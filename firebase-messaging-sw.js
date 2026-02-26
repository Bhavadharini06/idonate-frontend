// firebase-messaging-sw.js
// Firebase Cloud Messaging Service Worker for iDonate
//
// FIXED: Foreground/background notification routing for installed PWA (standalone mode)
//
//   - App OPEN & VISIBLE  → postMessage to client for in-app banner ONLY
//   - App in BACKGROUND / CLOSED → OS push notification ONLY
//   - Never both at the same time, never duplicates
//
// KEY FIX: Uses clients.matchAll() inside the raw push event instead of relying
// on a postMessage-synced pageIsVisible flag. The flag approach is unreliable in
// standalone PWA mode because the timing of postMessage delivery is not guaranteed
// before the push fires. clients.matchAll() is synchronous to the event and
// accurately reflects which windows are currently focused/visible.

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBsg7HK7O1FCTv9UZRIt1e4Q_56XG9Rkgw",
  authDomain: "idonate-9f055.firebaseapp.com",
  projectId: "idonate-9f055",
  storageBucket: "idonate-9f055.firebasestorage.app",
  messagingSenderId: "303354735816",
  appId: "1:303354735816:web:33c2fc8138cb063e75c9fd",
  measurementId: "G-JCBK24BW1E"
});

const messaging = firebase.messaging();

// BroadcastChannel — sends notification data directly to open page tabs.
// Used ONLY when page is visible (foreground path).
const bc = new BroadcastChannel('idonate_notifications');

// ─── Duplicate Push Guard ──────────────────────────────────────────────────────
// In standalone PWA mode, both the raw `push` event and `onBackgroundMessage`
// can fire for the same FCM message. We deduplicate using a short-lived Set.
const _handledPushIds = new Set();

function _getDedupeKey(data) {
  // Use request_id + a timestamp bucket (5-second window) as the dedup key
  const bucket = Math.floor(Date.now() / 5000);
  return `${data.request_id || data.type || 'unknown'}_${bucket}`;
}

// ─── Core: check visible clients and route notification ───────────────────────
//
// WHY clients.matchAll() and NOT a postMessage-synced flag:
//
//   In a normal browser tab, `document.visibilityState` changes are reliably
//   forwarded to the SW via postMessage before any push fires. In standalone
//   PWA mode this timing guarantee breaks — the push event can fire before the
//   visibility sync message arrives, so `pageIsVisible` is stale (false) even
//   though the app is on screen. The result: showNotification() fires → duplicate.
//
//   clients.matchAll({ type: 'window', includeUncontrolled: true }) queries the
//   LIVE list of open windows right now, inside the same microtask as the push
//   event. It is always accurate regardless of display mode.

async function _hasVisibleClient() {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });

  for (const client of clients) {
    // visibilityState === 'visible' means the window is in the foreground.
    // In standalone PWA mode this correctly returns 'visible' when the app
    // is the active window, and 'hidden' when it is backgrounded.
    if (client.visibilityState === 'visible') {
      return true;
    }
  }
  return false;
}

// ─── Core: deliver notification based on LIVE client visibility ───────────────
async function deliverNotification(data) {
  const title = data.title || '🩸 Blood Request';
  const body  = data.body  || 'Someone needs blood — tap to help!';

  const dedupKey = _getDedupeKey(data);
  if (_handledPushIds.has(dedupKey)) {
    console.log('[SW] Duplicate push suppressed:', dedupKey);
    return;
  }
  _handledPushIds.add(dedupKey);
  // Clean up old keys after 10 seconds to avoid unbounded growth
  setTimeout(() => _handledPushIds.delete(dedupKey), 10000);

  const visible = await _hasVisibleClient();

  if (visible) {
    // FOREGROUND — send to page for in-app banner, suppress OS push entirely
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    let sent = false;
    for (const client of clients) {
      if (client.visibilityState === 'visible') {
        client.postMessage({ type: 'BLOOD_REQUEST_NOTIFICATION', title, body, data });
        sent = true;
        break; // Only need to send to one visible client; it handles the UI
      }
    }

    // Fallback: also broadcast via BroadcastChannel for any listener
    if (!sent) {
      bc.postMessage({ type: 'BLOOD_REQUEST_NOTIFICATION', title, body, data });
    }

    console.log('[SW] Page VISIBLE → in-app banner only (OS push suppressed)');
    // Return WITHOUT calling showNotification()
    return;
  }

  // BACKGROUND — show OS push only, no in-app banner
  console.log('[SW] Page HIDDEN → OS push only (no in-app banner)');
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

// ─── Dismiss Handler ──────────────────────────────────────────────────────────
function handleDismiss(requestId) {
  const closePromise = self.registration.getNotifications({ tag: requestId })
    .then(notifications => {
      notifications.forEach(n => n.close());
      console.log('[SW] Dismissed OS notification for request:', requestId);
    });

  // Always broadcast dismiss to all open tabs so in-page banners are removed too
  bc.postMessage({ type: 'DISMISS_NOTIFICATION', request_id: requestId });
  return closePromise;
}

// ─── Raw Push Event Handler ───────────────────────────────────────────────────
//
// CRITICAL: This raw `push` event fires for ALL pushes in standalone PWA mode,
// including ones that onBackgroundMessage also handles. By intercepting here with
// event.waitUntil() and our dedup guard, we ensure showNotification() is called
// at most once, and never when the app is visible.
//
// The dedup key prevents onBackgroundMessage (below) from showing a second OS
// notification for the same push.

self.addEventListener('push', (event) => {
  console.log('[SW] Raw push event received');

  let data = {};
  try {
    const payload = event.data ? event.data.json() : {};
    // FCM data-only messages pack everything under payload.data
    data = payload.data || payload.notification || payload || {};
  } catch (e) {
    console.warn('[SW] Could not parse push payload:', e);
  }

  if (!data.type && !data.title && !data.request_id) {
    // Not a notification we handle — let FCM SDK take over
    return;
  }

  if (data.type === 'dismiss_notification') {
    event.waitUntil(handleDismiss(data.request_id));
    return;
  }

  event.waitUntil(deliverNotification(data));
});

// ─── Background Message Handler (FCM SDK — fires for background pushes) ───────
//
// onBackgroundMessage is the FCM SDK's own push handler. It fires when the page
// is hidden. We route it through deliverNotification() which deduplicates with
// the raw push handler above, so we never show two OS notifications.

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] onBackgroundMessage received:', payload);

  const data = payload.data || {};

  if (data.type === 'dismiss_notification') {
    return handleDismiss(data.request_id);
  }

  return deliverNotification(data);
});

// ─── Message Handler (postMessage from main page) ─────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // Visibility sync — kept for backward compat but no longer used for routing.
  // Routing now uses clients.matchAll() which is always accurate.
  if (event.data.type === 'PAGE_VISIBILITY') {
    console.log('[SW] PAGE_VISIBILITY received (informational only):', event.data.visible);
    return;
  }

  // Foreground notification forwarded from global.js onMessage handler
  if (event.data.type === 'SHOW_NOTIFICATION') {
    console.log('[SW] SHOW_NOTIFICATION received from page');
    event.waitUntil(
      deliverNotification(event.data.payload)
        .then(() => console.log('[SW] deliverNotification complete'))
        .catch(err => console.error('[SW] deliverNotification error:', err))
    );
  }

  // Dismiss forwarded from page
  if (event.data.type === 'DISMISS_NOTIFICATION') {
    event.waitUntil(handleDismiss(event.data.request_id));
  }
});

// ─── Notification Click Handler ───────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  event.notification.close();

  const data      = event.notification.data || {};
  const requestId = data.request_id;
  const origin    = self.location.origin;
  const urlToOpen = requestId
    ? `${origin}/DonorView.html?request=${requestId}`
    : `${origin}/DonorView.html`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus existing window if already open
        for (const client of clients) {
          if (client.url.includes('DonorView') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});