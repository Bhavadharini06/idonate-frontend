// nav.js — drop-in navigation patch for iDonate PWA
// Replaces window.location page transitions with a red cover fade
// so the browser chrome never flashes. Add ONCE to every page:
//   <script src="/nav.js"></script>

(function () {
  'use strict';

  // Create the cover element once and reuse it
  function getCover() {
    var el = document.getElementById('__nav_cover');
    if (!el) {
      el = document.createElement('div');
      el.id = '__nav_cover';
      el.style.cssText =
        'position:fixed;inset:0;background:#dc2626;z-index:2147483647;' +
        'opacity:0;pointer-events:none;transition:opacity 0.18s ease;';
      document.body.appendChild(el);
    }
    return el;
  }

  // Fade in red cover, navigate after paint
  window.navTo = function (url) {
    var cover = getCover();
    cover.style.opacity = '1';
    cover.style.pointerEvents = 'all';
    // Wait for the cover to be fully painted before navigating
    setTimeout(function () {
      window.location.href = url;
    }, 180);
  };

  // On every page load, fade the cover out so arrival is smooth
  document.addEventListener('DOMContentLoaded', function () {
    var cover = getCover();
    cover.style.opacity = '1';
    cover.style.pointerEvents = 'all';
    // Allow first paint, then fade out
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        cover.style.opacity = '0';
        cover.style.pointerEvents = 'none';
      });
    });
  });
})();