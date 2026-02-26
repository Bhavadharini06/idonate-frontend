// firebase-messaging-sw.js
// Firebase Cloud Messaging Service Worker for iDonate
//
// FIXES APPLIED:
//
// 1. BOTH client.postMessage() AND bc.postMessage() are sent when app is visible.
//    Previously only one path was used. Now the page catches it via whichever
//    listener (SW message or BroadcastChannel) is ready first.
//    showInAppNotification() deduplicates by request_id so it never shows twice.
//
// 2. Visibility detected via clients.matchAll() inside the push handler —
//    not via a postMessage-synced pageIsVisible flag which was unreliable
//    in standalone PWA mode.
//
// 3. Dedup guard (_handledPushIds) prevents both the raw push event AND
//    onBackgroundMessage from triggering two OS notifications for the same push.

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

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

// BroadcastChannel — page must also listen on this (set up in global.js)
const bc = new BroadcastChannel('idonate_notifications');

// ─── Duplicate Push Guard ─────────────────────────────────────────────────────
const _handledPushIds = new Set();

function _dedupKey(data) {
    const bucket = Math.floor(Date.now() / 5000); // 5-second window
    return `${data.request_id || data.type || 'unknown'}_${bucket}`;
}

// ─── Check if any client window is currently visible ─────────────────────────
async function _hasVisibleClient() {
    const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    });
    return clients.some(c => c.visibilityState === 'visible');
}

// ─── Core notification router ─────────────────────────────────────────────────
async function deliverNotification(data) {
    const title = data.title || '🩸 Blood Request';
    const body  = data.body  || 'Someone needs blood — tap to help!';

    // Dedup check — drop if already handled in the last 5 seconds
    const key = _dedupKey(data);
    if (_handledPushIds.has(key)) {
        console.log('[SW] Duplicate suppressed:', key);
        return;
    }
    _handledPushIds.add(key);
    setTimeout(() => _handledPushIds.delete(key), 10000);

    const visible = await _hasVisibleClient();

    if (visible) {
        // ── FOREGROUND ────────────────────────────────────────────────────────
        // Send on BOTH channels so whichever listener is ready in global.js
        // first will catch it. The banner is deduplicated by request_id in
        // showInAppNotification() so it only appears once even if both fire.

        // Channel A: direct postMessage to the visible client window
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });
        for (const client of clients) {
            if (client.visibilityState === 'visible') {
                client.postMessage({ type: 'BLOOD_REQUEST_NOTIFICATION', title, body, data });
                break;
            }
        }

        // Channel B: BroadcastChannel as redundant fallback
        bc.postMessage({ type: 'BLOOD_REQUEST_NOTIFICATION', title, body, data });

        console.log('[SW] FOREGROUND → in-app banner dispatched on both channels');
        // IMPORTANT: return here — do NOT call showNotification()
        return;
    }

    // ── BACKGROUND ────────────────────────────────────────────────────────────
    console.log('[SW] BACKGROUND → OS push notification');
    return self.registration.showNotification(title, {
        body,
        icon:               '/logo.png',
        badge:              '/logo.png',
        tag:                data.request_id || 'blood-request',
        renotify:           true,
        requireInteraction: false,
        vibrate:            [200, 100, 200],
        data:               data
    });
}

// ─── Dismiss handler ──────────────────────────────────────────────────────────
function handleDismiss(requestId) {
    const closePromise = self.registration.getNotifications({ tag: requestId })
        .then(notifications => notifications.forEach(n => n.close()));

    // Notify all open tabs to remove their in-app banner too
    bc.postMessage({ type: 'DISMISS_NOTIFICATION', request_id: requestId });
    return closePromise;
}

// ─── Raw Push Event ───────────────────────────────────────────────────────────
// Fires in all display modes. We intercept here so we fully control the flow.
self.addEventListener('push', (event) => {
    console.log('[SW] Raw push event received');

    let data = {};
    try {
        const payload = event.data ? event.data.json() : {};
        data = payload.data || payload.notification || payload || {};
    } catch (e) {
        console.warn('[SW] Could not parse push payload:', e);
    }

    // If it has none of our expected fields, let the FCM SDK handle it
    if (!data.type && !data.title && !data.request_id) return;

    if (data.type === 'dismiss_notification') {
        event.waitUntil(handleDismiss(data.request_id));
        return;
    }

    event.waitUntil(deliverNotification(data));
});

// ─── FCM Background Message Handler ──────────────────────────────────────────
// Fires for background pushes via the FCM SDK. Dedup with raw push via _handledPushIds.
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] onBackgroundMessage:', payload);
    const data = payload.data || {};

    if (data.type === 'dismiss_notification') {
        return handleDismiss(data.request_id);
    }

    return deliverNotification(data);
});

// ─── Page → SW message handler ────────────────────────────────────────────────
self.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'PAGE_VISIBILITY') {
        // Informational only — routing now uses clients.matchAll()
        console.log('[SW] PAGE_VISIBILITY (info):', event.data.visible ? 'VISIBLE' : 'HIDDEN');
        return;
    }

    if (event.data.type === 'SHOW_NOTIFICATION') {
        // Forwarded from Firebase onMessage() in browser-tab mode
        event.waitUntil(deliverNotification(event.data.payload));
    }

    if (event.data.type === 'DISMISS_NOTIFICATION') {
        event.waitUntil(handleDismiss(event.data.request_id));
    }

    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ─── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked');
    event.notification.close();

    if (event.action === 'dismiss') return;

    const data      = event.notification.data || {};
    const requestId = data.request_id;
    const origin    = self.location.origin;
    const urlToOpen = requestId
        ? `${origin}/DonorView.html?request=${requestId}`
        : `${origin}/DonorView.html`;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clients) => {
                for (const client of clients) {
                    if (client.url.includes('DonorView') && 'focus' in client) {
                        return client.focus();
                    }
                }
                return self.clients.openWindow ? self.clients.openWindow(urlToOpen) : undefined;
            })
    );
});