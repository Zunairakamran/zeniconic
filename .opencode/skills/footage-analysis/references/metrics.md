# Metrics — formulas, thresholds, calibration

Every number comes from one stream. Change a definition and you bump
`pipelineVersion`; `thresholdsHash` in the index is the SHA-256 of §2, so a stale
index is detectable rather than mysterious.

## 1. Frame contract

```
160×90, 8-bit grey, 10 fps, rawvideo on stdout, 14 400 bytes/frame, no header
```

144 kB/s of pipe; a 41 s 1080p clip is 410 frames, 5.9 MB. On a 4-core laptop with
no GPU this runs 4–8× realtime, dominated by H.264 decode: 8–15 s per 60 s 1080p30
clip, 2–4 min per 12-clip listing. 160×90 is a cost decision — a full 1080p grey
pipe is 1.3 GB/s of memory traffic before any arithmetic. `flags=area` is a box
filter: right for exposure and motion, but it compresses the Laplacian (§5).

```bash
ffmpeg -hide_banner -nostdin -nostats -loglevel info -threads 0 -i "raw/kitchen.mp4" \
  -filter_complex "[0:v]fps=10,scale=160:90:flags=area,format=gray[v];[0:a]ebur128=peak=true:metadata=1[a]" \
  -map "[v]" -f rawvideo -pix_fmt gray pipe:1 \
  -map "[a]" -f null -
```

Drop the audio graph when `ffprobe` reports no audio: `[0:a]` on a silent input
aborts the command. Keep `-loglevel info` — `ebur128` prints there, so `-loglevel
error` silently loses every loudness number. Read exactly 14 400-byte frames: stdout
chunks do not align, so accumulate, slice, keep the remainder, and pause above 64
queued frames — a 4-minute 4K clip would otherwise buffer 350 MB.

## 2. Summary

| Metric | Range | Aggregation | Starting threshold | Calibrated by |
|---|---|---|---|---|
| Shot boundary | bool/frame | — | adaptive, floor 6.0 | `scdet` cross-check |
| Shake | 0–1 | p90 per shot | usable ≤ 0.045 | hand labels |
| Sharpness | 0–1 | median per shot | acceptable ≤ 0.62 | blur ladder (§5) |
| Clip % | 0–1 | p95 per shot | white ≤ 0.12, black ≤ 0.18 | hand labels |
| Liveliness | 0–1 | mean per shot | hook 0.02–0.12 | format audits |
| Colourfulness | 0–1 | median | no gate, ranking only | Hasler–Süsstrunk |
| Freeze | seconds | max run | flag ≥ 0.80 s | `freezedetect` |
| Duplicate | 64-bit | per shot | Hamming ≤ 6 | labelled pairs |

Audio rides the same pass — `ebur128` gives LUFS and true peak per source, because
planning must know a clip is at −9 LUFS before stacking music on it. Voice quality is
not measured here; that belongs to `audio-restoration`.

## 3. Shot boundary

```
mad[t] = (1/14400)·Σ|F[t][i] − F[t−1][i]|          // 0..255
med    = median(mad[t−15 … t−1])                    // 1.5 s window
dev    = 1.4826·median(|v − med|)                   // robust sigma
thr    = clamp(med + 4·dev, 6.0, 40.0)
cut    = mad[t] > thr and t − lastCut ≥ 3 frames and stable(t+1 … t+5, thr/2)
```

Confirmation rejects flashes, whips and switched lights. Robust statistics because a
fast pan inflates a plain window mean, so a fixed threshold either misses cuts during
movement or fires on every pan: the 6.0 floor is 2.4 % of range (a static tripod frame
never reaches it) and the 40.0 ceiling stops the detector going deaf after a strobe.
A slow cross-dissolve scores below threshold and becomes one long shot, which is
correct for planning: you cut inside it. A drone reveal over a ridge can exceed 40.0
— the known false cut, cured only by the dev `-only-cuts` review. Afterwards, merge
shots under 0.4 s into the previous, drop shots under 0.6 s, assign ids in order.

## 4. Shake and pan

```js
let best = Infinity, bdx = 0, bdy = 0;
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
  let s = 0, c = 0;
  for (let y = 4; y < 86; y += 2) for (let x = 4; x < 156; x += 2) {
    s += Math.abs(b[y*160 + x] - a[(y+dy)*160 + (x+dx)]); c++;
  }
  if (s / c < best) { best = s / c; bdx = dx; bdy = dy; }
}
// shake = best/255;  panX = bdx, panY = bdy   (px/frame at 160×90, 10 fps)
```

Residual after the best shift is what translation cannot explain: wobble,
rolling-shutter jitter, subject motion. 49 shifts × 2 888 samples ≈ 141 k
comparisons per frame; 410 frames is 0.06 s of CPU.

Aggregate `shake = p90(residual)` — a stabiliser hunting mid shot produces two or
three spikes, exactly what the planner must avoid. Median `panX/panY` gives the
intentional move; `|pan| > 1.2 px/frame` is a pan, and its sign is a prior for the
tagger, never an override of `camera_move`. Bands: ≤ 0.045 usable, 0.045–0.075 only
if the shot is the sole representative of its room, > 0.075 reject. A 1.0 m/s gimbal
walk measures 0.02–0.03 after the shift search; handheld at chest height 0.06–0.11.

## 5. Blur (variance of Laplacian)

```js
let s = 0, s2 = 0, c = 0;
for (let y = 1; y < 89; y++) for (let x = 1; x < 159; x++) {
  const i = y*160 + x;
  const v = 4*F[i] - F[i-1] - F[i+1] - F[i-160] - F[i+160];
  s += v; s2 += v*v; c++;
}
const lapVar = s2/c - (s/c)**2;
sharpness = 1 - clamp01((Math.log1p(lapVar) - Math.log1p(LO)) / (Math.log1p(HI) - Math.log1p(LO)));
```

`LO = 25`, `HI = 220` are starting points and **must** be re-derived per camera
class: take a known-sharp frame, apply `gblur=sigma=0,1.5,3,6,12`, downscale to
160×90, fit `HI` at σ=0 and `LO` at σ=6. Phone and full-frame differ by ~2×.

The box downscale compresses the distribution, so this is a **ranking signal, not a
verdict**. Confirm on the contact-sheet PNGs: `blurdetect` runs once per shot at
512 px, stored as `sharpness512`; disagreement over 0.35 means trust that. Exclude
frames with `|pan| > 1.5 px/frame` from the median, or the listing's best transition
shot — a fast pan across a hallway — gets rejected as motion blur.

## 6. Exposure clipping

Per frame, count pixels `≤ 8` (crushed) and `≥ 247` (blown), divide by 14 400,
aggregate p95 per shot — one blown doorway frame is normal, 30 % of frames blown is
not.

| Condition | Gate | Relaxation |
|---|---|---|
| Blown (white) | ≤ 0.12 | `room ∈ {view, exterior, balcony}`: ×2 (sky may clip) |
| Crushed (black) | ≤ 0.18 | `room = exterior`: ×1.5 (night shots) |
| Both, same shot | ≤ 0.10 combined | none — that is an exposure failure |

`clipPct = max(white, black)` feeds the score blend. Above 0.35 it is a defect
(`blown_windows`, `crushed_shadows`) whatever the model said.

## 7. Motion energy

```
liveliness = mean over frames of sqrt((1/14400)·Σ(F[t] − F[t−1])²) / 255
```

RMS, not mean absolute: RMS weights large changes harder, so a whip reads as energy
and sensor grain does not. Bands: tripod 0.004–0.012, gimbal walk 0.020–0.055,
handheld walkthrough 0.045–0.110, drone orbit 0.070–0.160, whip/sprint > 0.200. Hooks
want 0.02–0.12 — a static first frame reads as a still and gets scrolled; over 0.20
belongs at the end, if anywhere.

## 8. Colourfulness and freezes

Hasler–Süsstrunk on the six contact-sheet frames — the only metric needing chroma,
because the pipe is grey:

```
rg = R − G,  yb = ½(R + G) − B
M  = sqrt(σ_rg² + σ_yb²) + 0.3·sqrt(μ_rg² + μ_yb²)
colourfulness = clamp01((M − 10) / 90)
```

Grey wall ≈ 8, interior 35–55, saturated garden ≈ 90, neon exterior ≈ 120. No gate;
it breaks ties and carries 0.10 of the quality blend. Monochrome sources score 0.01.

Freeze: over a 5-frame window, `mad < 0.35` **and** `shake < 0.002` **and**
`|exposure(t) − exposure(t−5)| < 0.5 %`; runs ≥ 0.8 s are `freezeSec`. The one real
divergence is grain on a frozen frame (`mad` 0.4–0.8): trust
`freezedetect=n=0.001:d=0.8`, lower the JS floor to 0.6, and re-run the golden
fixture first.

## 9. Duplicate shots

64-bit dHash on the middle contact-sheet frame: 9×8 grey, `bit = (left > right)`.
Hamming ≤ 6 is the same take — a re-shoot, or one clip imported twice. Required by
validator R21 (`no_repeated_shot`) and by planning, which must not show the same
kitchen twice in 30 s.

## 10. Defect penalties

| Defect | Penalty | Defect | Penalty |
|---|---|---|---|
| `visible_person` | 0.25 | `underexposed` | 0.12 |
| `watermark` | 0.20 | `reflection` | 0.10 |
| `motion_blur` | 0.15 | `distracting_object` | 0.10 |
| `soft_focus` | 0.15 | `cluttered` | 0.08 |
| `construction` | 0.15 | `tilted_horizon` | 0.08 |
| `blown_windows` | 0.10 | `lens_flare` | 0.05 |
| `crushed_shadows` | 0.10 | | |

Sum, capped at 0.45 so five cosmetic flaws do not score below a genuinely unusable
shot: the planner's floor is 0.20 and a bottomless scale destroys ordering.

## 11. Dev cross-checks, one clip at a time

```bash
ffmpeg -i in.mp4 -vf "scdet=threshold=10,metadata=print" -an -f null -   # cuts
ffmpeg -i in.mp4 -vf "blackdetect=d=0.2:pix_th=0.10" -an -f null -      # black
ffmpeg -i in.mp4 -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG" -an -f null -
```

Never in the production path — each is a second decode. `blackdetect` is ground
truth for `no_black_frames`; `signalstats` `YAVG`/`YHIGH` settles exposure when the
p95 looks implausible. Where a filter and the JS disagree by more than one threshold
step, the JS is usually right about the shot and the filter about the frame. Cost per
listing is in `tagging-prompt.md` §Cost control.