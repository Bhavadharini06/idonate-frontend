// auth-guard.js
// Include this script BEFORE global.js on all protected pages (Dashboard, DonorView, RequesterView).
// It immediately redirects to Login if no token is found, and prevents back navigation to auth pages.

(function () {
    'use strict';

    // ── FIX 1 & 5: Route protection guard
    // If no token exists, redirect to Login immediately.
    var token = localStorage.getItem('token');
    if (!token) {
        history.replaceState(null, '', './Login.html');
        window.location.replace('./Login.html');
        return; // Stop executing the rest of the page scripts
    }

    // ── FIX 2: Back navigation protection for protected pages
    // Push current page state so the browser stack is set.
    // Any popstate that tries to go back will be intercepted.
    var currentPage = window.location.pathname.split('/').pop() || 'Dashboard.html';
    history.replaceState({ page: currentPage, protected: true }, '', './' + currentPage);

    // When back button is pressed on any protected page:
    // - If logged in, push the current page again (traps user inside app)
    // - If somehow logged out, redirect to Login
    window.addEventListener('popstate', function (e) {
        var stillLoggedIn = !!localStorage.getItem('token');
        if (!stillLoggedIn) {
            history.replaceState(null, '', './Login.html');
            window.location.replace('./Login.html');
        } else {
            // Re-push current protected page to prevent escaping to auth pages
            history.pushState({ page: currentPage, protected: true }, '', './' + currentPage);
        }
    });
})();