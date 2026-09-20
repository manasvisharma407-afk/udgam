'use strict';

/**
 * Geometry helpers for the fleet / Smart Route feature.
 *
 * Deliberately separate from `lib/geo.js`: that module's `haversineKm` returns
 * `Infinity` for an invalid point (safe for dispatch ranking), whereas the
 * fleet code validates at the API boundary with `assertPoint` and then expects
 * plain numbers back. Merging them would change behaviour for one side.
 */

function assertPoint(point, name) {
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) {
    throw new Error(`${name} must contain numeric lat/lng`);
  }
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error(`${name} contains an invalid coordinate`);
  }
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((Number(b.lat) - Number(a.lat)) * Math.PI) / 180;
  const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180;
  const lat1 = (Number(a.lat) * Math.PI) / 180;
  const lat2 = (Number(b.lat) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

function interpolate(a, b, count = 10) {
  const n = Math.max(2, count);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return {
      lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * t,
      lng: Number(a.lng) + (Number(b.lng) - Number(a.lng)) * t,
    };
  });
}

function routeSamplePoints(route, origin, destination, count = 12) {
  if (Array.isArray(route?.points) && route.points.length > 1) {
    const step = Math.max(1, Math.floor(route.points.length / count));
    const sampled = route.points.filter((_, i) => i % step === 0).slice(0, count);
    return sampled.length >= 2 ? sampled : interpolate(origin, destination, count);
  }
  return interpolate(origin, destination, count);
}

function normalizePrecision(precision) {
  const n = Math.round(Number(precision));
  return Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : 3;
}

function gridKey(lat, lng, precision = 3) {
  const p = normalizePrecision(precision);
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return 'invalid-cell';
  // Scale up and round off float noise before flooring. Dividing by a size such
  // as 0.001 turns 26.9 into 26899.999999999996, which floors into the wrong
  // cell — and coordinates rounded to 3 decimals sit exactly on cell edges.
  const scale = 10 ** p;
  const snap = (value) => Math.floor(Math.round(value * scale * 1e6) / 1e6);
  const cellLat = snap(latNum) / scale;
  const cellLng = snap(lngNum) / scale;
  return `${cellLat.toFixed(p)}:${cellLng.toFixed(p)}`;
}

/**
 * Decode a Google encoded polyline (precision 1e5) into `{ lat, lng }` points.
 *
 * The Routes API returns geometry only in this form. Without decoding it, a
 * Google route has no `points`, so the map draws nothing and safety scoring
 * silently falls back to a straight line between origin and destination.
 * Truncated / malformed input yields the points decoded so far, never a throw.
 */
function decodePolyline(encoded) {
  const str = String(encoded || '');
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  // Reads one signed varint; returns null if the string ends mid-value.
  function readDelta() {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= str.length) return null;
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < str.length) {
    const dLat = readDelta();
    const dLng = dLat === null ? null : readDelta();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/**
 * Evenly thin a path to at most `max` points (always keeping first and last).
 * Provider geometry can run to thousands of points per route, and the
 * optimizer refreshes every 60 s — this keeps the JSON payload small.
 */
function thinPoints(points, max = 300) {
  if (!Array.isArray(points) || points.length <= max || max < 2) return points || [];
  const out = [];
  const stride = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * stride)]);
  return out;
}

module.exports = {
  assertPoint,
  haversineKm,
  routeSamplePoints,
  gridKey,
  normalizePrecision,
  decodePolyline,
  thinPoints,
};
