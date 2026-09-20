'use strict';

const { routeSamplePoints, haversineKm } = require('./geo');

/**
 * Route safety indicator for the fleet / Smart Route feature.
 *
 * Note this is a *different* blend from `services/safety.js` (which scores a
 * single location for the Safety and HerRides tabs and includes driver
 * vetting). Route scoring weighs live traffic instead of a driver, so the two
 * numbers are not interchangeable and are labelled "indicator" in the UI.
 */
const WEIGHTS = Object.freeze({ lighting: 0.4, crowd: 0.2, incidents: 0.25, traffic: 0.15 });

// A safety zone only describes the ground within its own radius. Without this
// cap the nearest zone would be applied to a route point kilometres away and
// the result would still be reported as "data-backed".
const DEFAULT_ZONE_RADIUS_M = 500;

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(row, keys) {
  for (const key of keys) {
    const n = numberOrNull(row?.[key]);
    if (n !== null) return n;
  }
  return null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value)));
}

function normalizeZone(row) {
  const lighting = firstNumber(row, ['lighting_score', 'lighting', 'light_score']);
  const crowd = firstNumber(row, ['crowd_score', 'crowd_density', 'activity_score', 'crowd']);
  const incidents = firstNumber(row, ['incident_score', 'safety_score', 'incident_safety_score']);
  return { lighting, crowd, incidents };
}

function normalizeIncident(row) {
  const severity = firstNumber(row, ['severity', 'risk_score', 'priority']);
  return severity === null ? 1 : clamp(severity, 0, 100) / 100;
}

function aggregateSafety(points, zones = [], incidents = [], traffic = null) {
  const nearestZones = [];
  for (const point of points) {
    let best = null;
    for (const zone of zones) {
      const z = zone?.center || { lat: zone?.lat, lng: zone?.lng };
      if (!Number.isFinite(Number(z?.lat)) || !Number.isFinite(Number(z?.lng))) continue;
      const d = haversineKm(point, z);
      const reachKm = (numberOrNull(zone?.radius_m) ?? DEFAULT_ZONE_RADIUS_M) / 1000;
      if (d > reachKm) continue;
      if (!best || d < best.d) best = { row: zone, d };
    }
    if (best) nearestZones.push(normalizeZone(best.row));
  }

  const avg = (key, fallback) => {
    const values = nearestZones.map((z) => z[key]).filter((v) => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
  };

  const lighting = clamp(avg('lighting', 70));
  const crowd = clamp(avg('crowd', 65));

  const recentIncidentCount = incidents.length;
  const incidentRisk = incidents.reduce((sum, row) => sum + normalizeIncident(row), 0);
  const incidentsScore = clamp(90 - recentIncidentCount * 8 - incidentRisk * 4);

  const congestion = traffic?.congestionRatio;
  const trafficScore =
    congestion === null || congestion === undefined ? 75 : clamp(100 - Number(congestion) * 100);

  const overall =
    lighting * WEIGHTS.lighting +
    crowd * WEIGHTS.crowd +
    incidentsScore * WEIGHTS.incidents +
    trafficScore * WEIGHTS.traffic;

  return {
    overall: Math.round(overall),
    lighting: Math.round(lighting),
    crowd: Math.round(crowd),
    incidents: Math.round(incidentsScore),
    traffic: Math.round(trafficScore),
    confidence: nearestZones.length || incidents.length ? 'data-backed' : 'demo-fallback',
    methodology: {
      weights: WEIGHTS,
      note: 'Risk indicator based on available aggregate/project signals; not a guarantee of safety.',
    },
  };
}

function createSafetyProvider({ dataSource, trafficProvider }) {
  return async ({ origin, destination, route, traffic }) => {
    const points = routeSamplePoints(route, origin, destination);
    const [zones, incidents] = await Promise.all([
      dataSource.getSafetyZonesNear(points),
      dataSource.getRecentIncidentsNear(points),
    ]);
    const liveTraffic = traffic || (await trafficProvider?.(points[0])) || null;
    return aggregateSafety(points, zones, incidents, liveTraffic);
  };
}

module.exports = { WEIGHTS, aggregateSafety, createSafetyProvider };
