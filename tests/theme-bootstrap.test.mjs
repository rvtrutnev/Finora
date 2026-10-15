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

test('chart rendering preserves Classic colors and switches only visible chart presentation', () => {
  const app = appHarness();
  app.run(`
    globalThis.chartTokens = {};
    globalThis.getComputedStyle = () => ({ getPropertyValue: name => chartTokens[name] || '' });
    globalThis.Chart = function(canvas, config) {
      this.canvas = canvas; this.config = config; this.data = config.data;
      this.options = config.options; this.updates = [];
      this.update = mode => this.updates.push(mode);
      this.destroy = () => {};
    };
    globalThis.visibleCanvas = { closest: () => ({}) };
    globalThis.hiddenCanvas = { closest: () => null };
    globalThis.lineConfig = { type: 'line', data: { datasets: [{ data: [100, 250], tension: 0.3 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { display: false } } } };
    chartNetWorth = createThemedChart(visibleCanvas, lineConfig);
    chartDashNetWorth = createThemedChart(hiddenCanvas, structuredClone(lineConfig));
  `);
  assert.equal(app.run('chartNetWorth.data.datasets[0].borderColor'), '#d4a849');
  assert.equal(app.run('chartNetWorth.data.datasets[0].backgroundColor'), '#d4a84922');
  app.run(`
    globalThis.originalData = chartNetWorth.data.datasets[0].data;
    document.documentElement.dataset.theme = 'pixel-retro';
    chartTokens = { '--chart-primary': '#22b8b0', '--chart-primary-fill': '#22b8b022',
      '--chart-tooltip-background': '#171811', '--chart-tooltip-text': '#e9dfac',
      '--font-body': 'Inter, sans-serif' };
    refreshVisibleChartThemes();
  `);
  assert.equal(app.run('chartNetWorth.data.datasets[0].borderColor'), '#22b8b0');
  assert.equal(app.run('chartNetWorth.data.datasets[0].data === originalData'), true);
  assert.equal(app.run('chartNetWorth.data.datasets[0].tension'), 0.3);
  assert.equal(app.run('chartNetWorth.updates.join()'), 'none');
  assert.equal(app.run('chartDashNetWorth.updates.length'), 0);
  assert.equal(app.run('chartNetWorth.options.plugins.tooltip.bodyColor'), '#e9dfac');
  app.run(`document.documentElement.dataset.theme = 'classic'; chartTokens = {}; refreshVisibleChartThemes();`);
  assert.equal(app.run('chartNetWorth.data.datasets[0].borderColor'), '#d4a849');
  assert.equal(app.run('chartNetWorth.options.plugins.tooltip.bodyFont'), undefined);
  app.run(`
    currentMonth = new Date(2026, 9, 1);
    budgetItems = [
      { type: 'income', amount: 500, date: '2026-10-01' },
      { type: 'expense', amount: 25, date: '2026-10-02', category: 'Food' },
      { type: 'expense', amount: 15, date: '2026-10-03', category: 'Food' },
      { type: 'expense', amount: 10, date: '2026-10-03', category: 'Travel' }
    ];
    renderCharts(budgetItems);
  `);
  assert.equal(app.run('chartDonut.data.datasets[0].data.join()'), '40,10');
  assert.equal(app.run('chartDonut.data.datasets[0].backgroundColor.join()'), '#d4a849,#3b82f6,#e74c3c,#1a9a5c,#a855f7,#f97316,#06b6d4,#ec4899,#84cc16,#f59e0b,#6366f1,#14b8a6');
  assert.equal(app.run('chartBar.data.datasets[0].data.join()'), '0,0,0,0,0,500');
  assert.equal(app.run('chartBar.data.datasets[1].data.join()'), '0,0,0,0,0,50');
  assert.equal(app.run('chartBar.data.datasets[0].backgroundColor'), '#1a9a5c99');
  app.run(`
    document.documentElement.dataset.theme = 'pixel-retro';
    chartTokens = { '--chart-primary': '#22b8b0', '--chart-secondary': '#e9dfac',
      '--chart-income-fill': '#22b8b0', '--chart-expense-fill': '#ff4b20',
      '--chart-label': '#e9dfac', '--chart-tick': '#9b9471', '--chart-grid': '#827b5d40' };
    renderCharts(budgetItems);
  `);
  assert.equal(app.run('chartDonut.data.datasets[0].backgroundColor.slice(0, 2).join()'), '#22b8b0,#e9dfac');
  assert.equal(app.run('chartBar.data.datasets[1].backgroundColor'), '#ff4b20');
  assert.equal(app.run('chartBar.options.scales.y.ticks.color'), '#9b9471');
  assert.equal(app.run('chartBar.options.scales.y.ticks.callback(2000)'), '2к');
  assert.equal(app.run('chartBar.options.scales.x.grid.color'), '#827b5d40');
  assert.equal(app.run('chartDonut.options.plugins.legend.labels.color'), '#e9dfac');
  app.run(`globalThis.matchMedia = () => ({ matches: true }); applyChartTheme(chartBar.config);`);
  assert.equal(app.run('chartBar.options.animation'), false);
  app.run(`document.documentElement.dataset.theme = 'classic'; applyChartTheme(chartBar.config);`);
  assert.equal(app.run('chartBar.options.animation'), undefined);
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

function appHarness({ updateError = null, storageThrows = false, missingThemeAsset = false, initialTheme = 'classic', updateRemoteImpl, keepNavigation = false } = {}) {
  const values = new Map();
  const nodes = new Map();
  const callbacks = [];
  const writes = [];
  const timers = [];
  const frames = [];
  const observers = [];
  function element(id = '') {
    const attributes = {};
    const classes = new Set();
    const listeners = new Map();
    return { id, dataset: {}, style: {}, textContent: '', title: '',
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); }, toggle(name) { classes.has(name) ? classes.delete(name) : classes.add(name); } },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
      dispatchEvent(event) { for (const callback of [...(listeners.get(event.type) || [])]) callback({ ...event, currentTarget: this }); },
      setAttribute(key, value) { attributes[key] = value; },
      getAttribute(key) { return attributes[key]; },
      appendChild(node) { nodes.set(node.id, node); }
    };
  }
  const control = element('theme-toggle');
  const authControl = /<button\b(?=[^>]*\bid="auth-theme-toggle")(?=[^>]*\bdata-theme-toggle\b)[^>]*>/s.test(html)
    ? element('auth-theme-toggle')
    : null;
  if (authControl) nodes.set(authControl.id, authControl);
  const meta = element();
  const root = { dataset: { theme: initialTheme } };
  const document = {
    documentElement: root, body: element(), addEventListener() {},
    createElement() { return element(); },
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return meta;
      if (selector === 'nav') return nodes.get('nav');
      if (selector === '.page.active') return [...nodes.values()].find(node => node.id.startsWith('page-') && node.classList.contains('active')) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-theme-toggle]') return [control, authControl].filter(Boolean);
      if (selector === '[data-theme-toggle-label]') return nodes.has('auth-theme-toggle-label') ? [nodes.get('auth-theme-toggle-label')] : [];
      if (selector === '.card-animate') return [...nodes.values()].filter(node => node.classList.contains('card-animate'));
      return [];
    }
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
    supabase: { createClient() { return { auth }; } }, console, structuredClone,
    requestAnimationFrame(callback) { frames.push(callback); },
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {}
  };
  const context = vm.createContext(sandbox);
  if (!missingThemeAsset) vm.runInContext(themeSource, context);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  vm.runInContext(scripts.at(-1)[1], context, { filename: 'index.html#application' });
  // Keep the real auth callback and theme adapter; replace financial UI/data boundaries.
  vm.runInContext(`
    globalThis.testLoadCalls = 0;
    globalThis.testShowCalls = [];
    globalThis.testFinancialWrites = [];
    loadAllData = async () => { testLoadCalls++; };
    dbUpsert = async (...args) => { testFinancialWrites.push(args); return null; };
    setAuthMode = () => {};
  `, context);
  if (!keepNavigation) vm.runInContext(`showPage = name => {
    testShowCalls.push(name);
    if (name === 'import') { importRows = []; importRawFile = null; }
  };`, context);
  return {
    values, root, control, authControl, nodes, writes, callbacks,
    get loadCalls() { return context.testLoadCalls; },
    get showCalls() { return [...context.testShowCalls]; },
    get financialWrites() { return [...context.testFinancialWrites]; },
    run(source) { return vm.runInContext(source, context); },
    flushFrames() { while (frames.length) frames.shift()(); },
    flushThemeMutation() { observers.forEach(callback => callback()); },
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

function navigationHarness() {
  const app = appHarness({ keepNavigation: true });
  app.run(`
    globalThis.cards = [document.createElement('div'), document.createElement('div')];
    cards.forEach((card, i) => { card.id = 'test-card-' + i; document.body.appendChild(card); });
    const page = document.createElement('div'); page.id = 'page-test';
    page.querySelectorAll = () => cards; document.body.appendChild(page);
    const nav = document.createElement('button'); nav.id = 'nav-test'; document.body.appendChild(nav);
  `);
  return app;
}

test('Pixel navigation clears stale card animation state without waiting for animationend', () => {
  const app = navigationHarness();
  app.run(`
    themeController.apply('pixel-retro');
    cards[0].classList.add('card-animate'); cards[0].style.animationDelay = '40ms';
    showPage('test');
  `);
  app.flushFrames();
  assert.equal(app.run(`cards.some(card => card.classList.contains('card-animate') || card.style.animationDelay)`), false);
});

test('switching to Pixel cancels running and queued Classic card animations', () => {
  const app = navigationHarness();
  app.run(`showPage('test');`);
  app.flushFrames();
  assert.equal(app.run(`cards[1].classList.contains('card-animate')`), true);
  app.run(`themeController.apply('pixel-retro');`);
  app.flushThemeMutation();
  assert.equal(app.run(`cards.some(card => card.classList.contains('card-animate') || card.style.animationDelay)`), false);
  app.run(`themeController.apply('classic'); showPage('test'); themeController.apply('pixel-retro');`);
  app.flushFrames();
  app.flushThemeMutation();
  app.run(`themeController.apply('classic');`);
  app.flushThemeMutation();
  assert.equal(app.run(`cards.some(card => card.classList.contains('card-animate') || card.style.animationDelay)`), false);
});

test('Classic navigation retains staggered animation and cleans up on animationend', () => {
  const app = navigationHarness();
  app.run(`showPage('test');`);
  app.flushFrames();
  assert.equal(app.run(`cards[0].style.animationDelay`), '0ms');
  assert.equal(app.run(`cards[1].style.animationDelay`), '40ms');
  assert.equal(app.run(`cards.every(card => card.classList.contains('card-animate'))`), true);
  app.run(`cards.forEach(card => card.dispatchEvent({ type: 'animationend' }));`);
  assert.equal(app.run(`cards.some(card => card.classList.contains('card-animate') || card.style.animationDelay)`), false);
});

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

test('the localized auth-screen theme toggle is available with no session', async () => {
  const app = appHarness();
  await app.authEvent('INITIAL_SESSION', null);
  assert.equal(app.nodes.get('auth-screen').classList.contains('hidden'), false);
  assert.equal(app.authControl.getAttribute('aria-label'), 'Переключить на Pixel Retro');
  assert.equal(app.nodes.get('auth-theme-toggle-label').textContent, 'Переключить на Pixel Retro');
  app.run("setLanguage('en');");
  assert.equal(app.authControl.getAttribute('aria-label'), 'Switch to Pixel Retro');
  assert.equal(app.nodes.get('auth-theme-toggle-label').textContent, 'Switch to Pixel Retro');
  await app.run('toggleTheme()');
  assert.equal(app.root.dataset.theme, 'pixel-retro');
  assert.equal(app.authControl.getAttribute('aria-pressed'), 'true');
  assert.equal(app.authControl.getAttribute('aria-label'), 'Switch to Classic');
  assert.equal(app.nodes.get('auth-theme-toggle-label').textContent, 'Switch to Classic');
  assert.deepEqual(app.writes, []);
});

test('USER_UPDATED does not reload finance data, navigate or clear an unfinished import', async () => {
  const app = appHarness();
  const session = { access_token: 'token-1', user: { id: 'user-1', user_metadata: { theme: 'classic' } } };
  await app.authEvent('INITIAL_SESSION', session);
  await app.flushAuthTasks();
  app.run("importRows = [{ date: '2026-10-15', amount: 125, checked: true }]; importRawFile = { name: 'unfinished.csv' }; document.getElementById('page-import').classList.add('active');");
  const loadCalls = app.loadCalls;
  const showCalls = app.showCalls;
  const writes = app.financialWrites;
  await app.authEvent('USER_UPDATED', { ...session, user: { ...session.user, user_metadata: { theme: 'pixel-retro' } } });
  await app.flushAuthTasks();
  assert.equal(app.loadCalls, loadCalls);
  assert.deepEqual(app.showCalls, showCalls);
  assert.deepEqual(app.financialWrites, writes);
  assert.equal(app.run('importRows[0].amount'), 125);
  assert.equal(app.run('importRows[0].checked'), true);
  assert.equal(app.run('importRawFile.name'), 'unfinished.csv');
});

test('INITIAL_SESSION and SIGNED_IN retain normal authenticated finance startup', async () => {
  const app = appHarness();
  await app.authEvent('INITIAL_SESSION', null);
  await app.authEvent('SIGNED_IN', { user: { id: 'user-1', user_metadata: { theme: 'classic' } } });
  assert.equal(app.loadCalls, 1);
  assert.deepEqual(app.showCalls, ['home']);
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

test('stale USER_UPDATED echo cannot replace a queued theme after the newer write fails', async () => {
  let resolveFirst;
  let calls = 0;
  const app = appHarness({ updateRemoteImpl: () => {
    if (calls++ === 0) return new Promise(resolve => { resolveFirst = resolve; });
    return { error: new Error('Offline') };
  } });
  const session = { access_token: 'token-A', user: { id: 'user-A', user_metadata: { theme: 'classic' } } };
  await app.authEvent('SIGNED_IN', session);
  await app.flushAuthTasks();
  const first = app.run('toggleTheme()');
  await Promise.resolve();
  const second = app.run('toggleTheme()');
  assert.deepEqual(app.writes, [{ data: { theme: 'pixel-retro' } }]);
  await app.authEvent('USER_UPDATED', { ...session, user: { ...session.user, user_metadata: { theme: 'pixel-retro' } } });
  await app.flushAuthTasks();
  resolveFirst({ error: null });
  await Promise.all([first, second]);
  assert.deepEqual(app.writes, [{ data: { theme: 'pixel-retro' } }, { data: { theme: 'classic' } }]);
  assert.equal(app.root.dataset.theme, 'classic');
  assert.equal(app.values.get('finora_theme'), 'classic');
  assert.equal(app.values.get('finora_theme_sync_pending'), 'classic');
  assert.equal(app.nodes.get('toast').dataset.kind, 'warning');
  assert.match(app.nodes.get('toast').textContent, /сохранена на этом устройстве/i);
});

test('TOKEN_REFRESHED for the same user does not invalidate the queued theme write', async () => {
  let resolveFirst;
  let calls = 0;
  const app = appHarness({ updateRemoteImpl: () => {
    if (calls++ === 0) return new Promise(resolve => { resolveFirst = resolve; });
    return { error: null };
  } });
  const session = { access_token: 'token-old', user: { id: 'user-A', user_metadata: { theme: 'classic' } } };
  await app.authEvent('SIGNED_IN', session);
  await app.flushAuthTasks();
  const first = app.run('toggleTheme()');
  await Promise.resolve();
  const second = app.run('toggleTheme()');
  await app.authEvent('TOKEN_REFRESHED', { ...session, access_token: 'token-new' });
  await app.flushAuthTasks();
  resolveFirst({ error: null });
  await Promise.all([first, second]);
  assert.deepEqual(app.writes, [{ data: { theme: 'pixel-retro' } }, { data: { theme: 'classic' } }]);
  assert.equal(app.root.dataset.theme, 'classic');
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
