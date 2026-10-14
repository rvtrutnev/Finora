import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const themeSource = fs.readFileSync(new URL('../js/theme.js', import.meta.url), 'utf8');

function runBootstrap(stored, { throws = false } = {}) {
  const match = html.match(/<script\b[^>]*\bid="theme-bootstrap"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match, 'The executable head bootstrap is missing');
  const root = { dataset: { theme: 'classic' } };
  const reads = [];
  const networkCalls = [];
  const storage = { getItem(key) {
    reads.push(key);
    if (throws) throw new Error('Storage denied');
    return stored ?? null;
  } };
  const sandbox = {
    document: { documentElement: root, get body() { throw new Error('Body is not initialized'); } },
    localStorage: storage,
    window: { localStorage: storage },
    fetch(...args) { networkCalls.push(['fetch', ...args]); },
    supabase: { createClient(...args) { networkCalls.push(['supabase', ...args]); } },
    sb: { auth: { updateUser(...args) { networkCalls.push(['updateUser', ...args]); } } }
  };
  vm.runInNewContext(match[1], sandbox, { filename: 'index.html#theme-bootstrap' });
  return { theme: root.dataset.theme, reads, networkCalls };
}

test('empty storage leaves Classic before body initialization', () => {
  assert.equal(runBootstrap(null).theme, 'classic');
});
test('a stored Pixel Retro theme applies before body initialization', () => {
  const result = runBootstrap('pixel-retro');
  assert.equal(result.theme, 'pixel-retro');
  assert.deepEqual(result.reads, ['finora_theme']);
});
test('invalid stored themes resolve to Classic', () => {
  for (const value of ['PIXEL-RETRO', '', 'dark', '{}']) {
    assert.equal(runBootstrap(value).theme, 'classic');
  }
});
test('storage failures keep Classic without escaping an exception', () => {
  assert.equal(runBootstrap('pixel-retro', { throws: true }).theme, 'classic');
});
test('bootstrap restores local preference without network or Supabase calls', () => {
  assert.deepEqual(runBootstrap('pixel-retro').networkCalls, []);
});

function appHarness({ updateError = null, storageThrows = false, missingThemeAsset = false, initialTheme = 'classic', updateRemoteImpl } = {}) {
  const values = new Map();
  const nodes = new Map();
  const callbacks = [];
  const writes = [];
  const timers = [];
  function element(id = '') {
    const attributes = {};
    return { id, dataset: {}, style: {}, textContent: '', title: '',
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(key, value) { attributes[key] = value; },
      getAttribute(key) { return attributes[key]; },
      appendChild(node) { nodes.set(node.id, node); }
    };
  }
  const control = element('theme-toggle');
  const meta = element();
  const root = { dataset: { theme: initialTheme } };
  const document = {
    documentElement: root, body: element(), addEventListener() {},
    createElement() { return element(); },
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return meta;
      if (selector === 'nav') return nodes.get('nav');
      return null;
    },
    querySelectorAll(selector) { return selector === '[data-theme-toggle]' ? [control] : []; }
  };
  for (const id of ['loading-screen', 'auth-screen', 'nav', 'lang-menu']) nodes.set(id, element(id));
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    if (!nodes.has(match[1])) nodes.set(match[1], element(match[1]));
  }
  const storage = {
    getItem(key) { if (storageThrows) throw new Error('Storage denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (storageThrows) throw new Error('Storage denied'); values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
  const auth = {
    onAuthStateChange(callback) { callbacks.push(callback); },
    async updateUser(payload) {
      writes.push(JSON.parse(JSON.stringify(payload)));
      if (updateRemoteImpl) return updateRemoteImpl(payload);
      return { error: updateError };
    },
    async signOut() { return { error: null }; }
  };
  const sandbox = {
    document, localStorage: storage, window: { localStorage: storage }, navigator: {},
    supabase: { createClient() { return { auth }; } }, console,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {}
  };
  const context = vm.createContext(sandbox);
  if (!missingThemeAsset) vm.runInContext(themeSource, context);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  vm.runInContext(scripts.at(-1)[1], context, { filename: 'index.html#application' });
  // Keep the real auth callback and theme adapter; replace financial UI/data boundaries.
  vm.runInContext('loadAllData = async () => {}; showPage = () => {}; setAuthMode = () => {};', context);
  return {
    values, root, control, nodes, writes, callbacks,
    run(source) { return vm.runInContext(source, context); },
    async authEvent(event, session) { return callbacks[0](event, session); },
    async flushAuthTasks() {
      while (timers.some(timer => timer.delay === 0)) {
        const index = timers.findIndex(timer => timer.delay === 0);
        await timers.splice(index, 1)[0].callback();
      }
      await Promise.resolve(); await Promise.resolve();
    }
  };
}

test('the application toggle updates root, accessible action and Supabase metadata only', async () => {
  const app = appHarness();
  await app.authEvent('SIGNED_IN', { access_token: 'token-1', user: { id: 'user-1', user_metadata: { theme: 'classic' } } });
  await app.flushAuthTasks();
  await app.run('toggleTheme()');
  assert.equal(app.root.dataset.theme, 'pixel-retro');
  assert.equal(app.control.getAttribute('aria-pressed'), 'true');
  assert.equal(app.control.getAttribute('aria-label'), 'Переключить на классическую тему');
  assert.deepEqual(app.writes, [{ data: { theme: 'pixel-retro' } }]);
  assert.match(app.nodes.get('toast').textContent, /Pixel Retro/);
  assert.equal(app.nodes.get('toast').dataset.kind, 'success');
});

test('all five languages refresh the action label and theme notification', async () => {
  const app = appHarness();
  await app.authEvent('SIGNED_IN', { user: { id: 'user-1', user_metadata: { theme: 'classic' } } });
  await app.flushAuthTasks();
  for (const [code, label, message] of [
    ['ru', 'Переключить на Pixel Retro', 'Включена тема Pixel Retro'],
    ['en', 'Switch to Pixel Retro', 'Pixel Retro theme enabled'],
    ['de', 'Zu Pixel Retro wechseln', 'Pixel-Retro-Design aktiviert'],
    ['fr', 'Passer au thème Pixel Retro', 'Thème Pixel Retro activé'],
    ['es', 'Cambiar al tema Pixel Retro', 'Tema Pixel Retro activado']
  ]) {
    app.run(`themeController.apply('classic'); setLanguage('${code}');`);
    assert.equal(app.control.getAttribute('aria-label'), label);
    assert.equal(app.control.title, label);
    await app.run('toggleTheme()');
    assert.equal(app.nodes.get('toast').textContent, '✓ ' + message);
  }
});

test('one existing auth listener defers and deduplicates missing-metadata writes', async () => {
  const app = appHarness();
  const session = { access_token: 'token-1', user: { id: 'user-1', user_metadata: {} } };
  assert.equal(app.callbacks.length, 1);
  await app.authEvent('INITIAL_SESSION', session);
  await app.authEvent('SIGNED_IN', session);
  assert.deepEqual(app.writes, [], 'Remote auth calls must occur outside the Supabase auth callback');
  await app.flushAuthTasks();
  assert.deepEqual(app.writes, [{ data: { theme: 'classic' } }]);
  await app.authEvent('SIGNED_OUT', null);
  assert.equal(app.values.get('finora_theme'), 'classic');
});

test('signed-out sessions never reconcile or send queued theme metadata', async () => {
  const app = appHarness();
  await app.authEvent('SIGNED_IN', { user: { id: 'user-1', user_metadata: {} } });
  await app.authEvent('SIGNED_OUT', null);
  await app.flushAuthTasks();
  assert.deepEqual(app.writes, []);
  assert.equal(app.root.dataset.theme, 'classic');
});

test('remote failure keeps local preference and presents a semantic warning toast', async () => {
  const app = appHarness({ updateError: new Error('Offline') });
  await app.authEvent('SIGNED_IN', { user: { id: 'user-1', user_metadata: { theme: 'classic' } } });
  await app.flushAuthTasks();
  await app.run('toggleTheme()');
  assert.equal(app.root.dataset.theme, 'pixel-retro');
  assert.equal(app.values.get('finora_theme'), 'pixel-retro');
  assert.equal(app.nodes.get('toast').dataset.kind, 'warning');
  assert.match(app.nodes.get('toast').textContent, /^⚠ /);
});

test('unavailable storage does not prevent application theme controls from working', async () => {
  const app = appHarness({ storageThrows: true });
  await app.run('toggleTheme()');
  assert.equal(app.root.dataset.theme, 'pixel-retro');
});

test('missing theme asset keeps Classic auth startup and application helpers usable', async () => {
  const app = appHarness({ missingThemeAsset: true, initialTheme: 'pixel-retro' });
  assert.equal(app.callbacks.length, 1, 'The existing auth listener must still register');
  await app.authEvent('INITIAL_SESSION', null);
  app.run("setLanguage('en'); showToast(t('auth_login_tab'), 'info');");
  assert.equal(app.nodes.get('toast').textContent, 'ℹ Sign In');
  await app.run('toggleTheme()');
  await app.authEvent('SIGNED_IN', { user: { id: 'user-1', user_metadata: { theme: 'pixel-retro' } } });
  await app.flushAuthTasks();
  assert.equal(app.root.dataset.theme, 'classic');
  assert.equal(app.nodes.get('theme-toggle').getAttribute('disabled'), '');
  assert.deepEqual(app.writes, []);
});

test('queued theme intent from account A is dropped after sign-out and account B sign-in', async () => {
  let resolveFirst;
  let requestCount = 0;
  const app = appHarness({ updateRemoteImpl: () => {
    if (requestCount++ === 0) return new Promise(resolve => { resolveFirst = resolve; });
    return { error: null };
  } });
  await app.authEvent('SIGNED_IN', { access_token: 'token-A', user: { id: 'user-A', user_metadata: { theme: 'classic' } } });
  await app.flushAuthTasks();
  const first = app.run('toggleTheme()');
  await Promise.resolve();
  const second = app.run('toggleTheme()');
  assert.deepEqual(app.writes, [{ data: { theme: 'pixel-retro' } }], 'A first intent has been sent; second is queued');
  await app.authEvent('SIGNED_OUT', null);
  await app.authEvent('SIGNED_IN', { access_token: 'token-B', user: { id: 'user-B', user_metadata: { theme: 'pixel-retro' } } });
  await app.flushAuthTasks();
  resolveFirst({ error: null });
  const [, dropped] = await Promise.all([first, second]);
  assert.deepEqual(app.writes, [{ data: { theme: 'pixel-retro' } }], 'An unsent A intent must never update B metadata');
  assert.equal(dropped.synced, false);
  assert.equal(app.root.dataset.theme, 'pixel-retro');
  assert.equal(app.values.has('finora_theme_sync_pending'), false);
});

test('sign-out invalidates scheduled reconciliation even if the next login repeats the same session fingerprint', async () => {
  const app = appHarness();
  const session = { access_token: 'token-A', user: { id: 'user-A', user_metadata: {} } };
  await app.authEvent('SIGNED_IN', session);
  await app.authEvent('SIGNED_OUT', null);
  await app.authEvent('SIGNED_IN', session);
  await app.flushAuthTasks();
  assert.deepEqual(app.writes, [{ data: { theme: 'classic' } }]);
});
