import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(
  new URL('../sw.js', import.meta.url),
  'utf8'
);

function createWorker({ fetchImpl, cacheMatches = new Map(), cacheKeys = [] }) {
  const listeners = {};
  const deletedCaches = [];
  const openedCaches = [];
  const precachedAssets = [];

  const caches = {
    async match(request) {
      const key = typeof request === 'string' ? request : request.url;
      return cacheMatches.get(key);
    },
    async keys() {
      return cacheKeys;
    },
    async delete(key) {
      deletedCaches.push(key);
      return true;
    },
    async open(key) {
      openedCaches.push(key);
      return { async addAll(assets) { precachedAssets.push([...assets]); } };
    }
  };

  const self = {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    skipWaiting() {},
    clients: { claim() {} }
  };

  vm.runInNewContext(workerSource, {
    self,
    caches,
    fetch: fetchImpl,
    Response,
    URL,
    Promise
  }, { filename: 'sw.js' });

  async function dispatchFetch(request) {
    let responsePromise = null;
    listeners.fetch({
      request,
      respondWith(value) {
        responsePromise = Promise.resolve(value);
      }
    });
    return responsePromise;
  }

  async function dispatchLifecycle(type) {
    let completion = Promise.resolve();
    listeners[type]({
      waitUntil(value) {
        completion = Promise.resolve(value);
      }
    });
    await completion;
  }

  return {
    dispatchFetch,
    dispatchLifecycle,
    deletedCaches,
    openedCaches,
    precachedAssets
  };
}

const localRequest = (overrides = {}) => ({
  method: 'GET',
  mode: 'same-origin',
  url: 'https://finora.test/app.js',
  ...overrides
});

test('returns the network response when fetch succeeds', async () => {
  const expected = new Response('online', { status: 200 });
  const worker = createWorker({ fetchImpl: async () => expected });
  const actual = await worker.dispatchFetch(localRequest());
  assert.equal(actual, expected);
});

test('returns the exact cached response when the network fails', async () => {
  const request = localRequest();
  const cached = new Response('cached', { status: 200 });
  const worker = createWorker({
    fetchImpl: async () => { throw new Error('offline'); },
    cacheMatches: new Map([[request.url, cached]])
  });
  const actual = await worker.dispatchFetch(request);
  assert.equal(actual, cached);
});

test('returns cached index.html for an uncached navigation request', async () => {
  const fallback = new Response('app shell', { status: 200 });
  const worker = createWorker({
    fetchImpl: async () => { throw new Error('offline'); },
    cacheMatches: new Map([['./index.html', fallback]])
  });
  const actual = await worker.dispatchFetch(localRequest({
    mode: 'navigate',
    url: 'https://finora.test/dashboard'
  }));
  assert.equal(actual, fallback);
});

test('returns an explicit 503 response when network and cache are unavailable', async () => {
  const worker = createWorker({
    fetchImpl: async () => { throw new Error('offline'); }
  });
  const actual = await worker.dispatchFetch(localRequest());
  assert.ok(actual instanceof Response);
  assert.equal(actual.status, 503);
  assert.match(await actual.text(), /временно недоступна/i);
});

test('does not intercept non-GET requests', async () => {
  const worker = createWorker({
    fetchImpl: async () => new Response('unexpected')
  });
  const actual = await worker.dispatchFetch(localRequest({ method: 'POST' }));
  assert.equal(actual, null);
});

test('does not intercept Supabase or CDN requests', async () => {
  const worker = createWorker({
    fetchImpl: async () => new Response('unexpected')
  });

  const supabase = await worker.dispatchFetch(localRequest({
    url: 'https://example.supabase.co/rest/v1/items'
  }));
  const cdn = await worker.dispatchFetch(localRequest({
    url: 'https://cdn.example.com/library.js'
  }));

  assert.equal(supabase, null);
  assert.equal(cdn, null);
});

test('install opens finora-v3 and precaches all local theme assets', async () => {
  const worker = createWorker({ fetchImpl: async () => new Response('online') });
  await worker.dispatchLifecycle('install');
  assert.deepEqual(worker.openedCaches, ['finora-v3']);
  assert.deepEqual(worker.precachedAssets, [[
    './index.html',
    './styles/themes.css',
    './js/theme.js',
    './fonts/press-start-2p/PressStart2P-Regular.woff2',
    './fonts/press-start-2p/OFL.txt'
  ]]);
});

test('activation deletes only obsolete Finora caches', async () => {
  const worker = createWorker({
    fetchImpl: async () => new Response('online'),
    cacheKeys: ['finora-v1', 'finora-v2', 'finora-v3', 'other-app-v1']
  });
  await worker.dispatchLifecycle('activate');
  assert.deepEqual(worker.deletedCaches, ['finora-v1', 'finora-v2']);
});
