'use strict';

/**
 * Fleet / Smart Route tests. Run with: npm test   (node --test, no extra dependencies)
 *
 * Logger and Supabase client are stubbed and the provider keys are forced
 * empty *before* anything loads config, so no test can reach a real database
 * or spend real Google/TomTom quota even if a developer's backend/.env has keys.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

process.env.GOOGLE_MAPS_API_KEY = '';
process.env.TOMTOM_API_KEY = '';
process.env.DEMO_MODE = 'true';
process.env.NODE_ENV = 'test';

function stubModule(relativePath, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule('src/lib/logger.js', { warn() {}, error() {}, info() {}, debug() {} });
// Tests that need a database swap in a fake client; everything else sees none.
let fakeClient = null;
stubModule('src/config/supabase.js', { getSupabase: () => fakeClient });

const config = require('../src/config/env');
const geo = require('../src/services/fleet/geo');
const { aggregateSafety } = require('../src/services/fleet/safety');
const { syntheticDemoCells, createHeatmapService } = require('../src/services/fleet/heatmap');
const sustainability = require('../src/services/fleet/sustainability');
const carpool = require('../src/services/fleet/carpoolMatcher');
const { optimizeRoute } = require('../src/services/fleet/routeOptimizer');

const origin = { lat: 26.9124, lng: 75.7873 };
const destination = { lat: 26.8467, lng: 75.8063 };

/* --------------------------------------------------------------------- geo */

test('geo: haversine of the Jaipur sample trip is ~7-9 km', () => {
  const km = geo.haversineKm(origin, destination);
  assert.ok(km > 7 && km < 9, String(km));
});

test('geo: gridKey is stable, rejects junk, precision is clamped', () => {
  assert.equal(geo.gridKey(26.9124, 75.7873, 3), geo.gridKey(26.9125, 75.7874, 3));
  assert.equal(geo.gridKey('x', null, 3), 'invalid-cell');
  // Coordinates rounded to 3 decimals sit exactly on a cell edge; float noise
  // must not push them into the neighbouring cell.
  assert.equal(geo.gridKey(26.9, 75.8, 3), geo.gridKey(26.9001, 75.8001, 3));
  assert.equal(geo.gridKey(26.9, 75.8, 3), '26.900:75.800');
  assert.equal(geo.normalizePrecision(999), 6);
  assert.equal(geo.normalizePrecision('x'), 3);
});

test('geo: assertPoint rejects missing and out-of-range coordinates', () => {
  assert.throws(() => geo.assertPoint(null, 'origin'), /origin/);
  assert.throws(() => geo.assertPoint({ lat: 'x', lng: 1 }, 'origin'), /numeric/);
  assert.throws(() => geo.assertPoint({ lat: 91, lng: 0 }, 'origin'), /invalid coordinate/);
  assert.doesNotThrow(() => geo.assertPoint(origin, 'origin'));
});

test('geo: decodePolyline matches the published Google example', () => {
  assert.deepEqual(geo.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
});

test('geo: decodePolyline tolerates empty and truncated input', () => {
  assert.deepEqual(geo.decodePolyline(''), []);
  assert.deepEqual(geo.decodePolyline(null), []);
  // First point complete, second point cut off mid-value.
  assert.equal(geo.decodePolyline('_p~iF~ps|U_ulL').length, 1);
});

test('geo: thinPoints caps length and keeps both endpoints', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ lat: i, lng: i }));
  const thin = geo.thinPoints(pts, 50);
  assert.equal(thin.length, 50);
  assert.equal(thin[0], pts[0]);
  assert.equal(thin[49], pts[999]);
  assert.equal(geo.thinPoints(pts.slice(0, 10), 50).length, 10);
});

/* ------------------------------------------------------------------ safety */

test('safety: demo fallback scores 0-100 and is labelled', () => {
  const s = aggregateSafety([origin, destination], [], [], null);
  assert.ok(s.overall >= 0 && s.overall <= 100);
  assert.equal(s.confidence, 'demo-fallback');
});

test('safety: congestion and incidents lower their sub-scores', () => {
  const base = aggregateSafety([origin], [], [], null);
  assert.ok(aggregateSafety([origin], [], [], { congestionRatio: 0.9 }).traffic < base.traffic);
  assert.ok(aggregateSafety([origin], [], [{ severity: 80 }, { severity: 60 }], null).incidents < base.incidents);
});

test('safety: a zone only applies within its own radius', () => {
  const nearby = { lat: origin.lat, lng: origin.lng, radius_m: 500, lighting: 20 };
  const far = { lat: origin.lat + 0.05, lng: origin.lng, radius_m: 500, lighting: 20 }; // ~5.5 km away

  const used = aggregateSafety([origin], [nearby], [], null);
  assert.equal(used.confidence, 'data-backed');
  assert.equal(used.lighting, 20);

  const ignored = aggregateSafety([origin], [far], [], null);
  assert.equal(ignored.confidence, 'demo-fallback');
  assert.equal(ignored.lighting, 70);
});

/* ----------------------------------------------------------------- heatmap */

test('heatmap: synthetic grid is 30 unique, north-first, demo-labelled cells', () => {
  const cells = syntheticDemoCells({ north: 26.94, south: 26.82, east: 75.86, west: 75.74 });
  assert.equal(cells.length, 30);
  assert.equal(new Set(cells.map((c) => c.key)).size, 30);
  assert.ok(cells[0].lat > cells[cells.length - 1].lat);
  assert.ok(cells.every((c) => c.demo === true));
});

test('heatmap: real-data path aggregates zones inside the bounds only', async () => {
  const service = createHeatmapService({
    dataSource: {
      enabled: true,
      getSafetyZonesNear: async () => [
        { lat: 26.9, lng: 75.8, lighting: 60, incidents: 10 },
        { lat: 26.9001, lng: 75.8001, lighting: 80, incidents: 30 },
        { lat: 10, lng: 10, lighting: 1, incidents: 99 }, // outside bounds
      ],
    },
  });
  const cells = await service.getCells({ north: 26.94, south: 26.82, east: 75.86, west: 75.74 });
  assert.equal(cells.length, 1);
  assert.equal(cells[0].sampleCount, 2);
  assert.equal(cells[0].lighting, 70);
  assert.equal(cells[0].incidents, 20);
});

/* -------------------------------------------------------- supabase adapter */

// Minimal chainable stand-in for the supabase-js query builder.
function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = { table, filters: [] };
      const builder = {
        select(columns) { query.select = columns; return builder; },
        neq(column, value) { query.filters.push(['neq', column, value]); return builder; },
        gte(column, value) { query.filters.push(['gte', column, value]); return builder; },
        lte(column, value) { query.filters.push(['lte', column, value]); return builder; },
        limit(n) { query.limit = n; return builder; },
        abortSignal(signal) { query.signal = signal; return builder; },
        then(resolve, reject) {
          calls.push(query);
          return Promise.resolve(tables[table] ? tables[table](query) : { data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('adapter: maps safety_zones columns, caches, and shares one query between callers', async () => {
  const client = fakeSupabase({
    safety_zones: () => ({
      data: [{ id: 'z1', name: 'MI Road', lat: 26.91, lng: 75.79, radius_m: 600, lighting_index: 40, incident_index: 55, cctv_coverage: 10 }],
      error: null,
    }),
  });
  fakeClient = client;
  try {
    const { createSupabaseDataSource } = require('../src/services/fleet/supabaseData');
    const source = createSupabaseDataSource();
    assert.equal(source.enabled, true);

    const [a, b] = await Promise.all([source.getSafetyZonesNear(), source.getSafetyZonesNear()]);
    assert.deepEqual(a, b);
    assert.equal(a[0].lighting, 40);
    assert.equal(a[0].incidents, 55);
    assert.equal(a[0].radius_m, 600);
    await source.getSafetyZonesNear();
    assert.equal(client.calls.filter((c) => c.table === 'safety_zones').length, 1, 'concurrent + repeat calls must share one query');
    assert.ok(client.calls[0].signal, 'query must carry a timeout signal');
  } finally {
    fakeClient = null;
  }
});

test('adapter: recent incidents read coordinates only, skip cancelled, and keep only rows within 1 km', async () => {
  const route = [origin, { lat: origin.lat, lng: origin.lng + 0.01 }];
  const client = fakeSupabase({
    sos_events: () => ({
      data: [
        { lat: origin.lat + 0.001, lng: origin.lng, created_at: new Date().toISOString() }, // ~110 m
        { lat: origin.lat + 0.0095, lng: origin.lng, created_at: new Date().toISOString() }, // ~1.05 km: inside the bbox padding, outside 1 km
      ],
      error: null,
    }),
  });
  fakeClient = client;
  try {
    const { createSupabaseDataSource } = require('../src/services/fleet/supabaseData');
    const rows = await createSupabaseDataSource().getRecentIncidentsNear(route);
    assert.equal(rows.length, 1);

    const query = client.calls.find((c) => c.table === 'sos_events');
    assert.equal(query.select, 'lat, lng, created_at', 'no reporter id / label / org may be read');
    assert.ok(query.filters.some(([op, col, val]) => op === 'neq' && col === 'status' && val === 'cancelled'));
    assert.ok(query.filters.some(([op, col]) => op === 'gte' && col === 'created_at'));
  } finally {
    fakeClient = null;
  }
});

test('adapter: database errors degrade to empty data instead of throwing, and back off', async () => {
  const client = fakeSupabase({
    safety_zones: () => ({ data: null, error: { message: 'boom' } }),
    sos_events: () => ({ data: null, error: { message: 'boom' } }),
  });
  fakeClient = client;
  try {
    const { createSupabaseDataSource } = require('../src/services/fleet/supabaseData');
    const source = createSupabaseDataSource();
    assert.deepEqual(await source.getSafetyZonesNear(), []);
    assert.deepEqual(await source.getSafetyZonesNear(), []);
    assert.equal(client.calls.filter((c) => c.table === 'safety_zones').length, 1, 'a failing table must not be re-queried on every call');
    assert.deepEqual(await source.getRecentIncidentsNear([origin]), []);
  } finally {
    fakeClient = null;
  }
});

/* ----------------------------------------------------------------- carpool */

test('carpool: demo seeds match, survive long uptime and work without requestedAt', () => {
  const later = new Date(Date.now() + 5 * 3_600_000).toISOString();
  assert.ok(carpool.findNearbyCarpool({ id: 'rider-1', origin, destination, requestedAt: later }));
  assert.ok(carpool.findNearbyCarpool({ id: 'rider-1', origin, destination }));
});

test('carpool: distant bookings are not matched and a rider never matches themself', () => {
  carpool.addBooking({
    id: 'far-booking',
    origin: { lat: 28.6, lng: 77.2 },
    destination: { lat: 28.7, lng: 77.3 },
  });
  const match = carpool.findNearbyCarpool({ id: 'rider-1', origin, destination });
  assert.notEqual(match?.bookingId, 'far-booking');
  assert.notEqual(
    carpool.findNearbyCarpool({ id: 'demo-passenger-a', origin, destination })?.bookingId,
    'demo-passenger-a'
  );
});

test('carpool: request starts unconfirmed; decline recorded; unknown id is null', () => {
  const request = carpool.requestCarpool('rider-1', 'demo-booking-b');
  assert.equal(request.status, 'pending_confirmation');
  assert.equal(carpool.confirmCarpool(request.id, false).status, 'declined');
  assert.equal(carpool.confirmCarpool('missing', true), null);
});

test('carpool: invalid bookings throw', () => {
  assert.throws(() => carpool.addBooking({ origin: { lat: 'x', lng: 1 }, destination }));
});

test('carpool: matching thresholds come from central config', () => {
  assert.deepEqual(carpool.matchingDefaults(), {
    maxPickupKm: config.CARPOOL_MAX_PICKUP_KM,
    maxDropoffKm: config.CARPOOL_MAX_DROPOFF_KM,
    maxTimeDiffMin: config.CARPOOL_MAX_TIME_DIFF_MIN,
  });
});

/* ---------------------------------------------------------- sustainability */

test('sustainability: CO2 and points arithmetic', () => {
  const impact = sustainability.estimateImpact({
    selectedDistanceKm: 8,
    baselineDistanceKm: 10,
    carpoolPassengers: 2,
  });
  assert.equal(impact.routeOptimization.co2SavedGrams, 384); // 2 km x 192 g
  assert.equal(impact.carpool.co2SavedGrams, 1536); // 8 km x 192 g
  assert.equal(impact.total.points, 38); // floor(1920 / 50)
  assert.equal(
    sustainability.estimateImpact({ selectedDistanceKm: 8, carpoolPassengers: 1 }).carpool.co2SavedGrams,
    0
  );
});

test('sustainability: recorded users are ranked and flagged as current', () => {
  const impact = sustainability.estimateImpact({ selectedDistanceKm: 8, baselineDistanceKm: 10, carpoolPassengers: 2 });
  sustainability.recordImpact({ userId: 'test-user', name: 'Test', impact });
  const rows = sustainability.getLeaderboard('test-user');
  assert.ok(rows.every((row, i) => row.rank === i + 1));
  assert.ok(rows.some((row) => row.id === 'test-user' && row.points === 38 && row.isCurrentUser));
});

/* ---------------------------------------------------------- route optimizer */

const passthroughSafety = async () => ({ overall: 70, lighting: 70, crowd: 70, incidents: 70, traffic: 70 });

test('optimizer: with no provider keys it serves labelled demo routes, best first', async () => {
  const result = await optimizeRoute({ origin, destination, safetyProvider: passthroughSafety });
  assert.equal(result.demoMode, true);
  assert.equal(result.routes.length, 3);
  assert.ok(result.routes.every((r) => r.demo === true && Number.isFinite(r.distanceKm)));
  assert.equal(result.recommendedRouteId, result.routes[0].id);
  assert.deepEqual(result.providerStatus, {
    google: 'missing_key',
    tomtomRouting: 'missing_key',
    tomtomTraffic: 'missing_key',
  });
});

test('optimizer: Google geometry is decoded so the map and safety scorer get real points', async () => {
  const realFetch = global.fetch;
  const seenPoints = [];
  config.GOOGLE_MAPS_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        routes: [
          {
            duration: '900s',
            staticDuration: '600s',
            distanceMeters: 8000,
            routeLabels: ['DEFAULT_ROUTE'],
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }),
  });
  try {
    const result = await optimizeRoute({
      origin,
      destination,
      safetyProvider: async ({ route }) => {
        seenPoints.push(route.points);
        return passthroughSafety();
      },
    });
    assert.equal(result.demoMode, false);
    assert.equal(result.providerStatus.google, 'ok');
    const [route] = result.routes;
    assert.equal(route.provider, 'google');
    assert.equal(route.trafficDelaySec, 300);
    assert.equal(route.points.length, 3);
    assert.deepEqual(route.points[0], { lat: 38.5, lng: -120.2 });
    assert.equal(seenPoints[0].length, 3, 'safety provider must receive the decoded geometry');
  } finally {
    global.fetch = realFetch;
    config.GOOGLE_MAPS_API_KEY = '';
  }
});

test('optimizer: a provider failure falls back to demo routes instead of throwing', async () => {
  const realFetch = global.fetch;
  config.GOOGLE_MAPS_API_KEY = 'test-key';
  global.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const result = await optimizeRoute({ origin, destination, safetyProvider: passthroughSafety });
    assert.equal(result.demoMode, true);
    assert.equal(result.providerStatus.google, 'error');
  } finally {
    global.fetch = realFetch;
    config.GOOGLE_MAPS_API_KEY = '';
  }
});

/* -------------------------------------------------------------- HTTP router */

async function withServer(fn) {
  const express = require('express');
  const { errorHandler } = require('../src/middleware/errorHandler');
  const router = require('../src/routes/fleet');

  const app = express();
  app.use(express.json());
  app.use('/api/fleet', router);
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/fleet`;
  try {
    await fn(async (route, options = {}) => {
      const response = await fetch(`${base}${route}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('http: health, validation errors and the demo happy path', async () => {
  await withServer(async (call) => {
    const health = await call('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.demoMode, true);
    assert.deepEqual(health.body.providers, { google: false, tomtom: false });

    const bad = await call('/optimize-route', { method: 'POST', body: { origin: { lat: 'x' } } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /origin/);

    const ok = await call('/optimize-route', {
      method: 'POST',
      body: { origin, destination, passengerId: 'http-rider' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.demoMode, true);
    assert.ok(ok.body.carpoolSuggestion, 'seeded demo booking should be suggested in demo mode');
    assert.equal(ok.body.dataMode, 'demo-safety-fallback');

    const search = await call('/search-location?q=jaipur');
    assert.equal(search.status, 503, 'search must fail clearly, not with a 500, when unconfigured');
    assert.equal((await call('/search-location')).status, 400);
  });
});

test('http: heatmap validates bounds and returns a labelled synthetic grid', async () => {
  await withServer(async (call) => {
    assert.equal((await call('/heatmap?north=1&south=0&east=1')).status, 400);
    const ok = await call('/heatmap?north=26.94&south=26.82&east=75.86&west=75.74');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.dataMode, 'demo-synthetic');
    assert.equal(ok.body.cells.length, 30);
  });
});

test('http: carpool request/confirm guard rails', async () => {
  await withServer(async (call) => {
    const post = (route, body) => call(route, { method: 'POST', body });
    assert.equal((await post('/carpool/request', {})).status, 400);
    assert.equal((await post('/carpool/request', { bookingId: 'a', matchedBookingId: 'a' })).status, 400);
    assert.equal((await post('/carpool/request', { bookingId: 'a', matchedBookingId: 'nope' })).status, 404);

    const created = await post('/carpool/request', { bookingId: 'rider-9', matchedBookingId: 'demo-booking-b' });
    assert.equal(created.status, 201);
    assert.equal((await post('/carpool/confirm', {})).status, 400);
    const confirmed = await post('/carpool/confirm', { requestId: created.body.request.id, confirmed: true });
    assert.equal(confirmed.body.request.status, 'confirmed');
    assert.equal((await post('/carpool/confirm', { requestId: 'missing' })).status, 404);
  });
});

test('http: sustainability impact, record and leaderboard', async () => {
  await withServer(async (call) => {
    const post = (route, body) => call(route, { method: 'POST', body });
    assert.equal((await post('/sustainability/impact', {})).status, 400);
    const { body } = await post('/sustainability/impact', {
      selectedDistanceKm: 8,
      baselineDistanceKm: 10,
      carpoolPassengers: 2,
    });
    assert.equal(body.impact.total.points, 38);

    assert.equal((await post('/sustainability/record', { userId: 'u', impact: {} })).status, 400);
    const recorded = await post('/sustainability/record', { userId: 'http-user', name: 'You', impact: body.impact });
    assert.equal(recorded.status, 201);
    const board = await call('/sustainability/leaderboard?userId=http-user');
    assert.ok(board.body.rows.some((r) => r.id === 'http-user' && r.isCurrentUser));
  });
});

test('http: malformed JSON is a 4xx, not a 500', async () => {
  await withServer(async () => {
    // Bypass the helper so the body really is invalid JSON.
    const express = require('express');
    const { errorHandler } = require('../src/middleware/errorHandler');
    const app = express();
    app.use(express.json());
    app.use('/api/fleet', require('../src/routes/fleet'));
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/fleet/optimize-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      });
      assert.equal(response.status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

/* ------------------------------------------------------------ production mode */

test('production mode never seeds demo bookings or demo leaderboard riders', () => {
  const script = `
    const c = require('./src/services/fleet/carpoolMatcher');
    const s = require('./src/services/fleet/sustainability');
    process.stdout.write(JSON.stringify({ bookings: c.listBookings().length, board: s.getLeaderboard().length }));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'false' },
  });
  assert.deepEqual(JSON.parse(out.toString()), { bookings: 0, board: 0 });
});
