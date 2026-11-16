---
name: EDL and rendering
description: Use when an EDL must be validated or fixed, when the user asks "why won't this render", "the export is 28 seconds", "the price card is under the button bar", "the music jumps at the cut", "re-render just the kitchen", or "the draft looks different from the final", and whenever a take is encoded, muxed, cached or re-rendered after a chat edit.
---

# EDL and rendering

An EDL is the source of truth for one variant. Rendering is a pure function of
that EDL plus the media it references — no hidden state, no model call, no clock.
If two machines render the same EDL with the same versions, they produce the same
file, and the render cache proves it.

Three jobs, in this order: **validate** the EDL, **plan** the physical work, then
**render** it in segments that can be reused.

## When to use

- The planner or the chat layer produced a new EDL and it must be checked before a
  single frame is encoded.
- A render failed: bad duration, black frames, a text card outside the safe area,
  a cut that lands off the beat, a double kitchen.
- The user edits one line of copy in chat and expects a fast partial re-render.
- A take must be produced at draft quality for review, then at final quality for
  delivery.
- Cache behaviour looks wrong: a full re-render after a music change, or a stale
  segment surviving an in-point edit.
- Someone asks what the Remotion licence costs for their team size.

## When to switch skills

| Situation | Go to |
|---|---|
| Choosing format, look, hook, room order, on-screen copy | `real-estate-creative` |
| The EDL needs a shot that is not in the index, or a score looks wrong | `footage-analysis` |
| Voice is weak, muffled, clipped, or music fights narration | `audio-restoration` |
| Chat edits the EDL through tools, budgets, diffs | `agent-tool-design` |
| Destination packaging: caption, hashtags, thumbnail, spec sheet | `platform-delivery` |
| A render disagrees with a preview | this skill, `references/remotion-structure.md` §6 |

## Workflow

1. **Parse, then validate.** Load the EDL, run `validate(edl, index, formats)`
   (`references/validator-rules.md`). Errors block. Warnings render but are
   written into `review.checks`. Never auto-fix a validation error silently: every
   change is a diff the user sees and approves, per the non-negotiables.

2. **Resolve the timeline once.** Build the flat timeline: for each clip, its
   timeline start, duration `(outSec − inSec) / speed`, and the overlap consumed
   by a non-cut `transitionIn`. Every later stage reads this array, never the
   schema fields again. Two different duration calculations is how a 30 s format
   ships at 28.4 s.

3. **Plan the physical work.** One segment per clip, one chunk per clip, one picture
   per take. Segment = source clip + crop path + speed → canvas-normalised video.
   Chunk = segment + its incoming transition + the overlays intersecting that range.
   Audio = music + voice + ducking + loudness. Hash each unit
   (`references/render-cache.md`) and mark it `hit`, `miss` or `stale`.

4. **Render segments at final geometry.** FFmpeg per segment, CRF 14 near-lossless,
   canvas-sized, no audio (`-an`). Segments are the cache unit; a 1080p30 6 s
   segment takes 12–20 s on a 4-core laptop with no GPU.

5. **Composite with Remotion, per chunk.** One composition per render profile, chunk
   props projected from the EDL, pre-normalised segments via `OffthreadVideo`.
   Remotion draws overlays, text, captions and transitions only — no cropping, no
   source decoding beyond the segments. Concatenate the chunks with `-c copy`.
   `references/remotion-structure.md`.

6. **Mix audio with FFmpeg.** Music bed, voice, sidechain duck, two-pass
   `loudnorm` to the profile target (−14 LUFS for `vertical-social`,
   `feed-portrait`, `pin`; −16 for `landscape`). AAC 320 kbps, 48 kHz, stereo.
   `references/ffmpeg-recipes.md`.

7. **Mux without re-encoding picture or sound.** `-c:v copy -c:a copy`, faststart,
   then verify with `ffprobe` (duration, fps, pix_fmt, audio params) and a second
   `loudnorm` measurement pass. A mux that re-encodes has bug-written all over it.

8. **Run the review checks, not the validator.** Black frames, freeze, loudness,
   text legibility, hook visibility, room order, repeated shot. Write them to
   `review.checks` with `passed` and a one-line detail. Review is perceptual;
   validation is structural. Never mix them, or every failed review will read like
   a crash.

9. **Ladder the quality.** `draft` = 540p, CRF 28, `veryfast`, same timeline and
   same audio chain, ~3× faster. `final` = profile resolution, CRF 18, `slow`.
   Both carry a manifest of the segment hashes they used, so a take can name its
   own inputs.

10. **Write atomically, then record.** `take.mp4.part` → rename → sidecars with the
    same stem (`.jpg` cover, `.srt`, `.txt`). Append `costUsd`, `renderCacheHits`
    and wall time to the provenance block of the EDL copy stored with the take.

### Commands

```bash
# validate only, no render
node services/pipeline/cli.mjs validate --edl out/edl_oak_v3.json --json findings.json

# draft, then final, reusing whatever the cache holds
node services/pipeline/cli.mjs render --edl out/edl_oak_v3.json --profile vertical-social --ladder draft
node services/pipeline/cli.mjs render --edl out/edl_oak_v3.json --profile vertical-social --ladder final

# which units will run?
node services/pipeline/cli.mjs plan --edl out/edl_oak_v3.json --profile vertical-social --explain
```

`plan --explain` prints one line per unit — `seg_9f3c… HIT`, `seg_1a04… MISS
(inSec 12.4→12.6)`, `aud_77b1… MISS (music_track changed)` — before any encoding
starts. Make it a habit: it is the cheapest debugging tool in the pipeline.

### Findings shape

```json
{
  "ok": false,
  "errors": [
    { "rule": "R14", "severity": "error", "clipId": null,
      "message": "Timeline is 28.400 s; social_hook targets 30.000 s ±0.5.",
      "fix": "Add 1.600 s of tail on c07 or slow c03 to 0.90." }
  ],
  "warnings": [
    { "rule": "R25", "severity": "warning", "clipId": "c01",
      "message": "Hook starts under a 1.4 s dissolve; first clean frame at 1.400 s." }
  ],
  "stats": { "clips": 9, "durationSec": 28.400, "avgShotSec": 3.156, "cuts": 8 }
}
```

Every finding names a rule id, a location and a fix in plain language. A finding
without a fix is a bug report, not a validator message.

## Hard rules

- **Times are seconds, 3 decimals.** Never frames in the EDL. Convert at the
  boundary with `Math.round(sec * fps)`, once, in one helper.
- **Durations are computed, never stored.** `(outSec − inSec) / speed`, minus
  transition overlap. Storing a duration that disagrees with its inputs is the
  single most common source of a mis-timed video.
- **Validation is exhaustive or worthless.** Every rule has an id and a failing
  fixture. A rule that cannot fail in a test does not exist.
- **No silent repair.** Clamping, reordering or trimming is a proposed diff with a
  reason, applied through the same path as a chat edit.
- **Cuts land on beats within ±0.25 s** when music has a beat grid and the format
  is beat-driven. Report the worst deviation; do not snap silently.
- **Text inside the safe area, measured, not hoped.** Vertical: ≥250 px top,
  ≥340 px bottom, ≥120 px right, ≥60 px left. Estimate the text box with the real
  font metrics before rendering.
- **Cache keys are content, not filenames.** `raw/kitchen.mp4` renamed is a cache
  hit; a re-graded file with the same name is a miss.
- **Segments are re-encoded, never stream-copied.** `-c copy` on an arbitrary
  in-point lands on the nearest keyframe and silently gives you a different shot.
- **The picture is encoded twice at most** (segment at CRF 14, composite at CRF
  18). A third generation means something is re-rendering a render.
- **No GPU, no network, no clock during a render.** If a stage needs the network it
  is not a render stage.
- **Remotion licence is a shipping gate.** Free for individuals and companies of
  up to 3 people. Above that: $25/seat/month, or $0.01/render with a $100/month
  minimum. Confirm the current terms before release; do not ship on an assumption.

## References

- `references/validator-rules.md` — R01–R39, severities, exact predicates, the
  safe-area estimator, the timeline maths, and the fixture policy.
- `references/ffmpeg-recipes.md` — two-pass loudnorm, sidechain ducking, H.264
  presets, frame-accurate trim, pad_blur, concat, verification.
- `references/render-cache.md` — segment hashing, invalidation matrix, partial
  re-render, GC, the draft/final ladder, timings on the target machine.
- `references/remotion-structure.md` — composition tree, `OffthreadVideo`,
  `staticFile` on Windows, deterministic frame maths, the licence.

## Verification

1. **Validator self-test.** `pnpm test:rules` runs at least one failing fixture per
   rule id. A rule with no failing fixture fails the suite.
2. **Duration arithmetic.** For three fixture EDLs, printed timeline duration
   matches `ffprobe` output within one frame (0.034 s at 30 fps). A 0.5 s
   disagreement means transitions are being counted twice.
3. **Cut accuracy.** Pick five cuts; extract the frame at `cut − 0.02` and
   `cut + 0.02`; the content must change across the pair and the frames must come
   from the intended source shots.
4. **Loudness.** `ffmpeg -af ebur128` on the final file reports −14.0 ±0.5 LUFS
   (vertical) and −16.0 ±0.5 (landscape), true peak ≤ −1.0 dBTP.
5. **Cache correctness.** Re-render an unchanged EDL: zero segment misses, byte
   count identical, wall time under 15 s. Change one clip's `inSec` by 0.2 s: exactly
   one segment misses, one chunk re-renders, audio is a hit.
6. **Ladder parity.** Draft and final frame at 15.000 s show the same content,
   crop and text position. Different content means a `Date.now()` or a random seed
   leaked into the composition.
7. **Determinism.** Render the same EDL twice into different directories; file
   hashes of the picture stream match (`ffmpeg -f md5 -` on the video stream).
8. **Licence gate.** The build fails if `REMOTION_LICENCE` is unset and the
   configured seat count exceeds 3.
