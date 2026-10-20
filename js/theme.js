(function (window) {
  'use strict';

  const THEMES = Object.freeze(['classic', 'pixel-retro']);
  const DEFAULT_THEME = 'classic';
  const STORAGE_KEY = 'finora_theme';
  const PENDING_KEY = 'finora_theme_sync_pending';
  const THEME_COLORS = Object.freeze({
    classic: '#0e0e12',
    'pixel-retro': '#080907'
  });
  const SHORT_THEME_LABELS = Object.freeze({
    classic: 'Classic',
    'pixel-retro': 'Pixel'
  });

  function normalizeTheme(value) {
    return THEMES.includes(value) ? value : null;
  }

  function createThemeController(dependencies) {
    const {
      document,
      storage,
      updateRemote,
      canSyncRemote = () => true,
      // Optional stable context identity; change it when the remote session is invalidated.
      getRemoteContext = () => undefined,
      defaultAccountTheme = null,
      translate = key => key,
      notify = () => {}
    } = dependencies;
    let currentTheme = normalizeTheme(read(STORAGE_KEY)) || DEFAULT_THEME;
    let remoteQueue = Promise.resolve();
    let remoteIntent = 0;
    let localIntentVersion = 0;
    const activeLocalSyncs = new Map();

    function read(key) {
      try {
        return storage.getItem(key);
      } catch (_error) {
        return null;
      }
    }

    function write(key, value) {
      try {
        storage.setItem(key, value);
        return true;
      } catch (_error) {
        return false;
      }
    }

    function remove(key) {
      try {
        storage.removeItem(key);
      } catch (_error) {
        // Storage may be unavailable; the active theme still remains usable.
      }
    }

    function refreshControls() {
      if (!document || typeof document.querySelectorAll !== 'function') return;
      const controls = document.querySelectorAll('[data-theme-toggle]');
      const nextTheme = currentTheme === 'classic' ? 'pixel-retro' : 'classic';
      const nextThemeKey = nextTheme === 'pixel-retro' ? 'theme_switch_pixel' : 'theme_switch_classic';
      const label = translate(nextThemeKey);

      for (const control of controls) {
        control.setAttribute('aria-pressed', String(currentTheme === 'pixel-retro'));
        control.setAttribute('aria-label', label);
        control.title = label;
      }
      for (const labelElement of document.querySelectorAll('[data-theme-toggle-label]')) {
        labelElement.textContent = labelElement.dataset.themeToggleLabel === 'short'
          ? SHORT_THEME_LABELS[nextTheme]
          : label;
      }
    }

    function apply(theme, { persist = true, notify: shouldNotify = false } = {}) {
      currentTheme = normalizeTheme(theme) || DEFAULT_THEME;
      if (document && document.documentElement) {
        document.documentElement.dataset.theme = currentTheme;
      }
      if (document && typeof document.querySelector === 'function') {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = THEME_COLORS[currentTheme];
      }
      if (persist) write(STORAGE_KEY, currentTheme);
      if (document && typeof document.querySelectorAll === 'function') {
        for (const logo of document.querySelectorAll('[data-brand-logo]')) {
          logo.src = currentTheme === 'pixel-retro' ? logo.dataset.pixelSrc : logo.dataset.classicSrc;
        }
      }
      refreshControls();
      if (shouldNotify) {
        const messageKey = currentTheme === 'pixel-retro'
          ? 'theme_pixel_enabled'
          : 'theme_classic_enabled';
        notify(translate(messageKey), 'success');
      }
      return currentTheme;
    }

    function getTheme() {
      return currentTheme;
    }

    function isCurrentRemoteContext(context) {
      return Object.is(context, getRemoteContext());
    }

    function hasActiveSync(context = getRemoteContext()) {
      return (activeLocalSyncs.get(context) || 0) > 0;
    }

    function syncRemote(theme, intent, context) {
      if (typeof updateRemote !== 'function') return Promise.resolve(false);

      const request = remoteQueue.then(async () => {
        try {
          if (!isCurrentRemoteContext(context)) return false;
          const result = await updateRemote(theme, context);
          if (result && result.error) throw result.error;
          if (intent === remoteIntent && isCurrentRemoteContext(context)) remove(PENDING_KEY);
          return true;
        } catch (_error) {
          if (intent === remoteIntent && isCurrentRemoteContext(context)) write(PENDING_KEY, theme);
          return false;
        }
      });
      remoteQueue = request.then(() => undefined);
      return request;
    }

    function toggle() {
      apply(currentTheme === 'classic' ? 'pixel-retro' : 'classic', { persist: true, notify: true });
      return saveCurrent();
    }

    async function saveCurrent() {
      const context = getRemoteContext();
      localIntentVersion += 1;
      const theme = currentTheme;
      const intent = ++remoteIntent;
      if (typeof updateRemote !== 'function' || !canSyncRemote()) {
        remove(PENDING_KEY);
        return { theme, synced: false, source: 'local' };
      }
      write(PENDING_KEY, theme);
      activeLocalSyncs.set(context, (activeLocalSyncs.get(context) || 0) + 1);
      try {
        const synced = await syncRemote(theme, intent, context);
        if (!synced && intent === remoteIntent && isCurrentRemoteContext(context)) {
          notify(translate('theme_sync_local_only'), 'warning');
        }
        return { theme, synced, source: 'local' };
      } finally {
        const remaining = (activeLocalSyncs.get(context) || 1) - 1;
        if (remaining) activeLocalSyncs.set(context, remaining);
        else activeLocalSyncs.delete(context);
      }
    }

    async function reconcile(user) {
      const context = getRemoteContext();
      const remoteTheme = user && user.user_metadata
        ? normalizeTheme(user.user_metadata.theme)
        : null;

      if (remoteTheme) {
        remoteIntent += 1;
        apply(remoteTheme, { persist: true });
        remove(PENDING_KEY);
        return { theme: remoteTheme, synced: true, source: 'remote' };
      }

      if (!user || !user.id) {
        return { theme: currentTheme, synced: false, source: 'local' };
      }

      const pendingTheme = normalizeTheme(read(PENDING_KEY));
      const theme = normalizeTheme(defaultAccountTheme) || pendingTheme || currentTheme;
      apply(theme, { persist: true });
      if (typeof updateRemote !== 'function') {
        return { theme, synced: false, source: pendingTheme ? 'pending' : 'local' };
      }

      const intent = ++remoteIntent;
      write(PENDING_KEY, theme);
      const synced = await syncRemote(theme, intent, context);
      return {
        theme,
        synced,
        source: pendingTheme ? 'pending' : 'local'
      };
    }

    apply(currentTheme, { persist: true });

    function getIntentVersion() {
      return localIntentVersion;
    }

    return { getTheme, apply, toggle, saveCurrent, reconcile, refreshControls, hasActiveSync, getIntentVersion };
  }

  window.FinoraTheme = {
    THEMES,
    DEFAULT_THEME,
    STORAGE_KEY,
    PENDING_KEY,
    normalizeTheme,
    createThemeController
  };
})(window);
