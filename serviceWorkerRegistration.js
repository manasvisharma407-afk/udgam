/**
 * Service worker registration.
 *
 * CRA's built-in registration is not used: this app ships a hand-written
 * worker (public/service-worker.js) with a cache strategy tuned for a safety
 * product — the shell is cached so the SOS screen opens offline, while every
 * API call stays network-first so nobody ever acts on a stale driver list or a
 * cached "all clear".
 */

const isLocalhost = Boolean(
  typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '[::1]' ||
      /^127(\.\d{1,3}){3}$/.test(window.location.hostname))
);

export function registerServiceWorker({ onUpdate, onSuccess } = {}) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production' && !isLocalhost) return;

  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL || ''}/service-worker.js`;

    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        registration.onupdatefound = () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.onstatechange = () => {
            if (installing.state !== 'installed') return;

            if (navigator.serviceWorker.controller) {
              onUpdate?.(registration);
            } else {
              onSuccess?.(registration);
            }
          };
        };

        // Check for a new build every time the app is foregrounded.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update();
        });
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Service worker registration failed:', error);
      });
  });
}

export function unregisterServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch(() => {});
}
