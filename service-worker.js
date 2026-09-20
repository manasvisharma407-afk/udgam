/* eslint-disable no-restricted-globals */

/**
 * RaahSaathi service worker.
 *
 * The caching strategy is shaped by one rule: a safety app must never show
 * stale safety data. So:
 *
 *   App shell        → cache-first. The SOS screen must open instantly and
 *                      without a network, because that is exactly when it is
 *                      needed most.
 *   API responses    → network-only. A cached driver list, safety score, or
 *                      "no active alerts" is worse than an honest error. The
 *                      one exception is nothing — we never serve stale /api.
 *   Map tiles        → stale-while-revalidate, capped. Tiles are heavy and a
 *                      slightly old basemap is harmless.
 *   Navigations      → network-first with an offline shell fallback.
 *
 * Bumping CACHE_VERSION invalidates everything on the next activation.
 */

const CACHE_VERSION = 'v2.0.0';
const SHELL_CACHE = `raahsaathi-shell-${CACHE_VERSION}`;
const TILE_CACHE = `raahsaathi-tiles-${CACHE_VERSION}`;
const MAX_TILES = 250;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* ------------------------------------------------------------------ install */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // addAll rejects the whole batch if any single asset 404s, which would
        // leave the app with no shell at all. Add them individually instead.
        Promise.all(
          SHELL_ASSETS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

/* ----------------------------------------------------------------- activate */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('raahsaathi-') && !key.endsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* -------------------------------------------------------------------- fetch */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache anything from the API or the socket transport. A stale
  // emergency response is a safety failure, not a performance win.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return; // fall through to the network
  }

  // Map tiles: serve from cache, refresh in the background.
  if (/tile|basemaps|\.png$/i.test(url.hostname + url.pathname) && url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, TILE_CACHE, MAX_TILES));
    return;
  }

  // Navigations: try the network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() =>
          caches
            .match('/index.html')
            .then((cached) => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Same-origin static assets: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});

function staleWhileRevalidate(request, cacheName, maxEntries) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
            trimCache(cacheName, maxEntries);
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
}

function trimCache(cacheName, maxEntries) {
  caches.open(cacheName).then((cache) =>
    cache.keys().then((keys) => {
      if (keys.length <= maxEntries) return;
      // Oldest-first eviction.
      Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
    })
  );
}

/* -------------------------------------------------------------- messaging */

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* -------------------------------------------------------- push (optional)
   Wired for the next milestone: server-sent distress alerts to a backgrounded
   app. Requires VAPID keys and a push subscription store on the backend. */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'RaahSaathi alert', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Emergency nearby', {
      body: payload.body || 'A woman near you has triggered an SOS.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.sosId || 'raahsaathi-alert',
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 150, 400, 150, 400],
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => 'focus' in client);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
