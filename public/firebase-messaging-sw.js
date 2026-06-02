importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

const CACHE_NAME = 'ewp-cache-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/manifest.json',
    '/logo.svg',
    '/logo.png',
    '/favicon.ico'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

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
        // We let Firebase handle the display of the notification automatically
        // since the Cloud Function sends a payload with the "notification" object.
        // Calling self.registration.showNotification here would cause a duplicate notification.
    });
}
