// Service worker for the installed app: keeps the game on the phone so it opens without a connection.
// build.js fills in the version (a hash of the build) and the file list.
const VERSION = 'c871964a3b47';
const APP = 'pocket-bridge-app-' + VERSION;
const FONTS = 'pocket-bridge-fonts';
const FILES = ["./","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png"];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(APP).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('pocket-bridge-app-') === 0 && k !== APP; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // the game itself: from the phone first; a new build arrives with the next version of this file
    event.respondWith(caches.open(APP).then(function (c) {
      return c.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
    }).then(function (hit) { return hit || fetch(req); }));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // fonts: use the stored copy and refresh it in the background; without one, the system fonts are used
    event.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(req).then(function (hit) {
        const net = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit || Response.error(); });
        return hit || net;
      });
    }));
  }
});
