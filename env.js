'use strict';

require('dotenv').config();
const { z } = require('zod');

/**
 * Single source of truth for configuration.
 *
 * Nothing else in the codebase should read `process.env` directly — that way a
 * missing variable fails loudly at boot instead of producing an `undefined`
 * halfway through an emergency dispatch.
 */
const csv = (value) =>
  String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

// A blank `FOO=` line in .env arrives as '' — treat it as "unset" so the default
// applies, rather than coercing '' to 0 and failing the boot-time validation.
const optionalPositive = (fallback) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().positive().default(fallback)
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  // Comma separated list. Render/Vercel preview URLs can be added here.
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Supabase (Postgres + Auth). DATABASE_URL is used by the SQL migration
  // scripts; the REST client uses SUPABASE_URL + the service role key.
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),

  // Dispatch tuning.
  SOS_RADIUS_KM: z.coerce.number().positive().default(5),
  SOS_MAX_RESPONDERS: z.coerce.number().int().positive().default(25),
  LOCATION_BROADCAST_MS: z.coerce.number().int().positive().default(3000),
  PRESENCE_TTL_MS: z.coerce.number().int().positive().default(90_000),

  // Enterprise dashboard access (shared secret for machine clients).
  ADMIN_API_KEY: z.string().optional(),

  // When true the server accepts unsigned "demo" identities. Useful for
  // hackathon demos and local development; refuse to enable it in production.
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // Chatbot. 'demo' = rule-based replies only (no external calls, no key needed).
  // With gemini/openai and a key set, the same data-grounded replies are
  // rephrased by the model; without a key the bot silently stays rule-based.
  AI_PROVIDER: z.enum(['demo', 'gemini', 'openai']).default('demo'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Fleet operations / Smart Route (routes/fleet.js). Every key is optional:
  // with neither routing key set the optimizer serves clearly-labelled demo
  // routes. These are server-side secrets — never expose them to the client.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  TOMTOM_API_KEY: z.string().optional(),
  SOS_LOOKBACK_HOURS: optionalPositive(24),
  CARPOOL_MAX_PICKUP_KM: optionalPositive(2),
  CARPOOL_MAX_DROPOFF_KM: optionalPositive(3),
  CARPOOL_MAX_TIME_DIFF_MIN: optionalPositive(15),

  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  corsOrigins: csv(env.CORS_ORIGINS),
  // Never let DEMO_MODE stay on in production by accident.
  demoMode: env.DEMO_MODE && env.NODE_ENV !== 'production',
  supabaseEnabled: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
  // True only when the selected provider actually has a key.
  aiEnabled:
    (env.AI_PROVIDER === 'gemini' && Boolean(env.GEMINI_API_KEY)) ||
    (env.AI_PROVIDER === 'openai' && Boolean(env.OPENAI_API_KEY)),
};

module.exports = config;
