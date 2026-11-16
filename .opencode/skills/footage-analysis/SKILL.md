---
name: Footage analysis
description: Use when the user drops a folder of raw property clips and asks which shots are usable, when footage_index.json is missing or stale, when a shot's room tag or score looks wrong, or when the vision tagger needs re-calibrating against hand labels.
---

# Footage analysis

Turns a listing's `raw/` folder into `footage_index.json`: every source clip probed
and hashed, cut into shots, measured on one decode pass, contact-sheeted six
frames per shot, tagged by one vision call per shot, and scored 0.0–1.0.

The index is the only thing planning reads. No downstream stage may open a source
clip to "check" something the index should answer.

Output: `data/listings/<slug>/footage_index.json`, content-addressed by the
SHA-256 of every input file. Analysis is resumable: kill it at any point, re-run,
and it spends nothing on work already done.

## When to use

- A user drags a folder of clips in and asks "which of these are any good",
  "what rooms do we have", "is this drone shot usable".
- `footage_index.json` is absent, older than its source files, or references
  shots that no longer exist.
- The shot inspector shows an obviously wrong room, a score that contradicts the
  visible frame, or a crop that cuts a bed in half.
- A new model, prompt version or threshold set is being trialled, so the index
  must be rebuilt and re-labelled (see `references/calibration.md`).
- A render failed with "source shot not in index" or "scoreAtSelection missing".

## When to switch skills

| Situation | Go to |
|---|---|
| Cut a timeline, validate an EDL, encode or mux | `edl-and-rendering` |
| Choose a format, look, hook or room order from the index | `real-estate-creative` |
| Voice is weak, or music fights the narration | `audio-restoration` |
| Crop window is off-centre after analysis is already correct | this skill, `references/crop-anchors.md` |
| Choosing or re-pricing the vision model | this skill, `references/calibration.md` |
| Any user-facing wording ("shot", "usable", "room") | `docs/CONVENTIONS.md` |
| Source files are corrupt, truncated or unplayable | Stop. Report the file names. Never transcode or overwrite originals. |

## Workflow

1. **Probe first, no decode.** For each file under `raw/`, run `ffprobe -v error
   -print_format json -show_format -show_streams`. Reject anything without a
   video stream whose `codec_type=video` and `width>0`. Record `duration`,
   `r_frame_rate`, `width`, `height`, rotation side data, and whether an audio
   stream exists. A probed file that fails here is reported, not repaired.

2. **Hash, then name.** Stream the file through SHA-256 (16 MB chunks, never
   `readFileSync`). `sourceId = "s_" + sha.slice(0, 8)`. If two files hash the
   same, index one and note the duplicate path — users do drop copies.

3. **Decode once.** Spawn the frame pipe described in `references/metrics.md`:
   160×90 8-bit grey at 10 fps on stdout, audio loudness measured on the same
   process. Read exactly 14 400 bytes per frame; never buffer more than 64
   frames. Every pixel metric below is computed from this stream.

4. **Cut into shots.** Mean absolute difference between consecutive frames, with
   an adaptive threshold (§ metrics 3). Merge shots shorter than 0.4 s into the
   previous shot; drop shots shorter than 0.6 s. Shot ids follow the convention:
   `sh_s4f2a1b9c_003`, index zero-padded to 3.

5. **Measure each shot.** Shake, sharpness, exposure clipping, motion energy,
   freeze runs, duplicate hash (§ metrics 4–9). All values normalised 0.0–1.0
   except where a unit is stated. Percentiles, not means: one bad second must
   not hide behind a good twenty.

6. **Seek-extract six frames per shot.** These are seeks, not a second pass:
   six `-ss` extractions at 512×512 padded square, PNG. Use them for the contact
   sheet, the sharpness confirmation (§ metrics 5) and colourfulness (chroma is
   not in the grey pipe). Never seek the same timestamp twice; cache by
   `(sourceId, timestampMs)`.

7. **Build one sheet per shot.** `tile=3x2`, JPEG quality 80, 1536×1024, tile
   order left-to-right then top-to-bottom in ascending time. One image, always.
   Write to `cache/contact-sheets/<sha256>/<shotId>.jpg`.

8. **Tag one shot per request.** POST the sheet as a single `image_url` part with
   the prompt from `references/tagging-prompt.md`. Temperature 0, strict JSON
   schema, 8 s timeout, two retries on 429/5xx only. Never send 6 images. Never
   send video. Never send a clip.

9. **Score deterministically.** The model's 0–100 becomes `modelScore`; the
   stored score is a blend, so two runs on the same sheet agree:

   ```
   quality = 0.30*sharpness + 0.25*(1-shake) + 0.20*liveliness
           + 0.15*(1-clipPct) + 0.10*colourfulness
   score   = clamp01(0.70*(modelScore/100) + 0.30*quality - defectPenalty)
   ```

   `defectPenalty` sums 0.05–0.25 per defect from the table in
   `references/metrics.md`, capped at 0.45. Store `score` (0.0–1.0, 3dp),
   `modelScore` (integer 0–100) and `confidence`.

10. **Write atomically.** `index.json.tmp` → `fsync` → `rename`. One file, one
    hash: `sourceIndexHash` = SHA-256 of the canonical JSON with keys sorted.
    Planning stores this hash; a mismatch invalidates the plan, not the index.

11. **Log the money.** Append one row per listing to `cost_ledger` (USD, 4dp):
    input tokens, output tokens, model id, sheet count, wall time.

12. **Verify before declaring done** (§ Verification). A run that produced an
    index but fails the checks is a failed run.

### Index shape

```json
{
  "indexVersion": "1.0.0",
  "listingId": "2026-11-14-14-oak-avenue",
  "createdAt": "2026-11-15T09:12:04.318Z",
  "pipelineVersion": "analysis-1.4.2",
  "model": { "tagging": "google/gemini-3.8-flash", "promptVersion": "tag-1.3.0" },
  "thresholdsHash": "9c1f…",
  "costUsd": 0.2137,
  "sources": [{
    "sourceId": "s_4f2a1b9c",
    "path": "raw/kitchen-pan.mp4",
    "sha256": "4f2a1b9c…",
    "durationSec": 41.208,
    "width": 3840, "height": 2160, "fps": 29.97, "rotation": 0,
    "audio": { "hasAudio": true, "lufs": -22.4, "truePeakDbtp": -3.1 },
    "shots": [{
      "shotId": "sh_s4f2a1b9c_003",
      "inSec": 12.400, "outSec": 18.950,
      "metrics": { "shake": 0.031, "sharpness": 0.72, "clipPct": 0.018,
                   "liveliness": 0.064, "colourfulness": 0.41, "freezeSec": 0.0 },
      "tags": { "room": "kitchen", "cameraMove": "pan_right",
                "sellingPoints": ["natural_light", "island_bench"],
                "defects": ["blown_windows"],
                "bestIn": 0.600, "bestOut": 5.900,
                "modelScore": 78, "confidence": 0.82 },
      "anchors": [{ "t": 0.00, "bbox": [0.31, 0.22, 0.44, 0.61] },
                  { "t": 0.20, "bbox": [0.33, 0.23, 0.43, 0.60] }],
      "dhash": "9e3a1c07b25f4d68",
      "contactSheet": "cache/contact-sheets/4f2a1b9c…/sh_s4f2a1b9c_003.jpg",
      "score": 0.741
    }]
  }]
}
```

## Hard rules

- **No GPU. Ever.** No CUDA, no ONNX runtime, no local model. All inference goes
  to OpenRouter. If a plan needs a tensor library, the plan is wrong.
- **One decode pass per source.** 10 fps grey on stdout, metrics in JS. The
  ffmpeg filters `scdet`, `blurdetect`, `freezedetect`, `blackdetect` and
  `signalstats` are for cross-checking a suspicious result in dev, never for the
  production path — each one costs a second decode.
- **One image per shot.** Six tiles in a 3×2 grid. Never six images, never the
  full video, never a frame at original resolution.
- **Strict JSON or nothing.** A response that fails schema validation is retried
  once, then the shot is stored with `room: "unknown"`, `confidence: 0.0`,
  `score` from metrics only. Do not regex-scrape prose.
- **Pinned model ids.** `google/gemini-3.8-flash` for tagging,
  `google/gemini-4-carbon` for review. Read them from
  `services/pipeline/models.json`; never hardcode a floating alias.
- **Content-addressed cache.** Re-running on unchanged files must make zero model
  calls and leave mtimes untouched.
- **Determinism.** No `Date.now()` inside a metric, no `Math.random()`, no
  locale-dependent sorting. Same bytes in, same index bytes out, except
  `createdAt` and the cost row.
- **Faces are tagged, not described.** "Two people visible at the far end of the
  room" is a defect. Naming, identifying or describing a person is a bug.
- **Scores are 0.0–1.0 in data, 0–100 in the UI.** Never store the integer as the
  score; the EDL's `scoreAtSelection` is a float and must match the index.
- **Never invent property facts.** The tagger sees pixels. Price, bedroom count,
  address and view direction come from the fact-confirmation step.

## References

- `references/metrics.md` — exact formulas, starting thresholds, percentiles,
  cross-check commands, audio measurement, defect penalties.
- `references/tagging-prompt.md` — the prompt verbatim, response schema,
  controlled vocabularies, retry policy.
- `references/calibration.md` — the 20-clip, 3-model bake-off, agreement gates,
  how thresholds are re-derived.
- `references/crop-anchors.md` — turning `subject_bbox` into an EDL `focus` and
  crop `path`, including the padded-tile un-mapping.
- `scripts/agreement.mjs` — plain Node 22, no dependencies: per-field agreement
  and a `room` confusion matrix from a labelled CSV.

## Verification

1. **Counts reconcile.** Every probed video appears once in `sources`; every shot
   id matches `^sh_s[a-f0-9]{8}_[0-9]{3}$`; every `inSec < outSec`; shots within
   a source are ordered and non-overlapping; total shot coverage ≤ duration.
2. **Cache is honest.** Run the pipeline twice. Second run: `costUsd` delta 0,
   model call count 0, `index.json` mtime unchanged.
3. **Resume is honest.** Kill at ~60 %, re-run. Model spend must equal one clean
   run within one contact sheet.
4. **Scores discriminate.** On the 20-clip golden fixture, score MAE against the
   stored fixture is < 2 points, and the top-ranked shot per clip is unchanged.
5. **Agreement clears the gate.** `node scripts/agreement.mjs labels.csv`
   exits 0: `room` ≥ 0.80, `camera_move` ≥ 0.70, `selling_points` F1 ≥ 0.60,
   `best_in` within ±0.35 s ≥ 0.75, score MAE ≤ 8.
6. **Eyeball three sheets.** Pick three shots at random; the tags must be
   defensible from the sheet alone. If not, the prompt is at fault, not the
   labels.
7. **Cost sanity.** A 12-clip listing lands between $0.15 and $0.35. Outside
   that, check sheet count and output length before shipping.
