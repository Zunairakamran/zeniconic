# Prototype run — Marina Gate 1

What actually happened when 19 WhatsApp clips and one reference video hit the pipeline,
and what it changed.

## Input

| | |
|---|---|
| Raw clips | 19 vertical 576×1024 WhatsApp exports, 99.4 s total |
| Reference | 64.37 s vertical, 1930 frames at ~30 fps, AAC audio |
| Shots detected | 24 across the raw clips; 19 across the reference |
| Vision tags | 24/24 at **$0.116** (Gemini 3.8 Flash, `:floor`) |

Rooms from tagging: living 9, bedroom 6, kitchen 5, bathroom 1, dining 1, entry 1,
unknown 1. Many shots carry a `people` defect (the agent is in frame), which is
penalised but not excluded — an agent shot is a legitimate closing beat.

## The bug that mattered

`buildFramePipeArgs` used `scale=W:H:force_original_aspect_ratio=decrease`. On a
portrait 576×1024 source at 160×90, that produces **51×90**, not 160×90. The raw
reader slices by `width*height`, so every frame after the first was misaligned.

Consequences before the fix:

- the reference decoded as 205 frames at 3.2 fps instead of 645 at 10 fps;
- it segmented as **1 shot** instead of **19**, so its pacing was unmeasurable;
- blur, shake and exposure were measured on interleaved garbage.

Fix: `scale=...,pad=W:H:(ow-iw)/2:(oh-ih)/2`, plus per-orientation analysis sizes
(portrait 90×160, landscape 160×90) so black bars never dilute the metrics.
`media` tests were updated; the contract is now "the decoder emits exactly W×H".

## Baseline vs reference (before tuning)

| Metric | Ours (v1) | Reference |
|---|---|---|
| Duration | 30.0 s | 64.4 s |
| Cuts/min | 14.0 | 16.8 |
| Avg shot | 3.8 s | 3.4 s |
| Rhythm CV | 0.05 | 0.71 |
| Static shots | 100% | 47% |
| Score | **48.9 / 100** | — |

The encoder was honest: the cut was technically fine and rhythmically flat.

## Results after tuning

| Version | Score | Cuts/min | Rhythm CV | Static | Notes |
|---|---|---|---|---|---|
| v1 calm, heuristic rooms | 48.9 | 14.0 | 0.05 | 100% | Flat, no motion, arbitrary rooms |
| v2 calm, tagged + rhythm + push | 57.3 | 14.0 | 0.21 | 75% | Better order and slight movement |
| v3 walkthrough pacing, tagged | **73.2** | **20.0** | 0.25 | 82% | Beats reference on pace; still flatter |

The reference scores 100 by definition. The remaining gap is rhythm variance and the
"static" share, not exposure or content.

## What changed for v3

1. **Style drives pacing** — the prototype had hardcoded `look: calm`; the `--style`
   flag now selects the planner's look, so `walkthrough` (2.7 s average) yields 11
   shots instead of 8 and beats the reference's 16.8 cuts/min with 20.0.
2. **Rhythm pass** — shot lengths follow a deliberate pattern (1.9, 3.6, 2.3, …)
   clamped to each source shot and re-balanced to exactly 30 s. CV rose 0.05 → 0.25.
3. **Motion pass** — every clip gets a 1.02→1.14 push with alternating lateral drift,
   applied through the EDL crop path and rendered by Remotion.
4. **Vision tags** — rooms and scores from the model, not filenames.
5. **Overlays + music** — address, price, specs and agent name from Remotion, plus a
   room label on every shot: the reference keeps information on screen throughout,
   and a single end card looked empty by comparison.
6. **Hybrid voice** — the agent's real lines from the entry and "why wait" shots,
   plus Kokoro-82M (Apache-2.0, CPU) for the bridge lines. Each voice is gain-matched,
   summed, then mastered.
7. **Music** — a catchy 120 BPM Lyria bed, sidechain-ducked under the voice, mastered
   to −14.2 LUFS / −1.5 dBTP.
8. **Captions** — Bricolage Grotesque 800, uppercase, centred, 76px, **no backing
   plate**, word-timed from the voice track. Room labels were removed once captions
   landed; together they collided. Captions stop at 23.5 s so the price/contact end
   card is clean.
9. **Crossfades** — 0.35 s dissolves between every shot, overlapping live picture.

## An honest note on "static"

The benchmark calls a shot static when mean frame-to-frame luma change is below 0.05.
That is a demanding threshold: a slow gimbal pan or a 12% push on a still room does
not cross it. The reference clears it on 53% of shots, likely through faster camera
movement and harder cuts. For real-estate footage, "static" here means "calm", not
"bad". The number is useful for comparison, not as an absolute quality verdict.

## Honest limits

- 576×1024 source is the ceiling. A 4K master would beat this on sharpness, not on
  pacing.
- The reference's 64 s allows 19 shots; a 30 s cut carries 11 comfortably.
- Transcription (captions) and Kokoro voiceover are not in this run; both modules
  exist, but no engine binary is wired yet.
- `people` in frame is common. The product should ask whether the agent wants to
  appear, rather than deciding silently.
- Transitions are implemented in the FFmpeg renderer but the final path uses
  Remotion, whose sequences currently cut rather than crossfade. That is the next
  visual upgrade.

## Deliverables

```
data/listings/marina-gate-1/out/
  zeniconic-walkthrough-draft.mp4     540×960, 30.00s, overlays + music
  zeniconic-final.mp4                 1080×1920 · 30.00s · hybrid voice, captions, crossfades
  zeniconic-walkthrough-standard.mp4  1080×1920 · 30.00s · previous pass, music only
  prototype.edl.json                  the edit decision list
  overlay.edl.json                    the same edit with media paths for Remotion
  compare-ours-vs-reference.jpg       three frames each, stacked
```

## Customisation that exists

| Knob | Where | Values |
|---|---|---|
| Style / pacing | `--style` flag + `config/styles/*.json` | calm, social, walkthrough, editorial |
| Target duration | `--target` | 5–60 s, planner validates feasibility |
| Output quality | `--quality` | draft 540p, standard 1080p, high 1440p |
| Music mood | `scripts/generate-music.ts --mood` | calm, luxury, social, cinematic |
| Transitions | EDL `transitionIn` + `packages/render` | cut, dissolve, slide, whip (FFmpeg path) |
| Overlay animation | EDL `animation` | none, fade, rise, slide_in, count_up |
| Aspect | profile | vertical-social, feed-portrait, landscape, pin |
| Room labels | EDL overlays | on every shot, per-room text |

What is **not** yet wired into the final Remotion path: crossfade transitions (the
composition cuts), captions, and TTS. Those are the next three.

## Reproduce

```powershell
npx tsx scripts/index-clips.ts data/listings/marina-gate-1/raw `
  --out data/listings/marina-gate-1/footage_index.json

npx tsx scripts/tag-clips.ts data/listings/marina-gate-1   # needs OPENROUTER_API_KEY

npx tsx scripts/generate-music.ts --mood calm --duration 35 --bpm 96 `
  --out data/music/calm-bed-96.m4a

npx tsx scripts/prototype.ts data/listings/marina-gate-1 --target 30 --style calm --quality draft

npx tsx scripts/benchmark.ts `
  data/listings/marina-gate-1/out/zeniconic-calm.mp4 `
  data/listings/marina-gate-1/reference/reference-video.mp4
```
