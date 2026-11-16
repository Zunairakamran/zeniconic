# Calibration — the 20-clip bake-off

Required before the tagger is trusted on a real listing, and repeated whenever the
model, the prompt or a threshold changes. Not optional, not a one-off: a tagger
nobody has measured produces confident nonsense that costs a render to discover.

Deliverable: `docs/calibration/<yyyy-mm-dd>-bakeoff.md` — the report, the CSV, and
the threshold values it produced.

## 1. Corpus

20 real clips from 20 different properties, so no single camera, agent or estate
agency dominates. Pull from `data/listings/*/raw/` of finished listings; never
manufacture test footage, it will be too clean.

| Stratum | Clips | Why it is in the set |
|---|---|---|
| Exterior, drone, gimbal orbit | 5 | Sky clipping, horizon tilt, fast motion |
| Interior walkthrough, handheld | 5 | Shake, exposure swings, doorways |
| Room pans, tripod | 4 | Clean shots — the easy class must not be missed |
| Poor light / tight rooms | 3 | Noise, crushed blacks, wide lens distortion |
| Known problems | 3 | Person in frame, watermark, construction |
| **Total** | **20** | |

Keep the media outside git (git-ignored `data/`), commit the labels, the CSVs and
the report. A calibration you cannot reproduce is an anecdote.

Detect shots as normal, then sample **6 shots per clip** (spread across the clip,
stratified by score band so you are not labelling only the good ones) → 120 rows.
120 rows is the minimum for a per-field agreement number to mean anything; 40 rows
gives you a confidence interval wide enough to hide a 15-point regression.

## 2. Hand labels

Two labelers, independently, blind to model output. No discussion until both
sheets are submitted. Disagreements are adjudicated by a third person on the
fields that matter (`room`, `defects`, `best_in`); adjudicated values become truth.

Labels live in one CSV per listing set, one row per shot:

```csv
clip_id,shot_id,hand_room,model_room,hand_camera_move,model_camera_move,hand_selling_points,model_selling_points,hand_defects,model_defects,hand_best_in,model_best_in,hand_best_out,model_best_out,hand_score,model_score
oak-01,sh_s4f2a1b9c_002,kitchen,kitchen,pan_right,pan_right,natural_light;island_bench,natural_light;island_bench,blown_windows,blown_windows,0.8,0.6,5.9,5.9,78,74
oak-01,sh_s4f2a1b9c_003,living,living,static,pan_left,,natural_light,,,0.0,0.4,4.2,3.1,71,64
```

Lists are `;`-separated. Scores are 0–100 integers for both sides so the number in
the CSV is the number a human can argue with. Missing model values are empty, not
`null` — the script treats empty as "not attempted" and excludes it from the
denominator rather than scoring it as wrong.

Rules for the hand side: label from the same six frames a model would see, in the
same 3×2 sheet, so the comparison is about judgement and not about extra evidence.
If a labeler needs a seventh frame to decide the room, the model could not have
known either, and the shot's ground truth is `unknown`.

## 3. Run the models

Three candidates, pinned in `services/pipeline/models.json` for the duration of
the bake-off:

| Slot | Model | Price in/out (USD/M) | Role |
|---|---|---|---|
| `default` | `google/gemini-3.8-flash` | 0.83 / 4.13 | Current production tagger |
| `review` | `google/gemini-4-carbon` | 2.00 / 10.00 | Review pass, stronger reasoning |
| `challenger` | `google/gemini-3.5-flash-lite` | 0.30 / 2.50 | Cheap; wins only if agreement holds |

```bash
node services/pipeline/cli.mjs analyse \
  --listing fixtures/bakeoff-2026-11 \
  --model google/gemini-3.8-flash \
  --prompt tag-1.3.0 \
  --out out/bakeoff/flash.json --no-cache
```

Run each model on the identical 20 clips with the identical prompt version and
identical sheets. `--no-cache` for the bake-off only: a cached sheet from a
different prompt version silently invalidates the comparison.

Cost of the whole bake-off: 120 sheets × 3 models. Flash ≈ $0.27, carbon ≈ $0.65,
lite ≈ $0.10 — under **$1.10** total, about 20 minutes of wall time. There is no
budget argument against doing this.

## 4. Agreement

```bash
node .opencode/skills/footage-analysis/scripts/agreement.mjs out/bakeoff/flash.csv
node .opencode/skills/footage-analysis/scripts/agreement.mjs out/bakeoff/carbon.csv --json report.json
```

Plain Node 22, no dependencies. Prints per-field agreement, Cohen's κ for the
categorical fields, list micro-F1 for the tag arrays, temporal MAE and in-tolerance
rate for the boundaries, rank correlation for scores, and a `room` confusion matrix
with the top confused pairs. Exits 1 if any field misses its gate (use `--no-gate`
for exploratory runs).

| Field | Kind | Gate | Rationale |
|---|---|---|---|
| `room` | categorical | ≥ 0.80 exact, κ ≥ 0.70 | Drives room order and duplicate avoidance |
| `camera_move` | categorical | ≥ 0.70 exact, κ ≥ 0.60 | Drives crop path and transition choice |
| `selling_points` | list | F1 ≥ 0.60 | Feeds hook copy; some synonym tolerance is fine |
| `defects` | list | F1 ≥ 0.55 | Drives penalties; a false `visible_person` is expensive |
| `best_in` | seconds | ≥ 75 % within ±0.35 s, MAE ≤ 0.60 | Cut points are ±0.25 s to the beat |
| `best_out` | seconds | ≥ 75 % within ±0.35 s, MAE ≤ 0.60 | Same |
| `score` | 0–100 | MAE ≤ 8, Spearman ≥ 0.80 | Ordering matters more than level |
| top-1 per clip | selection | ≥ 0.80 | The hook depends on it |

A model that wins on `score` MAE but loses on `top-1` has learned to rate rooms, not
to pick a hook. Choose on `top-1`, then `room`, then cost. Ties break on latency.

Expect `bedroom`/`living` and `entry`/`living` to dominate the room confusion
matrix — an open-plan flat genuinely has no boundary. If a pair exceeds 15 % of
rows, either merge expectations in the label guide or add a distinct `room_label`
overlay for the user to correct; do not quietly widen the enum.

## 5. Pixel thresholds

The bake-off also re-derives the metric thresholds, because a threshold tuned on a
phone camera mislabels a drone clip.

**Blur ladder.** For one known-sharp frame per camera class, produce σ = 0, 1.5,
3, 6, 12 with `gblur`, downscale to 160×90, and record Laplacian variance. Set
`HI` to the σ=0 value and `LO` to the σ=6 value. Write the pair into the threshold
table; the table's hash goes into every index. Re-test with 10 labelled soft shots
and 10 labelled sharp shots from the corpus — target ≥ 85 % correct at the chosen
cut on `sharpness512`.

**Shake bands.** Sort the 120 labelled shots by p90 residual and inspect the
boundary between "usable" and "wobbly". Record where the labels change; if the
band is ambiguous over more than 0.015, the metric needs the pan-exclusion rule
from `references/metrics.md` §5 before the threshold is worth setting.

**Exposure.** Confirm the p95 aggregation against `signalstats`: pick five shots
where the p95 and the frame maximum disagree most and decide by eye which matches
the label. Adjust the relaxations for `view`/`exterior` from that evidence, not
from taste.

**Score blend.** Fit the four blend weights by least squares against hand scores on
the 120 rows, then round to two decimals and freeze them. Changing the blend is a
`pipelineVersion` bump: every stored score is now incomparable to every new one.

## 6. Decision record

The report answers, in this order:

1. Which model becomes `default` for tagging, and which for `review`.
2. The agreement table, per model, per field, with the gates marked pass/fail.
3. The `room` confusion matrix and the two worst pairs.
4. Threshold values for blur, shake, exposure, with the hash.
5. Score blend weights and the resulting score MAE.
6. Cost per listing at the new defaults, and wall time for 12 clips.
7. The three worst individual rows, quoted, with a sentence on whether the model
   or the label was wrong. If the label was wrong, fix the label and re-run — a
   bake-off that never corrects its own labels is measuring noise.

## 7. Maintenance

- Re-run on every model change, every prompt-version bump, and every 3 months
  regardless. Model behaviour drifts without a version change.
- Add 2 clips per quarter from the newest listings, retire the 2 oldest, keep 20.
  A corpus frozen in 2026 measures a camera fleet that no longer exists.
- Any threshold edit without a report entry is a bug against
  `docs/CONVENTIONS.md` determinism: the index would change with no record of why.
