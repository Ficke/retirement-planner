/* global URLSearchParams, console, document, window */

(() => {
  const measurementId = 'G-Q998L3MV0B';
  const analyticsHostnames = new Set(['adamficke.dev', 'www.adamficke.dev']);

  if (!analyticsHostnames.has(window.location.hostname) || typeof window.gtag === 'function') {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  script.addEventListener('error', () => {
    console.error('Google Analytics failed to load.');
  });
  document.head.append(script);

  window.gtag('js', new Date());

  if (new URLSearchParams(window.location.search).has('analytics_debug')) {
    window.gtag('config', measurementId, { debug_mode: true });
  } else {
    window.gtag('config', measurementId);
  }
})();
