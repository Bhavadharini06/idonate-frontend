// firebase-messaging-sw.js
// Firebase Cloud Messaging Service Worker for iDonate
// UPDATED: Safe foreground/background notification control
//   - Page VISIBLE  → in-app banner only  (no OS push)
//   - Page HIDDEN   → OS push only        (no in-app banner)
//   - Never both at the same time

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

// ─── Page Visibility State ─────────────────────────────────────────────────
// Updated by the main page via postMessage({ type: 'PAGE_VISIBILITY', visible: true/false })
// Defaults to false (background) so that if the SW fires before the page
// reports in, we safely fall back to OS push rather than silently dropping it.
let pageIsVisible = false;

// ─── Core: deliver notification based on page visibility ───────────────────
function deliverNotification(data) {
  const title = data.title || '🩸 Blood Request';
  const body  = data.body  || 'Someone needs blood — tap to help!';

  if (pageIsVisible) {
    // FOREGROUND — show only in-app banner, suppress OS push entirely
    bc.postMessage({ type: 'BLOOD_REQUEST_NOTIFICATION', title, body, data });
    console.log('[SW] Page VISIBLE → in-app banner only (OS push suppressed)');
    return Promise.resolve();
  } else {
    // BACKGROUND — show only OS push, no in-app banner
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
}

// ─── Dismiss Handler ────────────────────────────────────────────────────────
function handleDismiss(requestId) {
  const closePromise = self.registration.getNotifications({ tag: requestId })
    .then(notifications => {
      notifications.forEach(n => n.close());
      console.log('[SW] Dismissed OS notification for request:', requestId);
    });
  // Always broadcast dismiss to all open tabs so in-page banners are removed
  bc.postMessage({ type: 'DISMISS_NOTIFICATION', request_id: requestId });
  return closePromise;
}

// ─── Background Message Handler (FCM push arrives while page is hidden) ─────
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);
  const data = payload.data || {};

  if (data.type === 'dismiss_notification') {
    return handleDismiss(data.request_id);
  }

  return deliverNotification(data);
});

// ─── Message Handler (postMessage from main page) ───────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // ── Visibility sync — page tells SW its current visibility state
  if (event.data.type === 'PAGE_VISIBILITY') {
    pageIsVisible = event.data.visible === true;
    console.log('[SW] Page visibility updated:', pageIsVisible ? 'VISIBLE' : 'HIDDEN');
    return;
  }

  // ── Foreground notification forwarded from global.js onMessage handler
  if (event.data.type === 'SHOW_NOTIFICATION') {
    console.log('[SW] SHOW_NOTIFICATION received from page');
    event.waitUntil(
      deliverNotification(event.data.payload)
        .then(() => console.log('[SW] deliverNotification complete'))
        .catch(err => console.error('[SW] deliverNotification error:', err))
    );
  }

  // ── Dismiss forwarded from page
  if (event.data.type === 'DISMISS_NOTIFICATION') {
    event.waitUntil(handleDismiss(event.data.request_id));
  }
});

// ─── Notification Click Handler ─────────────────────────────────────────────
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
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('DonorView.html') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(urlToOpen) : undefined;
    })
  );
});