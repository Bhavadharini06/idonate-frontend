const API_BASE = 'https://idonate-backend-hy7w.onrender.com';

const firebaseConfig = {
  apiKey: "AIzaSyBsg7HK7O1FCTv9UZRIt1e4Q_56XG9Rkgw",
  authDomain: "idonate-9f055.firebaseapp.com",
  projectId: "idonate-9f055",
  storageBucket: "idonate-9f055.firebasestorage.app",
  messagingSenderId: "303354735816",
  appId: "1:303354735816:web:33c2fc8138cb063e75c9fd",
  measurementId: "G-JCBK24BW1E"
};

let messaging = null;
let fcmInitialized = false;
let foregroundHandlerSetup = false;
let idleTimer = null;
let isUserOnline = false;
const IDLE_TIMEOUT = 30000;

// ─── In-Page Notification Banner ──────────────────────────────────────────────
(function injectNotificationStyles() {
  if (document.getElementById('idonate-notif-style')) return;
  const style = document.createElement('style');
  style.id = 'idonate-notif-style';
  style.textContent = `
    #idonate-notif-container {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    .idonate-notif-banner {
      pointer-events: all;
      background: #ffffff;
      border-left: 5px solid #dc2626;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(220,38,38,0.12);
      padding: 14px 18px 14px 14px;
      min-width: 300px;
      max-width: 380px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      animation: idonate-slide-in 0.35s cubic-bezier(.4,0,.2,1);
      cursor: pointer;
    }
    .idonate-notif-banner:hover {
      box-shadow: 0 12px 36px rgba(0,0,0,0.22), 0 4px 12px rgba(220,38,38,0.18);
      transform: translateY(-1px);
      transition: all 0.15s ease;
    }
    .idonate-notif-icon {
      font-size: 28px;
      line-height: 1;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .idonate-notif-content { flex: 1; min-width: 0; }
    .idonate-notif-title {
      font-weight: 700;
      font-size: 14px;
      color: #dc2626;
      margin-bottom: 3px;
      line-height: 1.3;
    }
    .idonate-notif-body {
      font-size: 13px;
      color: #374151;
      line-height: 1.4;
    }
    .idonate-notif-close {
      background: none;
      border: none;
      font-size: 18px;
      color: #9ca3af;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
      margin-top: -2px;
    }
    .idonate-notif-close:hover { color: #dc2626; }
    @keyframes idonate-slide-in {
      from { opacity: 0; transform: translateX(120%); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes idonate-slide-out {
      from { opacity: 1; transform: translateX(0); }
      to   { opacity: 0; transform: translateX(120%); }
    }
  `;
  if (document.head) {
    document.head.appendChild(style);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  }
})();

function getOrCreateNotifContainer() {
  let container = document.getElementById('idonate-notif-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'idonate-notif-container';
    document.body.appendChild(container);
  }
  return container;
}

// ─── Dismiss a specific notification banner by request ID ─────────────────────
function dismissNotificationBanner(requestId) {
  if (!requestId) return;
  const container = document.getElementById('idonate-notif-container');
  if (!container) return;
  container.querySelectorAll('.idonate-notif-banner').forEach(banner => {
    if (banner.dataset.requestId === String(requestId)) {
      banner.style.animation = 'idonate-slide-out 0.3s cubic-bezier(.4,0,.2,1) forwards';
      banner.addEventListener('animationend', () => banner.remove(), { once: true });
      console.log('🗑️ Dismissed in-page banner for request:', requestId);
    }
  });
}

function showInPageNotification(title, body, data) {
  const container = getOrCreateNotifContainer();
  const banner = document.createElement('div');
  banner.className = 'idonate-notif-banner';
  banner.style.position = 'relative';
  banner.style.overflow = 'hidden';
  const requestId = data && data.request_id;
  if (requestId) banner.dataset.requestId = requestId;

  banner.innerHTML = `
    <div class="idonate-notif-icon">🩸</div>
    <div class="idonate-notif-content">
      <div class="idonate-notif-title">${title}</div>
      <div class="idonate-notif-body">${body}</div>
    </div>
    <button class="idonate-notif-close" title="Dismiss">✕</button>
  `;

  banner.addEventListener('click', (e) => {
    if (e.target.classList.contains('idonate-notif-close')) return;
    if (requestId) {
      window.location.href = `./DonorView.html?request=${requestId}`;
    } else {
      window.location.href = './DonorView.html';
    }
  });

  banner.querySelector('.idonate-notif-close').addEventListener('click', () => {
    dismissBanner(banner);
  });

  container.appendChild(banner);

  function dismissBanner(el) {
    el.style.animation = 'idonate-slide-out 0.3s cubic-bezier(.4,0,.2,1) forwards';
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  console.log('✅ In-page notification banner shown:', title);
}

// ─── BroadcastChannel Listener ────────────────────────────────────────────────
// Receives messages from the SW. SW only sends here when pageIsVisible=true,
// so this always maps to the in-app banner — never a duplicate.
(function setupBroadcastListener() {
  try {
    const bc = new BroadcastChannel('idonate_notifications');
    bc.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'BLOOD_REQUEST_NOTIFICATION') {
        console.log('📬 BroadcastChannel notification received:', msg);
        showInPageNotification(msg.title, msg.body, msg.data || {});
      }

      if (msg.type === 'DISMISS_NOTIFICATION') {
        console.log('🗑️ BroadcastChannel dismiss received for request:', msg.request_id);
        dismissNotificationBanner(msg.request_id);
      }
    });
    console.log('✅ BroadcastChannel listener active');
  } catch (e) {
    console.warn('⚠️ BroadcastChannel not supported:', e);
  }
})();

// ─── Visibility Sync to Service Worker ────────────────────────────────────────
// KEY mechanism that prevents duplicate notifications.
// The SW reads pageIsVisible before deciding: in-app banner OR OS push.
(function syncVisibilityToSW() {
  function sendVisibility() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: 'PAGE_VISIBILITY',
      visible: document.visibilityState === 'visible'
    });
    console.log('👁️ Visibility synced to SW:', document.visibilityState);
  }

  // Send once SW is ready (covers initial page load)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(() => sendVisibility())
      .catch(() => {});
  }

  // Re-send on every tab switch, minimize, restore
  document.addEventListener('visibilitychange', sendVisibility);
})();

// ─── API Helper ───────────────────────────────────────────────────────────────
async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = options.headers || {};
  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  try {
    const response = await fetch(`${API_BASE}/${endpoint}`, { ...options, headers });
    if (response.status === 401) {
      localStorage.removeItem('token');
      window.location.href = './Login.html';
      return;
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.message !== 'Failed to fetch') {
      console.error(`API request failed for ${endpoint}:`, error);
    }
    throw error;
  }
}

// ─── FCM Initialization ───────────────────────────────────────────────────────
async function initializeFCM() {
  if (fcmInitialized) return true;
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications');
    return false;
  }
  if (!('serviceWorker' in navigator)) {
    console.warn('This browser does not support service workers');
    return false;
  }
  try {
    console.log('🔄 Registering service worker...');
    const existingRegs = await navigator.serviceWorker.getRegistrations();
    for (const reg of existingRegs) {
      await reg.update();
    }
    await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    console.log('✅ Service worker active');

    // Immediately sync visibility after SW becomes ready
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'PAGE_VISIBILITY',
        visible: document.visibilityState === 'visible'
      });
    }

    const { initializeApp, getApps, getApp } = await
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getMessaging } = await
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');

    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    messaging = getMessaging(app);
    fcmInitialized = true;
    console.log('✅ FCM initialized');

    await setupForegroundMessageHandler();
    return true;
  } catch (error) {
    console.error('❌ FCM initialization failed:', error);
    return false;
  }
}

// ─── Request Permission & Register Token ──────────────────────────────────────
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('Browser does not support notifications');
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission denied');
    return false;
  }
  const initialized = await initializeFCM();
  if (!initialized) return false;

  try {
    const { getToken } = await
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');
    const registration = await navigator.serviceWorker.ready;

    let deviceId = localStorage.getItem('fcm_device_id');
    if (!deviceId) {
      deviceId = 'web_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('fcm_device_id', deviceId);
      console.log('🆔 New device ID created:', deviceId);
    }

    console.log('🔄 Requesting FCM token...');
    const currentToken = await getToken(messaging, {
      vapidKey: 'BKM4qtaxUhKbxDc2uy1NpAgAeafz10fwKpJn6fdoIr9F1p7NXkGxR7viSyGDmx45mYNFOH3MCxbdvbYWUrIEEy4',
      serviceWorkerRegistration: registration
    });

    if (currentToken) {
      const lastRegisteredToken = localStorage.getItem('fcm_last_token');
      const needsReregister = localStorage.getItem('fcm_needs_reregister') === 'true';

      if (needsReregister || lastRegisteredToken !== currentToken) {
        if (lastRegisteredToken && lastRegisteredToken !== currentToken) {
          try {
            await apiRequest('fcm/unregister', {
              method: 'POST',
              body: JSON.stringify({ token: lastRegisteredToken, device_id: deviceId })
            });
          } catch (err) {
            console.warn('Failed to unregister old token:', err);
          }
        }
        await apiRequest('fcm/register', {
          method: 'POST',
          body: JSON.stringify({ token: currentToken, device_id: deviceId })
        });
        localStorage.setItem('fcm_last_token', currentToken);
        localStorage.removeItem('fcm_needs_reregister');
        console.log('✅ FCM token registered:', currentToken.substring(0, 20) + '...');
      } else {
        console.log('✅ FCM token unchanged (already registered)');
      }
      return true;
    } else {
      console.warn('⚠️ No FCM token obtained');
      return false;
    }
  } catch (error) {
    console.error('❌ Error getting FCM token:', error);
    return false;
  }
}

// ─── Foreground Message Handler ───────────────────────────────────────────────
async function setupForegroundMessageHandler() {
  if (!messaging) return;
  if (foregroundHandlerSetup) return;
  foregroundHandlerSetup = true;

  const { onMessage } = await
    import('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');

  onMessage(messaging, async (payload) => {
    console.log('📬 Foreground FCM message received:', payload);
    const data = payload.data || {};

    // Handle dismiss messages in the foreground
    if (data.type === 'dismiss_notification') {
      console.log('🗑️ Foreground dismiss received for request:', data.request_id);
      dismissNotificationBanner(data.request_id);
      try {
        const registration = await navigator.serviceWorker.ready;
        const sw = navigator.serviceWorker.controller || registration.active;
        if (sw) {
          sw.postMessage({ type: 'DISMISS_NOTIFICATION', request_id: data.request_id });
        }
      } catch (err) {
        console.warn('⚠️ Could not forward dismiss to SW:', err);
      }
      return;
    }

    const notificationPayload = {
      title:      data.title      || '🩸 Blood Request',
      body:       data.body       || 'Someone needs blood — tap to help!',
      request_id: data.request_id || '',
      ...data
    };

    if (Notification.permission !== 'granted') return;

    // Sync visibility to SW right before forwarding — ensures SW has latest state
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'PAGE_VISIBILITY',
        visible: document.visibilityState === 'visible'
      });
    }

    // Forward to SW — SW checks pageIsVisible and shows banner OR OS push, never both
    try {
      const registration = await navigator.serviceWorker.ready;
      const sw = navigator.serviceWorker.controller || registration.active;
      if (sw) {
        sw.postMessage({ type: 'SHOW_NOTIFICATION', payload: notificationPayload });
        console.log('✅ Forwarded foreground message to SW for display');
      } else {
        console.warn('⚠️ No active SW controller — showing in-page banner directly');
        showInPageNotification(notificationPayload.title, notificationPayload.body, notificationPayload);
      }
    } catch (err) {
      console.error('❌ Failed to forward to SW, showing in-page banner:', err);
      showInPageNotification(notificationPayload.title, notificationPayload.body, notificationPayload);
    }
  });

  console.log('✅ Foreground message handler registered');
}

// ─── Location & Online Status ─────────────────────────────────────────────────
async function updateLocation(latitude, longitude) {
  try {
    await apiRequest('users/location', {
      method: 'PUT',
      body: JSON.stringify({ latitude, longitude })
    });
  } catch (err) {
    console.warn('⚠️ Location update failed:', err.message);
  }
}

async function updateOnlineStatus(isOnline) {
  try {
    await apiRequest('users/online', {
      method: 'PUT',
      body: JSON.stringify({ is_online: isOnline })
    });
    isUserOnline = isOnline;
  } catch (err) {
    console.warn('⚠️ Online status update failed:', err.message);
  }
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      err => reject(new Error(`Geolocation error: ${err.message}`)),
      { timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ─── Idle Detection ────────────────────────────────────────────────────────────
function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!isUserOnline) {
    updateOnlineStatus(true).catch(() => {});
  }
  idleTimer = setTimeout(() => {
    updateOnlineStatus(false).catch(() => {});
  }, IDLE_TIMEOUT);
}

// ─── Auto-Online Initialization ───────────────────────────────────────────────
function initializeAutoOnline() {
  const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
  activityEvents.forEach(event => {
    document.addEventListener(event, resetIdleTimer, { passive: true });
  });

  if (document.visibilityState === 'visible') {
    updateOnlineStatus(true)
      .then(() => {
        console.log('✅ Auto-online initialized');
        return getCurrentLocation();
      })
      .then(loc => updateLocation(loc.latitude, loc.longitude))
      .catch(err => {
        console.warn('⚠️ Location update failed (user still online):', err.message);
      })
      .finally(() => {
        requestNotificationPermission().catch(err =>
          console.warn('⚠️ Notification setup failed:', err)
        );
      });
    resetIdleTimer();
  }

  window.addEventListener('beforeunload', () => {
    if (isUserOnline) {
      const token = localStorage.getItem('token');
      fetch(`${API_BASE}/users/online`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ is_online: false }),
        keepalive: true
      });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAutoOnline);
} else {
  initializeAutoOnline();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    apiRequest,
    initializeFCM,
    requestNotificationPermission,
    updateLocation,
    updateOnlineStatus,
    getCurrentLocation
  };
}