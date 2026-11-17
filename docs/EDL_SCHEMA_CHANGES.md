# EDL v2 — schema changes and migration

Status: contract for the capability/agent work. Implementation lives in
`packages/edl`; this file is the authority for shape, defaults and validation.

## Principles

1. **Additive.** A v1.0.0 document must validate after migration and render
   byte-identically when it carries no new fields. Nothing existing is renamed.
2. **One representation.** Effects, grades, captions and transitions are EDL
   data. The capability registry mutates the EDL; the render plan lowers it.
3. **Closed enums.** Every effect/transition/text-animation type in the schema
   must have a real renderer. Adding a type is a schema change plus a renderer
   plus tests — never a promise.
4. **Deterministic.** No timestamps or ids inside effect payloads beyond the
   clip/effect ids the planner already assigns.

## New root fields (all optional)

```ts
interface Edl {
  // ...v1 fields unchanged
  output?: {
    width?: number;          // 320..7680
    height?: number;         // 320..7680
    fps?: number;            // 12..60
    videoBitrate?: string;   // /\d+[kM]$/
    audioBitrate?: string;   // /\d+k$/
  };
  effects?: Effect[];        // timeline-global effects
  grade?: ColorGrade;        // global grade, applied after clip grade
}
```

## Effect

```ts
type EffectType =
  | 'blur' | 'motion_blur' | 'glow' | 'grain' | 'vignette' | 'sharpen'
  | 'chromatic_aberration' | 'saturation' | 'exposure' | 'contrast'
  | 'lut' | 'stabilize';

interface Effect {
  id: string;                // e1, e2… per document
  type: EffectType;
  /** 0..100 strength for types that have one; type-specific defaults below. */
  amount?: number;
  /** Optional limited window on the timeline. Defaults to the whole clip. */
  inSec?: number;
  outSec?: number;
  /** Free-form, type-specific; validated per type and rejected if unknown. */
  params?: Record<string, number | string | boolean>;
  enabled?: boolean;         // default true
}
```

Per-type params (validated in `validate.ts`):

| type | params | bounds |
|---|---|---|
| blur | `sigma` | 0..50 |
| motion_blur | `angle`, `length` | angle 0..360, length 1..100 |
| glow | `sigma`, `intensity` | sigma 0..40, intensity 0..1 |
| grain | `strength` | 0..1 |
| vignette | `angle` | 0..1 (0 = off) |
| sharpen | `amount` | 0..3 |
| chromatic_aberration | `offset` | 0..20 px |
| saturation | `value` | 0..3 (1 = neutral) |
| exposure | `value` | -3..3 EV |
| contrast | `value` | 0..3 (1 = neutral) |
| lut | `path` | repo-relative `.cube` under `data/luts/` |
| stabilize | `shakiness`, `accuracy` | 1..10 |

`lut` paths are resolved by the renderer against the repo/data root and must
stay inside it; the schema only allows `^[A-Za-z0-9._/-]+\.cube$` (no `..`).

## ColorGrade

```ts
interface ColorGrade {
  preset?: 'none' | 'warm_cinematic' | 'cool_cinematic' | 'luxury'
         | 'natural' | 'vivid' | 'noir';
  exposure?: number;      // -2..2
  contrast?: number;      // 0.5..2
  saturation?: number;    // 0..2
  temperature?: number;   // -1..1 (blue → warm)
  tint?: number;          // -1..1 (green → magenta)
  highlights?: number;    // -1..1
  shadows?: number;       // -1..1
  vibrance?: number;      // -1..1
  lut?: string;           // same rule as effect.lut
  intensity?: number;     // 0..1, blends the grade
}
```

A preset expands to parameters in the renderer; explicit fields override the
preset. `grade` on a clip overrides the root grade for that clip.

## Clip additions

```ts
interface Clip {
  // ...v1 fields unchanged
  effects?: Effect[];       // clip-scoped
  grade?: ColorGrade;       // clip-scoped
  speedRamp?: SpeedPoint[]; // 2..8 points, replaces the scalar `speed`
}

interface SpeedPoint {
  /** Normalised position inside the clip's source window, 0..1, strictly increasing. */
  t: number;
  /** 0.25..4. Timeline duration = Σ (segmentSource / speed). */
  speed: number;
}
```

Rules:

- If `speedRamp` is present, `speed` must be `1` (the ramp is authoritative) and
  the first/last points must be `t = 0` and `t = 1`.
- The ramp's computed timeline duration must equal
  `(outSec - inSec) / speed` within 0.05 s. The `speed_ramp` capability solves
  for the clip window; the validator rejects drift so preview and export agree.
- `speedRamp` is rendered by splitting the clip at each point and concatenating
  the sub-segments, so the validator's duration math is the renderer's math.

## Transition palette (v2)

Existing: `cut | dissolve | slide | whip | zoom_blur | luma_wipe | light_leak`.

Added, each verified against the bundled `ffmpeg-static` `xfade` list:

`dip_black` → `fadeblack`, `dip_white` → `fadewhite`, `blur` → `hblur`,
`directional_blur` → `vblur`, `push_left` → `slideleft`, `push_right` →
`slideright`, `circle` → `circleopen`, `wipe` → `wipeleft`, `glitch` →
`pixelize` (approximation, documented).

If the bundled FFmpeg lacks a name, the graph builder falls back to the
documented alternate and emits a warning. Never silently substitutes.

## Captions

```ts
interface Captions {
  mode: 'burn' | 'sidecar' | 'both' | 'none';
  style?: CaptionStyle;
  language?: string;
  words?: CaptionWord[];
  /** v2 */
  animation?: TextAnimation;
  highlight?: { color?: string; words?: string[] };
  font?: { family?: string; weight?: number; sizePx?: number; uppercase?: boolean };
  box?: { color?: string; opacity?: number; radiusPx?: number };
  position?: { anchor?: 'bottom_center' | 'center' | 'top_center'; offsetPx?: number };
  maxWordsPerLine?: number;   // 1..8
  maxLines?: number;          // 1..3
}

type TextAnimation =
  | 'none' | 'fade' | 'rise' | 'slide_in' | 'pop'
  | 'typewriter' | 'word_by_word' | 'tracking_in' | 'blur_in' | 'scale_in';
```

## Overlays

```ts
interface Overlay {
  // ...v1
  animation?: 'none' | 'fade' | 'rise' | 'slide_in' | 'count_up'
             | 'pop' | 'typewriter' | 'tracking_in' | 'blur_in' | 'scale_in';
  exitAnimation?: 'none' | 'fade' | 'slide_out';
  font?: { family?: string; weight?: number; sizePx?: number };
  color?: string;          // #RRGGBB
  background?: { color?: string; opacity?: number; radiusPx?: number };
  rotation?: number;       // -180..180
  keyframes?: OverlayKeyframe[];
}

interface OverlayKeyframe {
  t: number;               // 0..1 within the overlay window
  x?: number; y?: number;  // 0..1 of the canvas
  scale?: number;          // 0.1..4
  opacity?: number;        // 0..1
  rotation?: number;       // -180..180
}
```

## Audio

```ts
interface Audio {
  // ...v1
  fadeInSec?: number;      // 0..5
  fadeOutSec?: number;     // 0..5
}
```

## Versioning and migration

- `EDL_VERSION = '2.0.0'`; `edlVersion` accepts `1.0.0` only through
  `migrateEdl`, which sets `2.0.0` and leaves all other fields untouched.
- `validateEdl` accepts 1.0.0 documents (validated with the v1 rules) and
  returns `2.0.0` issues for v2 fields. Writing always migrates.
- Untouched v1 files on disk remain readable; variants/versions are migrated on
  next write.
- `migrate.ts` gains `migrateEdl(unknown): Edl` with a stable, tested mapping and
  a `E_VERSION` error for unknown majors.

## Validation additions (stable codes)

`E_EFFECT_TYPE`, `E_EFFECT_PARAM`, `E_EFFECT_RANGE`, `E_GRADE_RANGE`,
`E_SPEED_RAMP`, `E_SPEED_RAMP_DURATION`, `E_CAPTION_STYLE`, `E_TEXT_ANIMATION`,
`E_OVERLAY_KEYFRAME`, `E_OUTPUT_RANGE`, `E_LUT_PATH`.

Cross-field rules:

- effect windows inside the clip (or timeline for root effects), positive length.
- effect ids unique within their scope.
- speedRamp points strictly increasing, first 0, last 1, duration within 0.05 s.
- caption `highlight.words` must be a subset of the words present in cues.
- `maxWordsPerLine`/`maxLines` consistent with the cue builder (defaults 6/2).

## Render lowering (contract with packages/render)

`compileRenderPlan(edl, profile, quality)` returns per-clip FFmpeg filter
chains and, for Remotion-owned text, typed props. Effect order is:
trim → speed/ramp → scale/crop/transform → spatial effects (blur, sharpen,
chromatic) → color (grade, LUT, exposure/contrast/saturation) → temporal
(grain, vignette, glow) → fps/format. Documented once; tests pin the order.

Effects not supported by a backend cause a validation error naming the effect,
never a silent drop. `marketing_38` goes through the same lowering, with its
fast FFmpeg profile.

## Migration strategy (code order)

1. Schema + types + migrate + validator tests (v1 fixtures still pass).
2. Renderer lowering for the supported subset; byte-identical output for
   documents without v2 fields (snapshot test).
3. Capability handlers that write v2 fields.
4. Chat allow-list/tree extended to the new paths.
5. Agent tools.
