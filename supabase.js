'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('./env');
const logger = require('../lib/logger');

/**
 * Service-role Supabase client.
 *
 * The service role bypasses RLS, so it is only ever used server-side and every
 * query in `services/` scopes rows explicitly (by user id / org id). If the
 * project is not configured we return `null` and the services fall back to the
 * in-memory store, which keeps the demo runnable without a database.
 */
let client = null;

if (config.supabaseEnabled) {
  client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'raahsaathi-backend' } },
  });
  logger.info('Supabase client initialised');
} else {
  logger.warn(
    'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — running with in-memory persistence only'
  );
}

/** @returns {import('@supabase/supabase-js').SupabaseClient | null} */
function getSupabase() {
  return client;
}

module.exports = { getSupabase };
