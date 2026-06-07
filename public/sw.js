/* Spike Log Pro service worker — network-first to avoid serving stale bundles.
   Cross-origin requests (e.g. Firebase sync) are never intercepted, so data
   and sync are unaffected. Cache is used only as an offline fallback. */
const CACHE = 'spikelog-v1';
const SCOPE_INDEX = '/volleyball/index.html';

self.addEventListener('install', () => {
  // Activate the new SW immediately, replacing any old one.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop any caches from previous versions so old bundles can't resurface.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests. Firebase / Google / any cross-origin
  // call passes straight through to the network untouched.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      // Network-first: always prefer fresh content.
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      // Offline fallback only.
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const fallback = await caches.match(SCOPE_INDEX);
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
