# Bank PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Import the supplied four bank PDF formats into existing account budget categories with review, rules and duplicate protection.

**Architecture:** Pure normalization/parsing modules, a local PDF.js extraction boundary, an account-scoped import controller and Supabase persistence. Preserve existing Classic/Pixel visuals and CSV/Excel support.

**Tech Stack:** Static HTML/JavaScript, Node test runner, locally vendored PDF.js, Supabase Postgres/RLS.

## Global Constraints

- First supported PDF formats: supplied T-Bank, Alfa, VTB, OTP samples.
- Original files stay in Downloads; never commit original text, personal data or real operations.
- Use synthetic fixtures in tests. Real-file diagnostics may print counts/totals/differences but not identifying descriptions.
- Existing categories are `{expense: [{name, subcategories}], income: [...]}`; never assign the first category as fallback.
- Unmatched rows require assignment before saving. Suspicious transfers, cash withdrawals and refunds start unchecked with a warning.
- Rules and operations are owner-scoped. Account change invalidates pending work and clears the preview.
- Unknown/scanned/encrypted/malformed documents show explicit errors; partial parsing exposes warnings.
- Do not publish, push, merge or apply production migrations.
- Work in `/Users/roman/Documents/Claude/Finora/.worktrees/theme-toggle-target-label`.
- Node: `/Users/roman/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.

### Task 1: PDF extraction and normalization

**Files:** Create `js/import-core.js`, `js/import-pdf.js`, `vendor/pdfjs/`, `tests/import-core.test.mjs`, `tests/import-pdf.test.mjs`, synthetic fixtures as needed.

**Interfaces:**
- Browser globals `FinoraImportCore`, `FinoraImportPdf`; support Node tests via CommonJS or VM.
- `FinoraImportPdf.read(file, {onProgress} = {}) -> Promise<{bank, rows, warnings}>`.
- `FinoraImportPdf.parsePages(pages) -> {bank, rows, warnings}`; pages consist of PDF.js text items with positions and page numbers. Document exact schema in module header.
- Rows: `{date, postedDate, desc, amount, amountMinor, currency, type, mcc, sourceId, sourceLocation, warnings, checked}`. `amount` is positive decimal for existing UI; `amountMinor` is safe integer. Optional operation-currency amount is retained separately.
- Core exports: `parseMoney(text)` (signed minor units or null), `normalizeCurrency(text)`, `suggestCategory(row,categories,rules)` returning `{category,subcategory}` or empty strings, `duplicateSignature(row)` canonical string, `parseDelimited(text,bank)` returning the same result shape.

- [ ] Write failing synthetic behavior tests before implementation. Literal examples:
  ```js
  assert.equal(core.parseMoney('−1 234,56 RUB'), -123456);
  assert.equal(core.parseMoney('not a sum'), null);
  assert.deepEqual(core.suggestCategory({type:'expense',desc:'unknown'}, {expense:[],income:[]}, []), {category:'',subcategory:''});
  ```
  Each PDF fixture must assert hand-computed date, amount, direction and description, including multi-page continuation, duplicated header, account vs operation amount, plus suspicious row selection. Exercise CSV quoted delimiters and multiline descriptions.
- [ ] Run tests and record expected missing-feature failure.
- [ ] Inspect original samples locally using Python PDF libraries and PDF.js; locate table coordinates rather than assuming text extraction order. Files:
  `/Users/roman/Downloads/Выписка_по_счёту_Альфа.pdf`,
  `/Users/roman/Downloads/Справка_ОТП.pdf`,
  `/Users/roman/Downloads/Выписка_втб.pdf`,
  `/Users/roman/Downloads/Справка о движении средствТбанк.pdf`.
- [ ] Vendor a current pinned official PDF.js distribution with license; no external runtime PDF requests, no document upload, disable PDF JavaScript/eval. Lazy-load library; bound file size/pages and destroy document after extraction.
- [ ] Implement the exported contracts, error handling and four adapters. Exclude headers/footers/totals. Keep MCC when available. Normalize RUR to RUB. Prefer unambiguous purchase date; fallback to posted date with warning. Redact card/account numbers from retained descriptions.
- [ ] Run all task tests and locally parse the four PDFs. Independently reconcile row counts and per-currency debit/credit totals against the source; report any unverified cases without claiming full validation.
- [ ] Commit only task source, vendor files and synthetic tests. Record interfaces, tests and concerns in report.

### Task 2: Preview, account persistence and safe saves

**Files:** Create `js/import-ui.js`, `tests/import-ui.test.mjs`, `supabase/migrations/202610200002_bank_import.sql`; modify `index.html`, `sw.js`, applicable service worker tests.

**Interfaces:** Consume Task 1 globals. Controller `FinoraImportUI.create({root, getContext, getCategories, getBudgetItems, saveCategory, loadRules, saveRule, saveOperation, onSaved})`; return `{reset, loadFile}`. Context includes `{userId,generation}`, compared before/after every async operation. Keep UI persistence adapters in index.html; pure/stateful controller testable without production credentials.

- [ ] Add failing tests exercising real controller/core and only stub I/O:
  ```js
  // Unassigned selection cannot write; failed save remains retryable.
  // Account changes during read/save never affect next user's preview.
  // Same file retry has same row keys; two identical purchases keep two keys.
  // New category write failure cannot update global category state.
  // A deleted target category makes a saved rule inapplicable.
  ```
- [ ] Run and record failing tests.
- [ ] Implement native accessible file picker/drop zone, progress/status live region, bank and per-currency totals, preview with checkboxes/type/category/subcategory, explicit warning resolution and create-category form. Existing aesthetic stays intact.
- [ ] Use typed categories; transactionally update UI only on confirmed category persistence. Offer explicit description/MCC rule creation, show what rule will match, load/save per owner.
- [ ] Implement atomic idempotent import persistence in SQL: owner-scoped key and operation creation in one RPC transaction. Keep two identical legitimate transactions via occurrence ordinal; flag uncertain matches with existing budget rows and across overlapping files for explicit confirmation. Never silently skip ambiguous matches or rely on date+amount alone.
- [ ] Add RLS rules table and SECURITY INVOKER (or carefully bounded fixed-search-path definer) RPC; validate auth.uid and payload. SQL must be rerunnable safely and documented, not applied live.
- [ ] Wire lifecycle reset, existing CSV/Excel path using normalized core parsing; loading a new file clears stale manual-bank state. Guard double-click, partial success and stale async completions. Rule failures show separately from operation results.
- [ ] Include local modules and vendor assets in updated service-worker strategy, preserve reliable network fallback.
- [ ] Run task tests and complete suite; commit exact implementation/test/migration files. Report migration requirement and browser QA entry points.

### Task 3: Integration acceptance and documentation

**Files:** tests/fixes in affected modules only; `docs/bank-import.md`.

- [ ] Verify supplied PDFs with production parser, independently compare rows/totals, and record only anonymized results.
- [ ] Run SQL locally if a PostgreSQL runtime is available; otherwise explicitly record SQL execution/RLS checks as pending, never claim production persistence verified.
- [ ] Use synthetic local account preview (no production login/data writes). Verify file selection, progress, errors, four banks, create categories, rules, duplicates and partial retry. Desktop/mobile and Classic/Pixel screenshots; no private statement screenshots in repository.
- [ ] Run `node --test tests/*.test.mjs`, `git diff --check` and syntax checks. Fix discovered regressions with failing tests first.
- [ ] Document supported templates, limitations, privacy and migration/deploy checklist; commit.
- [ ] Final independent review, bounded fixes, then hand off locally without publishing.
