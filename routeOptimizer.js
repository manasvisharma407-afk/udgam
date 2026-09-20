'use strict';

const config = require('../../config/env');
const logger = require('../../lib/logger');
const { assertPoint, haversineKm, decodePolyline, thinPoints } = require('./geo');

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TOMTOM_ROUTE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';
const TOMTOM_FLOW_URL =
  'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json';

// Enough vertices to draw a smooth line on a city-scale map without shipping
// several thousand points per route on every 60 s refresh.
const MAX_ROUTE_POINTS = 300;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeout || 8000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  // The status only — never the URL, which for TomTom carries the API key.
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`);
  return data;
}

function parseDuration(value) {
  const match = String(value || '').match(/^([0-9.]+)s$/);
  return match ? Number(match[1]) : 0;
}

async function googleRoutes(origin, destination) {
  if (!config.GOOGLE_MAPS_API_KEY) return { routes: [], status: 'missing_key' };
  try {
    const data = await request(GOOGLE_ROUTES_URL, {
      method: 'POST',
      timeout: 8000,
      headers: {
        'X-Goog-Api-Key': config.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeLabels',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin: {
          location: { latLng: { latitude: Number(origin.lat), longitude: Number(origin.lng) } },
        },
        destination: {
          location: {
            latLng: { latitude: Number(destination.lat), longitude: Number(destination.lng) },
          },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: true,
        languageCode: 'en-IN',
        units: 'METRIC',
      }),
    });
    return {
      status: 'ok',
      routes: (data?.routes || []).map((r, index) => ({
        provider: 'google',
        id: `google-${index}`,
        label: (r.routeLabels || []).includes('DEFAULT_ROUTE')
          ? 'Google default route'
          : `Google alternative ${index + 1}`,
        distanceKm: Number(r.distanceMeters || 0) / 1000,
        durationSec: parseDuration(r.duration),
        trafficDelaySec: Math.max(0, parseDuration(r.duration) - parseDuration(r.staticDuration)),
        // Decoded here so the map can draw it and the safety scorer samples the
        // real road geometry instead of a straight origin -> destination line.
        points: thinPoints(decodePolyline(r.polyline?.encodedPolyline), MAX_ROUTE_POINTS),
        labels: r.routeLabels || [],
      })),
    };
  } catch (error) {
    logger.warn({ err: error.message }, 'fleet: Google Routes request failed');
    return { routes: [], status: 'error', error: error.message };
  }
}

async function tomtomRoutes(origin, destination) {
  if (!config.TOMTOM_API_KEY) return { routes: [], status: 'missing_key' };
  try {
    const points = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
    const url = `${TOMTOM_ROUTE_URL}/${points}/json?${new URLSearchParams({
      key: config.TOMTOM_API_KEY,
      traffic: 'true',
      travelMode: 'car',
      routeType: 'fastest',
      maxAlternatives: '2',
    })}`;
    const data = await request(url, { timeout: 8000 });
    return {
      status: 'ok',
      routes: (data?.routes || []).map((r, index) => {
        const summary = r.summary || {};
        const path = (r.legs || [])
          .flatMap((leg) => leg.points || [])
          .map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude) }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        return {
          provider: 'tomtom',
          id: `tomtom-${index}`,
          label: index === 0 ? 'TomTom fastest route' : `TomTom alternative ${index}`,
          distanceKm: Number(summary.lengthInMeters || 0) / 1000,
          durationSec: Number(summary.travelTimeInSeconds || 0),
          trafficDelaySec: Number(summary.trafficDelayInSeconds || 0),
          points: thinPoints(path, MAX_ROUTE_POINTS),
        };
      }),
    };
  } catch (error) {
    logger.warn({ err: error.message }, 'fleet: TomTom routing request failed');
    return { routes: [], status: 'error', error: error.message };
  }
}

async function tomtomTraffic(point) {
  if (!config.TOMTOM_API_KEY) return { status: 'missing_key', traffic: null };
  try {
    const params = new URLSearchParams({
      key: config.TOMTOM_API_KEY,
      point: `${point.lat},${point.lng}`,
      unit: 'KMPH',
    });
    const data = await request(`${TOMTOM_FLOW_URL}?${params}`, { timeout: 5000 });
    const d = data?.flowSegmentData;
    if (!d) return { status: 'unavailable', traffic: null };
    const current = Number(d.currentSpeed || 0);
    const freeFlow = Number(d.freeFlow || current || 1);
    return {
      status: 'ok',
      traffic: {
        currentSpeedKmh: current,
        freeFlowSpeedKmh: freeFlow,
        congestionRatio: Math.max(0, Math.min(1, 1 - current / freeFlow)),
        confidence: Number(d.confidence || 0),
      },
    };
  } catch (error) {
    logger.warn({ err: error.message }, 'fleet: TomTom traffic request failed');
    return { status: 'error', traffic: null, error: error.message };
  }
}

function scoreRoute(route, safety) {
  const safetyScore = Math.max(0, Math.min(100, Number(safety?.overall ?? 50)));
  const trafficPenalty = Math.max(0, Math.min(30, Number(route.trafficDelaySec || 0) / 60));
  const timePenalty = Math.max(0, Math.min(20, Number(route.durationSec || 0) / 180));
  return (
    Math.round((safetyScore * 0.65 + (100 - trafficPenalty) * 0.2 + (100 - timePenalty) * 0.15) * 10) /
    10
  );
}

function demoRoute(origin, destination, variant = 0) {
  const distanceKm = haversineKm(origin, destination);
  const variants = [
    { id: 'demo-fast', label: 'Fastest demo route', distanceFactor: 1.0, minutesPerKm: 3.0, delay: 0 },
    { id: 'demo-balanced', label: 'Balanced demo route', distanceFactor: 1.08, minutesPerKm: 3.15, delay: 2 },
    { id: 'demo-activity', label: 'Higher-activity demo route', distanceFactor: 1.15, minutesPerKm: 3.25, delay: 4 },
  ];
  const v = variants[variant % variants.length];
  return {
    provider: 'demo',
    id: v.id,
    label: v.label,
    distanceKm: distanceKm * v.distanceFactor,
    durationSec: Math.round(distanceKm * v.minutesPerKm * 60 + v.delay * 60),
    trafficDelaySec: v.delay * 60,
    points: [origin, destination],
    demo: true,
  };
}

async function optimizeRoute({ origin, destination, safetyProvider }) {
  assertPoint(origin, 'origin');
  assertPoint(destination, 'destination');

  const [googleResult, tomtomResult, trafficResult] = await Promise.all([
    googleRoutes(origin, destination),
    tomtomRoutes(origin, destination),
    tomtomTraffic(origin),
  ]);

  let routes = [...googleResult.routes, ...tomtomResult.routes];
  let demoMode = false;
  if (!routes.length) {
    routes = [0, 1, 2].map((variant) => demoRoute(origin, destination, variant));
    demoMode = true;
  }

  // A provider can return a route with a missing/zero distance. Fall back to the
  // straight-line estimate so the UI never renders NaN or throws on toFixed().
  const fallbackKm = haversineKm(origin, destination);
  routes = routes.map((route, index) => ({
    ...route,
    id: route.id || `route-${index}`,
    distanceKm:
      Number.isFinite(Number(route.distanceKm)) && Number(route.distanceKm) > 0
        ? Number(route.distanceKm)
        : fallbackKm,
    durationSec:
      Number.isFinite(Number(route.durationSec)) && Number(route.durationSec) > 0
        ? Number(route.durationSec)
        : Math.round(fallbackKm * 180),
    trafficDelaySec: Number.isFinite(Number(route.trafficDelaySec)) ? Number(route.trafficDelaySec) : 0,
  }));

  const enriched = await Promise.all(
    routes.map(async (route) => {
      const safety = await safetyProvider({ origin, destination, route, traffic: trafficResult.traffic });
      return { ...route, safety, traffic: trafficResult.traffic, optimizationScore: scoreRoute(route, safety) };
    })
  );
  enriched.sort((a, b) => b.optimizationScore - a.optimizationScore);

  return {
    generatedAt: new Date().toISOString(),
    demoMode,
    providerStatus: {
      google: googleResult.status,
      tomtomRouting: tomtomResult.status,
      tomtomTraffic: trafficResult.status,
    },
    routes: enriched,
    recommendedRouteId: enriched[0]?.id || null,
  };
}

module.exports = { optimizeRoute, scoreRoute };
