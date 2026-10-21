const CACHE_PREFIX = 'finora-';
const CACHE = `${CACHE_PREFIX}v7`;
const ASSETS = [
  './index.html',
  './styles/themes.css',
  './js/theme.js',
  './js/planning.js',
  './js/import-core.js',
  './js/import-pdf.js',
  './js/import-ui.js',
  './js/faq-content.js',
  './js/faq-ui.js',
  './vendor/pdfjs/pdf.mjs',
  './vendor/pdfjs/pdf.worker.mjs',
  './logo.png',
  './logo-pixel.svg',
  './fonts/press-start-2p/PressStart2P-Regular.woff2',
  './fonts/press-start-2p/OFL.txt'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys
      .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE)
      .map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const appShell = await caches.match('./index.html');
      if (appShell) return appShell;
    }

    return new Response('Finora временно недоступна', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', e => {
  // Изменяющие запросы, Supabase и CDN всегда идут напрямую в сеть.
  if (
    e.request.method !== 'GET' ||
    e.request.url.includes('supabase.co') ||
    e.request.url.includes('cdn.')
  ) {
    return;
  }
  e.respondWith(networkFirst(e.request));
});
