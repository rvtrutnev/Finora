# Finora Pixel Retro Theme — Design Specification

**Date:** 2026-10-14
**Status:** Approved design
**Branch:** `feature/pixel-retro-theme`
**Base:** `dev` at `29a01d2`

## 1. Objective

Add a second, user-selectable visual theme named **Pixel Retro** to Finora while preserving the existing **Classic** theme, application structure, calculations, navigation, data model, and user workflows.

Pixel Retro uses a dark terminal-inspired visual language derived from the user's supplied references:

- dark instrument-panel background;
- cream primary text and figures;
- cyan actions and positive states;
- red-orange risks and negative states;
- pixel typography for display elements;
- subtle CRT scan lines and glow on large decorative surfaces only.

The feature must work before and after authentication, persist locally, synchronize through Supabase user metadata, and remain usable offline after its assets have been cached.

## 2. Scope

### Included

- A `Classic` and `Pixel Retro` theme switcher in the top navigation.
- Semantic CSS tokens shared by both themes.
- Pixel Retro styles for every existing Finora screen and reusable component.
- Hybrid typography: pixel display font plus Inter for body copy and forms.
- Subtle, non-animated CRT treatment.
- Immediate local persistence through `localStorage`.
- Cross-device synchronization through Supabase `user_metadata`.
- Theme-aware PWA metadata and local asset caching.
- Automated behavior tests and browser-based responsive checks.
- Translations for new theme-related labels and notifications in all currently supported languages.

### Excluded

- Changes to financial calculations or stored financial data.
- New screens, navigation items, or business workflows.
- Separate markup or component trees for each theme.
- A new Supabase table or changes to RLS policies.
- Strong CRT distortion, text flicker, chromatic aberration, or continuous animation.
- Redesign of the current information architecture.
- Automatic selection based on the operating-system color scheme.

## 3. Confirmed Product Decisions

1. Pixel Retro is an optional second theme; Classic remains available.
2. The first visit defaults to Classic.
3. Before authentication, Finora immediately applies the last locally stored theme.
4. After authentication, the selected theme synchronizes across devices through Supabase.
5. The switch is a dedicated button in the top navigation next to the language control.
6. Both themes use the same HTML structure and JavaScript business logic.
7. Pixel Retro changes the visual layer only.
8. The selected direction is **Terminal Hybrid**.
9. Typography is hybrid rather than fully pixelated.
10. CRT treatment is subtle and does not cover inputs, tables, modals, or charts.

## 4. Technical Architecture

### 4.1 Theme Attribute

The active theme is represented on the document root:

```html
<html lang="ru" data-theme="classic">
<html lang="ru" data-theme="pixel-retro">
```

Allowed internal values are strictly:

- `classic`
- `pixel-retro`

Unknown or malformed values fall back to `classic`.

### 4.2 File Boundaries

The implementation introduces the following local files:

- `styles/themes.css` — shared tokens, Classic values, Pixel Retro values, and theme-specific component treatments;
- `js/theme.js` — validation, theme application, UI state, local persistence, Supabase synchronization, and retry state;
- `fonts/press-start-2p/PressStart2P-Regular.woff2` — local display font;
- `fonts/press-start-2p/OFL.txt` — font license.

`index.html` retains application markup and business logic. It receives only the integrations needed to load the theme files, bootstrap the initial theme, render the switch, expose translations, and call synchronization from the existing authentication lifecycle.

### 4.3 Semantic Tokens

Themes must be expressed through semantic custom properties rather than duplicated selectors or page-specific color replacements.

The minimum token groups are:

- canvas and surface colors;
- primary, secondary, and inverse text;
- border and focus colors;
- action, positive, negative, and warning colors;
- control backgrounds and disabled states;
- card elevation and hover treatment;
- corner radii;
- body and display font families;
- transition duration;
- chart series and chart-grid colors;
- PWA browser chrome color.

Existing Tailwind color names may temporarily remain as compatibility aliases, but their generated values must resolve through semantic CSS variables. New Pixel Retro code must not introduce another set of page-specific hard-coded colors.

### 4.4 Early Bootstrap

A small synchronous bootstrap in `<head>` reads `finora_theme` from `localStorage`, validates it, and writes `data-theme` before the body is rendered.

Requirements:

- no network request;
- no dependency on Supabase or Tailwind;
- failure-safe when storage is blocked;
- invalid values resolve to Classic;
- no visible Classic-to-Retro flash during normal startup.

## 5. Theme State and Synchronization

### 5.1 Storage Keys

- Local selected theme: `finora_theme`
- Pending remote synchronization marker: `finora_theme_sync_pending`
- Supabase user metadata field: `theme`

### 5.2 Startup Before Authentication

1. Read `finora_theme`.
2. Validate the value against `classic` and `pixel-retro`.
3. Apply the validated value or Classic when absent.
4. Update the switch state and theme-color metadata when the DOM is available.

### 5.3 Authenticated Reconciliation

After Supabase reports an authenticated session:

1. Read `session.user.user_metadata.theme`.
2. If the remote value is valid, treat it as authoritative, apply it, and update local storage.
3. If no valid remote value exists, keep the validated local theme and write it to user metadata.
4. Clear the pending marker after a successful write.
5. If the write fails, retain the local theme and set the pending marker.

On the next authenticated initialization, a pending write is retried only when no conflicting valid remote value exists. A valid remote value always wins during reconciliation.

### 5.4 User-Initiated Switching

When the user activates the switch:

1. Calculate the other allowed theme.
2. Apply it immediately.
3. Store it in `localStorage`.
4. Update `aria-pressed`, accessible labels, and the theme-color meta element.
5. Show a localized non-blocking confirmation.
6. If authenticated, update Supabase user metadata.
7. If remote synchronization fails, retain the local selection and mark it pending.

Theme synchronization errors must never block authentication, data loading, navigation, or financial operations.

## 6. Visual System

### 6.1 Pixel Retro Palette

| Role | Value |
|---|---|
| Canvas | `#080907` |
| Primary surface | `#10110D` |
| Elevated/control surface | `#171811` |
| Primary text and figures | `#E9DFAC` |
| Secondary text | `#9B9471` |
| Accent, action, positive | `#22B8B0` |
| Negative and destructive | `#FF4B20` |
| Warning | `#D6A84B` |
| Border | `#827B5D` |

Color is not the sole carrier of meaning. Financial states retain signs, labels, icons, or textual explanations.

### 6.2 Typography

- **Press Start 2P** is used for the Finora brand, short headings, key figures, compact labels, and button captions.
- **Inter** remains the body, form, table, tooltip, modal, and long-description font.
- Pixel typography must not be applied to user-entered data or multi-line explanatory text.
- Display sizes use values at which Press Start 2P renders predictably, favoring multiples of eight where practical.
- The font is self-hosted, declared with `font-display: swap`, and distributed with its OFL license.

The selected font is the official Google Fonts Press Start 2P release because its metadata lists Cyrillic and Cyrillic Extended subsets and an OFL license.

### 6.3 Geometry and Surfaces

- Cards use a solid dark surface, a one-pixel border, and a 6–8 px radius.
- Pixel Retro removes Classic's gold gradients and soft modern shadows.
- Interactive controls resemble compact instrument keys rather than decorative game buttons.
- Focus indicators use a clear cyan outline with sufficient contrast.
- Existing spacing, element order, and responsive breakpoints remain unchanged unless a narrow adjustment is required to prevent text clipping caused by the display font.

### 6.4 Component Rules

- **Navigation:** same sections and placement; pixel labels, terminal borders, cyan active state.
- **Cards:** cream figures, muted labels, thin borders, no nested decorative frames beyond existing structural grouping.
- **Buttons:** cyan primary, outlined secondary, red-orange destructive, explicit disabled state.
- **Inputs and selects:** unchanged usable dimensions, dark control surface, visible focus ring, body font for entered values.
- **Modals:** solid surface without CRT overlay; clear title, body copy, and action hierarchy.
- **Tables and lists:** body font, stable column alignment, restrained row separators.
- **Charts:** cyan, cream, red-orange, and amber series; muted grid; tooltips remain readable in both themes.
- **Toasts:** use both color and icon/text to distinguish success, warning, and error.

### 6.5 CRT Treatment

- A low-opacity scan-line pseudo-element may cover the application canvas and selected large decorative panels.
- A restrained inset glow may be used on the main shell.
- No animation, flicker, displacement, blur, or chromatic separation is allowed.
- Inputs, selects, text areas, tables, charts, and modals are excluded from the overlay.
- Under `prefers-reduced-motion: reduce`, theme transitions and decorative glow are disabled.

## 7. Theme Switch UI

The switch is added to the right side of the existing sticky navigation near the language control.

It must include:

- a small pixel-monitor icon;
- `type="button"`;
- localized `title` and `aria-label` describing the theme that will be activated;
- `aria-pressed="true"` only while Pixel Retro is active;
- a minimum usable target size consistent with neighboring navigation actions;
- keyboard activation and a visible focus indicator.

No separate settings modal is introduced in this version.

## 8. Internationalization

New translation keys must be added for Russian, English, German, French, and Spanish:

- switch to Pixel Retro;
- switch to Classic;
- Pixel Retro enabled;
- Classic enabled;
- local-only synchronization warning if surfaced to the user.

Theme identifiers stored in local storage and Supabase remain language-neutral internal values.

## 9. PWA and Offline Assets

The service-worker cache name advances to `finora-v3`.

The install asset list includes at minimum:

- `./index.html`
- `./styles/themes.css`
- `./js/theme.js`
- `./fonts/press-start-2p/PressStart2P-Regular.woff2`
- `./fonts/press-start-2p/OFL.txt`

Only Finora-prefixed obsolete caches are removed during activation. Existing rules that bypass non-GET, Supabase, and CDN requests remain intact.

This scope guarantees availability of the new local theme assets after a successful install. It does not claim that all existing third-party CDN dependencies are newly made offline-capable.

## 10. Accessibility and Responsive Requirements

- Normal text targets a contrast ratio of at least 4.5:1.
- Large text and essential non-text boundaries target at least 3:1.
- Theme selection cannot be communicated by color alone.
- The switch remains operable with keyboard navigation.
- Focus is visible in both themes.
- Pixel text must not clip at supported translations or 200% text zoom.
- No horizontal page scrolling at the supported phone and laptop widths.
- Reduced-motion preferences are respected.
- Existing semantic labels and form behavior are preserved.

## 11. Error Handling

- Blocked or unavailable local storage: fall back to Classic and keep the application usable.
- Invalid local or remote theme value: ignore it and use the last valid value or Classic.
- Supabase read failure: keep the local theme without blocking startup.
- Supabase write failure: keep the local theme, set the pending marker, and retry on the next authenticated initialization.
- Missing font: use the declared monospace fallback without hiding text.
- Missing theme stylesheet or script: Classic-compatible markup remains usable.

Theme errors are non-fatal and must not interrupt financial data operations.

## 12. Verification Strategy

### Automated Tests

Add focused tests for:

1. first startup with no stored preference;
2. early application of a valid local preference;
3. rejection of an invalid local preference;
4. immediate theme toggling and local persistence;
5. root attribute, `aria-pressed`, accessible label, and theme-color updates;
6. valid remote preference overriding local state after authentication;
7. missing remote preference causing local-to-remote initialization;
8. Supabase failure preserving the local theme and setting pending synchronization;
9. new assets being included in the `finora-v3` service-worker cache;
10. preservation of all existing service-worker tests.

### Browser and Visual Checks

Check both themes in Chrome and Safari at phone and laptop widths:

- authentication screen;
- dashboard;
- wallets;
- receivables and debts;
- budget;
- calculator;
- import;
- modal dialogs, dropdowns, toasts, loading, empty, error, and disabled states;
- Chart.js charts and tooltips;
- theme switching before and after sign-in;
- page reload after service-worker activation;
- keyboard focus and reduced-motion behavior;
- long localized labels in all five supported languages.

## 13. Acceptance Criteria

The feature is ready when:

- Classic remains the first-visit default and visually retains its current appearance;
- the dedicated navigation control switches both themes without reloading;
- the selection persists locally and synchronizes through Supabase metadata;
- a synchronization outage does not block the app;
- every current screen is legible and functionally unchanged under Pixel Retro;
- the Pixel Retro assets are served locally and included in `finora-v3`;
- automated tests pass, including the existing service-worker suite;
- Chrome and Safari checks pass at representative phone and laptop widths;
- no unrelated financial, navigation, or data-model behavior changes.

## 14. Delivery Sequence

1. Add tests for theme state and synchronization behavior.
2. Add the theme-state module and early bootstrap.
3. Introduce semantic tokens and preserve Classic appearance.
4. Add the Pixel Retro visual layer and bundled font.
5. Add the accessible switch and translations.
6. Update PWA caching and tests.
7. Run automated, responsive, visual, and browser checks.
