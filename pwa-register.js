// pwa-register.js
// Place at: frontend/pwa-register.js
// Add to every HTML page: <script src="/pwa-register.js"></script>

(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/service-worker.js')
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
  }
})();