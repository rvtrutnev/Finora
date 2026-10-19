# Theme Toggle Target Label

## Goal

Make every theme toggle show the theme that will be enabled by the next click:

- while Classic is active, the visible label is `Pixel`;
- while Pixel Retro is active, the visible label is `Classic`.

The accessible name and tooltip must continue to use the localized full action text, such as `Переключить на Pixel Retro` and `Переключить на классическую тему`.

## Root cause

The theme controller already refreshes elements marked with `data-theme-toggle-label`. The authentication-screen label has this marker, but the compact navigation label only has the CSS class `theme-toggle-label`, so its visible text never changes after the theme changes.

## Design

Add `data-theme-toggle-label` to the compact navigation label and keep the existing theme controller as the single source of truth. Do not add a second selector, a button-specific branch, or duplicate theme state.

The controller will continue to update:

- `aria-pressed` to represent whether Pixel Retro is active;
- `aria-label` and `title` with the localized next-theme action;
- every `data-theme-toggle-label` element with the same localized next-theme action.

For the compact navigation control, CSS may keep the shortened visual presentation if needed, but the displayed target must change with the active theme.

## Testing

1. Add a regression assertion that both visible label elements receive `theme_switch_pixel` in Classic and `theme_switch_classic` in Pixel Retro.
2. Run the focused theme tests and the complete test suite.
3. In a browser, verify Classic -> Pixel Retro -> Classic and confirm that the button always names the opposite, target theme.

## Scope

No changes to theme persistence, Supabase synchronization, visual theme tokens, service-worker behavior, or unrelated UI are included.
