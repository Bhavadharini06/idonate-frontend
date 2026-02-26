// pwa-register.js — registers firebase-messaging-sw.js as the single unified service worker.
// This file handles BOTH PWA caching AND FCM push notifications.
// Add to every HTML page: <script src="/pwa-register.js"></script>

(function () {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    // ✅ CRITICAL: Register firebase-messaging-sw.js (not service-worker.js).
    // FCM requires the SW that called firebase.messaging() to be the one
    // passed to messaging.getToken(). Using a separate service-worker.js breaks FCM.
    navigator.serviceWorker
      .register('/firebase-messaging-sw.js')
      .then(function (registration) {
        console.log('[PWA] Service Worker registered. Scope:', registration.scope);

        registration.addEventListener('updatefound', function () {
          var newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New version available — reload to update.');
            }
          });
        });
      })
      .catch(function (error) {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  });
})();