# Design system

`tokens.css` is the only source of colour, type, space, radius and motion values
in Zeniconic. The mockups in `../mockups/` and the real renderer both import
it. A second palette anywhere is a bug.

## Direction

An editorial property brochure that happens to render video, set in a confident
grotesque. Warm paper shell, near-black preview stage, brass accent used
sparingly. Deliberately not a SaaS dashboard: no purple gradients, no
glassmorphism, no icon soup.

- Display: **Bricolage Grotesque** (650) — screen titles, prices, the wordmark.  It has the irregular, hand-cut quality a serif would give, without reading as
  decoration; at 44px it is the thing you notice first.
- UI: **Archivo** — everything functional. A sturdy grotesque with an honest
  small size, so 10px uppercase labels stay legible.
- Accent: brass `#B08A4A` for fills, progress and borders. Brass as *text* uses
  `--brass-text` instead; raw brass fails contrast on paper.

## Contrast audit (WCAG 2.2 AA)

Two gates, both runnable with plain Node:

- `node docs/design/check-contrast.mjs` — the token pairs, both themes. Fast, runs in CI.
- `node scripts/audit-contrast-dom.mjs` — the **rendered** deck, both themes, in a real
  browser via Chrome DevTools Protocol. Catches a component that uses the wrong
  token even when every token is individually fine. Skips text over photography and
  disabled controls, which are judged differently.

Run the second one after any component change; it is the one that catches the
mistake of using `--brass-dark` as text because it looked right on one surface.

## Palette measurements

Run `node docs/design/check-contrast.mjs` after any palette change. Current
state, measured on 15 November 2026:

| Pair | Ratio | AA text | Verdict |
|---|---|---|---|
| `--ink` on `--paper` | 17.04:1 | 4.5 | pass |
| `--ink-70` on `--paper` | 8.66:1 | 4.5 | pass |
| `--ink-45` on `--paper` | 5.33:1 | 4.5 | pass (was 4.16 — darkened) |
| `--ink-45` on `--paper-deep` | 4.88:1 | 4.5 | pass (was 3.81) |
| `--brass-text` on `--paper` | 5.77:1 | 4.5 | pass (new token) |
| `--brass-text` on `--brass-wash` | 5.17:1 | 4.5 | pass (was 3.95) |
| `--on-brass` on `--brass` (primary button) | 5.86:1 | 4.5 | pass (was 3.14 with cream) |
| `--on-brass` on `--brass-hover` | 5.23:1 | 4.5 | pass |
| `#4F5B49` on `--sage-wash` | 6.04:1 | 4.5 | pass |
| `#7A5A1C` on `--amber-wash` | 5.51:1 | 4.5 | pass (was 4.51) |
| `--clay` on `--clay-wash` | 4.89:1 | 4.5 | pass |
| `--border-interactive` on `--paper` | 3.46:1 | 3.0 | pass (input edges) |
| `--brass-text` focus ring on `--paper` | 5.77:1 | 3.0 | pass |
| `--brass` as body text on paper | 2.91:1 | 4.5 | **forbidden** — fills only |

Five changes came out of this audit and are now baked into the tokens:

1. `--ink-45` darkened from `#7C7568` to `#6B6458`. It carries 10px uppercase
   labels, so it must pass normal-text contrast, not large-text.
2. `--brass-text` added. Brass at text sizes looked right and measured 3.95:1 on
   the wash; the darker variant keeps the hue and passes.
3. Primary buttons switched from cream text on brass (3.14:1) to a dark `--on-brass`
   label (5.86:1). It also reads more like ink on a printed brochure, which suits the
   direction. `--brass-hover` keeps that label legible on hover in both themes.
4. `--border-interactive` added for input edges. `--hairline-strong` measured
   1.75:1; it was doing two jobs (decoration and affordance) and only one of them
   was legal.
5. Focus rings now use `--brass-text` (5.77:1) instead of raw brass (2.91:1).
   The ring still reads as brass, but it is now visible to everyone.

## Dark theme

`tokens.css` ships a second palette under `:root[data-theme="dark"]`. It is not an
inversion, for three reasons:

1. **The shell drops to warm near-black, surfaces rise toward the light.** Cards
   are *lighter* than the page (`#201C16` on `#171410`), which is how depth works
   in the dark. Inverting the light theme would make cards darker and collapse
   the hierarchy.
2. **Brass lightens, it does not stay put.** `--brass-text` becomes `#D6AC66`
   (8.70:1) because the light-mode `#7A5A24` disappears on near-black. Fills stay
   `#B08A4A` and keep a dark label via `--on-brass`.
3. **The stage stops being separated by luminance.** In light mode a pale card
   against near-black is a 19:1 edge. In dark mode the card and stage are 1.17:1
   apart, so the edge is carried by the hairline and the shadow. Both are always
   present on a stage; neither is optional.

Status text is now a token (`--success-text`, `--warn-text`, `--danger-text`)
rather than a literal inside `.badge`, specifically so the dark theme can move it
without patching components.

Measured results, both themes:

| Pair | Light | Dark |
|---|---|---|
| Body text | 17.04:1 | 15.87:1 |
| Secondary text | 8.66:1 | 9.96:1 |
| Tertiary / 10px caps | 5.33:1 | 5.51:1 |
| Brass text on paper | 5.77:1 | 8.70:1 |
| Primary button label | 5.86:1 | 5.75:1 |
| Input border | 3.46:1 | 3.24:1 |
| Focus ring | 5.77:1 | 8.70:1 |

The app follows the OS by default and lets the user override in Settings. The
mockups carry a Light/Dark switch so both can be reviewed side by side.

## Rules that outlive the mockups

- Never use a colour for text that has not been measured. `check-contrast.mjs`
  is the gate.
- Status is never colour alone: every badge carries a word.
- Focus is always visible: 2px brass outline with 2px offset, on every
  interactive element, including within the dark stage.
- Motion respects `prefers-reduced-motion`; nothing essential is conveyed by
  movement alone.
- The dark stage is the only near-black surface. Everything else is paper, so
  footage is the brightest thing on screen.
