const CACHE_NAME = 'aquashield-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Let live API requests go straight to network
  if (event.request.url.includes('/api/v1/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first with fallback to cache for shell assets
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});