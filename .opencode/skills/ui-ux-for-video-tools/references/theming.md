# Theming

Zeniconic ships light and dark from one token set. `<html data-theme="dark">`
switches palettes; no component knows which theme is active. The design is not an
inversion, and treating it as one is the most common way a dark mode ships broken.

## What changes

| Token group | Light | Dark | Rule |
|---|---|---|---|
| Shell | `#F7F4EF` | `#171410` | Warm near-black, never pure black |
| Raised cards | `#FFFDF9` | `#201C16` | **Lighter** than the shell |
| Inset panels | `#EFEAE1` | `#110F0C` | Darker than the shell |
| Stage | `#0E0D0B` | `#0A0907` | Darkest surface in both themes |
| Body ink | `#14120F` | `#F3EEE3` | |
| Brass text | `#7A5A24` | `#D6AC66` | Lightens to stay readable |
| Brass fill | `#B08A4A` | `#B08A4A` | Unchanged; label uses `--on-brass` |
| Success / warning / danger | dark text on pale wash | pale text on dark wash | Status text is a token, never a literal |

## Four rules that are not obvious

**1. Surfaces rise, they do not invert.** In light mode cards are lighter than the
page. Keep that direction: dark cards are `#201C16` on a `#171410` page. A naive
inversion makes cards darker than the page and collapses the hierarchy that makes
a card read as a card.

**2. The stage separates by edge, not luminance.** A raised card against the stage
is 19:1 in light mode and 1.17:1 in dark. The stage must therefore always carry a
hairline border and its shadow. Removing either makes the preview bleed into the
page. This is the one place where a dark theme needs an extra rule rather than a
token swap.

**3. Brass lightens for text, stays put for fills.** `--brass-text` moves to
`#D6AC66` (8.70:1 on the dark shell). Fills stay `#B08A4A` and use `--on-brass`
for the label. Never use `--ink` as a label on brass: it is light in dark mode and
drops to 2.9:1.

**4. Footage is not inverted and not dimmed past recognition.** Thumbnails keep
their tonality; only the chrome around them changes. A dark theme that washes out
property photography defeats the product. In mockups the CSS "photo" gradients are
dimmed by about 15%, not desaturated.

## Implementation

```css
:root { color-scheme: light; --paper: #F7F4EF; /* … */ }
:root[data-theme="dark"] { color-scheme: dark; --paper: #171410; /* … */ }
```

- The app follows the OS by default (`prefers-color-scheme`) and writes an
  explicit `data-theme` when the user overrides it in Settings.
- The mockup deck defaults to light so the reviewed design is what opens, and
  offers a Light/Dark switch.
- `color-scheme` must be set in both themes so native scrollbars, form controls
  and the caret follow.
- Persist the choice; do not re-read the OS on every launch once overridden.

## When adding a component

1. Use existing tokens only. If a colour is missing, add it to **both** palettes in
   the same commit.
2. Check it against `docs/design/check-contrast.mjs` — it evaluates both themes and
   exits non-zero on regression.
3. Look at it on `--paper`, `--paper-raised`, `--paper-deep` and `--stage`. A
   component that only works on one of those is not finished.
4. Do not introduce a theme-specific component variant unless the token route is
   impossible; document why in a comment if you do.
5. Status is still never colour alone: the badge keeps its word.

## What to check in a dark review

- Does the video stage still read as a stage, or has it merged with the page?
- Are card edges visible without relying on shadow alone?
- Do selected chips read as selected, not just "slightly warmer"?
- Does the primary button look like the primary action, and is its label dark?
- Are thumbnails still appetising, or has the dimming made the property look dull?
- Is any focus ring invisible against the stage?
