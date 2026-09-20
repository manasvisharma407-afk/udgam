/**
 * Runtime configuration.
 *
 * CRA inlines `process.env.REACT_APP_*` at build time, so these are baked into
 * the bundle by Vercel. Never put a secret here — only the anon/publishable
 * keys, which are safe precisely because Supabase RLS enforces access.
 */

const stripTrailingSlash = (url) => (url || '').replace(/\/+$/, '');

export const BACKEND_URL =
  stripTrailingSlash(process.env.REACT_APP_BACKEND_URL) || 'http://localhost:5000';

export const API_BASE = `${BACKEND_URL}/api`;

export const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

export const MAP_TILE_URL =
  process.env.REACT_APP_MAP_TILE_URL ||
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Fallback map centre — Jaipur, the pilot city. */
export const DEFAULT_CENTER = {
  lat: Number(process.env.REACT_APP_DEFAULT_LAT) || 26.9124,
  lng: Number(process.env.REACT_APP_DEFAULT_LNG) || 75.7873,
};

export const SOS_RADIUS_KM = Number(process.env.REACT_APP_SOS_RADIUS_KM) || 5;
export const LOCATION_BROADCAST_MS =
  Number(process.env.REACT_APP_LOCATION_BROADCAST_MS) || 3000;

/** National emergency numbers surfaced when no responder is in range. */
export const EMERGENCY_NUMBERS = [
  { label: 'Police', number: '100' },
  { label: 'Women Helpline', number: '1091' },
  { label: 'Emergency', number: '112' },
];

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
