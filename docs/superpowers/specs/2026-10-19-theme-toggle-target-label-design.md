# Theme Toggle Target Label

## Goal

Make every theme toggle show the theme that will be enabled by the next click:

- while Classic is active, the visible label is `Pixel`;
- while Pixel Retro is active, the visible label is `Classic`.

The accessible name and tooltip must continue to use the localized full action text, such as `Переключить на Pixel Retro` and `Переключить на классическую тему`.

## Root cause

The theme controller already refreshes elements marked with `data-theme-toggle-label`. The authentication-screen label has this marker, but the compact navigation label only has the CSS class `theme-toggle-label`, so its visible text never changes after the theme changes.

## Design

Add `data-theme-toggle-label="short"` to the compact navigation label and keep the existing theme controller as the single source of truth. The controller uses the attribute value to render the compact target name (`Pixel` or `Classic`) while ordinary label elements continue to receive the localized full action. Do not add a second selector, a button-specific state branch, or duplicate theme state.

The controller will continue to update:

- `aria-pressed` to represent whether Pixel Retro is active;
- `aria-label` and `title` with the localized next-theme action;
- ordinary `data-theme-toggle-label` elements with the localized next-theme action;
- compact `data-theme-toggle-label="short"` elements with the next theme name.

The compact navigation control displays `Pixel` in Classic and `Classic` in Pixel Retro.

## Testing

1. Add a regression assertion that the authentication label receives the full localized action while the compact navigation label receives `Pixel` in Classic and `Classic` in Pixel Retro.
2. Run the focused theme tests and the complete test suite.
3. In a browser, verify Classic -> Pixel Retro -> Classic and confirm that the button always names the opposite, target theme.

## Scope

No changes to theme persistence, Supabase synchronization, visual theme tokens, service-worker behavior, or unrelated UI are included.
