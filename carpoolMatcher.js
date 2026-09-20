'use strict';

const config = require('../../config/env');
const { haversineKm, assertPoint } = require('./geo');

/**
 * In-memory booking pool and carpool matching for Smart Route.
 *
 * State lives in this process only (like `services/presence.js`), so it is
 * lost on restart and not shared between instances. Horizontal scaling would
 * need the `carpool_requests` table from supabase/001_fleet_operations.sql.
 */
const bookings = new Map();
const carpoolRequests = new Map();

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function matchingDefaults() {
  return {
    maxPickupKm: config.CARPOOL_MAX_PICKUP_KM,
    maxDropoffKm: config.CARPOOL_MAX_DROPOFF_KM,
    maxTimeDiffMin: config.CARPOOL_MAX_TIME_DIFF_MIN,
  };
}

function toTimestamp(value, fallback = Date.now()) {
  const t = new Date(value ?? '').getTime();
  return Number.isFinite(t) ? t : fallback;
}

function addBooking(booking) {
  assertPoint(booking.origin, 'booking.origin');
  assertPoint(booking.destination, 'booking.destination');
  const stored = {
    id: booking.id || nextId('booking'),
    passengerId: booking.passengerId || null,
    origin: booking.origin,
    destination: booking.destination,
    requestedAt: new Date(toTimestamp(booking.requestedAt)).toISOString(),
    status: 'pending',
    demoSeed: Boolean(booking.demoSeed),
    createdAt: booking.createdAt || new Date().toISOString(),
  };
  bookings.set(stored.id, stored);
  return stored;
}

function getBooking(id) {
  return bookings.get(id) || null;
}

// The seeded demo bookings are anchored to server start time. Without this the
// demo silently stops matching once the process has been running for longer
// than the configured time window.
function refreshDemoSeedTimes(referenceMs = Date.now()) {
  let offset = 0;
  for (const booking of bookings.values()) {
    if (!booking.demoSeed) continue;
    booking.requestedAt = new Date(referenceMs + offset * 60000).toISOString();
    offset += 6;
  }
}

function findNearbyCarpool(candidate, options = {}) {
  const defaults = matchingDefaults();
  const maxPickupKm = options.maxPickupKm ?? defaults.maxPickupKm;
  const maxDropoffKm = options.maxDropoffKm ?? defaults.maxDropoffKm;
  const maxTimeDiffMin = options.maxTimeDiffMin ?? defaults.maxTimeDiffMin;
  assertPoint(candidate?.origin, 'candidate.origin');
  assertPoint(candidate?.destination, 'candidate.destination');

  const candidateTime = toTimestamp(candidate.requestedAt);
  refreshDemoSeedTimes(candidateTime);

  const matches = [];
  for (const booking of bookings.values()) {
    if (booking.id === candidate.id || booking.passengerId === candidate.id) continue;
    if (booking.status !== 'pending') continue;
    const pickupDistance = haversineKm(candidate.origin, booking.origin);
    const dropoffDistance = haversineKm(candidate.destination, booking.destination);
    const timeDiffMin =
      Math.abs(candidateTime - toTimestamp(booking.requestedAt, candidateTime)) / 60000;
    if (pickupDistance <= maxPickupKm && dropoffDistance <= maxDropoffKm && timeDiffMin <= maxTimeDiffMin) {
      matches.push({
        bookingId: booking.id,
        pickupDistanceKm: Number(pickupDistance.toFixed(2)),
        dropoffDistanceKm: Number(dropoffDistance.toFixed(2)),
        timeDifferenceMin: Number(timeDiffMin.toFixed(1)),
      });
    }
  }
  matches.sort(
    (a, b) => a.pickupDistanceKm + a.dropoffDistanceKm - (b.pickupDistanceKm + b.dropoffDistanceKm)
  );
  return matches[0] || null;
}

function requestCarpool(bookingId, matchedBookingId) {
  const id = nextId('carpool');
  const request = {
    id,
    bookingId,
    matchedBookingId,
    status: 'pending_confirmation',
    createdAt: new Date().toISOString(),
  };
  carpoolRequests.set(id, request);
  return request;
}

function confirmCarpool(requestId, confirmed) {
  const request = carpoolRequests.get(requestId);
  if (!request) return null;
  request.status = confirmed ? 'confirmed' : 'declined';
  request.updatedAt = new Date().toISOString();
  return request;
}

function listBookings() {
  return [...bookings.values()];
}

// Two clearly labelled synthetic bookings so the confirmation flow can be
// demonstrated without a database. Seeded ONLY in demo mode: in production a
// rider must never be offered a carpool with a booking that does not exist.
function seedDemoBookings() {
  const now = Date.now();
  addBooking({
    id: 'demo-passenger-a',
    passengerId: 'demo-passenger-a',
    demoSeed: true,
    origin: { lat: 26.9124, lng: 75.7873 },
    destination: { lat: 26.8467, lng: 75.8063 },
    requestedAt: new Date(now).toISOString(),
  });
  addBooking({
    id: 'demo-booking-b',
    passengerId: 'demo-passenger-b',
    demoSeed: true,
    origin: { lat: 26.921, lng: 75.79 },
    destination: { lat: 26.854, lng: 75.811 },
    requestedAt: new Date(now + 6 * 60000).toISOString(),
  });
}
if (config.demoMode) seedDemoBookings();

module.exports = {
  addBooking,
  getBooking,
  findNearbyCarpool,
  requestCarpool,
  confirmCarpool,
  listBookings,
  matchingDefaults,
};
