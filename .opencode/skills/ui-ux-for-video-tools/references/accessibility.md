# Accessibility

WCAG 2.2 AA, treated as a build requirement rather than an audit at the end.
Every item below is testable in this app, on this machine, without special
hardware.

## Criteria that bite in this product

| Criterion | Where it bites | What we do |
|---|---|---|
| 1.4.3 Contrast (minimum) | Small meta text, badge labels, primary button | Token pairs are audited; see the table below |
| 1.4.11 Non-text contrast | Focus rings, tile borders, the progress rail, score dots | 3 : 1 against the adjacent surface, minimum |
| 1.2.2 Captions (prerecorded) | Every delivered video | On by default; burned or sidecar by profile |
| 2.1.1 Keyboard | The whole flow, including shot reordering | Full map below |
| 2.4.7 Focus visible | Every control | 2 px ring, `--brass-text`, never removed |
| 2.4.11 Focus not obscured | Sticky player chrome over the version rail | Focused elements scroll clear of sticky bars |
| 2.5.7 Dragging movements | Reordering shots by drag | `Cmd/Ctrl+←/→` and a `Move` menu item do the same thing |
| 2.5.8 Target size | Score dots, close buttons, tile corners | 24×24 px minimum, 8 px spacing |
| 2.2.1 Timing adjustable | Toasts, preview auto-dismiss | Minimum 6 s, pause on hover and focus, never the only copy |
| 1.4.4 Resize text | 200% browser zoom | Layout holds; no clipped labels |
| 1.4.10 Reflow | 320 px equivalent width | Single column, no horizontal scroll |

## Contrast audit

Measured with the WCAG relative-luminance formula against the surface named in
each row. Re-measure whenever a token changes; do not trust a mockup.

| Foreground | Background | Ratio | Permitted use |
|---|---|---|---|
| `--ink` | `--paper` | 17.0 : 1 | Any text |
| `--ink` | `--paper-raised` | 18.4 : 1 | Any text |
| `--ink-70` | `--paper` | 8.7 : 1 | Secondary text, captions, meta |
| `--ink-70` | `--paper-raised` | 9.4 : 1 | Same |
| `--ink-45` | `--paper` | 5.3 : 1 | Caps labels ≥10 px, tertiary meta |
| `--ink-45` | `--paper-deep` | 4.9 : 1 | Same, on inset panels |
| `--ink-20` | `--paper-deep` | 1.5 : 1 | Disabled text only (exempt), always with a reason |
| `--ink` | `--brass` | 5.9 : 1 | Primary button label |
| `--brass` as text | `--paper` | 2.9 : 1 | **Forbidden.** Fills, rails and borders only |
| `--brass-text` | `--paper` | 5.8 : 1 | Links, small brass text |
| `--brass-text` | `--brass-wash` | 5.2 : 1 | Selected chip and badge labels |
| `--brass-text` | `--paper` (ring) | 5.8 : 1 | Focus ring, 3 : 1 minimum met with margin |
| `--border-interactive` | `--paper` | 3.5 : 1 | Input edges |
| `--clay` | `--clay-wash` | 4.9 : 1 | Error badge text |
| `#4F5B49` | `--sage-wash` | 6.0 : 1 | Success badge text |
| `#7A5A1C` | `--amber-wash` | 5.5 : 1 | Warning badge text |
| `--paper-raised` | `--stage` | 18.8 : 1 | Preview chrome text |
| `--ink-20` | `--stage` | 8.4 : 1 | Muted preview chrome |

**Status: resolved in tokens, 15 November 2026.** The two original findings were
fixed at the palette rather than per component, plus three the same audit found:

1. **Primary button** is `--brass` fill with an `--ink` label. Cream on brass was
   3.1 : 1.
2. **`--ink-45`** was darkened from `#7C7568` to `#6B6458`. It carries 10 px caps,
   so 4.2 : 1 was a real failure, not a stylistic quibble.
3. **`--brass-text`** was added for text and rings; raw brass on the wash was
   3.95 : 1.
4. **`--border-interactive`** was added because `--hairline-strong` measured
   1.75 : 1 and inputs need a 3 : 1 edge.
5. **Focus rings** use `--brass-text`, not raw brass (2.9 : 1).

`docs/design/check-contrast.mjs` is the gate: it exits non-zero if any required
pair regresses. If a new pair is needed, add it there and record the measurement
in `docs/design/README.md`.

Focus rings: 2 px `--brass-text` on `--paper` and `--paper-deep` (5.8 : 1),
`--brass` on `--paper-raised` (3.1 : 1, non-text only) and `--stage` (6.1 : 1).

## Keyboard map

`?` opens this map in the app. Every row is tested in CI by a Playwright flow.

Global:

| Key | Action |
|---|---|
| `Cmd/Ctrl+1…9` | Go to screen 1–9 |
| `?` | Keyboard sheet |
| `Esc` | Close the topmost non-destructive layer |
| `Tab` / `Shift+Tab` | Reading order |

Per screen:

| Screen | Keys |
|---|---|
| Home | `↑↓←→` move across cards, `Enter` opens, `N` new listing |
| Intake & facts | `Tab` walks facts in label order, `Enter` commits a field, `Esc` reverts the field, `Cmd/Ctrl+Enter` confirms |
| Progress | `Esc` returns without cancelling; nothing else is interactive |
| Shot review | `←→` select a tile, `Cmd/Ctrl+←→` move it, `Space` play/pause, `Shift+←→` one frame, `[` `]` versions, `S` swap |
| Variants | `↑↓←→` across cards, `Space` play the loop, `K` keep, `Enter` open |
| Refine chat | `Enter` sends, `Shift+Enter` newline, `Tab` reaches suggestions, `Cmd/Ctrl+Enter` applies the focused proposal |
| Destinations | `↑↓←→` across the matrix, `Space` toggles, `Shift+Space` toggles the whole row |
| Export | `Tab` through wrappers, `Cmd/Ctrl+Shift+E` exports |
| Settings | `Tab` through sections; `Copy report` is first in tab order |

No shortcut is single-letter-only on a screen with text input focused. `S` for
swap and `K` for keep are inert while a field has focus.

## Focus management

Five rules, implemented once in a `useFocusRestore` hook rather than per screen:

1. **Dialogs** trap focus, land on the primary, and on close return focus to the
   invoking control, matched by id, not by position.
2. **Re-renders never lose focus.** Virtualised lists keep the focused item in the
   DOM, or use roving tabindex with `aria-activedescendant`; after data changes the
   same item id is re-focused. A list that re-renders and drops focus to `<body>`
   fails the build.
3. **Route changes** move focus to the new screen's `<h1>`, which is `tabindex="-1"`,
   and announce the screen name.
4. **Applying a change** moves focus to the new version rail entry, because that is
   the thing that changed.
5. **Never steal focus** for progress, toasts or completion. Those announce via
   live regions; the user's place is theirs.

Live regions:

- `role="status"` `aria-live="polite"` for apply results, export completion, job
  stage changes, and the diff summary when it appears.
- `role="alert"` only for errors that block the current action, and never for each
  tick of a progress rail.
- The progress rail is `role="progressbar"` with `aria-valuetext="Choosing shots,
  3 of 5 stages, about 4 minutes left"`. It is not a live region: a screen reader
  reading every percent is worse than silence.

## Captions

Captions are content, not decoration. The three reasons they are on by default:
most social viewing is muted, the captions are the accessibility path for anyone
who cannot hear the voiceover, and they are the only copy of the address and price
that survives a muted autoplay.

- Default `captions.mode`: `burn` for `vertical-social`, `feed-portrait` and
  `pin`; `sidecar` for `landscape`, because MLS and website embeds must not have
  burned-in text. `both` is opt-in per delivery.
- Default style: `clean_lower` for `calm` and `walkthrough` looks, `bold_center`
  for `social`. Captions use `--paper-raised` on a 60% `--stage` scrim, 4.5 : 1
  minimum over the brightest frame in the shot. Verify against the actual frame,
  not against black.
- Vertical captions sit inside the safe area: ≥250 px from the top, ≥340 px from
  the bottom, ≥120 px from the right, ≥60 px from the left. Two lines maximum,
  32–38 characters per line at 1080 width.
- Line breaks fall on clause boundaries, never mid-phrase. Re-break when the
  timing changes; a caption that jumps mid-word reads as a stutter.
- Timing: minimum 1.0 s on screen, maximum 5 s, no more than two lines per cue,
  and no cue over a hard cut.
- Turning captions off shows the consequence in the row: `Without captions, most
  viewers watch this muted and miss the price.`

## Reduced motion

`prefers-reduced-motion: reduce` is honoured through the stylesheet's blanket
rule, plus these explicit swaps:

- Diff block entry: fade only, 120 ms, no vertical slide, no layout shift.
- Rail entry on apply: appear in place, no growth animation.
- Poster hover loops: no autoplay; a static poster with a play glyph.
- Progress rails: fill updates without easing; the indeterminate sweep is replaced
  by a static `Working` label plus the stage name.
- No parallax anywhere, ever. No confetti on export.

## Screen reader notes

- Shot tile: `"Balcony, shot 2 of 12, 3.4 seconds, score 82, sharp. Press S to swap."`
  Name first, then position, then the facts that support a decision.
- Variant card: `"Social hook, walkthrough look, 28 seconds, loudness on target.
  Rendering, 40%."`
- Diff clause: `"Change 1 of 3: balcony at 8.0 seconds. Press Enter to preview."`
- Version rail entry: `"Version 5, current, created by you, 2 minutes ago. 3
  changes: balcony at 8.0s."`
- Score chips are `aria-label`-ed with the word: `"score 82, sharp"`, never a bare
  number.
- Wall-clock times in announcements are relative (`2 minutes ago`) because a
  screen reader user cannot compare two absolute timestamps at a glance.

## Testing

Five passes, run before any screen is called done:

1. **Keyboard only.** Unplug the mouse. Complete Home → Export. Any step that
   requires pointing is a bug with a line number.
2. **Zoom 200%.** Layout reflows, no clipped labels, no overlapping chrome.
3. **Reduced motion on.** No transitions over 120 ms, no autoplay, everything still
   legible.
4. **Screen reader.** One pass with NVDA on Windows: screen names, tile labels, the
   diff summary, version rail, and one error path.
5. **Contrast spot-check.** Any pair not in the table above gets measured with a
   script before it ships, not eyeballed in a screenshot.
