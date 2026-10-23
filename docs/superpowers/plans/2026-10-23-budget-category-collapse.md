# Budget Category Collapse Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this chat, sequentially, per the user's existing choice.

**Goal:** Independently collapse top-level budget groups without changing financial data.

**Architecture:** Keep a session-only Set of encoded type/category/currency keys. Render a native button and a controlled hidden container per group. Toggle only that container, retaining button focus; clear state in resetAccountData.

**Tech Stack:** Existing vanilla JavaScript, HTML, CSS, node:test VM integration harness.

## Global Constraints

- No subcategory/tag controls and no collapse-all button.
- Preserve Classic/Pixel, totals, charts, currencies, financial data and account settings.
- Default expanded; retain state on rerender/month change; reset on reload/account exit.
- Update budget FAQ; publish only on separate authorization.

### Task 1: Independent disclosure controls

Files: index.html, styles/themes.css, tests/theme-bootstrap.test.mjs.

- [x] Add tests through the real renderBudget function: two categories, same label across types/currencies, tags, escaped labels, default-expanded and empty states.
- [x] Invoke toggleBudgetCategory(button) using rendered attributes and assert hidden/aria-expanded, unchanged totals/data, independence and reopen behavior. Check rerender, month change, account reset and a fresh harness.
- [x] Run `node --test tests/theme-bootstrap.test.mjs`; observe missing-control assertions fail.
- [x] Implement state with `const collapsedBudgetCategories = new Set()`, encoded JSON grouping keys and `toggleBudgetCategory(button)`. Use `button.dataset.budgetCategory`, `aria-controls`, `body.hidden`, `aria-expanded`; never interpolate category text into JavaScript.
- [x] Render `<button type="button" onclick="toggleBudgetCategory(this)" ...>` with inline SVG chevron and existing summary; body has unique index-based id and hidden attribute when collapsed.
- [x] Add scoped styles for 44px target, wrapping, inward focus outline, chevron orientation and hidden containers; reset Set in resetAccountData.
- [x] Rerun focused tests and full suite.

### Task 2: Documentation and verification

Files: js/faq-content.js, sw.js, tests/service-worker.test.mjs.

- [x] Explain category-header activation, retained totals, no subcategory toggle and session-only state in budget FAQ.
- [x] Change service-worker test expectations to v10 and assert activation removes v9; observe failure, then update sw.js.
- [x] Run full suite, syntax checks and `git diff --check`.
- [x] Using synthetic local preview, verify click/keyboard, focus retention, independent groups, Classic/Pixel desktop/mobile and FAQ open/close preserving page and collapse state.
- [x] Review diff against spec, record evidence and remaining limits, commit only scoped files; no publication.

## Verification — 2026-10-23

- Baseline: 135 passing tests. Red phase: 3 disclosure tests failed because no buttons existed; 2 service-worker tests failed against v9. Green: 138 tests pass.
- Inline JavaScript, FAQ and service worker syntax checks pass; git diff --check passes.
- Browser: local synthetic Supabase adapter only, no production financial writes. Classic and Pixel checked at native desktop viewport and 390×844; no horizontal overflow, controls 44px tall. Click, Enter, Space, hidden-row keyboard skipping and focus retention verified. Food collapsed while Transport stayed expanded; total stayed 341 RUB. Reload reset collapse state. FAQ opened/closed in all four theme/viewport combinations.
- Existing theme-change toast intercepted a center click in Pixel; DOM hit testing identified the toast. Keyboard and fresh-page click checks passed. This existing global notification behavior was not changed as part of category controls.
- UI review performed inline (user chose sequential work), not by a separate agent. Detector ran with degraded regex fallback: parser modules missing, computed contrast not checked; findings concerned existing fonts/gradient/glow, outside this scoped change.
- Evidence screenshots: /tmp/finora-collapse-classic.jpg and /tmp/finora-collapse-pixel.jpg. Current QA server: http://127.0.0.1:8774/.
- Publication not authorized in this implementation turn; branch retained locally.
