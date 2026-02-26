// Firebase Cloud Messaging Service Worker for iDonate
// ✅ UNIFIED: This is the ONE service worker for both caching (PWA) AND FCM notifications.
// pwa-register.js must register THIS file as /firebase-messaging-sw.js
// global.js must use this registration for messaging.getToken()
//
// ✅ SDK v8 (NOT v10): v10 uses fcmregistrations.googleapis.com which requires
// the Firebase apiKey to be unrestricted --- causing 401 errors on Vercel deployments.
// v8 uses iid.googleapis.com which authenticates via VAPID key only --- no apiKey needed.

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBsg7HK7O1FCTv9UZRIt1e4Q_56XG9Rkgw",
  authDomain:        "idonate-9f055.firebaseapp.com",
  projectId:         "idonate-9f055",
  storageBucket:     "idonate-9f055.firebasestorage.app",
  messagingSenderId: "303354735816",
  appId:             "1:303354735816:web:33c2fc8138cb063e75c9fd",
  measurementId:     "G-JCBK24BW1E"
});

const messaging = firebase.messaging();

// ─── Cache Config ─────────────────────────────────────────────────────────────
const CACHE_NAME = 'idonate-v2';
const OFFLINE_FALLBACK = '/Login.html';
const PRE_CACHE_ASSETS = [
  '/Login.html', '/Register.html', '/Dashboard.html',
  '/DonorView.html', '/manifest.json', '/logo.png',
  '/icons/icon-192x192.png', '/icons/icon-512x512.png',
];

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
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch (Cache Strategy) ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !url.hostname.includes('firebase')) return;

  // API / backend → network-first, offline fallback
  if (url.hostname.includes('onrender.com') || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'You are offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
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

// ─── BroadcastChannel for in-app banners ─────────────────────────────────────
const bc = new BroadcastChannel('idonate_notifications');

// ─── Dedup guard ──────────────────────────────────────────────────────────────
const _handledPushIds = new Set();

function _getDedupeKey(data) {
  const bucket = Math.floor(Date.now() / 5000);
  return `${data.request_id || data.type || 'unknown'}_${bucket}`;
}

// ─── FIX: Track page visibility via postMessage from main page ───────────────
// Previously the SW received PAGE_VISIBILITY messages but discarded them,
// then tried to use client.visibilityState which is unreliable across browsers.
// Now we maintain a Set of client IDs that are currently visible, updated via
// postMessage. This is the only reliable cross-browser approach in a SW.
const _visibleClients = new Set();

// ─── Check if any app window is currently visible ────────────────────────────
// FIX: Prefer the _visibleClients set (kept in sync via postMessage) over
// reading client.visibilityState directly, which is unreliable in Safari and
// some Android browsers. Fall back to client.visibilityState if the set is
// empty (e.g. before the first PAGE_VISIBILITY message arrives).
async function _hasVisibleClient() {
  if (_visibleClients.size > 0) return true;

  // Fallback: iterate clients and check visibilityState directly
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clients.some((c) => c.visibilityState === 'visible');
}

// ─── Core notification delivery ───────────────────────────────────────────────
async function deliverNotification(data) {
  const title = data.title || '🩸 Blood Request';
  const body  = data.body  || 'Someone needs blood — tap to help!';

  const dedupKey = _getDedupeKey(data);
  if (_handledPushIds.has(dedupKey)) {
    console.log('[SW] Duplicate push suppressed:', dedupKey);
    return;
  }

  _handledPushIds.add(dedupKey);
  setTimeout(() => _handledPushIds.delete(dedupKey), 10000);

  const visible = await _hasVisibleClient();

  if (visible) {
    // App is open and visible → send in-app banner only, suppress OS push
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let sent = false;

    for (const client of clients) {
      // FIX: Check both the _visibleClients set and the native visibilityState
      if (_visibleClients.has(client.id) || client.visibilityState === 'visible') {
        client.postMessage({ type: 'BLOOD_REQUEST_NOTIFICATION', title, body, data });
        sent = true;
        break;
      }
    }

    if (!sent) bc.postMessage({ type: 'BLOOD_REQUEST_NOTIFICATION', title, body, data });

    console.log('[SW] Page VISIBLE → in-app banner only');
    return; // Do NOT call showNotification
  }

  // App is backgrounded or closed → OS push notification
  console.log('[SW] Page HIDDEN → OS push notification');

  return self.registration.showNotification(title, {
    body,
    icon:               '/logo.png',
    badge:              '/logo.png',
    tag:                data.request_id || 'blood-request',
    renotify:           true,
    requireInteraction: false,
    vibrate:            [200, 100, 200],
    data:               data,
    actions: [
      { action: 'view',    title: 'View Request' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  });
}

// ─── Dismiss handler ──────────────────────────────────────────────────────────
function handleDismiss(requestId) {
  const closePromise = self.registration.getNotifications({ tag: requestId })
    .then((notifications) => notifications.forEach((n) => n.close()));
  bc.postMessage({ type: 'DISMISS_NOTIFICATION', request_id: requestId });
  return closePromise;
}

// ─── Raw push event (fires in standalone PWA mode) ────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Raw push event received');
  let data = {};
  try {
    const payload = event.data ? event.data.json() : {};
    data = payload.data || payload.notification || payload || {};
  } catch (e) {
    console.warn('[SW] Could not parse push payload:', e);
  }

  if (!data.type && !data.title && !data.request_id) return;

  if (data.type === 'dismiss_notification') {
    event.waitUntil(handleDismiss(data.request_id));
    return;
  }

  event.waitUntil(deliverNotification(data));
});

// ─── FCM SDK background message handler ───────────────────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] onBackgroundMessage received');
  const data = payload.data || {};
  if (data.type === 'dismiss_notification') return handleDismiss(data.request_id);
  return deliverNotification(data);
});

// ─── Message handler (postMessage from main page) ─────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // FIX: Actually track page visibility state here so deliverNotification()
  // can reliably know whether a foreground tab is open. Previously this
  // message was received but completely ignored (just a comment said
  // "informational only"), which meant _hasVisibleClient() always fell back
  // to the unreliable client.visibilityState property.
  if (event.data.type === 'PAGE_VISIBILITY') {
    const clientId = event.source?.id;
    if (clientId) {
      if (event.data.visible) {
        _visibleClients.add(clientId);
      } else {
        _visibleClients.delete(clientId);
      }
    }
    return;
  }

  if (event.data.type === 'DISMISS_NOTIFICATION') {
    event.waitUntil(handleDismiss(event.data.request_id));
  }
});

// ─── Clean up _visibleClients when a window closes ───────────────────────────
// FIX: Without this, a closed tab's clientId lingers in _visibleClients
// forever, causing the SW to think the app is visible when it's not.
self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
  const liveIds = new Set(clients.map((c) => c.id));
  for (const id of _visibleClients) {
    if (!liveIds.has(id)) _visibleClients.delete(id);
  }
});

// ─── Notification click handler ───────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked, action:', event.action);
  event.notification.close();

  if (event.action === 'dismiss') return;

  const data      = event.notification.data || {};
  const requestId = data.request_id;
  const urlToOpen = requestId
    ? `${self.location.origin}/DonorView.html?request=${requestId}`
    : `${self.location.origin}/DonorView.html`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes('DonorView') && 'focus' in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
      })
  );
});