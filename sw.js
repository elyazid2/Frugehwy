// Maktaba Service Worker — v2.0
// Caches the app shell for offline use.
// YouTube bridge requests (localhost:3847) bypass cache entirely.

const CACHE_NAME = 'maktaba-v2';

const ASSETS = [
  './index.html',
  './manifest.json'
];

// ── Install: cache core assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clear old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fall back to network ──
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never intercept: cross-origin, bridge calls, or YouTube CDN
  const skip =
    !url.startsWith(self.location.origin) ||
    url.includes('localhost:3847') ||
    url.includes('googlevideo.com');

  if (skip) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
