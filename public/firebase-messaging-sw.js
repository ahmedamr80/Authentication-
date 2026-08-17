importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

const CACHE_NAME = 'ewp-cache-v2'; // Increment version for updates
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/logo.svg',
    '/logo.png',
    '/favicon.ico',
];

// 1. Install Event: Cache essential assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// 2. Activate Event: Cleanup old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. Fetch Event: Intelligent caching strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests and Firebase-specific URLs (Auth/Firestore/FCM)
    if (request.method !== 'GET' ||
        url.origin.includes('firebase') ||
        url.origin.includes('googleapis') ||
        url.pathname.startsWith('/api/')) {
        return;
    }

    // Strategy for Static Assets (Images, Next.js JS/CSS chunks)
    if (url.pathname.startsWith('/_next/static/') ||
        STATIC_ASSETS.includes(url.pathname) ||
        url.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico|woff2|css|js)$/)) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                return fetch(request).then((networkResponse) => {
                    return caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, networkResponse.clone());
                        return networkResponse;
                    });
                });
            })
        );
        return;
    }

    // Strategy for Pages (Navigation): Network First, fallback to cache
    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseClone);
                });
                return networkResponse;
            })
            .catch(() => caches.match(request))
    );
});

// --- FIREBASE MESSAGING ---

// We get the config from the URL search params so it is always available synchronously when SW starts up.
const params = new URL(location).searchParams;

const firebaseConfig = {
    apiKey: params.get("apiKey"),
    authDomain: params.get("authDomain"),
    projectId: params.get("projectId"),
    storageBucket: params.get("storageBucket"),
    messagingSenderId: params.get("messagingSenderId"),
    appId: params.get("appId")
};

if (!firebase.apps.length && firebaseConfig.apiKey) {
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();
    
    messaging.onBackgroundMessage((payload) => {
        console.log('[firebase-messaging-sw.js] Received background message ', payload);
    });
}
