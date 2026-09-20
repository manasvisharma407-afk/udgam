'use strict';

const crypto = require('crypto');
const config = require('../config/env');
const geo = require('../lib/geo');
const logger = require('../lib/logger');
const presence = require('./presence');
const { getSupabase } = require('../config/supabase');

/**
 * Emergency dispatch.
 *
 * Design rules that are deliberately non-negotiable:
 *  1. An SOS is never silently dropped. If zero responders match, the event is
 *     still persisted and escalated to org admins + the fallback channel.
 *  2. Responder selection is gender-filtered *and* radius-bounded, capped at
 *     SOS_MAX_RESPONDERS so one alert cannot fan out to an entire city.
 *  3. Location updates during an active SOS are append-only. The trail is
 *     evidence, so nothing in this module ever mutates a prior fix.
 */

/** @type {Map<string, object>} sosId -> active event */
const activeEvents = new Map();

function newId() {
  return crypto.randomUUID();
}

/**
 * Rank responders for an SOS.
 *
 * Priority order:
 *   1. Verified female drivers (they have a vehicle and are vetted)
 *   2. Female commuters/responders who have opted in
 *   3. Org security/admin staff regardless of gender (fleet operators)
 *
 * Non-female peers are never sent the precise location of a female user's
 * distress signal — only aggregate "incident in your area" data via the admin
 * channel. That is the whole point of the female-only geofence.
 */
function rankResponders(origin, { excludeSocketId, radiusKm = config.SOS_RADIUS_KM, orgId = null } = {}) {
  const candidates = presence.near(origin, radiusKm, (record) => {
    if (record.socketId === excludeSocketId) return false;
    if (!record.availableAsResponder) return false;

    const isFemale = record.gender === 'female';
    const isOrgStaff = record.role === 'admin' && orgId && record.orgId === orgId;
    return isFemale || isOrgStaff;
  });

  const tierOf = (r) => {
    if (r.gender === 'female' && r.role === 'driver' && r.verified) return 0;
    if (r.gender === 'female' && r.verified) return 1;
    if (r.gender === 'female') return 2;
    return 3; // org staff
  };

  return candidates
    .map((r) => ({ ...r, tier: tierOf(r) }))
    .sort((a, b) => a.tier - b.tier || a.distanceKm - b.distanceKm)
    .slice(0, config.SOS_MAX_RESPONDERS);
}

async function createEvent({ origin, reporter, trigger, radiusKm = config.SOS_RADIUS_KM }) {
  if (!geo.isValidPoint(origin)) {
    throw Object.assign(new Error('A valid location is required to raise an SOS'), {
      status: 400,
    });
  }

  const sosId = newId();
  const event = {
    id: sosId,
    status: 'active',
    trigger, // 'shake' | 'manual' | 'button_hold' | 'voice' | 'fallback'
    reporter: {
      userId: reporter.userId,
      socketId: reporter.socketId,
      displayName: reporter.displayName,
      gender: reporter.gender,
      orgId: reporter.orgId || null,
    },
    origin: { lat: origin.lat, lng: origin.lng, accuracy: origin.accuracy ?? null },
    latest: { lat: origin.lat, lng: origin.lng, at: Date.now() },
    radiusKm,
    trail: [{ lat: origin.lat, lng: origin.lng, at: Date.now() }],
    acknowledgedBy: [],
    createdAt: Date.now(),
    resolvedAt: null,
  };

  activeEvents.set(sosId, event);
  await persistEvent(event).catch((err) =>
    logger.error({ err, sosId }, 'SOS persistence failed — event continues in memory')
  );

  return event;
}

async function persistEvent(event) {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase.from('sos_events').insert({
    id: event.id,
    reporter_id: isUuid(event.reporter.userId) ? event.reporter.userId : null,
    reporter_label: event.reporter.displayName,
    org_id: event.reporter.orgId,
    trigger: event.trigger,
    status: event.status,
    lat: event.origin.lat,
    lng: event.origin.lng,
    accuracy_m: event.origin.accuracy,
    radius_km: event.radiusKm,
  });

  if (error) throw error;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Append a GPS fix to a live event. Returns the updated event or null. */
async function appendLocation(sosId, fix) {
  const event = activeEvents.get(sosId);
  if (!event || event.status !== 'active') return null;
  if (!geo.isValidPoint(fix)) return null;

  const point = {
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy ?? null,
    speed: fix.speed ?? null,
    heading: fix.heading ?? null,
    at: Date.now(),
  };

  event.latest = point;
  event.trail.push(point);
  // Keep the in-memory trail bounded; Supabase holds the full history.
  if (event.trail.length > 600) event.trail.splice(0, event.trail.length - 600);

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from('sos_locations').insert({
      sos_id: sosId,
      lat: point.lat,
      lng: point.lng,
      accuracy_m: point.accuracy,
      speed_mps: point.speed,
      heading_deg: point.heading,
    });
    if (error) logger.error({ err: error, sosId }, 'location append failed');
  }

  return event;
}

function acknowledge(sosId, responder) {
  const event = activeEvents.get(sosId);
  if (!event) return null;
  if (event.acknowledgedBy.some((r) => r.userId === responder.userId)) return event;

  event.acknowledgedBy.push({
    userId: responder.userId,
    displayName: responder.displayName,
    distanceKm: geo.haversineKm(event.latest, responder),
    etaMinutes: geo.etaMinutes(geo.haversineKm(event.latest, responder)),
    at: Date.now(),
  });

  getSupabase()
    ?.from('sos_responders')
    .insert({
      sos_id: sosId,
      responder_id: isUuid(responder.userId) ? responder.userId : null,
      responder_label: responder.displayName,
      distance_km: geo.haversineKm(event.latest, responder),
    })
    .then(({ error }) => error && logger.error({ err: error }, 'ack persistence failed'));

  return event;
}

async function resolve(sosId, { resolvedBy, resolution = 'safe' }) {
  const event = activeEvents.get(sosId);
  if (!event) return null;

  event.status = 'resolved';
  event.resolvedAt = Date.now();
  event.resolution = resolution;
  activeEvents.delete(sosId);

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase
      .from('sos_events')
      .update({
        status: 'resolved',
        resolution,
        resolved_at: new Date().toISOString(),
        resolved_by_label: resolvedBy?.displayName || null,
      })
      .eq('id', sosId);
    if (error) logger.error({ err: error, sosId }, 'resolve persistence failed');
  }

  return event;
}

function getEvent(sosId) {
  return activeEvents.get(sosId) || null;
}

function listActive({ orgId = null } = {}) {
  return [...activeEvents.values()]
    .filter((e) => !orgId || e.reporter.orgId === orgId)
    .map(toPublicEvent);
}

/** Strip internal identifiers before anything leaves the server. */
function toPublicEvent(event) {
  return {
    id: event.id,
    status: event.status,
    trigger: event.trigger,
    reporter: {
      displayName: event.reporter.displayName,
      gender: event.reporter.gender,
    },
    origin: event.origin,
    latest: event.latest,
    radiusKm: event.radiusKm,
    trail: event.trail.slice(-120),
    acknowledgedBy: event.acknowledgedBy,
    createdAt: event.createdAt,
    resolvedAt: event.resolvedAt,
    ageSeconds: Math.round((Date.now() - event.createdAt) / 1000),
  };
}

/** Auto-expire events nobody resolved, so the admin map stays truthful. */
const STALE_MS = 2 * 60 * 60 * 1000;
const sweeper = setInterval(() => {
  for (const [sosId, event] of activeEvents.entries()) {
    if (Date.now() - event.createdAt > STALE_MS) {
      logger.warn({ sosId }, 'auto-expiring stale SOS event');
      resolve(sosId, { resolution: 'expired' });
    }
  }
}, 5 * 60 * 1000);
sweeper.unref?.();

module.exports = {
  createEvent,
  appendLocation,
  acknowledge,
  resolve,
  getEvent,
  listActive,
  rankResponders,
  toPublicEvent,
};
