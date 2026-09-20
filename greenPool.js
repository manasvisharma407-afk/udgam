'use strict';

const geo = require('../lib/geo');
const logger = require('../lib/logger');
const { getSupabase } = require('../config/supabase');

/**
 * Green Pool — women-only carpool matching.
 *
 * Emission factors are India-specific (grams CO2e per passenger-km), sourced
 * from CEA grid factors and MoRTH fleet averages. They live here as named
 * constants so the number the UI shows can always be traced back to an
 * assumption someone can argue with.
 */
const EMISSION_FACTORS_G_PER_KM = {
  petrol_car_solo: 171,
  diesel_car_solo: 186,
  auto_rickshaw: 108,
  two_wheeler: 62,
  ev_car_solo: 92, // grid-charged, CEA FY23 average intensity
  bus: 32,
  metro: 18,
};

const DEFAULT_BASELINE = 'petrol_car_solo';

/**
 * Route overlap score, 0–1.
 *
 * Two trips pool well when their endpoints are close *and* they head the same
 * way. Bearing agreement is checked explicitly so we never match someone
 * travelling north with someone travelling south past the same junction.
 */
function overlapScore(a, b, { maxDetourKm = 2.5 } = {}) {
  if (![a.origin, a.destination, b.origin, b.destination].every(geo.isValidPoint)) return 0;

  const bearingA = geo.bearingDeg(a.origin, a.destination);
  const bearingB = geo.bearingDeg(b.origin, b.destination);
  const headingDelta = geo.bearingDelta(bearingA, bearingB);
  if (headingDelta > 55) return 0; // heading meaningfully different ways

  // How far each rider deviates from the other's straight-line corridor.
  const detours = [
    geo.distanceToSegmentKm(b.origin, a.origin, a.destination),
    geo.distanceToSegmentKm(b.destination, a.origin, a.destination),
    geo.distanceToSegmentKm(a.origin, b.origin, b.destination),
    geo.distanceToSegmentKm(a.destination, b.origin, b.destination),
  ];
  const worstDetour = Math.max(...detours);
  if (worstDetour > maxDetourKm) return 0;

  const corridorScore = 1 - worstDetour / maxDetourKm;
  const headingScore = 1 - headingDelta / 55;

  const lenA = geo.haversineKm(a.origin, a.destination);
  const lenB = geo.haversineKm(b.origin, b.destination);
  // Penalise pairing a 2 km hop with a 30 km commute.
  const lengthScore = Math.min(lenA, lenB) / Math.max(lenA, lenB, 0.1);

  return Number((0.5 * corridorScore + 0.3 * headingScore + 0.2 * lengthScore).toFixed(4));
}

/** Time-window compatibility, 0–1. 20 minutes of slack is generous but usable. */
function timeScore(a, b, { toleranceMinutes = 20 } = {}) {
  const ta = new Date(a.departAt).getTime();
  const tb = new Date(b.departAt).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0.5;
  const deltaMin = Math.abs(ta - tb) / 60000;
  return deltaMin > toleranceMinutes ? 0 : 1 - deltaMin / toleranceMinutes;
}

/**
 * CO2 saved by pooling, in kilograms.
 *
 * The saving is the emissions of everyone driving separately minus the
 * emissions of one shared vehicle covering the pooled distance.
 */
function carbonSaved({ soloDistancesKm, pooledDistanceKm, baseline = DEFAULT_BASELINE }) {
  const factor = EMISSION_FACTORS_G_PER_KM[baseline] ?? EMISSION_FACTORS_G_PER_KM[DEFAULT_BASELINE];
  const soloGrams = soloDistancesKm.reduce((sum, km) => sum + km * factor, 0);
  const pooledGrams = pooledDistanceKm * factor;
  const savedGrams = Math.max(0, soloGrams - pooledGrams);

  return {
    baseline,
    factorGPerKm: factor,
    soloKg: Number((soloGrams / 1000).toFixed(2)),
    pooledKg: Number((pooledGrams / 1000).toFixed(2)),
    savedKg: Number((savedGrams / 1000).toFixed(2)),
    // Rough equivalence: a mature urban tree sequesters ~21 kg CO2 per year.
    treeDaysEquivalent: Number(((savedGrams / 1000 / 21) * 365).toFixed(1)),
    vehiclesRemoved: Math.max(0, soloDistancesKm.length - 1),
  };
}

/** Distance a single vehicle covers serving every rider (greedy corridor route). */
function pooledDistanceFor(trips) {
  if (trips.length === 0) return 0;
  const origins = trips.map((t) => t.origin);
  const destinations = trips.map((t) => t.destination);

  // Anchor on the longest leg, then add pickup/drop detours.
  const legs = trips.map((t) => geo.haversineKm(t.origin, t.destination));
  const anchorIdx = legs.indexOf(Math.max(...legs));
  const anchor = trips[anchorIdx];

  let distance = legs[anchorIdx];
  origins.forEach((o, i) => {
    if (i === anchorIdx) return;
    distance += geo.distanceToSegmentKm(o, anchor.origin, anchor.destination) * 2;
  });
  destinations.forEach((d, i) => {
    if (i === anchorIdx) return;
    distance += geo.distanceToSegmentKm(d, anchor.origin, anchor.destination) * 2;
  });

  return Number(distance.toFixed(2));
}

/**
 * Find pool matches for a trip request.
 * `candidates` are open trips already filtered to the requester's city.
 */
function matchTrip(request, candidates, { minScore = 0.45, limit = 8 } = {}) {
  return candidates
    .filter((c) => c.id !== request.id)
    .filter((c) => c.seatsAvailable > 0)
    // Green Pool is a women-only product; the filter is a hard gate, not a preference.
    .filter((c) => c.womenOnly !== false)
    .map((c) => {
      const route = overlapScore(request, c);
      const time = timeScore(request, c);
      const score = Number((0.7 * route + 0.3 * time).toFixed(4));

      const soloDistances = [
        geo.haversineKm(request.origin, request.destination),
        geo.haversineKm(c.origin, c.destination),
      ];
      const pooled = pooledDistanceFor([request, c]);

      return {
        trip: c,
        routeOverlap: route,
        timeCompatibility: Number(time.toFixed(4)),
        matchScore: score,
        pooledDistanceKm: pooled,
        carbon: carbonSaved({
          soloDistancesKm: soloDistances,
          pooledDistanceKm: pooled,
          baseline: request.baseline || DEFAULT_BASELINE,
        }),
      };
    })
    .filter((m) => m.routeOverlap > 0 && m.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

async function listOpenTrips({ city = null, near = null, radiusKm = 15 } = {}) {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('pool_trips')
    .select('*')
    .eq('status', 'open')
    .gte('depart_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .order('depart_at', { ascending: true })
    .limit(200);

  if (city) query = query.eq('city', city);

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, 'pool trip listing failed');
    return [];
  }

  const trips = (data || []).map(fromRow);
  if (!near || !geo.isValidPoint(near)) return trips;
  return trips.filter((t) => geo.haversineKm(near, t.origin) <= radiusKm);
}

function fromRow(row) {
  return {
    id: row.id,
    hostId: row.host_id,
    hostName: row.host_name,
    origin: { lat: row.origin_lat, lng: row.origin_lng },
    originLabel: row.origin_label,
    destination: { lat: row.dest_lat, lng: row.dest_lng },
    destinationLabel: row.dest_label,
    departAt: row.depart_at,
    seatsAvailable: row.seats_available,
    womenOnly: row.women_only,
    city: row.city,
    baseline: row.baseline_mode || DEFAULT_BASELINE,
    status: row.status,
  };
}

/** Aggregate impact for the dashboard. */
async function impactSummary({ orgId = null, sinceDays = 30 } = {}) {
  const supabase = getSupabase();
  if (!supabase) {
    return { rides: 0, savedKg: 0, vehiclesRemoved: 0, passengerKm: 0, sinceDays };
  }

  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  let query = supabase
    .from('pool_matches')
    .select('co2_saved_kg, pooled_distance_km, riders, created_at, org_id')
    .gte('created_at', since);

  if (orgId) query = query.eq('org_id', orgId);

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, 'impact summary failed');
    return { rides: 0, savedKg: 0, vehiclesRemoved: 0, passengerKm: 0, sinceDays };
  }

  const rows = data || [];
  return {
    sinceDays,
    rides: rows.length,
    savedKg: Number(rows.reduce((s, r) => s + (r.co2_saved_kg || 0), 0).toFixed(2)),
    vehiclesRemoved: rows.reduce((s, r) => s + Math.max(0, (r.riders || 1) - 1), 0),
    passengerKm: Number(
      rows.reduce((s, r) => s + (r.pooled_distance_km || 0) * (r.riders || 1), 0).toFixed(1)
    ),
  };
}

module.exports = {
  EMISSION_FACTORS_G_PER_KM,
  overlapScore,
  timeScore,
  carbonSaved,
  pooledDistanceFor,
  matchTrip,
  listOpenTrips,
  impactSummary,
};
