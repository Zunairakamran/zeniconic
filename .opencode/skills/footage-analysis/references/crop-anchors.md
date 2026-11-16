# Crop anchors — from `subject_bbox` to an EDL crop path

The tagger returns one `subject_bbox` per sheet frame, in **padded-tile**
coordinates. The EDL wants `transform.focus` plus `transform.path`: a list of up to
12 `{t, x, y, scale}` crop-window centres in source-normalised space, `t` relative
to the clip (0..1). This file is the conversion, including the two places it goes
wrong.

## 1. Inputs

- `frames[i].subject_bbox = [x, y, w, h]`, fractions of the 512×512 tile, origin
  top-left, `x+w ≤ 1`, `y+h ≤ 1`.
- Tile content size `(cw, ch)` and pad offset `(ox, oy)` in the 512 square:
  `s = 512 / max(srcW, srcH)`, `cw = round(srcW·s)`, `ch = round(srcH·s)`,
  `ox = (512−cw)/2`, `oy = (512−ch)/2`.
- Frame times `t_i = i / 5` of the shot, snapped to `round(t_i · fps) / fps` so the
  extraction is reproducible.

Sanity gate: a bbox wider than 0.98 of the tile, or whose area is under 1 %, is
treated as "no subject" rather than a real anchor. Both happen when the model
returns corner coordinates or a degenerate box.

## 2. Un-pad (the most common error)

```
cx_src = ((x + w/2)·512 − ox) / cw      // 0..1 across the source frame
cy_src = ((y + h/2)·512 − oy) / ch
hw_src = (w·512) / cw
hh_src = (h·512) / ch
```

A 16:9 source gets `cw = 512, ch = 288, oy = 112`. A bbox reported at tile
`y = 0.40` is **inside the picture**, while `y = 0.10` is in the grey bar and must
be clamped to the picture, not trusted as "subject near the top". Skipping this
step shifts every anchor up by 22 % of the frame on landscape sources — which
presents as crops that cut the ceiling and leave the floor.

Clamp: `cx ∈ [0,1]`, `cy ∈ [0,1]`. If the raw bbox centre fell inside a pad bar
by more than half its height, discard that frame's anchor and fall back to the
shot median.

## 3. Cover-crop geometry

Cover means the crop window is the largest rectangle of the canvas aspect that fits
in the source. With source `W×H` and canvas aspect `rc = canvasW/canvasH`:

```
r_s = W / H
if r_s > rc:  cropH = H, cropW = H·rc        // source wider: crop width
else:         cropW = W, cropH = W / rc      // source taller: crop height
fx = cropW / W        // fraction of source width visible
fy = cropH / H
```

Valid centre range: `x ∈ [fx/2, 1 − fx/2]`, `y ∈ [fy/2, 1 − fy/2]`. Clamp after
smoothing, never before — clamping an unsmoothed path produces a wall-slide.

For a 1920×1080 source:

| Profile | Canvas | `fx` | Visible px | Upscale to fill | Verdict |
|---|---|---|---|---|---|
| `vertical-social` | 1080×1920 | 0.316 | 608×1080 | 1.78× | soft; 4K preferred |
| `feed-portrait` | 1080×1350 | 0.450 | 864×1080 | 1.25× | acceptable |
| `pin` | 1000×1500 | 0.375 | 720×1080 | 1.39× | acceptable |
| `landscape` | 1920×1080 | 1.000 | 1920×1080 | 1.00× | no crop; ignore path |

**Rule:** for `vertical-social`, a source narrower than 2560 px will upscale by
more than 1.35×. Prefer `transform.mode = "pad_blur"` for those sources, or cut
the shot from the widest available clip. This is a decision the planner makes; the
anchor generator only reports `upscale` so the planner can make it.

For a 3840×2160 source, `fx = 0.316` gives 1215×2160 visible, downscaled to 1080 —
sharp. Phone footage shot in portrait (1080×1920) on a `vertical-social` canvas has
`r_s = 0.5625 = rc`, so `fx = 1`: no crop at all, and the path collapses to a
single point. Detect this case and emit one keyframe; a path with three identical
points is noise in the EDL and a wasted interpolation.

## 4. Path generation

1. Collect up to six anchor centres `(cx_i, cy_i)` and subject heights `hh_i`.
2. Convert each `t_i = i/5` to clip-relative time; drop anchors whose shot frame
   is outside the trimmed `inSec..outSec` window and re-normalise `t` to the trim.
3. **Deadband.** If the spread of `cx` (max−min) is under 0.02, collapse x to the
   mean. Same for y. A subject that does not move must not produce a floating
   camera; ±2 % drift is invisible in the anchor and visible as seasick motion in
   the render.
4. **Spike guard.** If one anchor is more than 0.18 from the median of its
   neighbours, replace it with the interpolation of its neighbours. One bad bbox
   out of six otherwise produces a lurch at 60 % of the shot.
5. **Smooth.** Exponential moving average, `α = 0.35`, forwards then backwards, so
   the path does not lag the subject at either end.
6. **Velocity clamp.** Limit centre movement to 0.12 of the frame per second
   (`0.004` per frame at 30 fps). A crop that outruns the subject reads as a pan
   the camera operator did not make.
7. **Clamp** to the valid range from §3.
8. **Reduce.** Ramer–Douglas–Peucker, `ε = 0.015`, then cap at 12 points by
   dropping the point whose removal adds least error. For two or more points keep
   `t = 0` and `t = 1`; a single-point path is legal only at `t = 0`, and round
   `t` to 3dp.
9. **Zoom.** `scale = clamp(1 + 0.6·(1 − median(hh)), 1.0, 1.6)`. A subject filling
   60 % of the frame gets 1.24; a whole-room wide gets 1.0. Never exceed 1.6 on
   `vertical-social` — beyond that the upscale plus crop is mush, and the schema
   allows 2.5 for stills-driven formats that this skill does not generate.

Output per clip: 1 keyframe for a static shot, 3–5 for a walkthrough. If you emit
more than 6, the smoothing or the spike guard failed.

## 5. Focus fallback ladder

`transform.focus` is the coarse answer; `path` refines it. Pick focus first:

| Condition | `focus` |
|---|---|
| Any usable anchor, movement under 0.08 | `saliency` |
| Anchors all left of 0.35 | `left` |
| Anchors all right of 0.65 | `right` |
| Anchors above 0.40 (ceiling detail, chandelier) | `top` |
| Anchors below 0.60 (floor, rug, pool) | `bottom` |
| No anchors, or `room = "view"` with no subject | `center` |

`pad_blur` and `contain` do not crop, so the path is irrelevant: emit a single
`{t:0, x:0.5, y:0.5, scale:1}` and spend nothing on anchoring. Do not omit the
field — `path` has `minItems: 1`.

Drone shots: anchor y to 0.45 fixed and let x follow the subject. The horizon is
the subject in an aerial, and a bbox that tracks a house will tilt the horizon
until it looks like a mistake.

## 6. Verification

1. **Draw it.** Overlay the crop rectangle on the six sheet frames as PNG and look
   at it. This takes 20 seconds and catches every failure in §7. Never ship a path
   you have not drawn.
2. **No wall-slide.** Centre must be ≥ `fx/2 + 0.01` from both x edges in every
   keyframe. An anchor pinned to the clamp is a warning, not a success.
3. **Headroom.** Where the subject is a person or a piece of furniture, keep ≥ 0.06
   of frame height above the bbox top unless `room = "exterior"`. Cutting a
   pendant light in half is the classic tell of a bad vertical crop.
4. **Reversibility.** Applying the path to the preview and then to the render must
   produce the same crop centres to 3dp. Both read the same EDL; if they diverge,
   one of them is recomputing from the bbox instead of from the EDL.
5. **Coverage.** `path.length ≤ 12`, `t` ascending, first `0.000`, last `1.000`,
   `scale ∈ [1, 2.5]` — the schema will reject otherwise and the failure arrives at
   render time, which is the expensive place.

## 7. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Crop sits high, feet cut | pad offset ignored (§2) | un-pad, then clamp |
| Crop drifts while subject is still | no deadband | deadband 0.02 |
| One lurch mid-shot | bad bbox not guarded | spike guard 0.18 |
| Crop hits frame edge and stays | clamp applied before smoothing | smooth first |
| Crop pans faster than the subject | no velocity clamp | 0.12/s |
| Soft result on a 1080p horizontal clip | 1.78× upscale in `vertical-social` | `pad_blur`, or prefer 4K |
| Horizon tilted on drone | y tracks the house | y anchored 0.45 |
| Two subjects, crop on neither | bbox is the union of both | use the union centre, confidence ≤ 0.5 |
