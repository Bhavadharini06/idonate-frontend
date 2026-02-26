// ⚠️  VAPID KEY: Must exactly match the Web Push certificate in:
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Key pair
// If you see a 401 error from fcmregistrations.googleapis.com, this key is wrong.

const VAPID_KEY = 'BKM4qtaxUhKbxDc2uy1NpAgAeafz10fwKpJn6fdoIr9F1p7NXkGxR7viSyGDmx45mYNFOH3MCxbdvbYWUrIEEy4';

const ONLINE_KEY = 'user_is_online';

// ────────────────────────────────────────────────────────────────────────────
// Heartbeat interval handle — kept so we can clear it on logout
// ────────────────────────────────────────────────────────────────────────────
let _onlineHeartbeatTimer = null;

// Called once when any page loads (after token check confirms user is logged in)
async function restoreOnlineStatus() {
    const stored = localStorage.getItem(ONLINE_KEY);

    // FIX: If notification permission is already granted we should always
    // re-assert online=true so the backend donor pool is populated correctly.
    // Previously this only ran when stored === 'true', meaning first-time users
    // (who never explicitly went online) would never appear in the donor query.
    if (stored === 'true' || Notification.permission === 'granted') {
        try {
            await apiRequest('users/online', {
                method: 'PUT',
                body: JSON.stringify({ is_online: true })
            });
            localStorage.setItem(ONLINE_KEY, 'true');
        } catch (err) {
            console.warn('[iDonate] Could not restore online status:', err);
        }
    }

    // FIX: Start a heartbeat so the backend never expires the user as offline
    // due to a stale is_online flag (e.g. server restart, tab inactive).
    _startOnlineHeartbeat();
}

// Send a keepalive every 90 seconds while the tab is open and the user is
// supposed to be online. This handles server restarts and network blips
// that would otherwise leave is_online stuck as False in the DB.
function _startOnlineHeartbeat() {
    if (_onlineHeartbeatTimer) return; // already running
    _onlineHeartbeatTimer = setInterval(async () => {
        if (localStorage.getItem(ONLINE_KEY) !== 'true') return;
        try {
            await apiRequest('users/online', {
                method: 'PUT',
                body: JSON.stringify({ is_online: true })
            });
        } catch (err) {
            // Silently ignore — next tick will retry
        }
    }, 90_000);
}

function _stopOnlineHeartbeat() {
    if (_onlineHeartbeatTimer) {
        clearInterval(_onlineHeartbeatTimer);
        _onlineHeartbeatTimer = null;
    }
}

// ════════════════════════════════════════════════════════════════════════════
// SW + BroadcastChannel listeners --- registered IMMEDIATELY so they are ready
// before any FCM push arrives (critical for standalone PWA mode).
// ════════════════════════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (!event.data) return;
        const { type, title, body, data } = event.data;
        if (type === 'BLOOD_REQUEST_NOTIFICATION') showInAppNotification({ title, body, ...(data || {}) });
        if (type === 'DISMISS_NOTIFICATION')       _dismissBanner(event.data.request_id);
    });
}

const _notifBC = new BroadcastChannel('idonate_notifications');
_notifBC.onmessage = (event) => {
    if (!event.data) return;
    const { type, title, body, data } = event.data;
    if (type === 'BLOOD_REQUEST_NOTIFICATION') showInAppNotification({ title, body, ...(data || {}) });
    if (type === 'DISMISS_NOTIFICATION')       _dismissBanner(event.data.request_id);
};

function _dismissBanner(requestId) {
    if (!requestId) return;
    document.querySelectorAll(`.notification-banner[data-request-id="${requestId}"]`)
            .forEach(el => el.remove());
}

// ════════════════════════════════════════════════════════════════════════════
// API Request Helper
// ════════════════════════════════════════════════════════════════════════════
async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
    };
    const response = await fetch(`${API_BASE}/${endpoint}`, { ...options, headers });

    if (response.status === 401) {
        localStorage.removeItem('token');
        window.location.href = './Login.html';
        throw new Error('Unauthorized');
    }

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed: ${response.status}`);
    }

    return response.json();
}

// ════════════════════════════════════════════════════════════════════════════
// Online Status
// ════════════════════════════════════════════════════════════════════════════
async function updateOnlineStatus(isOnline) {
    try {
        await apiRequest('users/online', {
            method: 'PUT',
            body: JSON.stringify({ is_online: isOnline })
        });
        // Persist intent — only cleared on logout
        localStorage.setItem(ONLINE_KEY, isOnline ? 'true' : 'false');

        // FIX: Stop heartbeat when user goes offline so we don't accidentally
        // flip them back to online after they explicitly went offline.
        if (!isOnline) {
            _stopOnlineHeartbeat();
        } else {
            _startOnlineHeartbeat();
        }
    } catch (err) {
        console.warn('[iDonate] Failed to update online status:', err);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Location
// ════════════════════════════════════════════════════════════════════════════
async function updateLocation(latitude, longitude) {
    try {
        await apiRequest('users/location', {
            method: 'PUT',
            body: JSON.stringify({ latitude, longitude })
        });
    } catch (err) {
        console.warn('[iDonate] Failed to update location:', err);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// FCM Token Registration --- dedup guard
// ════════════════════════════════════════════════════════════════════════════
let _fcmRegistrationInProgress = false;
let _fcmLastRegisteredToken    = null;

async function registerFCMToken(token) {
    if (_fcmRegistrationInProgress) {
        console.log('[FCM] Registration already in progress, skipping duplicate');
        return false;
    }

    if (_fcmLastRegisteredToken === token) {
        console.log('[FCM] Token unchanged, skipping re-registration');
        return true;
    }

    _fcmRegistrationInProgress = true;

    try {
        let deviceId = localStorage.getItem('fcm_device_id');
        if (!deviceId) {
            deviceId = 'web_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('fcm_device_id', deviceId);
        }

        await apiRequest('fcm/register', {
            method: 'POST',
            body: JSON.stringify({ token, device_id: deviceId })
        });

        localStorage.setItem('fcm_last_token', token);
        _fcmLastRegisteredToken = token;
        console.log('[FCM] Token registered, device:', deviceId);

        // FIX: After successfully registering the FCM token the user is
        // definitively "online" — set it now so the backend donor pool
        // includes this user immediately (was missing before; caused
        // "Online donors with FCM tokens: 0" in the notification loop).
        await updateOnlineStatus(true);

        return true;
    } catch (err) {
        console.error('[FCM] Token registration failed:', err);
        return false;
    } finally {
        setTimeout(() => { _fcmRegistrationInProgress = false; }, 5000);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Request Notification Permission + FCM Setup
// ════════════════════════════════════════════════════════════════════════════
async function requestNotificationPermission() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;

    if (Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result !== 'granted') return false;
    }

    if (Notification.permission !== 'granted') return false;

    try {
        // Wait for the active service worker registration (firebase-messaging-sw.js at scope '/')
        // NOTE: getRegistration() takes a PAGE URL within scope, NOT the SW script filename.
        // navigator.serviceWorker.ready is the safest way to get the active registration.
        const swReg = await navigator.serviceWorker.ready;

        console.log('[FCM] Using SW registration:', swReg.active?.scriptURL);

        if (typeof firebase === 'undefined') {
            await _loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
            await _loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');
        }

        if (!firebase.apps.length) {
            firebase.initializeApp({
                apiKey:            "AIzaSyBsg7HK7O1FCTv9UZRIt1e4Q_56XG9Rkgw",
                authDomain:        "idonate-9f055.firebaseapp.com",
                projectId:         "idonate-9f055",
                storageBucket:     "idonate-9f055.firebasestorage.app",
                messagingSenderId: "303354735816",
                appId:             "1:303354735816:web:33c2fc8138cb063e75c9fd",
                measurementId:     "G-JCBK24BW1E"
            });
        }

        const messaging = firebase.messaging();

        let token;
        try {
            token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
        } catch (tokenErr) {
            const msg = tokenErr?.message || String(tokenErr);
            if (msg.includes('401') || msg.includes('authentication') || msg.includes('credential')) {
                console.error('[FCM] ❌ VAPID key error (401): The VAPID key in global.js does NOT match the Web Push certificate in your Firebase Console.\n' +
                    'Fix: Go to Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → copy the Key pair value into VAPID_KEY in global.js');
            } else if (msg.includes('messaging/token-subscribe-failed')) {
                console.error('[FCM] ❌ Token subscribe failed. Check: 1) VAPID key matches Firebase Console, 2) Cloud Messaging API is enabled in Google Cloud Console for project idonate-9f055');
            } else {
                console.error('[FCM] ❌ getToken failed:', tokenErr);
            }
            throw tokenErr;
        }

        if (!token) { console.warn('[FCM] No token received'); return false; }

        console.log('[FCM] ✅ Token obtained successfully');

        await registerFCMToken(token);

        // Foreground handler (browser tab mode)
        // FIX: Use messaging.onMessage to handle notifications when the app is
        // in the foreground. The SW will route background messages; this handler
        // covers the "tab is active" case so we show an in-app banner.
        messaging.onMessage((payload) => {
            const data = payload.data || {};
            if (data.type === 'dismiss_notification') { _dismissBanner(data.request_id); return; }
            showInAppNotification(data);
        });

        // FIX: Inform the SW about current visibility state so it can decide
        // whether to show an OS push or an in-app banner. Send immediately and
        // re-send on every visibility change.
        function _syncVis() {
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type:    'PAGE_VISIBILITY',
                    visible: document.visibilityState === 'visible'
                });
            }
        }

        document.addEventListener('visibilitychange', _syncVis);
        _syncVis(); // send initial state right now

        // Token refresh
        if (messaging.onTokenRefresh) {
            messaging.onTokenRefresh(async () => {
                try {
                    const newToken = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
                    if (newToken && newToken !== _fcmLastRegisteredToken) {
                        _fcmLastRegisteredToken = null;
                        await registerFCMToken(newToken);
                    }
                } catch (e) { console.error('[FCM] Token refresh error:', e); }
            });
        }

        console.log('[FCM] Setup complete');
        return true;

    } catch (err) {
        console.error('[FCM] Setup error:', err);
        return false;
    }
}

// ════════════════════════════════════════════════════════════════════════════
// In-App Notification Banner
// ════════════════════════════════════════════════════════════════════════════
function showInAppNotification(data) {
    const title     = data.title      || '🩸 Blood Request';
    const body      = data.body       || 'Someone needs blood nearby!';
    const requestId = data.request_id || '';

    if (requestId && document.querySelector(`.notification-banner[data-request-id="${requestId}"]`)) return;

    const banner = document.createElement('div');
    banner.className = 'notification-banner';
    if (requestId) banner.dataset.requestId = requestId;
    banner.style.cssText = `
        position: fixed; top: 16px; right: 16px; z-index: 99999;
        background: white; border-left: 4px solid #dc2626;
        border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.18);
        padding: 14px 16px; max-width: 340px; width: calc(100vw - 32px);
        display: flex; flex-direction: column; gap: 8px;
        animation: _swipeIn 0.3s ease;
    `;
    banner.innerHTML = `
        <style>@keyframes _swipeIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}</style>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <strong style="color:#dc2626;font-size:0.95rem;line-height:1.3;">${title}</strong>
            <button onclick="this.closest('.notification-banner').remove()"
               style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:1.3rem;line-height:1;padding:0;flex-shrink:0;">✕</button>
        </div>
        <p style="margin:0;font-size:0.875rem;color:#374151;line-height:1.4;">${body}</p>
        ${requestId ? `
        <div style="display:flex;gap:8px;margin-top:4px;">
            <a href="./DonorView.html?request=${requestId}"
             style="flex:1;text-align:center;background:#dc2626;color:white;padding:7px 12px;
                     border-radius:6px;text-decoration:none;font-size:0.875rem;font-weight:600;">View Request</a>
            <button onclick="this.closest('.notification-banner').remove()"
               style="flex:1;background:#f3f4f6;border:none;border-radius:6px;padding:7px 12px;
                     cursor:pointer;font-size:0.875rem;font-weight:600;color:#374151;">Dismiss</button>
        </div>` : ''}
    `;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 15000);
}

// ════════════════════════════════════════════════════════════════════════════
// Script Loader Helper
// ════════════════════════════════════════════════════════════════════════════
function _loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ════════════════════════════════════════════════════════════════════════════
// Hospital Geocoding
// ════════════════════════════════════════════════════════════════════════════
async function locateHospital() {
    const hospitalName = document.getElementById('hospitalName')?.value.trim();
    const district     = document.getElementById('district')?.value.trim();
    const city         = document.getElementById('city')?.value.trim();

    if (!hospitalName) { alert('Please enter a hospital name'); return; }

    const locateBtn = document.querySelector('.locate-btn');
    const origText  = locateBtn?.innerHTML;
    if (locateBtn) { locateBtn.innerHTML = '🔍 Locating Hospital...'; locateBtn.disabled = true; }

    try {
        const response = await fetch(`${API_BASE}/geocode/hospital`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                hospitalName,
                district: district || null,
                city:     city     || null
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Geocoding failed');

        if (data.success && data.location) {
            const { latitude, longitude, display_name } = data.location;
            window.hospitalCoordinates = { latitude, longitude };

            if (window.map) {
                window.map.setView([latitude, longitude], 15);
                if (window.hospitalMarker) window.map.removeLayer(window.hospitalMarker);
                window.hospitalMarker = L.marker([latitude, longitude]).addTo(window.map);
                window.hospitalMarker.bindPopup(`<b>${hospitalName}</b><br>${display_name}`).openPopup();
            }
            alert(`✅ Hospital located: ${display_name}`);
        } else {
            throw new Error('Invalid response from geocoding service');
        }
    } catch (error) {
        console.error('Geocoding error:', error);
        let errorMessage = 'Unable to locate hospital. ';
        if (error.message.includes('not found')) {
            errorMessage += 'Please check the hospital name spelling.';
        } else if (error.message.includes('unavailable') || error.message.includes('timed out')) {
            errorMessage += 'Service temporarily unavailable. Please try again in a moment.';
        } else {
            errorMessage += error.message;
        }
        alert(errorMessage);
    } finally {
        if (locateBtn) { locateBtn.innerHTML = origText; locateBtn.disabled = false; }
    }
}

function selectOnMap() {
    if (!window.map) { alert('Please open the request form first.'); return; }
    alert('Click anywhere on the map to select the hospital location.');
    window.map.once('click', (e) => {
        const { lat, lng } = e.latlng;
        if (window.hospitalMarker) window.map.removeLayer(window.hospitalMarker);
        window.hospitalMarker = L.marker([lat, lng]).addTo(window.map);
        window.hospitalMarker.bindPopup(`<b>Selected Location</b><br>Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`).openPopup();
        window.hospitalCoordinates = { latitude: lat, longitude: lng };
        window.map.off('click');
        alert('✅ Location selected on map');
    });
}