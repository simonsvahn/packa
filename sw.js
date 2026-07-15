/* Packa.
   Cacha endast appskalet. Varken masterdata, Dropbox-svar eller
   framtida arkivexport får någonsin hamna i denna cachelista. */
const CACHE_PREFIX = 'packa-shell-';
const CACHE = `${CACHE_PREFIX}2026-07-15-16`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './src/app.js',
  './src/core-demo.js',
  './src/real-workspace.js',
  './src/insights.js',
  './src/views.js',
  './src/data-layer.js',
  './src/dropbox-live.js',
  './src/domain/canonical.js',
  './src/domain/hlc.js',
  './src/domain/materializer.js',
  './src/domain/operations.js',
  './src/domain/repository.js',
  './src/domain/schema-v1.js',
  './src/storage/indexeddb.js',
  './src/storage/memory.js',
  './src/sync/batch.js',
  './src/sync/compaction.js',
  './src/sync/dropbox-transport.js',
  './src/sync/errors.js',
  './src/sync/memory-transport.js',
  './src/sync/oauth-flow.js',
  './src/sync/oauth-pkce.js',
  './src/sync/session.js',
  './src/sync/sync-engine.js'
];

self.addEventListener('install', event => {
  const freshShell = SHELL.map(path => new Request(new URL(path, self.location.href), { cache: 'reload' }));
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(freshShell))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('packlista-data.json') || url.pathname.includes('/ops/') || url.pathname.includes('/archive/')) return;

  const isNavigation = request.mode === 'navigate';
  if (isNavigation) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) caches.open(CACHE).then(cache => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
      fetch(request, { cache: 'no-store' })
      .then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
