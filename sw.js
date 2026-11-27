const CACHE_NAME = 'study-os-v22';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  // 单个资源 404 不能拖垮整次安装：逐项 add，失败的等下次在线访问再补
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k.indexOf('study-os-') === 0).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || new Response(
          '<!doctype html><meta charset="utf-8"><title>离线</title><p>当前离线，且本地缓存尚未建立。请联网后再打开一次。</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    }).then((res) => res || new Response('', { status: 504, statusText: 'Offline' }))
  );
});
