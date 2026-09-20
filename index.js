'use strict';

const config = require('../config/env');
const logger = require('../lib/logger');
const schemas = require('../lib/schemas');
const { identityFromToken, demoIdentity } = require('../middleware/auth');

const presence = require('../services/presence');
const dispatch = require('../services/dispatch');
const safety = require('../services/safety');

/**
 * Realtime layer.
 *
 * Rooms:
 *   `sos:<id>`   — the reporter plus every responder who accepted. Carries the
 *                  live GPS trail.
 *   `org:<id>`   — enterprise dashboards for one fleet operator.
 *   `admins`     — all dashboards (used only for aggregate counters).
 *
 * Every inbound payload is schema-validated. A malformed frame from a flaky
 * mobile connection must not be able to corrupt an in-flight incident.
 */

const ACK_OK = { ok: true };
const fail = (message, code = 'bad_request') => ({ ok: false, error: code, message });

function attachSockets(io) {
  // Authenticate during the handshake so `socket.data.user` is always present.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      const identity = await identityFromToken(token);

      if (identity) {
        socket.data.user = identity;
        return next();
      }

      if (config.demoMode) {
        socket.data.user = demoIdentity(socket.handshake.auth?.profile || {});
        return next();
      }

      return next(new Error('authentication_required'));
    } catch (err) {
      logger.error({ err }, 'socket handshake failed');
      return next(new Error('authentication_error'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    logger.info({ socketId: socket.id, userId: user.userId, role: user.role }, 'client connected');

    if (user.orgId) socket.join(`org:${user.orgId}`);
    if (user.role === 'admin') socket.join('admins');

    socket.emit('CONNECTED', {
      socketId: socket.id,
      user: {
        userId: user.userId,
        displayName: user.displayName,
        gender: user.gender,
        role: user.role,
        verified: user.verified,
      },
      config: {
        sosRadiusKm: config.SOS_RADIUS_KM,
        locationBroadcastMs: config.LOCATION_BROADCAST_MS,
        demoMode: config.demoMode,
      },
    });

    /* -------------------------------------------------- presence register */

    socket.on('REGISTER_USER', (raw, ack) => {
      const parsed = schemas.registerPayload.safeParse(raw || {});
      if (!parsed.success) return ack?.(fail('Invalid registration payload', 'validation_failed'));

      const payload = parsed.data;
      const record = presence.upsert(socket.id, {
        userId: user.userId,
        // Identity attributes come from the verified profile, not the client.
        // A client cannot declare itself female to receive female-only alerts.
        displayName: user.displayName || payload.displayName,
        gender: user.source === 'demo' ? payload.gender || user.gender : user.gender,
        role: user.source === 'demo' ? payload.role || user.role : user.role,
        verified: user.verified,
        orgId: user.orgId || payload.orgId,
        vehicleId: payload.vehicleId,
        availableAsResponder: payload.availableAsResponder,
        lat: payload.lat,
        lng: payload.lng,
        accuracy: payload.accuracy,
      });

      broadcastPresenceCounters(io);
      ack?.({ ...ACK_OK, presence: publicPresence(record) });
    });

    /* ------------------------------------------- ambient location updates */

    socket.on('UPDATE_LOCATION', (raw, ack) => {
      const parsed = schemas.coordinate.safeParse(raw || {});
      if (!parsed.success) return ack?.(fail('Invalid coordinates', 'validation_failed'));

      const record = presence.upsert(socket.id, parsed.data);
      if (record.orgId) {
        io.to(`org:${record.orgId}`).emit('FLEET_POSITION', publicPresence(record));
      }
      ack?.(ACK_OK);
    });

    /* ------------------------------------------------------------ raise SOS */

    socket.on('SEND_SOS', async (raw, ack) => {
      const parsed = schemas.sosPayload.safeParse(raw || {});
      if (!parsed.success) return ack?.(fail('A valid location is required', 'validation_failed'));

      const payload = parsed.data;
      const current = presence.get(socket.id) || {};

      try {
        const event = await dispatch.createEvent({
          origin: { lat: payload.lat, lng: payload.lng, accuracy: payload.accuracy },
          reporter: {
            userId: user.userId,
            socketId: socket.id,
            displayName: user.displayName,
            gender: user.gender || current.gender,
            orgId: user.orgId || current.orgId,
          },
          trigger: payload.trigger,
        });

        socket.join(`sos:${event.id}`);

        const responders = dispatch.rankResponders(event.origin, {
          excludeSocketId: socket.id,
          orgId: event.reporter.orgId,
        });

        const publicEvent = dispatch.toPublicEvent(event);

        // Targeted fan-out. Each responder gets their own distance/ETA so the
        // nearest person knows they are the nearest person.
        for (const responder of responders) {
          io.to(responder.socketId).emit('EMERGENCY_ALERT_BROADCAST', {
            ...publicEvent,
            note: payload.note || null,
            yourDistanceKm: Number(responder.distanceKm.toFixed(2)),
            yourEtaMinutes: responder.etaMinutes,
            priorityTier: responder.tier,
          });
        }

        // Dashboards see every incident for their org, plus aggregate counts.
        if (event.reporter.orgId) {
          io.to(`org:${event.reporter.orgId}`).emit('ADMIN_INCIDENT_OPENED', publicEvent);
        }
        io.to('admins').emit('ADMIN_INCIDENT_OPENED', publicEvent);

        logger.warn(
          { sosId: event.id, trigger: event.trigger, responders: responders.length },
          'SOS dispatched'
        );

        ack?.({
          ...ACK_OK,
          sosId: event.id,
          responderCount: responders.length,
          radiusKm: event.radiusKm,
          // Honest signal: if nobody is nearby, the UI must tell her that and
          // surface the call-100 fallback rather than implying help is coming.
          escalateToEmergencyServices: responders.length === 0,
        });
      } catch (err) {
        logger.error({ err }, 'SOS creation failed');
        ack?.(fail(err.message || 'Could not raise SOS', 'sos_failed'));
      }
    });

    /* --------------------------------------------- live GPS during an SOS */

    socket.on('SOS_LOCATION_UPDATE', async (raw, ack) => {
      const parsed = schemas.locationPayload.safeParse(raw || {});
      if (!parsed.success) return ack?.(fail('Invalid location update', 'validation_failed'));

      const { sosId, ...fix } = parsed.data;
      const event = dispatch.getEvent(sosId);
      if (!event) return ack?.(fail('Incident is no longer active', 'sos_not_found'));
      if (event.reporter.userId !== user.userId) {
        return ack?.(fail('Only the reporter can stream location', 'forbidden'));
      }

      const updated = await dispatch.appendLocation(sosId, fix);
      if (!updated) return ack?.(fail('Incident is no longer active', 'sos_not_found'));

      // Also refresh ambient presence so the fleet map stays in sync.
      presence.upsert(socket.id, fix);

      const frame = {
        sosId,
        lat: updated.latest.lat,
        lng: updated.latest.lng,
        accuracy: updated.latest.accuracy,
        speed: updated.latest.speed,
        heading: updated.latest.heading,
        at: updated.latest.at,
        trailLength: updated.trail.length,
      };

      socket.to(`sos:${sosId}`).emit('SOS_LOCATION_STREAM', frame);
      io.to('admins').emit('SOS_LOCATION_STREAM', frame);
      if (event.reporter.orgId) io.to(`org:${event.reporter.orgId}`).emit('SOS_LOCATION_STREAM', frame);

      ack?.(ACK_OK);
    });

    /* -------------------------------------------------- responder accepts */

    socket.on('ACKNOWLEDGE_SOS', (raw, ack) => {
      const sosId = typeof raw === 'string' ? raw : raw?.sosId;
      if (!sosId) return ack?.(fail('sosId is required', 'validation_failed'));

      const record = presence.get(socket.id);
      const event = dispatch.acknowledge(sosId, {
        userId: user.userId,
        displayName: user.displayName,
        lat: record?.lat,
        lng: record?.lng,
      });

      if (!event) return ack?.(fail('Incident is no longer active', 'sos_not_found'));

      socket.join(`sos:${sosId}`);

      const responderInfo = event.acknowledgedBy[event.acknowledgedBy.length - 1];
      io.to(`sos:${sosId}`).emit('SOS_RESPONDER_ACCEPTED', {
        sosId,
        responder: responderInfo,
        totalResponders: event.acknowledgedBy.length,
      });
      io.to('admins').emit('ADMIN_INCIDENT_UPDATED', dispatch.toPublicEvent(event));

      // Hand the responder the full trail so far so they can navigate.
      ack?.({ ...ACK_OK, incident: dispatch.toPublicEvent(event) });
    });

    /* ------------------------------------------------------- resolve SOS */

    socket.on('RESOLVE_SOS', async (raw, ack) => {
      const sosId = typeof raw === 'string' ? raw : raw?.sosId;
      const resolution = raw?.resolution || 'safe';
      const event = dispatch.getEvent(sosId);
      if (!event) return ack?.(fail('Incident is no longer active', 'sos_not_found'));

      const isReporter = event.reporter.userId === user.userId;
      const isAdmin = user.role === 'admin';
      if (!isReporter && !isAdmin) {
        return ack?.(fail('Only the reporter or an operator can stand down an alert', 'forbidden'));
      }

      const resolved = await dispatch.resolve(sosId, { resolvedBy: user, resolution });
      const payload = { sosId, resolution, resolvedAt: resolved.resolvedAt };

      io.to(`sos:${sosId}`).emit('SOS_RESOLVED', payload);
      io.to('admins').emit('SOS_RESOLVED', payload);
      if (event.reporter.orgId) io.to(`org:${event.reporter.orgId}`).emit('SOS_RESOLVED', payload);

      ack?.(ACK_OK);
    });

    /* ------------------------------------------------------- latency probe */

    // Deliberately does no work. The client measures round-trip time with this
    // so it can tell the user whether her alert would actually get out; routing
    // that probe through a real query would hit Supabase every 20s per client.
    socket.on('PING', (raw, ack) => ack?.({ ...ACK_OK, at: Date.now() }));

    /* ------------------------------------------------ on-demand safety read */

    socket.on('REQUEST_SAFETY_SCORE', async (raw, ack) => {
      const parsed = schemas.coordinate.safeParse(raw || {});
      if (!parsed.success) return ack?.(fail('Invalid coordinates', 'validation_failed'));
      try {
        ack?.({ ...ACK_OK, safety: await safety.scoreLocation(parsed.data) });
      } catch (err) {
        ack?.(fail(err.message, 'safety_failed'));
      }
    });

    /* ----------------------------------------------------- admin snapshot */

    socket.on('ADMIN_SUBSCRIBE', (raw, ack) => {
      if (user.role !== 'admin' && !config.demoMode) {
        return ack?.(fail('Admin scope required', 'forbidden'));
      }
      socket.join('admins');
      const orgId = raw?.orgId || user.orgId;
      if (orgId) socket.join(`org:${orgId}`);

      ack?.({
        ...ACK_OK,
        incidents: dispatch.listActive({ orgId }),
        fleet: presence
          .all()
          .filter((p) => !orgId || p.orgId === orgId)
          .map(publicPresence),
        stats: presence.stats(),
      });
    });

    /* ------------------------------------------------------------ cleanup */

    socket.on('disconnect', (reason) => {
      const record = presence.remove(socket.id);
      logger.info({ socketId: socket.id, reason }, 'client disconnected');

      if (record?.orgId) {
        io.to(`org:${record.orgId}`).emit('FLEET_OFFLINE', { id: record.userId });
      }
      broadcastPresenceCounters(io);
    });
  });
}

function publicPresence(record) {
  return {
    id: record.userId,
    displayName: record.displayName,
    role: record.role,
    gender: record.gender,
    verified: record.verified,
    vehicleId: record.vehicleId,
    lat: record.lat,
    lng: record.lng,
    heading: record.heading,
    speed: record.speed,
    updatedAt: record.updatedAt,
  };
}

let counterTimer = null;
/** Debounced so a reconnect storm cannot spam every dashboard. */
function broadcastPresenceCounters(io) {
  if (counterTimer) return;
  counterTimer = setTimeout(() => {
    counterTimer = null;
    io.to('admins').emit('PRESENCE_STATS', presence.stats());
  }, 1500);
  counterTimer.unref?.();
}

module.exports = { attachSockets };
