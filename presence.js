'use strict';

const config = require('../config/env');
const geo = require('../lib/geo');
const logger = require('../lib/logger');

/**
 * Live presence registry.
 *
 * Presence is intentionally *not* stored in Postgres: it changes every three
 * seconds per active user and has no archival value. Supabase holds the durable
 * records (profiles, rides, SOS events); this map holds "who is where, right
 * now". Entries expire after PRESENCE_TTL_MS so a dropped mobile connection
 * cannot be matched as a live responder.
 *
 * Replacing this with Redis is a drop-in change: the module only exposes
 * upsert / remove / query, and every consumer awaits the results.
 */

/**
 * @typedef {Object} PresenceRecord
 * @property {string} socketId
 * @property {string} userId
 * @property {string} displayName
 * @property {'female'|'male'|'non_binary'|'undisclosed'} gender
 * @property {'commuter'|'driver'|'responder'|'admin'} role
 * @property {boolean} verified
 * @property {boolean} availableAsResponder
 * @property {number} lat
 * @property {number} lng
 * @property {number} accuracy
 * @property {number|null} heading
 * @property {number|null} speed
 * @property {string|null} orgId
 * @property {string|null} vehicleId
 * @property {number} updatedAt
 */

/** @type {Map<string, PresenceRecord>} */
const bySocket = new Map();
/** @type {Map<string, Set<string>>} userId -> socketIds */
const byUser = new Map();

function upsert(socketId, patch) {
  const existing = bySocket.get(socketId) || {};
  const record = {
    socketId,
    userId: patch.userId || existing.userId || socketId,
    displayName: patch.displayName ?? existing.displayName ?? 'RaahSaathi user',
    gender: patch.gender ?? existing.gender ?? 'undisclosed',
    role: patch.role ?? existing.role ?? 'commuter',
    verified: patch.verified ?? existing.verified ?? false,
    availableAsResponder:
      patch.availableAsResponder ?? existing.availableAsResponder ?? true,
    lat: Number.isFinite(patch.lat) ? patch.lat : existing.lat,
    lng: Number.isFinite(patch.lng) ? patch.lng : existing.lng,
    accuracy: Number.isFinite(patch.accuracy) ? patch.accuracy : existing.accuracy ?? null,
    heading: Number.isFinite(patch.heading) ? patch.heading : existing.heading ?? null,
    speed: Number.isFinite(patch.speed) ? patch.speed : existing.speed ?? null,
    orgId: patch.orgId ?? existing.orgId ?? null,
    vehicleId: patch.vehicleId ?? existing.vehicleId ?? null,
    updatedAt: Date.now(),
  };

  bySocket.set(socketId, record);

  if (!byUser.has(record.userId)) byUser.set(record.userId, new Set());
  byUser.get(record.userId).add(socketId);

  return record;
}

function get(socketId) {
  return bySocket.get(socketId) || null;
}

function remove(socketId) {
  const record = bySocket.get(socketId);
  if (!record) return null;
  bySocket.delete(socketId);
  const sockets = byUser.get(record.userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) byUser.delete(record.userId);
  }
  return record;
}

function isFresh(record, now = Date.now()) {
  return now - record.updatedAt <= config.PRESENCE_TTL_MS;
}

function all({ includeStale = false } = {}) {
  const now = Date.now();
  return [...bySocket.values()].filter((r) => includeStale || isFresh(r, now));
}

/**
 * Candidates inside a radius, nearest first.
 *
 * @param {{lat:number,lng:number}} center
 * @param {number} radiusKm
 * @param {(record: PresenceRecord) => boolean} [predicate]
 */
function near(center, radiusKm, predicate = () => true) {
  if (!geo.isValidPoint(center)) return [];
  const box = geo.boundingBox(center, radiusKm);
  const now = Date.now();

  const results = [];
  for (const record of bySocket.values()) {
    if (!isFresh(record, now)) continue;
    if (!geo.isValidPoint(record)) continue;
    // Cheap rectangular reject before the trigonometry.
    if (!geo.withinBoundingBox(record, box)) continue;
    if (!predicate(record)) continue;

    const distanceKm = geo.haversineKm(center, record);
    if (distanceKm > radiusKm) continue;

    results.push({ ...record, distanceKm, etaMinutes: geo.etaMinutes(distanceKm) });
  }

  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}

function socketsForUser(userId) {
  return [...(byUser.get(userId) || [])];
}

function stats() {
  const live = all();
  return {
    total: live.length,
    byRole: live.reduce((acc, r) => {
      acc[r.role] = (acc[r.role] || 0) + 1;
      return acc;
    }, {}),
    verifiedDrivers: live.filter((r) => r.role === 'driver' && r.verified).length,
    femaleResponders: live.filter((r) => r.gender === 'female' && r.availableAsResponder)
      .length,
  };
}

// Periodic sweep so a crashed client never lingers as a phantom responder.
const sweeper = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [socketId, record] of bySocket.entries()) {
    if (!isFresh(record, now)) {
      remove(socketId);
      removed += 1;
    }
  }
  if (removed) logger.debug({ removed }, 'presence sweep removed stale records');
}, Math.max(15_000, Math.floor(config.PRESENCE_TTL_MS / 3)));

sweeper.unref?.();

module.exports = { upsert, get, remove, all, near, socketsForUser, stats };
