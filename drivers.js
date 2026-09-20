'use strict';

const geo = require('../lib/geo');
const logger = require('../lib/logger');
const presence = require('./presence');
const safety = require('./safety');
const { getSupabase } = require('../config/supabase');

/**
 * Driver verification and matching.
 *
 * A driver is only surfaced to a rider when `background_check_status` is
 * 'cleared' AND the licence has not expired. Verification state is computed
 * here rather than trusted from the client, and the badge list returned to the
 * UI is explicit — a rider should be able to see exactly which checks passed.
 */

function badgesFor(row) {
  const badges = [];
  if (row.id_verified) badges.push({ key: 'govt_id', label: 'Govt ID verified', icon: 'id-card' });
  if (row.background_check_status === 'cleared') {
    badges.push({ key: 'background', label: 'Background check cleared', icon: 'shield-check' });
  }
  if (row.police_verification) {
    badges.push({ key: 'police', label: 'Police verification on file', icon: 'badge' });
  }
  if (row.safety_training_completed) {
    badges.push({ key: 'training', label: 'Safety training completed', icon: 'graduation' });
  }
  if (row.gender === 'female') {
    badges.push({ key: 'her_rides', label: 'HerRides certified driver', icon: 'heart' });
  }
  if (row.vehicle_gps_enabled) {
    badges.push({ key: 'gps', label: 'Live GPS on vehicle', icon: 'satellite' });
  }
  return badges;
}

function licenceValid(row) {
  if (!row.licence_expiry) return false;
  return new Date(row.licence_expiry).getTime() > Date.now();
}

function isEligible(row) {
  return row.background_check_status === 'cleared' && row.id_verified && licenceValid(row);
}

function toPublicDriver(row, { distanceKm = null } = {}) {
  return {
    id: row.id,
    displayName: row.display_name,
    gender: row.gender,
    photoUrl: row.photo_url,
    rating: row.rating,
    completedTrips: row.completed_trips,
    languages: row.languages || [],
    vehicle: {
      make: row.vehicle_make,
      model: row.vehicle_model,
      colour: row.vehicle_colour,
      // Plate is shown in full only after a booking is confirmed; the listing
      // view gets a partial so a rider can still spot the car.
      plateMasked: maskPlate(row.vehicle_plate),
      type: row.vehicle_type,
    },
    verification: {
      eligible: isEligible(row),
      idVerified: Boolean(row.id_verified),
      backgroundCheck: row.background_check_status,
      backgroundCheckedAt: row.background_checked_at,
      policeVerification: Boolean(row.police_verification),
      licenceValid: licenceValid(row),
      safetyTraining: Boolean(row.safety_training_completed),
      badges: badgesFor(row),
    },
    safetyScore: safety.driverScoreFor(row),
    complaints12m: row.complaints_12m ?? 0,
    distanceKm: distanceKm === null ? null : Number(distanceKm.toFixed(2)),
    etaMinutes: distanceKm === null ? null : geo.etaMinutes(distanceKm),
  };
}

function maskPlate(plate) {
  if (!plate) return null;
  const clean = String(plate).replace(/\s+/g, '');
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 2)}•••${clean.slice(-4)}`;
}

async function fetchDriverRows(ids) {
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) return new Map();

  const { data, error } = await supabase.from('drivers').select('*').in('id', ids);
  if (error) {
    logger.error({ err: error }, 'driver lookup failed');
    return new Map();
  }
  return new Map((data || []).map((row) => [row.id, row]));
}

/**
 * Nearby drivers for a rider.
 * `womenOnly` defaults to true — that is the RaahSaathi product promise.
 */
async function nearbyDrivers(center, { radiusKm = 5, womenOnly = true, limit = 20 } = {}) {
  const online = presence.near(center, radiusKm, (r) => r.role === 'driver');
  const rows = await fetchDriverRows(online.map((r) => r.userId));

  const drivers = online
    .map((p) => {
      const row = rows.get(p.userId);
      if (!row) return null;
      if (womenOnly && row.gender !== 'female') return null;
      if (!isEligible(row)) return null;
      return toPublicDriver(row, { distanceKm: p.distanceKm });
    })
    .filter(Boolean)
    .slice(0, limit);

  return drivers;
}

async function getDriver(id) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from('drivers').select('*').eq('id', id).maybeSingle();
  if (error) {
    logger.error({ err: error, id }, 'driver fetch failed');
    return null;
  }
  return data ? toPublicDriver(data) : null;
}

module.exports = { nearbyDrivers, getDriver, toPublicDriver, isEligible, badgesFor };
