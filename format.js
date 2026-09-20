/** Shared formatting + client-side geo helpers. */

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  if (!a || !b) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatEta(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h}h ${minutes % 60}m`;
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatClock(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatCoordinate(value, digits = 5) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function formatKg(kg) {
  if (!Number.isFinite(kg)) return '—';
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  return `${kg.toFixed(1)} kg`;
}

/** Map a 0–100 safety score to a brand colour band. */
export function safetyBand(score) {
  if (!Number.isFinite(score)) return { label: 'Unknown', tone: 'slate' };
  if (score >= 75) return { label: 'Safe', tone: 'green' };
  if (score >= 55) return { label: 'Caution', tone: 'amber' };
  return { label: 'Elevated risk', tone: 'red' };
}

/** Build a Google Maps deep link — used in the "share my location" flow. */
export function mapsLink({ lat, lng }) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function shareText({ lat, lng, displayName }) {
  return `${displayName || 'A RaahSaathi user'} has triggered an emergency alert. Live location: ${mapsLink(
    { lat, lng }
  )}`;
}
