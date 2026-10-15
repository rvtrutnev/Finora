# Service Worker Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить ошибку Safari `Returned response is null` и сделать поведение Service Worker Finora определённым при сбое сети и отсутствии ресурса в кэше.

**Architecture:** Сохранить существующую модель network-first, но вынести гарантированный fallback в отдельную функцию внутри `sw.js`. Проверять поведение Service Worker как исполняемого скрипта в изолированном `node:vm`-контексте с реальными объектами `Response` и управляемыми реализациями `fetch`/Cache Storage.

**Tech Stack:** статический HTML/PWA, Service Worker API, Node.js 24 (`node:test`, `node:assert`, `node:vm`), Python 3 HTTP server, Chrome, Safari.

## Global Constraints

- Не изменять бизнес-логику `index.html`.
- Не менять Supabase, данные пользователей, аутентификацию или схему БД.
- Не менять Cloudflare Pages до успешной локальной проверки.
- Не объединять `dev` с `main` и не публиковать без отдельного подтверждения пользователя.
- Не добавлять npm-зависимости или сборщик к существующему статическому проекту.
- Для перехваченного запроса `respondWith()` всегда должен получать promise, завершающийся объектом `Response`.

## File Structure

- Create: `tests/service-worker.test.mjs` — изолированный загрузчик `sw.js` и поведенческие тесты событий `install`, `activate` и `fetch`.
- Modify: `sw.js` — network-first, гарантированный fallback, фильтрация запросов и ограниченная очистка кэшей Finora.
- Preserve: `index.html`, `manifest.json`, Supabase-конфигурация и остальные статические ресурсы.

---

### Task 1: Гарантированный Response при сетевой ошибке

**Files:**
- Create: `tests/service-worker.test.mjs`
- Modify: `sw.js:1-24`
- Test: `tests/service-worker.test.mjs`

**Interfaces:**
- Consumes: глобальные Service Worker API `self.addEventListener`, `fetch`, `caches.match`, `Response`.
- Produces: внутренняя `networkFirst(request): Promise<Response>`; обработчик `fetch`, который передаёт её promise в `respondWith()`.

- [ ] **Step 1: Создать тестовый загрузчик Service Worker и тесты fallback**

Создать `tests/service-worker.test.mjs`:

```js
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
      return { async addAll() {} };
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
    openedCaches
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
```

- [ ] **Step 2: Запустить тесты и подтвердить правильное падение**

Run:

```bash
/Users/roman/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/service-worker.test.mjs
```

Expected: тест сетевого ответа и точного кэша проходят; тесты навигационного fallback и явного `503 Response` падают, потому что текущий `sw.js` возвращает `undefined` при cache miss.

- [ ] **Step 3: Реализовать минимальный network-first fallback**

Заменить обработчик `fetch` в `sw.js`, добавив функцию:

```js
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

self.addEventListener('fetch', event => {
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('cdn.')) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});
```

- [ ] **Step 4: Запустить тесты и подтвердить зелёный результат**

Run the same `node --test` command.

Expected: `4` tests passed, `0` failed.

- [ ] **Step 5: Проверить diff и создать отдельный commit**

```bash
git diff --check
git diff -- sw.js tests/service-worker.test.mjs
git add sw.js tests/service-worker.test.mjs
git commit -m "fix: guarantee service worker fallback response"
```

---

### Task 2: Ограничить перехват запросов и очистку кэшей

**Files:**
- Modify: `tests/service-worker.test.mjs`
- Modify: `sw.js:1-35`
- Test: `tests/service-worker.test.mjs`

**Interfaces:**
- Consumes: тестовый helper `createWorker()` из Task 1.
- Produces: `CACHE_PREFIX = 'finora-'`, `CACHE = 'finora-v2'`; обработчик пропускает не-`GET`, Supabase и CDN; активация удаляет только старые кэши Finora.

- [ ] **Step 1: Добавить падающие тесты фильтрации и жизненного цикла**

Добавить в `tests/service-worker.test.mjs`:

```js
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
    url: 'https://project.supabase.co/rest/v1/wallets'
  }));
  const cdn = await worker.dispatchFetch(localRequest({
    url: 'https://cdn.jsdelivr.net/npm/chart.js'
  }));

  assert.equal(supabase, null);
  assert.equal(cdn, null);
});

test('installs the v2 app shell cache', async () => {
  const worker = createWorker({
    fetchImpl: async () => new Response('online')
  });

  await worker.dispatchLifecycle('install');

  assert.deepEqual(worker.openedCaches, ['finora-v2']);
});

test('activation deletes only stale Finora caches', async () => {
  const worker = createWorker({
    fetchImpl: async () => new Response('online'),
    cacheKeys: ['finora-v1', 'finora-v2', 'unrelated-cache']
  });

  await worker.dispatchLifecycle('activate');

  assert.deepEqual(worker.deletedCaches, ['finora-v1']);
});
```

- [ ] **Step 2: Запустить тесты и подтвердить правильные падения**

Run the `node --test` command from Task 1.

Expected: новый тест POST падает, потому что запрос перехватывается; тест установки падает на `finora-v1`; тест активации показывает удаление `unrelated-cache`. Тест Supabase/CDN уже проходит и фиксирует сохранённое поведение.

- [ ] **Step 3: Реализовать фильтрацию и версионирование кэша**

Изменить константы и обработчики `sw.js`:

```js
const CACHE_PREFIX = 'finora-';
const CACHE = `${CACHE_PREFIX}v2`;
const ASSETS = ['./index.html'];

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' ||
      event.request.url.includes('supabase.co') ||
      event.request.url.includes('cdn.')) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});
```

- [ ] **Step 4: Запустить весь тестовый файл**

Run the `node --test` command from Task 1.

Expected: `8` tests passed, `0` failed.

- [ ] **Step 5: Проверить diff и создать отдельный commit**

```bash
git diff --check
git diff -- sw.js tests/service-worker.test.mjs
git add sw.js tests/service-worker.test.mjs
git commit -m "test: cover service worker request lifecycle"
```

---

### Task 3: Локальная проверка Chrome и Safari

**Files:**
- Verify only: `index.html`, `sw.js`, `manifest.json`

**Interfaces:**
- Consumes: финальный `sw.js` и тесты из Tasks 1-2.
- Produces: доказательства локальной загрузки, регистрации обновлённого Service Worker и отсутствия ошибки `Returned response is null`.

- [ ] **Step 1: Повторно запустить автоматические тесты**

```bash
/Users/roman/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/service-worker.test.mjs
```

Expected: `8` tests passed, `0` failed.

- [ ] **Step 2: Запустить локальный HTTP-сервер**

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Сервер должен оставаться активным на время браузерной проверки.

- [ ] **Step 3: Проверить HTTP-ресурсы**

```bash
curl -I http://127.0.0.1:4173/
curl -I http://127.0.0.1:4173/sw.js
curl -I http://127.0.0.1:4173/manifest.json
```

Expected: все три запроса возвращают `HTTP/1.0 200 OK`.

- [ ] **Step 4: Проверить Chrome**

Открыть `http://127.0.0.1:4173/` в отдельной вкладке Chrome. Проверить наличие заголовка `Finora`, формы входа и отсутствие браузерной страницы ошибки. Перезагрузить вкладку один раз после регистрации Service Worker и повторить проверку.

- [ ] **Step 5: Проверить Safari**

Открыть `http://127.0.0.1:4173/` в отдельной вкладке Safari. Проверить наличие заголовка `Finora`, формы входа и отсутствие `WebKitServiceWorker:0`. Перезагрузить вкладку один раз после регистрации Service Worker и повторить проверку.

- [ ] **Step 6: Финальная проверка репозитория**

```bash
git diff --check
git status --short --branch
git log -4 --oneline --decorate
```

Expected: ветка `dev` содержит commit спецификации и два commits исправления; рабочее дерево чистое; отправки в `origin` и объединения с `main` нет.
