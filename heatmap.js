'use strict';

const { gridKey, normalizePrecision } = require('./geo');

function normalizeBounds({ north, south, east, west }) {
  const n = Number(north);
  const s = Number(south);
  const e = Number(east);
  const w = Number(west);
  return {
    north: Math.max(n, s),
    south: Math.min(n, s),
    east: Math.max(e, w),
    west: Math.min(e, w),
  };
}

// Rows are generated from north down so the rendered grid reads like a map
// (top row = northern cells) instead of being vertically mirrored.
function syntheticDemoCells(bounds, precision = 3) {
  const { north, south, east, west } = normalizeBounds(bounds);
  const rows = 5;
  const cols = 6;
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lat = north - ((r + 0.5) / rows) * (north - south);
      const lng = west + ((c + 0.5) / cols) * (east - west);
      const variation = (r * 13 + c * 7) % 24;
      cells.push({
        key: `${gridKey(lat, lng, precision)}#${r}-${c}`,
        lat,
        lng,
        sampleCount: 10 + ((r + c) % 8),
        lighting: 64 + variation,
        crowd: 58 + ((r * 9 + c * 5) % 30),
        incidents: 2 + ((r + c) % 5),
        traffic: 18 + ((r * 11 + c * 4) % 52),
        demo: true,
      });
    }
  }
  return cells;
}

function createHeatmapService({ dataSource }) {
  return {
    async getCells(input) {
      const precision = normalizePrecision(input?.precision ?? 3);
      const bounds = normalizeBounds(input || {});
      const { north, south, east, west } = bounds;
      if (![north, south, east, west].every(Number.isFinite)) {
        throw new Error('north, south, east and west must be numeric');
      }
      if (!dataSource?.enabled) return syntheticDemoCells(bounds, precision);

      const zones = await dataSource.getSafetyZonesNear([
        { lat: (north + south) / 2, lng: (east + west) / 2 },
      ]);
      const cells = new Map();
      for (const row of zones || []) {
        const lat = Number(row.lat ?? row.latitude ?? row.center?.lat);
        const lng = Number(row.lng ?? row.longitude ?? row.center?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat > north || lat < south || lng > east || lng < west) continue;
        const key = gridKey(lat, lng, precision);
        const current = cells.get(key) || {
          key,
          lat,
          lng,
          count: 0,
          lighting: [],
          crowd: [],
          incidents: [],
          traffic: [],
        };
        current.count += 1;
        const lighting = Number(row.lighting_score ?? row.lighting ?? row.light_score);
        const crowd = Number(row.crowd_score ?? row.crowd_density ?? row.activity_score);
        const incidents = Number(row.incident_count ?? row.incidents);
        const traffic = Number(row.congestion ?? row.congestion_ratio);
        if (Number.isFinite(lighting)) current.lighting.push(lighting);
        if (Number.isFinite(crowd)) current.crowd.push(crowd);
        if (Number.isFinite(incidents)) current.incidents.push(incidents);
        if (Number.isFinite(traffic)) current.traffic.push(traffic <= 1 ? traffic * 100 : traffic);
        cells.set(key, current);
      }
      const average = (arr, fallback = null) =>
        arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : fallback;
      return [...cells.values()]
        .sort((a, b) => b.lat - a.lat || a.lng - b.lng)
        .map((c) => ({
          key: c.key,
          lat: c.lat,
          lng: c.lng,
          sampleCount: c.count,
          lighting: average(c.lighting),
          crowd: average(c.crowd),
          incidents: average(c.incidents, 0),
          traffic: average(c.traffic),
        }));
    },
  };
}

module.exports = { createHeatmapService, syntheticDemoCells, normalizeBounds };
