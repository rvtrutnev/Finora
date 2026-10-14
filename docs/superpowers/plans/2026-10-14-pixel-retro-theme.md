# Pixel Retro Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switchable Pixel Retro theme to Finora that keeps Classic as the default, applies the last local choice before paint, and synchronizes the authenticated user's choice through Supabase metadata.

**Architecture:** Keep one HTML/application structure and introduce a small standalone theme controller plus a semantic CSS-token layer. An inline bootstrap applies the local preference before rendering; the controller owns validation, UI state, local persistence, and remote reconciliation; the existing authentication lifecycle supplies Supabase session metadata. Service Worker v3 caches all new local assets without changing the already-tested request fallback behavior.

**Tech Stack:** Static HTML/PWA, vanilla JavaScript, CSS custom properties, Tailwind CDN compatibility aliases, Supabase Auth user metadata, Chart.js, Service Worker API, Node.js `node:test`/`node:assert`/`node:vm`, self-hosted Press Start 2P WOFF2.

## Global Constraints

- Preserve every existing screen, navigation route, calculation, Supabase table interaction, and stored financial record.
- Keep `classic` as the first-visit default and retain its current appearance within practical screenshot tolerance.
- Use only `classic` and `pixel-retro` as stored theme identifiers; reject every other value.
- Do not add a database table, migration, package manager, runtime dependency, or build step.
- Use semantic CSS variables; do not create a second HTML tree or duplicate application logic per theme.
- Keep Inter for body copy, tables, forms, modals, and entered data. Use Press Start 2P only for compact display text.
- Keep CRT effects static and subtle. Never overlay inputs, tables, charts, or modals.
- Theme failures must not block authentication, navigation, data loading, or financial operations.
- Do not merge, deploy, or modify Cloudflare settings without a separate user approval.
- Keep `.superpowers/` untracked; only the approved spec and this plan belong in Git.

## File Structure

- Create: `js/theme.js` — theme constants, validation, application, persistence, control-state updates, and remote reconciliation.
- Create: `styles/themes.css` — shared semantic tokens, Classic mappings, Pixel Retro visual rules, responsive and accessibility rules.
- Create: `fonts/press-start-2p/PressStart2P-Regular.woff2` — locally served display font containing the official font glyph set.
- Create: `fonts/press-start-2p/OFL.txt` — official font license.
- Create: `tests/theme.test.mjs` — executable unit tests for the controller.
- Create: `tests/theme-bootstrap.test.mjs` — executable tests for the no-flash bootstrap under real success, invalid-value, and storage-failure branches.
- Modify: `index.html` — early bootstrap, asset links, theme button, translations, controller adapter, chart refresh, and theme-aware toast classes.
- Modify: `sw.js` — cache name and local asset manifest only.
- Modify: `tests/service-worker.test.mjs` — capture and verify the v3 precache list and cache cleanup.

---

### Task 1: Build the Theme Controller with Unit Tests

**Files:**
- Create: `tests/theme.test.mjs`
- Create: `js/theme.js`

**Interfaces:**
- Exposes: `window.FinoraTheme`.
- Exposes constants: `THEMES`, `DEFAULT_THEME`, `STORAGE_KEY`, `PENDING_KEY`.
- Exposes: `normalizeTheme(value): 'classic' | 'pixel-retro' | null`.
- Exposes: `createThemeController(dependencies)` returning `getTheme()`, `apply(theme, options)`, `toggle()`, `reconcile(user)`, and `refreshControls()`.
- Injects: `document`, `storage`, `updateRemote(theme)`, `translate(key)`, and `notify(message, kind)` so the controller is testable without a browser or Supabase.
- Updates: `<html data-theme>`, `[data-theme-toggle]`, `meta[name="theme-color"]`, `finora_theme`, and `finora_theme_sync_pending`.

- [ ] **Step 1: Create a minimal browser-module test harness**

In `tests/theme.test.mjs`, load `js/theme.js` through `node:vm`. Provide fakes for `window`, a root element with `dataset`, a theme-color meta element, two theme controls, and an in-memory `localStorage` implementation. Record calls to `updateRemote`, translations, and notifications.

The fake controls must support `setAttribute`, `getAttribute`, `title`, and a `[data-theme-toggle]` query so tests verify accessibility state rather than only internal state.

- [ ] **Step 2: Write failing tests for normalization and startup**

Add tests asserting:

```js
assert.equal(api.normalizeTheme('classic'), 'classic');
assert.equal(api.normalizeTheme('pixel-retro'), 'pixel-retro');
assert.equal(api.normalizeTheme('PIXEL-RETRO'), null);
assert.equal(api.normalizeTheme('unknown'), null);
assert.equal(api.normalizeTheme(null), null);
```

Then assert that controller construction/application:

- defaults to Classic with empty storage;
- applies a valid stored Pixel Retro value;
- replaces an invalid stored value with Classic;
- writes the matching root attribute and `theme-color`;
- sets `aria-pressed="true"` only for Pixel Retro;
- sets the translated label/title to describe the theme that the button will activate next.

- [ ] **Step 3: Run the controller tests and confirm the expected failure**

Run:

```bash
node --test tests/theme.test.mjs
```

Expected: fail because `js/theme.js` does not exist.

- [ ] **Step 4: Implement the smallest controller that passes startup tests**

Implement `js/theme.js` as an IIFE. Keep all storage access in guarded helpers because Safari private mode or policy restrictions may throw. Use these exact theme-color values:

```js
const THEME_COLORS = {
  classic: '#0e0e12',
  'pixel-retro': '#080907'
};
```

`apply(theme, { persist = true, notify = false } = {})` must normalize the input, fall back to Classic, update the DOM immediately, persist when requested, refresh all controls, optionally notify, and return the applied value.

- [ ] **Step 5: Add failing reconciliation and toggle tests**

Cover all state transitions:

1. `toggle()` changes Classic to Pixel Retro, persists immediately, updates the accessible state, notifies, and invokes `updateRemote` when configured.
2. A valid `user.user_metadata.theme` overrides a different local value during `reconcile(user)`.
3. Missing or invalid remote metadata keeps the valid local value and initializes remote metadata with it.
4. A successful remote update clears `finora_theme_sync_pending`.
5. A failed remote update retains the chosen local theme, stores it in the pending marker, and resolves without throwing.
6. A pending local value is retried only when no conflicting valid remote value exists.
7. A valid remote value always wins over a pending local value and clears the stale marker.
8. Missing user/session performs no remote write.

- [ ] **Step 6: Implement reconciliation and rerun tests**

`updateRemote` must receive only the validated theme string. The controller must catch remote failures internally and return a result object such as `{ theme, synced, source }`; the application must never need a try/catch merely to remain usable.

Run:

```bash
node --test tests/theme.test.mjs
```

Expected: all controller tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add js/theme.js tests/theme.test.mjs
git commit -m "feat: add theme state controller"
```

---

### Task 2: Integrate Early Bootstrap, Navigation Control, Localization, and Supabase

**Files:**
- Create: `tests/theme-bootstrap.test.mjs`
- Modify: `index.html`
- Use: `js/theme.js`

**Interfaces:**
- Adds root attribute: `<html ... data-theme="classic">`.
- Adds local stylesheet: `./styles/themes.css`.
- Adds local script: `./js/theme.js`.
- Adds control: `#theme-toggle[data-theme-toggle]` with `type="button"`, `aria-pressed`, `aria-label`, and `title`.
- Adds application functions: `toggleTheme()` and `reconcileTheme(user)`.
- Writes remote metadata through `sb.auth.updateUser({ data: { theme } })`.

- [ ] **Step 1: Write failing executable bootstrap tests**

Mark the early inline script with `id="theme-bootstrap"`. In `tests/theme-bootstrap.test.mjs`, extract that single script as the executable artifact, run it through `node:vm` with a real fake `document.documentElement.dataset` and controllable storage, and assert observable outcomes:

- empty storage leaves the root in Classic;
- a valid Pixel Retro value changes the root before body initialization;
- an invalid value resolves to Classic;
- a throwing storage implementation leaves Classic and does not escape an exception;
- the bootstrap makes no network or Supabase call.

Do not assert that a source string merely exists. Each test must execute the same bootstrap the browser executes and fail for a named behavior regression.

- [ ] **Step 2: Run integration tests and confirm failure**

```bash
node --test tests/theme-bootstrap.test.mjs
```

Expected: fail because the executable bootstrap is absent.

- [ ] **Step 3: Add the no-flash head bootstrap**

Set Classic in source markup, then add a small inline script in `<head>` that:

1. reads `finora_theme` inside `try/catch`;
2. accepts only `classic` or `pixel-retro`;
3. assigns the validated result to `document.documentElement.dataset.theme`;
4. falls back to Classic without throwing when storage is unavailable.

The bootstrap must not call Supabase, wait for DOM ready, or import another script.

- [ ] **Step 4: Add the accessible top-navigation control**

Place the button next to the existing language control without moving other navigation items. Use a small inline pixel-monitor SVG with `aria-hidden="true"`, a visually available short label where space permits, and the localized full action in `aria-label`/`title`. Preserve at least a 40×40 px hit area on compact layouts.

The button invokes only `toggleTheme()`. It must not submit forms, navigate, or reload the page.

- [ ] **Step 5: Add translations and the application adapter**

Add natural translations for all five languages. Instantiate the controller after `sb` and translation/toast helpers exist:

```js
const themeController = window.FinoraTheme.createThemeController({
  document,
  storage: window.localStorage,
  updateRemote: async theme => {
    const { error } = await sb.auth.updateUser({ data: { theme } });
    if (error) throw error;
  },
  translate: key => t(key),
  notify: (message, kind) => showToast(message, kind)
});
```

Expose `toggleTheme()` for the markup and call `themeController.refreshControls()` after language changes so action labels switch language immediately.

The required translation keys are `theme_switch_pixel`, `theme_switch_classic`, `theme_pixel_enabled`, `theme_classic_enabled`, and `theme_sync_local_only`. Verify their rendered action labels and notifications in the real browser during Task 6 rather than treating source-text presence as proof.

- [ ] **Step 6: Reconcile from the existing authentication lifecycle**

Call `reconcileTheme(session?.user)` only after an authenticated session is known. Ensure sign-out does not erase the local choice. Do not create a second auth listener; integrate with the current startup and `onAuthStateChange` paths and prevent duplicate remote writes for the same session event.

- [ ] **Step 7: Make toast markup themeable**

Replace inline hard-coded toast background colors with semantic classes or `data-kind` values (`success`, `warning`, `error`, `info`). Preserve text/icon status cues so color is not the only distinction.

- [ ] **Step 8: Run focused and existing tests**

```bash
node --test tests/theme.test.mjs tests/theme-bootstrap.test.mjs tests/service-worker.test.mjs
```

Expected: all tests pass. Then load the real local page and verify that the button is keyboard-native, has one accessible name, switches the visible theme without navigation/reload, updates `aria-pressed`, and that the existing auth lifecycle performs the intended metadata call.

- [ ] **Step 9: Commit Task 2**

```bash
git add index.html tests/theme-bootstrap.test.mjs
git commit -m "feat: integrate theme switching and sync"
```

---

### Task 3: Introduce Semantic Tokens while Preserving Classic

**Files:**
- Create: `styles/themes.css`
- Modify: `index.html`

**Interfaces:**
- Defines theme blocks for `:root, [data-theme="classic"]` and `[data-theme="pixel-retro"]`.
- Defines semantic tokens for canvas, surfaces, text, borders, actions, states, controls, focus, shadows, radii, fonts, transitions, and chart colors.
- Maps existing Tailwind compatibility names to variables using `rgb(var(--token-rgb) / <alpha-value>)`.

- [ ] **Step 1: Define the computed-style verification contract**

Use the browser's `getComputedStyle(document.documentElement)` during the visual check to verify that both themes expose usable values for:

```text
--color-canvas
--color-surface
--color-surface-raised
--color-text
--color-text-muted
--color-border
--color-focus
--color-action
--color-positive
--color-negative
--color-warning
--color-control
--color-disabled
--shadow-card
--radius-card
--font-body
--font-display
--transition-theme
--chart-primary
--chart-secondary
--chart-negative
--chart-grid
```

In the rendered application, also verify:

- toggling changes the computed palette without reloading;
- the display font request resolves to the local WOFF2 and text remains visible during loading;
- body/form/table font rules retain the body font;
- keyboard focus is visible;
- reduced-motion preference removes transitions and decorative glow;
- no animated CRT flicker keyframes exist.

- [ ] **Step 2: Capture the failing browser baseline**

Before creating `styles/themes.css`, run the computed-style checks against the local page. Record that the semantic variables are empty and the theme toggle cannot alter computed theme values. This is the RED evidence for the styling integration; source-text grep is not accepted as evidence.

- [ ] **Step 3: Inventory current visual constants before editing**

Use `rg` to list existing hex, RGB, gradient, shadow, radius, and font declarations in `index.html`. Record each current Classic value against a semantic role before replacement. Do not use broad mechanical replacement where the same literal serves different semantic roles.

- [ ] **Step 4: Create Classic tokens with current values**

Move only reusable visual primitives to `styles/themes.css`. Define Classic variables to reproduce the current canvas, cards, gold accent, typography, controls, borders, shadows, and chart palette. Preserve selector specificity and layout declarations in `index.html` unless moving a visual rule is necessary for theme override.

- [ ] **Step 5: Connect Tailwind compatibility aliases**

In the existing Tailwind config, resolve current application color names through RGB token triples so opacity modifiers continue to work. Example pattern:

```js
colors: {
  surface: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
  accent: 'rgb(var(--color-action-rgb) / <alpha-value>)'
}
```

Do not rename every existing utility class. Keep this as a compatibility bridge while new custom rules use semantic variables directly.

- [ ] **Step 6: Visually verify Classic before adding Retro overrides**

Serve the app locally and compare the current branch with the pre-theme commit `ee22441` at laptop and phone widths. Check navigation, authentication, dashboard, cards, tables, forms, modals, toasts, and charts. Correct token mappings until there is no unintended layout, typography, or color regression.

- [ ] **Step 7: Run tests and commit Task 3**

```bash
node --test tests/theme.test.mjs tests/theme-bootstrap.test.mjs
git diff --check
git add styles/themes.css index.html
git commit -m "refactor: define semantic theme tokens"
```

---

### Task 4: Add the Pixel Retro Visual System and Local Font

**Files:**
- Create: `fonts/press-start-2p/PressStart2P-Regular.woff2`
- Create: `fonts/press-start-2p/OFL.txt`
- Modify: `styles/themes.css`
- Modify: `index.html`

**Interfaces:**
- Pixel palette: canvas `#080907`, surface `#10110D`, raised/control `#171811`, text `#E9DFAC`, muted `#9B9471`, accent/positive `#22B8B0`, negative `#FF4B20`, warning `#D6A84B`, border `#827B5D`.
- Display font: `Press Start 2P` with monospace fallback.
- Body font: existing Inter stack.
- Charts read CSS variables at render time.

- [ ] **Step 1: Capture failing rendered checks for the approved palette and rules**

With `data-theme="pixel-retro"`, query computed styles and rendered elements in the real browser. Record the pre-implementation failures for the exact palette, display-font usage on brand/headings/key figures/buttons, body-font usage on inputs/textareas/selects/tables/modals, static scan-line treatment, input/chart/modal exclusions, visible focus, and reduced-motion behavior.

- [ ] **Step 2: Acquire and verify the official font assets**

Download the official Press Start 2P source and OFL license from the Google Fonts repository. Verify the source URL, license text, file type, non-zero size, and Cyrillic coverage. Use a temporary virtual environment outside the repository with `fonttools` and `brotli` to emit a full-glyph WOFF2; do not subset away Cyrillic, Latin Extended, punctuation, or currency symbols.

Record the upstream source and license in the commit message body or an adjacent source comment. Do not commit the temporary environment or downloaded source TTF.

- [ ] **Step 3: Define Pixel Retro token overrides**

Add `[data-theme="pixel-retro"]` overrides for the approved palette, sharp 6–8 px radii, thin borders, restrained shadows/glow, display font, chart colors, and short theme transitions. Keep all text contrast at or above the approved accessibility targets.

- [ ] **Step 4: Style existing components without changing structure**

Cover the current navigation, logo, headings, metric figures, cards, buttons, tabs, filters, inputs, selects, textareas, tables, list rows, badges, dropdowns, modal shell, authentication panel, calculator, import panel, loading states, empty states, disabled states, and toasts.

Rules:

- cyan is the primary action and active-state color;
- red-orange is reserved for negative/destructive states;
- cream is the main reading/figure color;
- body font remains on dense or editable content;
- Classic gold gradients and soft shadows are removed only in Pixel Retro;
- no cards-inside-cards decoration is added;
- existing spacing and DOM order remain unchanged.

- [ ] **Step 5: Add restrained CRT treatment**

Use a low-opacity, pointer-events-none pseudo-element on the application canvas and, if needed, one large decorative/auth surface. Exclude or layer below inputs, tables, charts, dropdowns, and modals. No flicker, blur, displacement, or chromatic aberration. Disable decorative glow and transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 6: Make Chart.js colors theme-aware**

Replace hard-coded chart colors with values obtained from `getComputedStyle(document.documentElement)`. When a theme is applied, update or rebuild only the currently rendered charts through the existing render path. Do not duplicate datasets or calculations. Verify tooltip foreground/background and muted grid contrast in both themes.

- [ ] **Step 7: Run automated and responsive checks**

```bash
node --test tests/theme.test.mjs tests/theme-bootstrap.test.mjs
git diff --check
```

At 390×844 and 1440×900, inspect all available screens in both themes. Repeat with each supported language and 200% text zoom for the navigation button, headings, figures, tabs, and action buttons. Fix clipping and horizontal overflow with narrow, theme-specific typography adjustments only.

- [ ] **Step 8: Commit Task 4**

```bash
git add fonts/press-start-2p styles/themes.css index.html
git commit -m "feat: add pixel retro visual theme"
```

---

### Task 5: Cache Theme Assets in Service Worker v3

**Files:**
- Modify: `tests/service-worker.test.mjs`
- Modify: `sw.js`

**Interfaces:**
- Cache name: `finora-v3`.
- Required local assets: `./index.html`, `./styles/themes.css`, `./js/theme.js`, `./fonts/press-start-2p/PressStart2P-Regular.woff2`, `./fonts/press-start-2p/OFL.txt`.
- Preserves: non-GET bypass, Supabase/CDN bypass, network-first response, navigation fallback, explicit 503, and selective Finora cache deletion.

- [ ] **Step 1: Extend the Service Worker harness**

Change the fake `caches.open().addAll()` implementation to record both the opened cache name and the exact asset list. Do not weaken the existing behavioral tests.

- [ ] **Step 2: Add failing v3 lifecycle assertions**

Assert that install opens `finora-v3` and precaches every required new asset. Assert that activate deletes `finora-v1` and `finora-v2`, preserves `finora-v3`, and preserves an unrelated cache such as `other-app-v1`.

- [ ] **Step 3: Run the Service Worker tests and confirm failure**

```bash
node --test tests/service-worker.test.mjs
```

Expected: new cache-name/asset tests fail against `finora-v2`.

- [ ] **Step 4: Update only the cache version and asset manifest**

Modify `CACHE_NAME` and `ASSETS`. Do not alter the already-proven fetch filtering or fallback algorithm unless a test exposes a regression caused by this feature.

- [ ] **Step 5: Run the complete test suite**

```bash
node --test tests/*.test.mjs
```

Expected: theme, integration, style, and all existing Service Worker tests pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add sw.js tests/service-worker.test.mjs
git commit -m "feat: cache local theme assets"
```

---

### Task 6: Perform End-to-End, Accessibility, and Regression Verification

**Files:**
- Verify: `index.html`
- Verify: `styles/themes.css`
- Verify: `js/theme.js`
- Verify: `sw.js`
- Verify: `tests/*.test.mjs`

- [ ] **Step 1: Run repository-level automated checks**

```bash
node --test tests/*.test.mjs
git diff --check
git status --short
```

Expected: all tests pass; no whitespace errors; only intentional tracked files and the ignored/untracked local `.superpowers/` companion directory are present.

- [ ] **Step 2: Verify local asset delivery**

Start a local static server and request the HTML, CSS, JS, WOFF2, OFL, manifest, and Service Worker directly. Every required asset must return HTTP 200 with a non-empty body; the font must have a font-compatible content type or remain usable through the browser's sniffing rules.

- [ ] **Step 3: Verify unauthenticated behavior from clean storage**

In Chrome and Safari:

1. clear site data;
2. load Finora and confirm Classic before first paint;
3. switch to Pixel Retro and confirm immediate UI/metadata/control updates;
4. reload and confirm Pixel Retro before authentication;
5. switch back to Classic and reload;
6. inject an invalid local value and confirm safe Classic fallback;
7. block storage access if the browser permits and confirm the app remains usable.

- [ ] **Step 4: Verify authenticated synchronization without touching finance data**

Use a test/non-production account. Check:

- missing remote preference initializes from the valid local theme;
- valid remote preference overrides a conflicting local theme on login;
- a user toggle updates only `user_metadata.theme`;
- simulated update failure keeps the local theme and sets the pending marker;
- the next authenticated initialization retries a non-conflicting pending value;
- sign-out retains the last local preference;
- no wallet, transaction, budget, receivable, debt, or profile-table row is created or modified.

- [ ] **Step 5: Verify every screen and state visually**

In both themes, at 390×844 and 1440×900, inspect authentication, dashboard, wallets, receivables/debts, budget, calculator, import, menus, dropdowns, forms, tables, charts/tooltips, modals, toasts, loading, empty, error, disabled, hover, active, and focus states.

Repeat critical navigation and action-label checks in Russian, English, German, French, and Spanish. Confirm no horizontal scrolling, clipped pixel text, unreadable dense text, overlay interference, or layout shift.

- [ ] **Step 6: Verify keyboard, contrast, zoom, and reduced motion**

Tab to the theme button, activate it with Space and Enter, and verify a visible focus ring in both themes. Check normal text at 4.5:1 and large text/control boundaries at 3:1. Test 200% zoom. Enable reduced motion and confirm theme transitions/decorative glow are suppressed and no animated CRT effect exists.

- [ ] **Step 7: Verify Service Worker upgrade and offline fallback**

In Chrome and Safari, unregister older workers once for a clean baseline, load the app, confirm `finora-v3`, reload after activation, and verify new theme assets are cached. Test offline reload and confirm there is no `FetchEvent.respondWith ... Returned response is null` error. Confirm Supabase and CDN requests remain outside Service Worker interception.

- [ ] **Step 8: Review the final diff against scope**

Compare with `ee22441` and the approved specification. Confirm there are no changes to business calculations, navigation structure, database schema, financial-data calls, Cloudflare settings, or deployment state. Review all user-facing translations for meaning rather than merely key presence.

- [ ] **Step 9: Request code review and resolve findings**

Use the `requesting-code-review` workflow on the completed branch. Fix verified issues, rerun the affected focused tests, then rerun the full suite and browser smoke checks.

- [ ] **Step 10: Create the final implementation commit if review required changes**

```bash
git add index.html styles/themes.css js/theme.js fonts/press-start-2p sw.js tests
git commit -m "fix: polish pixel retro theme"
```

Skip this commit when there are no post-review edits. Do not create an empty commit.

## Completion Evidence to Report

- Branch name and commit list.
- Exact automated test command and passing test count.
- Chrome and Safari versions used for visual/PWA checks.
- Viewports, languages, zoom, keyboard, reduced-motion, and contrast checks completed.
- Confirmation that Classic remained the default and retained its appearance.
- Confirmation that Supabase synchronization touched only `user_metadata.theme`.
- Confirmation that Service Worker v3 cached every local theme asset and returned a real `Response` offline.
- Any blocked checks, especially authenticated cross-device verification if no safe test account is available.
- Pull request link only after the user approves push/PR creation.
