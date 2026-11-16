# Zeniconic — UI mockups

Nine static artboards for the desktop app, each exactly **1440 × 900**. Open
`index.html` in a browser; the boards scale to fit a 1440 or 1280 window without
cropping. Everything is HTML and CSS, with a small amount of vanilla JavaScript
for chip toggles, tabs and the theme switch. No frameworks, build step, external
images or icon library.

Copy is real throughout: Marina Gate 1, Dubai Marina, AED 1,850,000, 3 bed · 2 bath · 1,240 sq ft, Sara Whitfield, Quiet Morning, November 2026.

The app stops at the file. v1 produces finished video files only: shapes,
quality, captions, voice and a cover. Platforms, posting, per-channel copy and
hashtags, permits and compliance belong to the marketing team, so no screen
names a platform or offers to publish.

## What each screen demonstrates

| # | Screen | What it demonstrates |
|---|---|---|
| 01 | **Home / listings** | One card per property with status as the loudest element: variants ready, tagging at 62%, needs a fact, draft. The empty "New video" tile is the same size as a listing, so the grid teaches the first action. A discreet $12.40 meter and the month total keep spend visible without making it the subject. |
| 02 | **Intake & facts** | A facts form, not a chat. Each row carries its source and a single tick; the missing square footage is the only amber thing on screen and offers both exits, Add and Skip. Ratios and look are chosen here so analysis runs once. |
| 03 | **Analysis progress** | A five-stage rail with real counts and honest time instead of a spinner. The contact sheet fills as shots are found, the cost ticker answers the wallet, and "safe to close" answers the calendar. |
| 04 | **Shot review** | Four columns of shots, each with duration, score plus a plain-language word, room, camera move and the reason for the score. Rejected shots stay visible and desaturated with their reason attached. Filters follow rooms, not file names. |
| 05 | **Variants** | Three complete edits presented as posters first: name, duration, shot count, score and approval status. One is approved; two still need a decision. The storyboard beneath is the only manual editing surface, with a drag affordance and rejected-shot note. |
| 06 | **Refine chat** | A plain-language request, a three-change diff with timecodes, and a version rail. The preview is a real 9:16 frame with a price overlay and safe margins; Apply is disabled until the preview has played. Nothing changes silently. |
| 07 | **Formats** | Three large shape cards — 9:16, 16:9 and 1:1 — each with a frame diagram, the text safe area and the variants it will render. The outcome panel shows the one vertical safe-area diagram (250 top, 340 bottom, 120 right, 60 left) and the six files that result. No platform is chosen or named: a shape is an output, not a destination. |
| 08 | **Export** | One explicit, priced, local step. Approved variants sit at the top; the output list prices all six files by shape with dimensions, length and estimated size; quality, voice, captions, cover and an optional permit line (off by default, because marketing owns compliance) are chosen here. The footer repeats files, time and price, and says nothing publishes. |
| 09 | **Settings & diagnostics** | The machine room: pinned model IDs with last-checked times, a spending cap with a small per-listing bar chart, brand kit, music bank with licence states, storage, and a copyable log tail with the app version. |

## Three design decisions that matter most

**1. A review desk, not an editor.**
The user's job is judgement. The app proposes shots, variants and diffs; the
person approves, swaps or rejects. The storyboard is the only place a beginner
can reorder the video, and even there the unit is a shot, not a trim handle. This
is why every screen's primary action is a decision — Analyze, Approve, Apply,
Export — rather than a tool.

**2. Every AI change is inspectable before it applies.**
The Refine screen is the proof: a diff block with three named changes and their
timecodes, an effect line (`12 shots → 11 · loudness unchanged`), and an Apply
button that stays disabled until the preview has played. Approved variants are
never overwritten; applying creates version 5 and leaves 1–4 in the rail. The
same grammar is reused for shot rejection and variant approval.

**3. Facts and money are first-class, not settings.**
Facts have provenance and gate export; the one missing value is surfaced as a
warning with two exits. Spend is shown as a remaining balance next to the action
and as a monthly total in the footer, never as a dashboard. The export screen
leaves the permit line off, says whose job compliance is, and estimates each
file's weight before the button. Trust for a time-poor beginner comes from these
small refusals, not from more controls.

## Deliberately not shown

- **No timeline.** No tracks, playhead across clips, razor tool or ripple edit.
  The storyboard is the sequence model, and the preview scrubber is bounded to
  the current cut.
- **No manual keyframing.** No curves, masks or per-property animation. Looks and
  formats are constrained generators over the user's own footage.
- **No file browser.** Footage arrives through the intake drop zone; the only
  folder path is the app's own storage location, with one "Open folder" action.
- **No platform picker.** The Formats screen chooses output shapes, not
  channels: 9:16, 16:9 or 1:1. The file is where the app's job ends.
- **No publish button.** Export writes finished files. Choosing where they go,
  and everything that follows, is the marketing team's job.

## Themes

`docs/design/tokens.css` ships both palettes under `:root` and
`:root[data-theme="dark"]`. The deck opens in **light** by default, regardless of
the operating system, so the client always sees the reviewed design first.

Use the **Light / Dark** segmented control in the deck header (top right, beside
the build label). It sets `document.documentElement.dataset.theme`, updates its
own `aria-pressed` state, and stores the choice under `zeniconic-theme` in
localStorage. Both sides are native buttons, reachable by Tab and activated with
Enter or Space. A tiny inline script applies a saved choice before first paint so
there is no flash of the wrong theme.

What to check in each theme:

- **Light** — warm paper shell, cards one step lighter, brass only for action and
  progress, sage for approved, clay for failure. Photos are bright but not
  washed out; type over them remains cream.
- **Dark** — the shell is warm near-black, cards are lighter than the shell, and
  the video stage is the darkest surface with a hairline edge. Brass text uses
  `--brass-text`; brass fills keep a dark `--on-brass` label. Status badges use
  `--success-text`, `--warn-text` and `--danger-text`. Photos are dimmed, not
  inverted, and their windows stay warm rather than glowing white.

Text over photography and disabled controls are intentionally outside the
contrast audit in `scripts/audit-contrast-dom.mjs`; all other DOM text passes AA
in both themes.
