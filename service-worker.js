// service-worker.js
// PWA Service Worker for iDonate — caching + offline support

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// ─── Cache Config ─────────────────────────────────────────────────────────────
const CACHE_NAME      = 'idonate-v2';   // bumped to force cache refresh
const OFFLINE_FALLBACK = '/Login.html';

const PRE_CACHE_ASSETS = [
    '/Login.html',
    '/Register.html',
    '/Dashboard.html',
    '/DonorView.html',
    '/manifest.json',
    '/logo.png',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// ─── Firebase Config ──────────────────────────────────────────────────────────
firebase.initializeApp({
    apiKey:            "AIzaSyBsg7HK7O1FCTv9UZRIt1e4Q_56XG9Rkgw",
    authDomain:        "idonate-9f055.firebaseapp.com",
    projectId:         "idonate-9f055",
    storageBucket:     "idonate-9f055.firebasestorage.app",
    messagingSenderId: "303354735816",
    appId:             "1:303354735816:web:33c2fc8138cb063e75c9fd",
});

const messaging = firebase.messaging();

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRE_CACHE_ASSETS))
            .catch((err) => console.warn('[SW] Pre-cache partial failure:', err))
    );
    self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(
                names
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            )
        )
    );
    self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;
    if (url.origin !== self.location.origin && !url.hostname.includes('firebase')) return;

    // API / backend calls → network-first, offline fallback
    if (
        url.pathname.startsWith('/api/') ||
        url.hostname.includes('render.com') ||
        url.hostname.includes('onrender.com')
    ) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(JSON.stringify({ error: 'You are offline' }), {
                    status:  503,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
        );
        return;
    }

    // HTML pages → network-first, then cache, then offline fallback
    if (event.request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() =>
                    caches.match(event.request)
                        .then((cached) => cached || caches.match(OFFLINE_FALLBACK))
                )
        );
        return;
    }

    // Static assets → cache-first
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});

// ─── FCM Background Push Handler ─────────────────────────────────────────────
// NOTE: firebase-messaging-sw.js handles the full foreground/background routing.
// This handler in service-worker.js is a safety fallback only.
messaging.onBackgroundMessage((payload) => {
    console.log('[SW:service-worker] Background FCM message:', payload);
    const data      = payload.data || {};
    const title     = data.title     || 'Blood Request';
    const body      = data.body      || 'Someone needs blood near you.';
    const requestId = data.request_id || '';

    if (data.type === 'dismiss_notification') {
        self.registration.getNotifications({ tag: requestId })
            .then((notifications) => notifications.forEach((n) => n.close()));
        return;
    }

    return self.registration.showNotification(title, {
        body,
        icon:               '/icons/icon-192x192.png',
        badge:              '/icons/icon-72x72.png',
        tag:                requestId,
        renotify:           true,
        requireInteraction: false,
        data:               { url: `/DonorView.html?request=${requestId}`, ...data },
        actions: [
            { action: 'view',    title: 'View Request' },
            { action: 'dismiss', title: 'Dismiss'      },
        ],
    });
});

// ─── Notification Click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'dismiss') return;

    const targetUrl = event.notification.data?.url || '/DonorView.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url.includes(targetUrl) && 'focus' in client) {
                        return client.focus();
                    }
                }
                return clients.openWindow(targetUrl);
            })
    );
});

// ─── Message Handler (page → SW) ─────────────────────────────────────────────
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});