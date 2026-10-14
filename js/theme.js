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

  function normalizeTheme(value) {
    return THEMES.includes(value) ? value : null;
  }

  function createThemeController(dependencies) {
    const {
      document,
      storage,
      updateRemote,
      translate = key => key,
      notify = () => {}
    } = dependencies;
    let currentTheme = normalizeTheme(read(STORAGE_KEY)) || DEFAULT_THEME;

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
      const nextThemeKey = currentTheme === 'classic'
        ? 'theme_switch_pixel'
        : 'theme_switch_classic';
      const label = translate(nextThemeKey);

      for (const control of controls) {
        control.setAttribute('aria-pressed', String(currentTheme === 'pixel-retro'));
        control.setAttribute('aria-label', label);
        control.title = label;
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

    async function syncRemote(theme) {
      if (typeof updateRemote !== 'function') return false;
      try {
        const result = await updateRemote(theme);
        if (result && result.error) throw result.error;
        remove(PENDING_KEY);
        return true;
      } catch (_error) {
        write(PENDING_KEY, theme);
        return false;
      }
    }

    async function toggle() {
      const theme = apply(currentTheme === 'classic' ? 'pixel-retro' : 'classic', {
        persist: true,
        notify: true
      });
      const synced = await syncRemote(theme);
      if (!synced && typeof updateRemote === 'function') {
        notify(translate('theme_sync_local_only'), 'warning');
      }
      return { theme, synced, source: 'local' };
    }

    async function reconcile(user) {
      const remoteTheme = user && user.user_metadata
        ? normalizeTheme(user.user_metadata.theme)
        : null;

      if (remoteTheme) {
        apply(remoteTheme, { persist: true });
        remove(PENDING_KEY);
        return { theme: remoteTheme, synced: true, source: 'remote' };
      }

      if (!user || !user.id) {
        return { theme: currentTheme, synced: false, source: 'local' };
      }

      const pendingTheme = normalizeTheme(read(PENDING_KEY));
      const theme = pendingTheme || currentTheme;
      apply(theme, { persist: true });
      if (typeof updateRemote !== 'function') {
        return { theme, synced: false, source: pendingTheme ? 'pending' : 'local' };
      }

      const synced = await syncRemote(theme);
      return {
        theme,
        synced,
        source: pendingTheme ? 'pending' : 'local'
      };
    }

    apply(currentTheme, { persist: true });

    return { getTheme, apply, toggle, reconcile, refreshControls };
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
