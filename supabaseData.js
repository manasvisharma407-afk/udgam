'use strict';

const config = require('../../config/env');
const { getSupabase } = require('../../config/supabase');
const logger = require('../../lib/logger');
const { haversineKm } = require('./geo');

/**
 * Read-only data adapter for the fleet feature, built on the app's shared
 * service-role Supabase client (config/supabase.js) rather than a second,
 * hand-rolled REST client.
 *
 * It reads the tables that already exist in supabase/schema.sql and maps their
 * columns onto the field names the fleet scoring code expects:
 *
 *   safety_zones.lighting_index  -> zone.lighting
 *   safety_zones.incident_index  -> zone.incidents   (0-100, higher = worse)
 *   sos_events (lat, lng, created_at only) -> recent incidents
 *
 * Only coordinates and timestamps are read from `sos_events`; no reporter id,
 * label or organisation ever leaves the database, and only aggregate counts
 * are derived from it. Cancelled alerts are excluded because they are
 * dominated by accidental shake triggers and would unfairly depress scores.
 */

const ZONE_COLUMNS = 'id, name, lat, lng, radius_m, lighting_index, incident_index, cctv_coverage';
const ZONE_LIMIT = 1000;
const ZONE_TTL_MS = 5 * 60 * 1000;
const INCIDENT_LIMIT = 500;
const INCIDENT_RADIUS_KM = 1;
// A slow or unreachable database must degrade to "no data" (demo-fallback
// scores), never hold up route optimization for the rider.
const QUERY_TIMEOUT_MS = 4000;
const ZONE_RETRY_AFTER_FAILURE_MS = 30_000;

function createSupabaseDataSource() {
  const supabase = getSupabase();
  const enabled = Boolean(supabase);

  // Municipal zone data changes on the order of months; cache it briefly so a
  // 60 s refresh from every open dashboard does not hit the database each time.
  let zoneCache = { at: 0, rows: [] };
  let zoneInFlight = null;

  async function fetchZones() {
    const { data, error } = await supabase
      .from('safety_zones')
      .select(ZONE_COLUMNS)
      .limit(ZONE_LIMIT)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));

    if (error) {
      logger.warn({ err: error.message }, 'fleet: safety_zones query failed');
      // Keep serving the last good rows and back off before trying again.
      zoneCache.at = Date.now() - ZONE_TTL_MS + ZONE_RETRY_AFTER_FAILURE_MS;
      return zoneCache.rows;
    }

    zoneCache = {
      at: Date.now(),
      rows: (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        radius_m: row.radius_m,
        lighting: row.lighting_index,
        incidents: row.incident_index,
        cctv: row.cctv_coverage,
      })),
    };
    return zoneCache.rows;
  }

  async function loadZones() {
    if (!enabled) return [];
    if (Date.now() - zoneCache.at < ZONE_TTL_MS) return zoneCache.rows;
    // One optimize request scores several routes in parallel; share one query.
    if (!zoneInFlight) {
      zoneInFlight = fetchZones().finally(() => {
        zoneInFlight = null;
      });
    }
    return zoneInFlight;
  }

  return {
    enabled,

    async getSafetyZonesNear() {
      try {
        return await loadZones();
      } catch (err) {
        logger.warn({ err: err.message }, 'fleet: could not load safety zones');
        return [];
      }
    },

    async getRecentIncidentsNear(points) {
      if (!enabled || !Array.isArray(points) || points.length === 0) return [];
      const lats = points.map((p) => Number(p.lat)).filter(Number.isFinite);
      const lngs = points.map((p) => Number(p.lng)).filter(Number.isFinite);
      if (!lats.length || !lngs.length) return [];

      // ~1.1 km of padding on the route's bounding box; exact distance is
      // checked below so corners of a diagonal route are not over-counted.
      const pad = 0.01;
      const since = new Date(Date.now() - config.SOS_LOOKBACK_HOURS * 3_600_000).toISOString();

      try {
        const { data, error } = await supabase
          .from('sos_events')
          .select('lat, lng, created_at')
          .neq('status', 'cancelled')
          .gte('created_at', since)
          .gte('lat', Math.min(...lats) - pad)
          .lte('lat', Math.max(...lats) + pad)
          .gte('lng', Math.min(...lngs) - pad)
          .lte('lng', Math.max(...lngs) + pad)
          .limit(INCIDENT_LIMIT)
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));

        if (error) {
          logger.warn({ err: error.message }, 'fleet: sos_events query failed');
          return [];
        }
        return (data || []).filter((row) =>
          points.some((point) => haversineKm(point, row) <= INCIDENT_RADIUS_KM)
        );
      } catch (err) {
        logger.warn({ err: err.message }, 'fleet: could not load recent incidents');
        return [];
      }
    },
  };
}

module.exports = { createSupabaseDataSource };
