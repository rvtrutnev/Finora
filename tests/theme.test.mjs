import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const controllerSource = await readFile(
  new URL('../js/theme.js', import.meta.url),
  'utf8'
);

function createHarness({ storedTheme, pendingTheme, updateRemoteImpl } = {}) {
  const values = new Map();
  if (storedTheme !== undefined) values.set('finora_theme', storedTheme);
  if (pendingTheme !== undefined) values.set('finora_theme_sync_pending', pendingTheme);

  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const root = { dataset: {} };
  const themeColor = { content: '' };
  const controls = [
    createControl(),
    createControl()
  ];
  const document = {
    documentElement: root,
    querySelector(selector) {
      return selector === 'meta[name="theme-color"]' ? themeColor : null;
    },
    querySelectorAll(selector) {
      return selector === '[data-theme-toggle]' ? controls : [];
    }
  };
  const translations = [];
  const notifications = [];
  const remoteCalls = [];
  const window = {};

  vm.runInNewContext(controllerSource, { window }, { filename: 'js/theme.js' });
  const controller = window.FinoraTheme.createThemeController({
    document,
    storage,
    updateRemote: async theme => {
      remoteCalls.push(theme);
      if (updateRemoteImpl) return updateRemoteImpl(theme);
    },
    translate: key => { translations.push(key); return `translated:${key}`; },
    notify: (message, kind) => notifications.push({ message, kind })
  });

  return {
    api: window.FinoraTheme,
    controller,
    controls,
    document,
    notifications,
    remoteCalls,
    root,
    storage,
    themeColor,
    translations,
    values
  };
}

function createControl() {
  const attributes = { 'data-theme-toggle': '' };
  return {
    title: '',
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] ?? null; }
  };
}

function assertResult(actual, expected) {
  assert.equal(actual.theme, expected.theme);
  assert.equal(actual.synced, expected.synced);
  assert.equal(actual.source, expected.source);
}

test('normalizes only the two supported theme names', () => {
  const { api } = createHarness();
  assert.equal(api.normalizeTheme('classic'), 'classic');
  assert.equal(api.normalizeTheme('pixel-retro'), 'pixel-retro');
  assert.equal(api.normalizeTheme('PIXEL-RETRO'), null);
  assert.equal(api.normalizeTheme('unknown'), null);
  assert.equal(api.normalizeTheme(null), null);
});

test('defaults to Classic and initializes DOM and controls with empty storage', () => {
  const harness = createHarness();
  assert.equal(harness.controller.getTheme(), 'classic');
  assert.equal(harness.root.dataset.theme, 'classic');
  assert.equal(harness.themeColor.content, '#0e0e12');
  for (const control of harness.controls) {
    assert.equal(control.getAttribute('aria-pressed'), 'false');
    assert.equal(control.getAttribute('aria-label'), 'translated:theme_switch_pixel');
    assert.equal(control.title, 'translated:theme_switch_pixel');
  }
  assert.equal(harness.values.get('finora_theme'), 'classic');
});

test('applies a valid stored Pixel Retro theme and accessible next-theme labels', () => {
  const harness = createHarness({ storedTheme: 'pixel-retro' });
  assert.equal(harness.controller.getTheme(), 'pixel-retro');
  assert.equal(harness.root.dataset.theme, 'pixel-retro');
  assert.equal(harness.themeColor.content, '#080907');
  for (const control of harness.controls) {
    assert.equal(control.getAttribute('aria-pressed'), 'true');
    assert.equal(control.getAttribute('aria-label'), 'translated:theme_switch_classic');
    assert.equal(control.title, 'translated:theme_switch_classic');
  }
});

test('replaces an invalid stored value with Classic', () => {
  const harness = createHarness({ storedTheme: 'PIXEL-RETRO' });
  assert.equal(harness.controller.getTheme(), 'classic');
  assert.equal(harness.values.get('finora_theme'), 'classic');
  assert.equal(harness.root.dataset.theme, 'classic');
});

test('toggle persists Pixel Retro, refreshes accessibility, notifies, and syncs remotely', async () => {
  const harness = createHarness();
  const result = await harness.controller.toggle();
  assert.equal(result.theme, 'pixel-retro');
  assert.equal(result.synced, true);
  assert.equal(harness.values.get('finora_theme'), 'pixel-retro');
  assert.equal(harness.root.dataset.theme, 'pixel-retro');
  assert.deepEqual(harness.remoteCalls, ['pixel-retro']);
  assert.equal(harness.controls[0].getAttribute('aria-pressed'), 'true');
  assert.deepEqual(harness.notifications, [
    { message: 'translated:theme_pixel_enabled', kind: 'success' }
  ]);
});

test('valid remote metadata overrides a different local theme', async () => {
  const harness = createHarness({ storedTheme: 'classic' });
  const result = await harness.controller.reconcile({
    id: 'user-1', user_metadata: { theme: 'pixel-retro' }
  });
  assertResult(result, { theme: 'pixel-retro', synced: true, source: 'remote' });
  assert.equal(harness.values.get('finora_theme'), 'pixel-retro');
  assert.equal(harness.root.dataset.theme, 'pixel-retro');
  assert.deepEqual(harness.remoteCalls, []);
});

test('missing or invalid remote metadata initializes remote with the local theme', async () => {
  for (const metadata of [{}, { theme: 'PIXEL-RETRO' }]) {
    const harness = createHarness({ storedTheme: 'pixel-retro' });
    const result = await harness.controller.reconcile({ id: 'user-1', user_metadata: metadata });
    assertResult(result, { theme: 'pixel-retro', synced: true, source: 'local' });
    assert.deepEqual(harness.remoteCalls, ['pixel-retro']);
  }
});

test('successful remote update clears a pending marker', async () => {
  const harness = createHarness({ pendingTheme: 'pixel-retro' });
  await harness.controller.reconcile({ id: 'user-1', user_metadata: {} });
  assert.equal(harness.values.has('finora_theme_sync_pending'), false);
});

test('failed remote update keeps local theme and pending marker without throwing', async () => {
  const harness = createHarness({
    storedTheme: 'pixel-retro',
    updateRemoteImpl: async () => { throw new Error('offline'); }
  });
  const result = await harness.controller.reconcile({ id: 'user-1', user_metadata: {} });
  assertResult(result, { theme: 'pixel-retro', synced: false, source: 'local' });
  assert.equal(harness.controller.getTheme(), 'pixel-retro');
  assert.equal(harness.values.get('finora_theme_sync_pending'), 'pixel-retro');
});

test('retries a pending local theme when remote metadata is not valid', async () => {
  const harness = createHarness({ storedTheme: 'classic', pendingTheme: 'pixel-retro' });
  const result = await harness.controller.reconcile({ id: 'user-1', user_metadata: {} });
  assertResult(result, { theme: 'pixel-retro', synced: true, source: 'pending' });
  assert.equal(harness.values.get('finora_theme'), 'pixel-retro');
  assert.deepEqual(harness.remoteCalls, ['pixel-retro']);
  assert.equal(harness.values.has('finora_theme_sync_pending'), false);
});

test('valid remote theme wins over a pending local theme and clears its marker', async () => {
  const harness = createHarness({ storedTheme: 'classic', pendingTheme: 'pixel-retro' });
  const result = await harness.controller.reconcile({
    id: 'user-1', user_metadata: { theme: 'classic' }
  });
  assertResult(result, { theme: 'classic', synced: true, source: 'remote' });
  assert.equal(harness.values.get('finora_theme'), 'classic');
  assert.equal(harness.values.has('finora_theme_sync_pending'), false);
  assert.deepEqual(harness.remoteCalls, []);
});

test('missing user performs no remote write', async () => {
  const harness = createHarness({ storedTheme: 'pixel-retro' });
  const result = await harness.controller.reconcile(null);
  assertResult(result, { theme: 'pixel-retro', synced: false, source: 'local' });
  assert.deepEqual(harness.remoteCalls, []);
});
