# Theme Toggle Target Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the compact navigation theme toggle display the theme that the next click will activate.

**Architecture:** Keep `js/theme.js` as the single source of theme and label state. Connect the navigation label to its existing `[data-theme-toggle-label]` contract with the `short` format in `index.html`, and extend the existing executable application harness so the regression test exercises the real markup-controller integration.

**Tech Stack:** Static HTML, vanilla JavaScript, Node.js built-in test runner and `vm` integration harness.

## Global Constraints

- In Classic, the visible target label is `Pixel`.
- In Pixel Retro, the visible target label is `Classic`.
- `aria-label` and `title` remain localized full action descriptions.
- Do not change persistence, Supabase synchronization, theme tokens, service-worker behavior, or unrelated UI.
- Keep `.superpowers/` local and untracked.

---

### Task 1: Connect and verify the navigation target label

**Files:**
- Modify: `tests/theme-bootstrap.test.mjs:123-205, 300-355`
- Modify: `js/theme.js:7-78`
- Modify: `index.html:248-251`

**Interfaces:**
- Consumes: `createThemeController(...).refreshControls()` and its `[data-theme-toggle-label]` DOM contract.
- Produces: a navigation label that follows the controller's localized next-theme text after initialization, language refresh, and every theme toggle.

- [x] **Step 1: Write the failing integration test**

Extend `appHarness()` to create the navigation label only when the actual `index.html` span carries both `theme-toggle-label` and `data-theme-toggle-label="short"`, return that node from `querySelectorAll('[data-theme-toggle-label]')`, and expose it as `navThemeLabel`.

Add this behavior test beside the existing application-toggle test:

```javascript
test('the navigation toggle always names the theme activated by the next click', async () => {
  const app = appHarness();
  assert.ok(app.navThemeLabel, 'The navigation theme label must participate in theme refresh');
  assert.equal(app.navThemeLabel.textContent, 'Pixel');
  assert.equal(app.control.getAttribute('aria-label'), 'Переключить на Pixel Retro');

  await app.run('toggleTheme()');
  assert.equal(app.root.dataset.theme, 'pixel-retro');
  assert.equal(app.navThemeLabel.textContent, 'Classic');
  assert.equal(app.control.getAttribute('aria-label'), 'Переключить на классическую тему');

  await app.run('toggleTheme()');
  assert.equal(app.root.dataset.theme, 'classic');
  assert.equal(app.navThemeLabel.textContent, 'Pixel');
  assert.equal(app.control.getAttribute('aria-label'), 'Переключить на Pixel Retro');
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='navigation toggle always names' tests/theme-bootstrap.test.mjs
```

Expected: FAIL with `The navigation theme label must participate in theme refresh`, proving the actual navigation label is not connected to the controller contract.

- [x] **Step 3: Implement the minimal controller and markup fix**

Add a `SHORT_THEME_LABELS` map in `js/theme.js`, derive the next theme once in `refreshControls()`, and render the short theme name only when `labelElement.dataset.themeToggleLabel === 'short'`. Ordinary labels continue to receive the translated full action.

Change the navigation label from:

```html
<span class="theme-toggle-label text-xs" aria-hidden="true">Pixel</span>
```

to:

```html
<span data-theme-toggle-label="short" class="theme-toggle-label text-xs" aria-hidden="true">Pixel</span>
```

Do not add another JavaScript selector or duplicate theme state.

- [x] **Step 4: Verify GREEN and the full suite**

Run:

```bash
node --test --test-name-pattern='navigation toggle always names' tests/theme-bootstrap.test.mjs
node --test tests/*.test.mjs
git diff --check
```

Expected: focused test PASS, complete suite PASS, and no whitespace errors.

- [x] **Step 5: Verify the UI in a browser**

Serve the repository locally, open the app, and verify:

1. Classic shows the Pixel target.
2. One click activates Pixel Retro and changes the target to Classic.
3. A second click restores Classic and changes the target back to Pixel.
4. `aria-label` and `title` name the same target action in each state.

- [x] **Step 6: Commit the implementation**

```bash
git add index.html js/theme.js tests/theme-bootstrap.test.mjs docs/superpowers/specs/2026-10-19-theme-toggle-target-label-design.md docs/superpowers/plans/2026-10-19-theme-toggle-target-label.md
git commit -m "fix: update theme toggle target label"
```
