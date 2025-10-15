const CACHE = 'task-pwa-cache-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/style.css',
  '/manifest.json',
  '/bell.png',
  '/offline.html',
  '/404.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Only cache successful responses
        if (response && response.ok) {
          const cloned = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, cloned));
          return response;
        }
        return caches.match('/404.html');
      })
      .catch(() => {
        return caches.match(e.request).then(resp => resp || caches.match('/offline.html'));
      })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = new URL('/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// Optional: receive messages from page to show notification from SW
self.addEventListener('message', event => {
  const data = event.data;
  if (data && data.type === 'SHOW_NOTIFICATION' && data.title) {
    self.registration.showNotification(data.title, data.options || {});
  }
});
