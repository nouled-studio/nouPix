// openLedMapper · remote-sw.js
// The service worker of the installed remote app: it keeps a copy of the remote page and its files, so the app opens
// (and says it is connecting) even while openLedMapper on the main computer isn't reachable. Everything else, and
// the live connection, always goes to the network.
'use strict';
const CACHE = 'olm-remote-2';
const SHELL = ['/remote', '/css/remote.css', '/js/remote-app.js', '/remote.webmanifest', '/icons/remote-192.png', '/icons/remote-512.png', '/icons/remote-maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// The network first, so a newer openLedMapper is always used; the copy only when the network fails
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
