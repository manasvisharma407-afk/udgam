'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('../config/env');
const logger = require('../lib/logger');
const { asyncHandler } = require('../middleware/errorHandler');

const { optimizeRoute } = require('../services/fleet/routeOptimizer');
const { createSafetyProvider } = require('../services/fleet/safety');
const { createSupabaseDataSource } = require('../services/fleet/supabaseData');
const { createHeatmapService } = require('../services/fleet/heatmap');
const {
  addBooking,
  getBooking,
  findNearbyCarpool,
  requestCarpool,
  confirmCarpool,
  listBookings,
  matchingDefaults,
} = require('../services/fleet/carpoolMatcher');
const { assertPoint } = require('../services/fleet/geo');
const { estimateImpact, recordImpact, getLeaderboard } = require('../services/fleet/sustainability');

/**
 * Fleet operations / Smart Route API, mounted at /api/fleet by routes/index.js.
 *
 * Response contract: validation failures return `{ error: '<human message>' }`
 * with a 4xx status, which is what the Smart Route components read. Anything
 * unexpected is passed to the app-wide errorHandler.
 *
 * No auth middleware, deliberately matching /api/chatbot and /api/safety/score:
 * the web client does not send a token yet. Because several routes spend a paid
 * provider quota (Google Routes, TomTom), every route is rate limited. Add
 * `requireAuth` once Supabase Auth fronts the app — see README "Known gaps".
 */
const router = express.Router();

const dataSource = createSupabaseDataSource();
const safetyProvider = createSafetyProvider({ dataSource });
const heatmapService = createHeatmapService({ dataSource });

const limiterOptions = { windowMs: 60_000, standardHeaders: true, legacyHeaders: false };
const readLimiter = rateLimit({ ...limiterOptions, limit: 120 });
const writeLimiter = rateLimit({ ...limiterOptions, limit: 30 });
// Routes that call paid third-party APIs on every request.
const providerLimiter = rateLimit({
  ...limiterOptions,
  limit: 30,
  message: { error: 'Too many requests. Please wait a moment.' },
});

const googleConfigured = () => Boolean(config.GOOGLE_MAPS_API_KEY);
const tomtomConfigured = () => Boolean(config.TOMTOM_API_KEY);

/* ------------------------------------------------------------------ health */

router.get('/health', readLimiter, (req, res) => {
  res.json({
    ok: true,
    supabaseDataSource: dataSource.enabled,
    providers: { google: googleConfigured(), tomtom: tomtomConfigured() },
    demoMode: !dataSource.enabled && !googleConfigured() && !tomtomConfigured(),
    carpoolMatching: matchingDefaults(),
    generatedAt: new Date().toISOString(),
  });
});

/* ---------------------------------------------------- TomTom location search */

router.get(
  '/search-location',
  providerLimiter,
  asyncHandler(async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 120);
    if (!query) return res.status(400).json({ error: 'Location query is required' });

    if (!tomtomConfigured()) {
      return res
        .status(503)
        .json({ error: 'Location search needs TOMTOM_API_KEY to be set on the server.' });
    }

    const url =
      `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?` +
      new URLSearchParams({ key: config.TOMTOM_API_KEY, limit: '5', countrySet: 'IN' });

    let data;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`TomTom search failed: ${response.status}`);
      data = await response.json();
    } catch (error) {
      logger.warn({ err: error.message }, 'fleet: location search failed');
      return res.status(502).json({ error: 'Location search is temporarily unavailable.' });
    }

    const results = (data.results || []).map((item) => ({
      name: item.poi?.name || item.address?.freeformAddress || query,
      address: item.address?.freeformAddress || '',
      lat: item.position?.lat,
      lng: item.position?.lon,
    }));

    res.json({ query, results });
  })
);

/* ------------------------------------------------------- route optimization */

router.post(
  '/optimize-route',
  providerLimiter,
  asyncHandler(async (req, res) => {
    const { origin, destination, passengerId, requestedAt } = req.body || {};

    try {
      assertPoint(origin, 'origin');
      assertPoint(destination, 'destination');
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const result = await optimizeRoute({ origin, destination, safetyProvider });

    const carpoolSuggestion = passengerId
      ? findNearbyCarpool({
          id: passengerId,
          origin,
          destination,
          requestedAt: requestedAt || new Date().toISOString(),
        })
      : null;

    res.json({
      ...result,
      carpoolSuggestion,
      dataMode: dataSource.enabled ? 'supabase' : 'demo-safety-fallback',
    });
  })
);

/* ---------------------------------------------------------------- bookings */

router.post('/bookings', writeLimiter, (req, res) => {
  try {
    const booking = addBooking(req.body || {});
    res.status(201).json({ booking, message: 'Booking added to the carpool matching pool.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/bookings', readLimiter, (req, res) => res.json({ bookings: listBookings() }));

/* ----------------------------------------------------------------- carpool */

router.post('/carpool/suggestions', writeLimiter, (req, res) => {
  try {
    res.json({ suggestion: findNearbyCarpool(req.body || {}) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/carpool/request', writeLimiter, (req, res) => {
  const { bookingId, matchedBookingId } = req.body || {};

  if (!bookingId || !matchedBookingId) {
    return res.status(400).json({ error: 'bookingId and matchedBookingId are required' });
  }
  if (bookingId === matchedBookingId) {
    return res.status(400).json({ error: 'A booking cannot be carpooled with itself' });
  }
  if (!getBooking(matchedBookingId)) {
    return res.status(404).json({ error: 'matchedBookingId is not in the booking pool' });
  }

  res.status(201).json({ request: requestCarpool(bookingId, matchedBookingId) });
});

router.post('/carpool/confirm', writeLimiter, (req, res) => {
  const { requestId, confirmed } = req.body || {};

  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  const request = confirmCarpool(requestId, Boolean(confirmed));
  if (!request) return res.status(404).json({ error: 'Carpool request not found' });

  res.json({ request });
});

/* ---------------------------------------------------------- sustainability */

router.post('/sustainability/impact', writeLimiter, (req, res) => {
  try {
    const { selectedDistanceKm, baselineDistanceKm, carpoolPassengers = 1 } = req.body || {};

    if (!Number.isFinite(Number(selectedDistanceKm))) {
      return res.status(400).json({ error: 'selectedDistanceKm is required' });
    }

    res.json({
      impact: estimateImpact({ selectedDistanceKm, baselineDistanceKm, carpoolPassengers }),
      dataMode: 'prototype-estimate',
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to estimate sustainability impact' });
  }
});

router.get('/sustainability/leaderboard', readLimiter, (req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    rows: getLeaderboard(req.query.userId || null),
    dataMode: 'demo-in-memory',
  });
});

router.post('/sustainability/record', writeLimiter, (req, res) => {
  try {
    const { userId, name, impact } = req.body || {};

    if (!userId || !impact || typeof impact.total !== 'object' || impact.total === null) {
      return res.status(400).json({ error: 'userId and a full impact object are required' });
    }

    const user = recordImpact({ userId, name, impact });
    res.status(201).json({
      user,
      rows: getLeaderboard(userId),
      message: 'Sustainability points recorded for this prototype trip.',
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to record sustainability impact' });
  }
});

/* ----------------------------------------------------------------- heat map */

router.get(
  '/heatmap',
  readLimiter,
  asyncHandler(async (req, res) => {
    const { north, south, east, west, precision = 3 } = req.query;

    for (const [name, value] of Object.entries({ north, south, east, west })) {
      if (value === undefined || value === '' || !Number.isFinite(Number(value))) {
        return res.status(400).json({ error: `${name} is required and must be numeric` });
      }
    }

    const cells = await heatmapService.getCells({ north, south, east, west, precision });

    res.json({
      generatedAt: new Date().toISOString(),
      aggregated: true,
      cells,
      dataMode: dataSource.enabled ? 'supabase' : 'demo-synthetic',
    });
  })
);

module.exports = router;
