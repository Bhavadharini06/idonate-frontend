// global.js --- Core shared functions for all iDonate pages.

const API_BASE  = 'https://idonate-backend-hy7w.onrender.com';
const VAPID_KEY = 'BKM4qtaxUhKbxDc2uy1NpAgAeafz10fwKpJn6fdoIr9F1p7NXkGxR7viSyGDmx45mYNFOH3MCxbdvbYWUrIEEy4';
const ONLINE_KEY = 'user_is_online';

// ── Sleep helper ─────────────────────────────────────────────────────────────
function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Wake-up ping ──────────────────────────────────────────────────────────────
// FIX: Call this on page load for Login/Register/Dashboard so the server is
// warmed up before the user submits a form. Render free tier sleeps after
// ~15 min of inactivity; the first request after sleep fails with ERR_FAILED
// (CORS preflight gets no response). This ping wakes the server silently.
async function wakeUpServer() {
    try {
        await fetch(`${API_BASE}/`, {
            method: 'GET',
            signal: AbortSignal.timeout(60000) // wait up to 60s for cold start
        });
        console.log('[iDonate] Server is warm.');
    } catch (err) {
        // Server still waking up — that's fine, subsequent calls will retry
        console.warn('[iDonate] Wake-up ping failed (server may still be starting):', err.message);
    }
}

// ── Raw fetch for online status ───────────────────────────────────────────────
// FIX: Retry logic to handle Render free-tier cold starts.
// When the server wakes up it can take 10-30s, during which CORS preflight
// fails with ERR_FAILED (no response at all). We retry up to 3 times with
// a 3-second delay before giving up silently — never redirecting to Login.
async function _setOnlineRaw(isOnline, retries = 3) {
    const token = localStorage.getItem('token');
    if (!token) return;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${API_BASE}/users/online`, {
                method:  'PUT',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ is_online: isOnline })
            });

            // Any HTTP response (even 4xx) means the server is up and CORS passed
            if (res.ok || res.status === 401 || res.status === 403) {
                return; // success or auth issue — don't retry
            }

            // 5xx server error — wait and retry
            if (attempt < retries) {
                await _sleep(3000 * attempt);
            }

        } catch (err) {
            // ERR_FAILED / network error — Render may still be waking up
            console.warn(`[iDonate] Online status attempt ${attempt}/${retries} failed:`, err.message);
            if (attempt < retries) {
                await _sleep(3000 * attempt); // 3s, 6s backoff
            }
        }
    }
    // All retries exhausted — silently ignore, never redirect
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
let _heartbeatTimer = null;

function _startHeartbeat() {
    if (_heartbeatTimer) return;
    _heartbeatTimer = setInterval(() => {
        if (localStorage.getItem(ONLINE_KEY) === 'true') _setOnlineRaw(true);
    }, 60_000);
}

function _stopHeartbeat() {
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

// ── restoreOnlineStatus ───────────────────────────────────────────────────────
async function restoreOnlineStatus() {
    try {
        const stored = localStorage.getItem(ONLINE_KEY);
        if (stored === 'true' || Notification.permission === 'granted') {
            // Fire-and-forget: the heartbeat will sync online status shortly after.
            _setOnlineRaw(true).catch(() => {});
            localStorage.setItem(ONLINE_KEY, 'true');
        }
        _startHeartbeat();
    } catch (err) {
        console.warn('[iDonate] restoreOnlineStatus error (ignored):', err);
        _startHeartbeat(); // always start heartbeat even on error
    }
}

// ── SW + BroadcastChannel listeners ──────────────────────────────────────────
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

// ── API Request Helper ────────────────────────────────────────────────────────
// FIX: Added retry logic for network errors (ERR_FAILED) caused by Render
// cold starts. Retries up to 3 times with exponential backoff (2s, 4s, 6s).
// Auth errors (401) are NOT retried — they redirect to login immediately.
// 4xx errors (other than 401) are NOT retried — they are real errors.
async function apiRequest(endpoint, options = {}, retries = 3) {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(`${API_BASE}/${endpoint}`, { ...options, headers });

            if (response.status === 401) {
                localStorage.removeItem('token');
                history.replaceState(null, '', './Login.html');
                window.location.replace('./Login.html');
                throw new Error('Unauthorized');
            }

            if (!response.ok) {
                // 4xx errors are real errors — parse and throw immediately, no retry
                if (response.status < 500) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.detail || `Request failed: ${response.status}`);
                }
                // 5xx server errors — retry
                if (attempt < retries) {
                    console.warn(`[iDonate] apiRequest ${endpoint} got ${response.status}, retrying (${attempt}/${retries})...`);
                    await _sleep(2000 * attempt);
                    continue;
                }
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || `Server error: ${response.status}`);
            }

            return response.json();

        } catch (err) {
            // Re-throw auth errors and parsed API errors immediately (they have a real message)
            if (err.message === 'Unauthorized' || (err.message && !err.message.includes('fetch'))) {
                // Check if it's a TypeError from fetch failure vs a real API error
                if (!(err instanceof TypeError)) {
                    throw err;
                }
            }

            // TypeError (network error / ERR_FAILED / CORS preflight fail) — retry
            if (attempt < retries) {
                console.warn(`[iDonate] apiRequest ${endpoint} network error (attempt ${attempt}/${retries}):`, err.message);
                await _sleep(2000 * attempt); // 2s, 4s backoff
                continue;
            }

            // All retries exhausted
            throw new Error('Unable to connect to server. Please check your connection and try again.');
        }
    }
}

// ── Online Status (public) ────────────────────────────────────────────────────
async function updateOnlineStatus(isOnline) {
    await _setOnlineRaw(isOnline);
    localStorage.setItem(ONLINE_KEY, isOnline ? 'true' : 'false');
    if (isOnline) { _startHeartbeat(); } else { _stopHeartbeat(); }
}

// ── Location ──────────────────────────────────────────────────────────────────
async function updateLocation(latitude, longitude) {
    try {
        await apiRequest('users/location', {
            method: 'PUT',
            body:   JSON.stringify({ latitude, longitude })
        });
    } catch (err) {
        console.warn('[iDonate] Failed to update location:', err);
    }
}

function startLocationTracking() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => updateLocation(pos.coords.latitude, pos.coords.longitude),
        (err) => console.warn('[iDonate] Geolocation error:', err),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}