# Screen inventory

Nine screens: the job, the layout in tokens, the states that matter, the exit
condition. Anything not listed on a screen is not on that screen.

Shared chrome: a 232 px `--rail-nav` left rail holding the listing's five-stage
progress as dots, a job indicator that survives navigation, and the app menu.
Content is capped at `--max-content` 1180 px and centred. The version rail appears
on screens 4, 5 and 6 only.

## 1. Home / listings

**Job:** find the listing you are working on, or start one.

**Layout:** nav rail; header with `Zeniconic` in `--font-display --text-3xl` and
`New listing` as the primary; filter chips (`All`, `Draft`, `Needs review`,
`Ready`); card grid, three across at 1180 px, one across below 900 px. Each card is
a 16:9 cover on `--stage`, address in `--font-display --text-xl`, status badge,
`4 variants` in `--ink-70`, `Edited 2 hours ago` in `--ink-45`. The whole card is
one link; hover raises to `--shadow-md` over `--dur-fast`.

**States:** *first run* — `Your listings live here`, one sentence, `New listing` ·
*filtered* — `No listings match "Ready". [ Show all ]` · *partial* — a card
mid-analysis keeps its thumbnail, gains a 2 px brass rail along the bottom edge,
and stays clickable · *error* — folder moved: clay badge `Footage folder missing`
plus `Locate folder` on the card, not inside it.

**Exit:** opening a listing resumes at its furthest completed stage.
**Never here:** render counts, storage warnings, model spend, charts.

## 2. Intake & facts

**Job:** confirm what is true about the property before anything is generated.

**Layout:** two columns at 1180 px. Left: drop zone and source list. Right: facts
form, 420 px. The drop zone is a `--r-md` dashed `--hairline-strong` area on
`--paper-deep`, 240 px tall, `Drop footage here` at `--text-lg`, formats at
`--ink-45`. Each fact row is a label in `--ink-70`, a `--field`, and a provenance
tag at `--text-xs`. Required: address, price, bedrooms, bathrooms, property type.
Optional: floor area, land size, parking, year built, features. Completeness is a
checklist of required rows, never a percentage ring.

**States:** *empty* — drop zone plus `Paste the listing link or add facts by hand` ·
*partial* — the source list shows duration and audio presence per file; a silent
file reads `Used without sound` and stays · *conflict* — two prices shown side by
side with `Use the imported value` / `Use the typed value`, blocking generation ·
*error* — `This file is HEVC and this build can't decode it. Convert it, or remove
it. [ Remove clip ]`.

**Exit:** `Confirm facts` enables when required rows are filled and no conflict is
open; disabled with the reason inline: `Add a price to continue`.
**Never here:** model-inferred values presented as filled rows.

## 3. Analysis progress

**Job:** wait without anxiety, or leave.

**Layout:** centred column, 560 px. Heading `Reading 52 clips`. Five stage rows at
44 px: name, state icon, segmented rail, duration. Beneath, a live strip of the
last six thumbnails the reader produced, at 96×54 on `--stage` — evidence that the
machine is doing the thing it claims.

**States:** *running* — `About 4 minutes left. You can close this window.` ·
*stalled* — one segment turns amber, `Waiting on the disk`, estimate recalculated
from the new throughput · *failed* — the stage turns clay, finished stages keep
their output, `Retry from here` on that row, three-part error below · *complete* —
`Ready to review. 4 variants from 38 shots. [ Review shots ]` plus a system
notification if the window is unfocused.

**Exit:** complete advances to shot review; failure stays, with retry.
**Never here:** a bare spinner, a fake 90%, a modal that blocks leaving.

## 4. Shot review

**Job:** approve or swap individual shots.

**Layout:** preview stage (`--stage`, `--shadow-stage`) filling the centre;
storyboard strip beneath at 128 px, horizontally scrollable; inspector on the
right at 320 px; version rail 72 px. Tile: thumbnail, room in `--text-2xs` caps,
duration in mono, score dot plus word, `Swap` on hover and focus. Inspector: the
`reason` (≤160 chars), score with `Why?`, `Swap shot`, `Trim start` / `Trim end`
steppers at 0.1 s, and `Play full clip`.

**States:** *partial* — `Scoring 28 of 40 shots`; scored tiles are interactive,
unscored tiles shimmer on `--paper-deep` and cannot be approved · *empty* — `We
couldn't find usable shots in these clips. [ Check footage ] [ Add more footage ]` ·
*rejected* — 60% opacity with a clay slash, reversible until approval · *error* —
`One shot points at a file that moved. [ Re-link footage ]`.

**Exit:** `Approve shots` → variants review; disabled while scoring is incomplete,
and never approves unscored shots silently.
**Never here:** a timeline, track headers, a razor, keyframes.

## 5. Variants review

**Job:** choose which edits to keep.

**Layout:** card grid, two across at 1180 px, with the facts gate row above it — one
line, a `--sage` tick or an `--amber` warning, and inline `Confirm facts`. Card:
poster on `--stage`, format and look at `--text-sm`, hook in the user's words,
duration, loudness chip (`−14, on target`), score with `Why?`, `Play 6s`, `Open`.
Hover plays a muted 6 s loop: the only autoplay in the app, and it is muted.

**States:** *partial* — a card still rendering shows its poster, a 2 px rail and
`Rendering`; it cannot be kept and says so · *near-duplicate* — two variants sharing
format and look are flagged `Nearly the same as variant 2` with `Make it different`
· *failed* — the failing review check with its `detail` and `Fix it` · *gated* — the
facts row collapses to `Facts confirmed`.

**Exit:** `Keep 4 variants` → destinations; disabled with `Keep at least one
variant`.
**Never here:** five identical videos generated from five platforms.

## 6. Refine chat

**Job:** ask for one change and see its diff.

**Layout:** stage left; `--panel-chat` 380 px right on `--paper-deep` with a
hairline divider; transcript scrolling; composer at the bottom with a `--field` and
a send button. Proposal diff blocks break out to the panel's full width minus
12 px, because a squeezed diff is unreadable.

**States:** *empty* — three suggestion chips derived from this listing's weakest
review checks (`Lead with the garden`, `Make it 5 s shorter`, `Softer music`), each
one tap · *thinking* — composer disabled, 2 px rail under the last message, label
`Working on it` · *proposed* — diff block with `Apply 3 changes` / `Discard` ·
*applied* — collapses to `Applied · v5 · [ View diff ]` · *refused* — `That would
cut the video to 6 seconds, under the 15 s minimum for this format. Try "make it 5
seconds shorter".` A refusal is a pivot, not a wall.

**Exit:** none; chat is ambient, and the user leaves by clicking another screen.
**Never here:** streaming edits, prose-only change descriptions, tool JSON.

## 7. Destinations

**Job:** choose where each variant goes.

**Layout:** a matrix, not two lists. Rows are variants; columns are platforms
(`TikTok`, `Reels`, `Stories`, `Shorts`, `Instagram feed`, `Facebook feed`,
`YouTube`, `Website`, `MLS`, `Pinterest`). Each row header names the render profile
the row collapses into, so it is visually obvious that four platforms share one
file. Tiles are 96×96 on `--paper-raised` with the platform mark and a name.

**Header line:** `A destination changes packaging, not the edit.` Once, in
`--ink-70`, and nowhere else in the app.

**States:** *selected* — `--brass-wash` fill, 2 px `--brass` inset, check ·
*warning* — amber dot with a reason on hover and focus: `MLS usually doesn't allow
music` · *unavailable* — greyed with `Not in this build` · *informational* —
`TikTok allows 10 minutes, so length is fine. Your hook lands at 6 s.` · *empty* —
`Pick at least one place to send this. [ Select all social ]`.

**Exit:** `Continue to export`, enabled with one tile selected on one variant.
**Never here:** a destination creating a variant or changing the edit.

## 8. Export

**Job:** produce files and their wrappers.

**Layout:** two columns. Left: one row per delivery with the filename in mono at
`--text-xs`, exactly as `CONVENTIONS.md` specifies
(`2026-11-14-14-oak-avenue_cinematic_calm_vertical-social_v2.mp4`), size estimate,
and a spec line: `1080×1920 · 30 fps · −14 loudness · captions burned`. Right:
destination folder, cover frame picker, caption and hashtags with character counts
against each platform limit.

**States:** *ready* — `Export 4 files`, `4 files, about 38 MB` · *running* — one
rail per file plus an overall stage line, `You can keep working. Files appear in the
folder as they finish.` · *success* — `4 files exported [ Show in folder ] [ Copy
paths ]`, listing status `Exported` · *partial failure* — `Export stopped at file 3
of 4. The disk has 240 MB free and this needs 600 MB. [ Free up space ] [ Choose
another folder ]`, with files 1–2 intact · *blocked* — the facts gate row.

**Exit:** success reveals the folder. Nothing uploads, ever.
**Never here:** auto-publish, account connections, scheduling.

## 9. Settings & diagnostics

**Job:** see what this machine can do, and prove it.

**Layout:** cards in one 720 px column: capabilities, models, storage, cost ledger,
logs. The capabilities table has one row per dependency — `afftdn`, `deesser`,
`loudnorm`, `sidechaincompress`, `ebur128`, the denoise binary and its version, the
local TTS voice, free disk — each `Available`, `Missing` or `Degraded`, with the
fallback named in the row: `deesser missing — using a fixed 6.6 kHz cut`.

**Models:** pinned ids from `models.json` with the pin date, and an `Offline mode`
switch that is honest about the cost: `No voiceover checks, no captions from audio.
Everything else keeps working.` **Cost ledger:** USD to four decimals per listing,
variant and stage, from `provenance.costUsd`; a monthly total, no forecasts.

**States:** *degraded* — amber section header, never behind a disclosure · *empty* —
`No model calls yet. The cost ledger fills as you generate.` · *error* — `The log
file is locked by another process. [ Copy report ]` still works from memory ·
*reset* — `Clear render cache`, naming the consequence: `Re-rendering will take
about 6 minutes.`

**Exit:** none. `Copy report` produces a plain-text diagnostics block.
**Never here:** settings that silently change a delivery spec. Loudness targets,
profile sizes and safe areas are not user-editable.
