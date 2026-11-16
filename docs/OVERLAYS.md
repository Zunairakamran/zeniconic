# Overlays

The renderer currently produces picture only. A listing video is not finished until
the price, address, logo and captions are on it. This is the spec for that layer.

## Why Remotion, not drawtext

FFmpeg's `drawtext` cannot do multi-line layout with a measured box, cannot animate
without a filter graph per frame, and cannot reuse the design tokens. Remotion renders
a React composition frame by frame, so the overlay you see in the mockup is the code
that ships.

**Licence:** free for individuals and companies up to 3 people; otherwise $25/seat/month
or $0.01/render with a $100/month minimum. Confirm the agency's size before shipping.

## Composition contract

One composition per aspect, driven by the EDL:

```tsx
<Composition
  id="zeniconic"
  component={VideoComposition}
  durationInFrames={Math.round(edl.format.targetDurationSec * fps)}
  fps={fps}
  width={canvas.width}
  height={canvas.height}
  defaultProps={{ edl, profile, brand, captions }}
/>
```

- **No data fetching, no clock, no randomness.** Every frame is a pure function of
  `frame`, the EDL, and the brand kit.
- Times map to frames with `Math.round(seconds * fps)`; never rely on CSS transitions
  for timing that must be exact.
- Source media is referenced by absolute path through `staticFile` or an input prop;
  never copied into the bundle.

## Layer order

1. **Clip layer** — one `OffthreadVideo` per EDL clip, trimmed to `inSec`/`outSec`,
   with the crop transform. Clips are absolutely positioned; transitions are short
   opacity/translate layers, never crossfades longer than 1.5 s.
2. **Scrim layer** — only where text needs it. A bottom gradient at 0–35% opacity,
   full width, behind lower thirds. Never a global dark overlay.
3. **Overlay layer** — text, price, logo, permit line.
4. **Caption layer** — burned word-level captions.
5. **Safe-area debug layer** — dev only, never in a render.

## Text styles

Sizes are specified at a 1080-wide canvas and scaled by `canvas.width / 1080`.

| Style | Font | Size | Weight | Notes |
|---|---|---|---|---|
| `price_lower` | Bricolage Grotesque | 96 | 650 | Bottom centre, subtext for beds/baths/sq ft |
| `spec_pill` | Archivo | 34 | 600 | Row of pills, max 3 |
| `address_tag` | Archivo | 32 | 600 | Bottom left, wide tracking, small caps |
| `logo_corner` | SVG | 120 px wide | — | Top left, 34% max width |
| `cta_card` | Bricolage Grotesque | 44 | 650 | End card only |
| `caption` | Archivo | 40 | 600 | Two lines max, 32 chars per line |
| `small_print` | Archivo | 24 | 400 | Permit/disclaimer, 55% opacity |
| `permit_line` | Archivo | 22 | 500 | `Permit No. 12345 · ORN 67890`, optional |

All text is measured before placement with the same `estimateTextBox` used by the
validator, then placed with `placeOverlay`. If it does not fit, the render refuses
rather than clipping.

## Safe areas

Vertical (`1080×1920`): top 250, bottom 340, left 60, right 120. The **right** margin is
the larger one because of platform action buttons; the layout must not centre text
blindly. Feed (`1080×1350`): 180/220/60/60. Landscape (`1920×1080`): 60/90/60/60.

Captions sit at `y = height − safeArea.bottom`, left-aligned at `safeArea.left`, and
never wrap past `width − safeArea.right`.

## Animation

| Animation | Behaviour |
|---|---|
| `fade` | 0 → 1 over 240 ms, no movement |
| `rise` | 12 px up + fade over 320 ms |
| `slide_in` | 24 px from the anchor side over 280 ms |
| `count_up` | number counts from 0 to value over 600 ms, then holds |
| `none` | static |

Animations start at `inSec`, end 0 ms before `outSec` starts fading. Nothing animates
during the last 200 ms of the video; the end card holds.

## Captions

- One line at a time is too slow; two lines maximum.
- Words come from `captions.words` with exact timings; the caption layer highlights
  the active word only if the style enables it.
- Arabic: `direction: rtl`, an Arabic-capable font, mirrored padding, no letter
  spacing. The DOM order is not reversed manually.
- Burned captions are part of the picture; an `.srt` sidecar can also be exported.

The full customisation contract — fonts, presets, animation, backing, per-variant
overrides and the schema 1.1 style object — lives in `docs/CAPTIONS.md`.

## Brand kit

```ts
interface BrandKit {
  agentName: string;
  agency: string;
  orn?: string;            // Dubai broker registration, optional
  logo?: string;           // SVG path
  colours: { brass: string; ink: string; paper: string };
  fontDisplay: string;     // bundled woff2 id
  fontUi: string;
}
```

Fonts are bundled as woff2 in `apps/render/fonts`; `FONT_BUNDLE_HASH` participates in
the render cache key. No CDN request is ever made.

## Render seam

Remotion renders **picture + burned captions** to a silent MP4. FFmpeg then muxes the
mastered audio (music + voice, loudnorm applied) and sets `+faststart`. This split keeps
loudness and ducking in one place and lets a chat edit re-render only the overlay layer
when the audio did not change.

Draft renders run at 0.5 scale with `chromiumOptions` reuse; final renders use
`concurrency = max(1, cores/2)`.

## Test plan

1. **Still snapshots** — for every overlay style, render one frame and compare against
   a committed PNG at 1080 wide. Catches text overflow and font fallback.
2. **Safe-area assertion** — the same geometry checks as `placeOverlay`, run against
   computed boxes in the composition.
3. **Duration** — rendered frame count equals `round(targetDuration * fps)`.
4. **Arabic** — one fixture with RTL captions and an Arabic voice script.
5. **No network** — run with the adapter offline; any font or asset request fails the test.

## Open questions

- Whether the price card should use `count_up` on every variant or only the first —
  default: only the hero variant, to avoid repetition across a batch.
- Whether the permit line is on by default in Dubai. Default: **off**; marketing owns
  compliance, and the field is one toggle in export.
