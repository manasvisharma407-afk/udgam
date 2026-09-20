import { API_BASE } from './config';

/**
 * Thin REST client.
 *
 * Everything realtime goes over the socket; this covers the request/response
 * surface (driver lists, safety scores, pool matching, admin snapshots) and
 * acts as the HTTP fallback for raising an SOS when WebSockets are blocked.
 */

let authToken = null;
export const setAuthToken = (token) => {
  authToken = token;
};

async function request(path, { method = 'GET', body, headers = {}, timeoutMs = 12_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw Object.assign(new Error(data?.message || data?.error || response.statusText), {
        status: response.status,
        data,
      });
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('The request timed out.'), { code: 'timeout' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chatbot. Posts to the Express backend at `${REACT_APP_BACKEND_URL}/api/chatbot/message`.
 * Location is optional: without it the bot asks the rider to turn location on.
 * The longer timeout leaves room for the server-side LLM call (10 s cap).
 */
export const sendChatMessage = (message, { lat, lng } = {}) =>
  request('/chatbot/message', {
    method: 'POST',
    body: { message, lat, lng },
    timeoutMs: 20_000,
  });

export const api = {
  health: () => request('/health'),
  me: () => request('/me'),

  nearbyDrivers: ({ lat, lng, radiusKm = 5, womenOnly = true }) =>
    request(
      `/drivers/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}&womenOnly=${womenOnly}`
    ),
  driver: (id) => request(`/drivers/${id}`),

  safetyScore: ({ lat, lng }) => request(`/safety/score?lat=${lat}&lng=${lng}`),
  routeScore: (points) => request('/safety/route', { method: 'POST', body: { points } }),

  /** HTTP fallback for raising an SOS when the socket cannot connect. */
  raiseSos: (payload) => request('/sos', { method: 'POST', body: payload, timeoutMs: 8000 }),
  resolveSos: (id) => request(`/sos/${id}/resolve`, { method: 'POST' }),

  poolTrips: ({ lat, lng, city } = {}) => {
    const params = new URLSearchParams();
    if (lat && lng) {
      params.set('lat', lat);
      params.set('lng', lng);
    }
    if (city) params.set('city', city);
    return request(`/pool/trips?${params.toString()}`);
  },
  createPoolTrip: (trip) => request('/pool/trips', { method: 'POST', body: trip }),
  matchPool: (trip) => request('/pool/match', { method: 'POST', body: trip }),
  poolImpact: ({ sinceDays = 30 } = {}) => request(`/pool/impact?sinceDays=${sinceDays}`),

  sendChatMessage,

  adminOverview: (adminKey) =>
    request('/admin/overview', { headers: adminKey ? { 'x-admin-key': adminKey } : {} }),
  routeHealth: (adminKey) =>
    request('/admin/route-health', { headers: adminKey ? { 'x-admin-key': adminKey } : {} }),
};

export default api;
