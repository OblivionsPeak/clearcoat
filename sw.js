// Clearcoat service worker — offline app shell + versioned cache.
//
// DEPLOY RITUAL: bump VERSION below together with #app-version in index.html
// on every deploy. The new VERSION names a new cache, the install step
// re-precaches the shell, and the in-app "New version ready" toast offers
// the reload that activates it. If VERSION doesn't change, returning users
// keep being served the old cached shell.

const VERSION = 'v0.47';
const CACHE = 'clearcoat-' + VERSION;

// app shell — every path here must exist in the repo
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/advisor.js',
  './js/engine.js',
  './js/library.js',
  './js/lightsweep.js',
  './js/main.js',
  './js/persist.js',
  './js/psd.js',
  './js/regions.js',
  './js/separate.js',
  './js/shaderball.js',
  './js/studio.js',
  './js/tga.js',
  './js/wand.js',
  './js/vendor/ag-psd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  // no skipWaiting here — the page shows an update toast and the user
  // opts in via the SKIP_WAITING message below
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('clearcoat-') && n !== CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept non-GET

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // same-origin: cache-first, network fallback (caching what it fetches)
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
  } else {
    // cross-origin (Google Fonts, GitHub raw): network with cache fallback —
    // fresh when online, stale if offline; never precached
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
