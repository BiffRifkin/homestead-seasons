const CACHE = 'homestead-seasons-v1.9';
const APP_SHELL = [
  './','./index.html','./styles.css?v=1.9','./app.js?v=1.9','./manifest.json',
  './assets/property.png','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png','./assets/apple-touch-icon.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isFreshAsset = event.request.mode === 'navigate' || /\.(?:js|css)$/.test(url.pathname);
  if (isFreshAsset) {
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put(event.request,response.clone()));
      return response;
    }).catch(async () => (await caches.match(event.request)) || (await caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response && response.ok) caches.open(CACHE).then(cache => cache.put(event.request,response.clone()));
    return response;
  })));
});
