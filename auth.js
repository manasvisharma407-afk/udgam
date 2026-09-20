'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const logger = require('../lib/logger');
const { getSupabase } = require('../config/supabase');

/**
 * Identity resolution.
 *
 * Preferred path: the client sends a Supabase access token. We verify the HS256
 * signature locally with SUPABASE_JWT_SECRET (no network hop on every socket
 * frame), then enrich with the `profiles` row for gender/role/org.
 *
 * Demo path: when DEMO_MODE is on *and* the environment is not production, an
 * unsigned identity is accepted so the prototype can be demoed without an auth
 * provider. This can never silently apply in production — see config/env.js.
 */

async function identityFromToken(token) {
  if (!token) return null;

  if (config.SUPABASE_JWT_SECRET) {
    try {
      const payload = jwt.verify(token, config.SUPABASE_JWT_SECRET, { algorithms: ['HS256'] });
      return enrich({
        userId: payload.sub,
        email: payload.email,
        source: 'supabase_jwt',
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'JWT verification failed');
      return null;
    }
  }

  // No local secret configured — fall back to asking Supabase directly.
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return enrich({ userId: data.user.id, email: data.user.email, source: 'supabase_api' });
  }

  return null;
}

async function enrich(identity) {
  const supabase = getSupabase();
  if (!supabase) return { ...identity, role: 'commuter', gender: 'undisclosed' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, gender, role, org_id, verified, available_as_responder')
    .eq('id', identity.userId)
    .maybeSingle();

  if (error) logger.error({ err: error }, 'profile enrichment failed');

  return {
    ...identity,
    displayName: data?.display_name || identity.email || 'RaahSaathi user',
    gender: data?.gender || 'undisclosed',
    role: data?.role || 'commuter',
    orgId: data?.org_id || null,
    verified: Boolean(data?.verified),
    availableAsResponder: data?.available_as_responder ?? true,
  };
}

/** Build a throwaway identity for demos. Never trusted for admin scopes. */
function demoIdentity(hint = {}) {
  return {
    userId: hint.userId || `demo-${Math.random().toString(36).slice(2, 10)}`,
    displayName: hint.displayName || 'Demo commuter',
    gender: hint.gender || 'female',
    role: hint.role === 'admin' ? 'commuter' : hint.role || 'commuter',
    orgId: hint.orgId || null,
    verified: false,
    availableAsResponder: hint.availableAsResponder ?? true,
    source: 'demo',
  };
}

function bearerFrom(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Express middleware: attaches `req.user`, 401s when absent. */
function requireAuth(req, res, next) {
  identityFromToken(bearerFrom(req))
    .then((identity) => {
      if (identity) {
        req.user = identity;
        return next();
      }
      if (config.demoMode) {
        req.user = demoIdentity(req.headers['x-demo-profile'] ? safeJson(req.headers['x-demo-profile']) : {});
        return next();
      }
      return res.status(401).json({ error: 'authentication_required' });
    })
    .catch(next);
}

/** Express middleware: auth optional, `req.user` may be null. */
function optionalAuth(req, res, next) {
  identityFromToken(bearerFrom(req))
    .then((identity) => {
      req.user = identity || (config.demoMode ? demoIdentity() : null);
      next();
    })
    .catch(next);
}

/**
 * Enterprise dashboard guard. Accepts either an authenticated admin profile or
 * the shared ADMIN_API_KEY used by fleet-operator machine clients.
 */
function requireAdmin(req, res, next) {
  const apiKey = req.headers['x-admin-key'];
  if (config.ADMIN_API_KEY && apiKey && timingSafeEqual(apiKey, config.ADMIN_API_KEY)) {
    req.user = { userId: 'service:admin', role: 'admin', orgId: req.headers['x-org-id'] || null };
    return next();
  }

  return identityFromToken(bearerFrom(req))
    .then((identity) => {
      if (identity?.role === 'admin') {
        req.user = identity;
        return next();
      }
      if (config.demoMode) {
        req.user = { userId: 'demo:admin', role: 'admin', orgId: null, source: 'demo' };
        return next();
      }
      return res.status(403).json({ error: 'admin_scope_required' });
    })
    .catch(next);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

module.exports = {
  identityFromToken,
  demoIdentity,
  requireAuth,
  optionalAuth,
  requireAdmin,
};
