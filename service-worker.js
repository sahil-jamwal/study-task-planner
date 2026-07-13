/* StudyFlow service worker — network-first so users always get the latest version.
   Saved copies are used only as an offline fallback. */
const CACHE_NAME = 'studyflow-shell-v11';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './scheduler.js',
  './firebaseConfig.js',
  './firebaseService.js',
  './authService.js',
  './cloudSync.js',
  './googleCalendar.js',
  './manifest.json'
];

// Install: pre-save the app files, and take over right away.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => undefined)
  );
  self.skipWaiting();
});

// Activate: delete any older saved versions, then control open pages immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Fetch: NETWORK FIRST.
// 1) Try the internet and get the freshest file.
// 2) Save that fresh copy for offline use.
// 3) Only if the internet fails, fall back to the saved copy.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Only manage our own files. Let outside scripts (Google, SheetJS, Firebase) load normally.
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  if (!sameOrigin) return;

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        return networkResponse;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
