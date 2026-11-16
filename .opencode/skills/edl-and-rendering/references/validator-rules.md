# Validator rules

Every rule has an id, a severity, a predicate that a unit test can call, and a
failing fixture. Rules are cheap; a render is not. An EDL that reaches the encoder
with an error in it wastes minutes of CPU and a model call, and the user sees a
broken video rather than a sentence explaining what is wrong.

Two kinds of check, never mixed:

- **Validator (structural).** Deterministic, pure, runs before a frame is encoded.
  Rules R01–R39. Errors block; warnings render.
- **Review (perceptual).** Measured on the finished file. Lives in
  `review.checks` and uses its own ten ids (`duration`, `no_black_frames`,
  `no_freeze`, `text_safe_area`, `cta_legible`, `room_order`, `loudness`,
  `no_repeated_shot`, `hook_visible`, `facts_present`).

## Constants

| Name | Value | Note |
|---|---|---|
| `DURATION_TOL` | 0.5 s | 30 s format → 29.5–30.5 s |
| `MIN_SHOT` | 1.2 s | timeline duration, after speed |
| `MAX_SHOT` | 8.0 s | warning at 6.0 s |
| `MIN_CLIP_SRC` | 0.05 s | reject zero-length source windows |
| `TRANSITION_MAX` | 1.5 s | schema cap; over 0.8 s reads as a mistake |
| `BEAT_TOL` | 0.25 s | cut-to-beat deviation |
| `OVERLAY_MIN` | 0.8 s | shorter is unreadable |
| `MAX_OVERLAYS_AT_ONCE` | 3 | more is a wall of text |
| `CTA_MIN` | 1.2 s | and must end in the last 3 s |
| `HOOK_TOL` | 0.02 | hook may lose to the top score by this much |
| `EDGE_MARGIN` | 0.01 | crop centre must stay this far inside the clamp |

## Timeline maths (do this once)

```ts
// canonical timeline: the only place duration is computed
let t = 0;
const flat = edl.clips.map((c, i) => {
  const src = (c.outSec - c.inSec) / c.speed;
  const overlap = i === 0 || c.transitionIn.type === "cut" ? 0 : c.transitionIn.durationSec;
  const start = t - overlap;
  const end = start + src;
  t = end;
  return { clip: c, index: i, start, end, dur: src, overlap, cutAt: start + overlap / 2 };
});
const total = flat.at(-1).end;
```

Round to 3 decimals only on output. Keep doubles during maths: rounding each clip
to 3dp and then summing drifts by up to 0.02 s across nine clips, which is a tenth
of the duration tolerance for nothing.

A dissolve's cut point is the centre of the overlap, not the start. Snapping the
start to a beat puts the visual change half a dissolve late, and on a 0.6 s
dissolve that is 0.3 s — outside the 0.25 s tolerance, before you have done
anything else wrong.

## Rules

| ID | Check | Sev | Fails when |
|---|---|---|---|
| R01 | Schema conformance | error | Ajv (2020-12) rejects; `additionalProperties: false` everywhere |
| R02 | `edlVersion` | error | not exactly `"1.0.0"` |
| R03 | EDL id | error | not `^edl_[a-z0-9-]+_v[0-9]+$`, or `_vN` ≠ `parentId` version + 1 |
| R04 | Counts | error | `clips.length` outside 1–40, `overlays.length` > 30 |
| R05 | Unique ids | error | duplicate clip or overlay id |
| R06 | Sources resolve | error | `src` missing under `raw/`, or `sourceId` ≠ `s_` + first 8 hex of the file's SHA-256 |
| R07 | Source window valid | error | `outSec − inSec < 0.05`, or `outSec > source.durationSec + 0.034` |
| R08 | Speed and gain | error | `speed ∉ [0.5, 2]`, `volumeDb ∉ [−60, 12]` |
| R09 | Transition shape | error | `type = "cut"` with `durationSec ≠ 0`, or `durationSec ∉ (0, 1.5]` for others |
| R10 | Transition unusable | warning | non-cut `durationSec > 0.8` |
| R11 | Crop path shape | error | `path.length ∉ [1,12]`, `t` not ascending, a multi-point path whose first `t ≠ 0` or last `t ≠ 1`, a single point at `t ≠ 0`, or `scale ∉ [1, 2.5]` |
| R12 | Crop path inside frame | error | any centre outside `[fx/2 + 0.01, 1 − fx/2 − 0.01]` (same for y with `fy`) |
| R13 | Canvas matches profile | error | width/height/fps differ from the profile table, or `safeArea` is looser than it (stricter is legal) |
| R14 | Duration | error | `|total − format.targetDurationSec| > 0.5` |
| R15 | Minimum shot | error | any `dur < 1.2` |
| R16 | Long shot | warning | any `dur > 6.0` |
| R17 | Shot count sanity | warning | fewer than 6 clips for a 30 s format |
| R18 | Room adjacency | error | `clips[i].room === clips[i-1].room` and neither is `"unknown"` |
| R19 | Room missing | warning | `room` absent on any clip |
| R20 | Repeated source shot | error | two clips overlap by > 0.25 s in the same source |
| R21 | Duplicate content | error | two clips' shots share a dHash with Hamming ≤ 6 |
| R22 | Hook is top score | error | `clips[0].scoreAtSelection < max(scoreAtSelection) − 0.02` |
| R23 | Hook exists | error | `clips[0].scoreAtSelection` absent, or clip 1 `dur > 4.0` |
| R24 | Hook visible early | warning | a non-logo overlay covers > 30 % of frame width in `0–1.5 s` |
| R25 | Hook not buried | warning | clip 1 `transitionIn` is not a cut or a dissolve ≤ 0.4 s |
| R26 | Overlay window valid | error | `outSec ≤ inSec`, `inSec < 0`, `outSec > total`, duration < 0.8 s |
| R27 | Overlay crowding | error | > 3 overlays overlap at any instant |
| R28 | Overlay text present | error | kind ∈ {price, spec_row, address, cta, room_label} and `text` empty |
| R29 | Overlay text length | error | `text` > 90 chars or `subtext` > 90 chars |
| R30 | Text inside safe area | error | estimated box (§ below) leaves `canvas.safeArea` |
| R31 | CTA closable | error | no `cta` overlay, or it starts after `total − 3`, or shorter than 1.2 s |
| R32 | Style/opacity range | error | `opacity ∉ [0,1]`, `maxWidthPct ∉ [20,100]` |
| R33 | Price matches facts | error | a `price` overlay's text is not a substring of the confirmed fact; never render an AI-guessed figure |
| R34 | Beat snap | error | music has `beatGrid` and any `cutAt` is > 0.25 s from the nearest beat |
| R35 | Beat grid shape | error | not ascending, negative, or > 2400 entries |
| R36 | Loudness target | error | `audio.mix.lufs` not within ±1.0 of the profile target |
| R37 | True peak | error | `audio.mix.truePeakDbtp > −1.0` |
| R38 | Music licence | error | `audio.music.license.source` or `licenseId` missing; `gainDb` > 12 |
| R39 | Provenance | error | `models.tagging`/`models.planning` empty, `promptVersions` empty, `sourceIndexHash` ≠ index hash, or `createdAt` not ISO-8601 |

Beat-driven formats for R34: `social_hook`, `just_listed`, `price_drop`,
`vertical_tour`. Not `room_walkthrough` (paced by speech) and not `cinematic_hero`
(paced by the move). `beatGrid` empty means no beat snapping — not a violation.

## Profile table (R13)

| Profile | Canvas | fps | Loudness |
|---|---|---|---|
| `vertical-social` | 1080×1920 | 30 | −14 LUFS |
| `feed-portrait` | 1080×1350 | 30 | −14 LUFS |
| `pin` | 1000×1500 | 30 | −14 LUFS |
| `landscape` | 1920×1080 | 30 | −16 LUFS |

24 and 60 fps are legal for `landscape` only; delivery platforms re-time anything
else, and re-timed 30 fps vertical footage judders at every pan.

## Safe area (R30)

`vertical-social` values are normative from `docs/CONVENTIONS.md`. The other
profiles use the same ratios of the canvas so one layout survives a profile change.

| Profile | top | bottom | left | right |
|---|---|---|---|---|
| `vertical-social` | 250 | 340 | 60 | 120 |
| `feed-portrait` | 176 | 239 | 60 | 120 |
| `pin` | 195 | 266 | 56 | 111 |
| `landscape` | 60 | 90 | 60 | 60 |

Text box estimator, measured before render and re-measured on the take:

```ts
const FONT = { // px at a 1080-wide canvas, Archivo (ui) / Bricolage Grotesque (display)
  price_lower: { size: 96, advance: 0.58, font: "display", weight: 700, pad: 18 },
  cta_card:    { size: 44, advance: 0.52, font: "ui", weight: 600, pad: 20 },
  spec_pill:   { size: 34, advance: 0.52, font: "ui", weight: 500, pad: 14 },
  address_tag: { size: 32, advance: 0.52, font: "ui", weight: 500, pad: 12 },
  room_label:  { size: 40, advance: 0.50, font: "display", weight: 500, pad: 10 },
  caption:     { size: 40, advance: 0.50, font: "ui", weight: 500, pad: 0 },
  small_print: { size: 24, advance: 0.52, font: "ui", weight: 400, pad: 6 },
};
```

```
scale   = canvas.width / 1080
fs      = FONT[style].size * scale
advance = FONT[style].advance * fs
maxW    = (overlay.maxWidthPct ?? 90)/100 * canvas.width
lines   = ceil(text.length / floor(maxW / advance))
h       = lines * fs * 1.15 + 2 * FONT[style].pad * scale
w       = min(maxW, text.length * advance) + 2 * FONT[style].pad * scale
```

Anchor placement: `top_*` at `y = safeArea.top`, `bottom_*` at
`y = height − safeArea.bottom − h`, `center` at `(height − h)/2`;
`*_left` at `x = safeArea.left`, `*_right` at `x = width − safeArea.right − w`,
`*_center` at `(width − w)/2`. Fail if `x < left`, `x + w > width − right`,
`y < top`, `y + h > height − bottom`.

The advances above are starting values, not gospel: the two faces changed with the
brand, so re-measure them with canvas `measureText` against the bundled woff2 before
trusting a layout. Keep the estimator slightly conservative. The take is measured
with `drawtext` bounds after render, and a text card that fails on the take is far
more expensive than one that was 6 % narrower than it needed to be.

## Fixture policy

One failing fixture per rule, named `fx-r30-text-outside-safe-area.json`, plus one
passing fixture every ten rules. Fixtures live next to the validator and are
schema-valid by default — fixtures that fail R01 test Ajv, not the rule under test.
Every rule also gets a one-line `message` and a `fix` string; the test asserts both
are non-empty, because an error the UI cannot render is an error the user cannot
act on.

Reviewed yearly against the platform chrome that produced the safe areas. Platforms
change their bars; the numbers in `docs/CONVENTIONS.md` are the contract, and this
file must match it or be corrected.
