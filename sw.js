/* App-shell cache so watchList opens instantly and works offline for data you
 * already have. API traffic is deliberately never cached here — TMDB/OMDb
 * responses are cached in IndexedDB by the app, where TTLs are enforced. */

const VERSION = 'v1';
const CACHE = `watchlist-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/idb.js',
  './js/tmdb.js',
  './js/omdb.js',
  './js/sort.js',
  './js/sync.js',
  './js/mock.js',
  './js/recommend.js',
  './js/views/browse.js',
  './js/views/lists.js',
  './js/views/detail.js',
  './js/views/parts.js',
  './js/views/settings.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing; one 404 would leave the app uncached.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // TMDB, OMDb, GitHub, images

  // Network-first keeps a deployed update from being masked by a stale shell,
  // while the cache still answers when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
