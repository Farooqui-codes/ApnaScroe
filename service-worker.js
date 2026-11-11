const CACHE_NAME = 'apnascore-shell-v1';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/dashboard.html',
  '/live-score.html',
  '/match-create.html',
  '/tournament.html',
  '/team.html',
  '/player.html',
  '/scorecard.html',
  '/statistics.html',
  '/leaderboards.html',
  '/settings.html',
  '/profile.html',
  '/public-match.html',
  '/public-tournament.html',
  '/css/style.css',
  '/css/responsive.css',
  '/css/dashboard.css',
  '/css/scoring.css',
  '/css/tournament.css',
  '/css/animations.css',
  '/js/icons.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/scoring-engine.js',
  '/js/offline-sync.js',
  '/js/migrate.js',
  '/js/animations.js',
  '/js/main.js',
  '/js/dashboard.js',
  '/js/match.js',
  '/js/scoring.js',
  '/js/tournament.js',
  '/js/team.js',
  '/js/player.js',
  '/js/scorecard.js',
  '/js/pdf.js',
  '/js/statistics.js',
  '/js/settings.js',
  '/js/vendor/gsap.min.js',
  '/js/vendor/jspdf.umd.min.js',
  '/js/vendor/jspdf.plugin.autotable.min.js',
  '/assets/logos/apnascore-logo.png',
  '/assets/images/apnascore-og-preview.jpg',
  '/assets/icons/apnascore-icon.png',
  '/assets/icons/favicon-32.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(APP_SHELL_ASSETS.map((url) => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    // Network first for API; do not serve stale errors
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ success: false, offline: true, message: 'Offline mode active' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Cache-first with background refresh for app shell assets
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const fetchPromise = fetch(request).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkRes;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
