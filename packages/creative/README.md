# @zeniconic/creative

A deterministic, explainable creative-director pass over an already-planned
`Edl`. It does not re-plan, re-analyse, render, or touch the pipeline. The main
agent calls `direct()` after planning.

```ts
import { direct } from '../../packages/creative/src/index';

const { edl, rationale } = direct(planned, {
  beatGrid: planned.audio.music.beatGrid,
  gradePreset: 'luxury',
});
```

`edl` is always valid (`validateEdl`), keeps every clip exactly once, and keeps
the input runtime. `rationale` explains every purpose, motion, transition,
grade, effect and beat-snap decision, plus the limitations of the pass.

## What it does

1. **Purpose** — classifies each shot from `room` + duration:
   `hook | establishing | space | craft | detail | rest | lifestyle | feature | close`.
2. **Hook** — values view/exterior/living, measured score and motion, then
   prefers a shot that is not the longest and still has push-in headroom. The
   hook is always first.
3. **Narrative order** — hook → establishing/space → craft/detail → rest →
   lifestyle/feature → close. Buckets are stable; within a bucket the picker
   avoids repeating the previous room. The close avoids repeating the room just
   before it when a reasonable alternative exists.
4. **Motion** — varied push-ins, pull-outs and pans; saliency is only claimed
   for craft/detail rooms, wides stay centred.
5. **Transitions** — only at earned boundaries (hook out, into rest, price/CTA,
   into close, one midpoint lift), capped at 40% of boundaries by default.
   Same-room and fast beats stay cuts. `handleOutSec` is set to the transition
   length so `xfade` borrows instead of shortening the film.
6. **Grade** — a preset only (`luxury` / `natural` / `vivid` …) plus small
   explicit parameters. No LUT file is invented.
7. **Effects** — at most three clips get a low-strength vignette/grain/sharpen.
8. **Beats** — an optional grid pulls nearby cuts earlier onto the beat by
   trimming the outgoing clip and extending the incoming one; runtime is
   unchanged. A later beat is refused because it would need source past the
   known out point.
9. **Validation** — invalid input is refused with `CreativeError`; an invalid
   output is never returned.

## `marketing_38`

With `preserveMarketingStructure` (default `true`) the planned clip order,
overlay windows and existing beat-sheet transitions are kept. The pass only
strengthens the hook's motion, adds a close transition if it fits, and applies
the grade/effects. Set `preserveMarketingStructure: false` to let the narrative
ordering run (overlays then no longer track their original shots unless
`remapOverlays: true`).

## Options

| option | default | effect |
| --- | --- | --- |
| `beatGrid` | `audio.music.beatGrid` | beats in timeline seconds |
| `beatToleranceSec` | `0.08` | max pull onto a beat (0.02–0.25) |
| `snapBoundaries` | on when a grid exists | pull cuts onto nearby beats |
| `gradePreset` | from `look` | override or `'none'` |
| `gradeIntensity` | `0.8` | 0..1 |
| `addEffects` | `true` | three-clip texture budget |
| `addTransitions` | `true` | may be turned off entirely |
| `maxTransitionRatio` | `0.4` | share of boundaries with a non-cut |
| `borrowHandles` | `true` | set `handleOutSec` to keep runtime |
| `preserveMarketingStructure` | `true` | keep `marketing_38` order/overlays |
| `remapOverlays` | `false` | re-anchor overlays to their original clip |
| `minClipSec` | `0.4` | guard for boundary snapping |

## Limitations

- Purposes use only room and duration; no facts are inferred.
- Clip ids stay attached to their clips; the narrative order is the `clips`
  array order, not `c01…` order.
- Overlays remain on absolute timeline seconds by default, so a price card
  keeps its late slot even when the shot under it changes.
- `handleOutSec` assumes the source has picture past `outSec`; the renderer
  falls back to shortening that cut if it does not.
- Beat snapping only moves cuts earlier.
- Marketing beat snapping is disabled so price/CTA windows keep their cuts.
