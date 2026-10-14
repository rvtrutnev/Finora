const CACHE = 'finora-v1';
const ASSETS = ['./index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
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
  // Supabase и CDN запросы всегда через сеть
  if (e.request.url.includes('supabase.co') || e.request.url.includes('cdn.')) {
    return;
  }
  e.respondWith(networkFirst(e.request));
});
