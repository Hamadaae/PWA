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
                // Cache new requests
                if (response.ok) {
                    const cloned = response.clone();
                    caches.open(CACHE).then(cache => cache.put(e.request, cloned));
                    return response;
                }
                // Custom 404
                return caches.match('/404.html');
            })
            .catch(() => {
                // Offline fallback
                return caches.match(e.request).then(resp => resp || caches.match('/offline.html'));
            })
    );
});

// New: listen for messages from the page and show notifications
self.addEventListener('message', (event) => {
    try {
        const data = event.data;
        if (data && data.type === 'SHOW_NOTIFICATION') {
            // Use showNotification so the notification originates from the SW (works when page isn't focused)
            self.registration.showNotification(data.title, data.options || {});
        }
    } catch (err) {
        console.error('SW message handler error:', err);
    }
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window" }).then(windowClients => {
            for (let client of windowClients) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
