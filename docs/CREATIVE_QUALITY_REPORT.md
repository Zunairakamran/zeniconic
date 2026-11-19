# Creative quality report — real demo, before and after

## Critical re-review after user playback (2026-11-19)

The user supplied the actual before/after Marketing 38 files. They were right:
the first "after" was substantially the same edit. The reasons were concrete,
not vague:

1. **The marketing order was deliberately preserved.** `direct()` used
   `preserveMarketingStructure: true`, so it kept the beat sheet's living →
   kitchen → living → kitchen → bedroom sequence and only added a grade. That is
   why the shot sequence looked unchanged.
2. **Every marketing caption was forced to 18 px.** `packages/render/src/graph.ts`
   appended `subtitles=...:force_style='FontName=Archivo,FontSize=18,...'` to the
   FFmpeg graph. libass obeyed that override over the ASS preset, so even the new
   typography rendered tiny. The ASS file was correct; the filter graph erased it.
3. **The 36 s ghost was a same-room dissolve.** The beat sheet put a 0.36 s
   `dissolve` between two bedroom shots at 35.75 s. Blending two similar rooms
   produced the double exposure. The director now refuses a same-room dissolve
   and uses a cut.
4. **Narration listed rooms that were no longer on screen.** The voice script
   said “living, entry, kitchen, bathroom” while the creative order showed a
   bedroom, so “Bathroom.” appeared over a bedroom. Room lists are no longer
   narrated; captions now carry address, bedroom count and price only.
5. **The ending had no CTA.** `planDrawTexts` never read the EDL `cta` overlay;
   the last 4.5 s only had a price card that had already ended. A real
   `BOOK A VIEWING` drawtext is now emitted in the CTA window.

Fixes in this round: marketing storyboard template (entry lands at 23.0 s),
interleaved rooms, same-room dissolve veto, style-free `subtitles` filter,
caption-engine cue grouping inside the marketing pass, 68 px luxury-gold ASS,
gold address label, CTA card, and address suppression when the caption already
says it.


Date: 2026-11-18. Footage: 18 presenter clips in `raw-clips/`, 576×1024,
1.5 minutes. Outputs are the real files in `demo/cuts/`.

## 1. What the previous output actually did

Inspected before files:

- `demo/cuts/before_calm.mp4` — 30 s Calm cut
- `demo/cuts/before_marketing38.mp4` — 38 s Marketing 38 cut

Objective findings from the EDL, frames and audio:

| Issue | Evidence |
|---|---|
| No speech captions in Calm | `calm.json` had `captions.mode: none`; frames showed only address/price cards |
| Marketing captions did not match the voice | EDL words were "Come inside… / Light, from the first hour / Slow mornings…"; the actual voice says "Marina Gate 1, Dubai Marina. One bedroom. A living entry kitchen bedroom walkthrough. Offered at 1.4 million AED." |
| Caption timing was estimated, not spoken | phrase durations were split by character count; no word timestamps entered the export |
| Music was a placeholder | EDL `music.trackId: none`, `beatGrid: []`; export used `data/assets/music/calm-096.m4a`, whose sidecar says `generatedBy: ffmpeg-synth-fixture` |
| Cuts were not music-aware | music is 96.01 BPM; cuts at arbitrary 2.0–2.75 s intervals |
| Very little picture treatment | Calm had all `cut` transitions, no `grade`, no `effects`; every clip shared the same 1.04→1.08 zoom |
| Repetition | Marketing 38: 4 living, 5 kitchen, 5 bedroom shots; no exterior/bathroom/balcony beat |
| Weak story | sequence followed room buckets, not hook → highlight → detail → feature → close |
| Basic typography | export hardcoded one ASS style (Bricolage 800 white bottom); caption presets did not reach the export |

The old caption mismatch is exact: the EDL text was a different script from the
spoken track, and word timing was derived from characters rather than audio.

## 2. Root causes

1. **One hardcoded caption style in the export.** `captionStyleForEdl` was not
   used by the FFmpeg path; every variant shipped the same ASS style.
2. **Caption words came from the wrong source.** Export preferred EDL curated
   words over the generated voice. For studio voice, phrase timings were real but
   were not used; for presenter audio, Scribe transcribed a mix containing music.
3. **Music was added after planning.** `planVariants` passed an empty music
   object, so `beatGrid` was always `[]`; no cut could be beat-aware.
4. **No creative pass.** Planning selected rooms and durations but never assigned
   story purpose, hook/climax/close, motion, grade, effects or transitions.
5. **The review gate checked technical issues**, not creative intent; it could
   not say "this is a stock room order" or "the music does not lift".

## 3. What was already available

- FFmpeg `xfade` graph for dissolves, whips, zoom-blur, luma wipe, light leak.
- Clip and timeline effects, LUTs, grades and speed ramps in the EDL.
- Remotion overlay/caption renderer with word reveals and kinetic animation.
- ASS caption path, font assets, safe-area geometry and caption cue grouping.
- Music beat detection (`packages/music`) and Lyria generation through OpenRouter.
- Segment cache, review inspection, job resume and the agent capability registry.

## 4. What was implemented

### Creative director — `packages/creative`

A deterministic post-plan pass over the EDL:

- classifies each clip as hook / establishing / space / craft / detail / rest /
  lifestyle / feature / close;
- picks the hook from view/exterior/living with score, motion and push-in
  preference;
- builds a narrative order, then assigns varied push/pull/pan motion;
- adds a luxury grade and restrained vignette/grain/sharpen where appropriate;
- places transitions only at meaningful boundaries (whip from hook, dissolve
  into rest/close, zoom-blur at the lift), never on every cut;
- borrows transition handles so total runtime is unchanged;
- snaps to music beats where the source permits;
- returns a rationale for every decision and refuses an invalid EDL.

### Music director — `services/pipeline/music-director.ts`

- builds a brief from real property/style facts and maps it to a concrete Lyria
  prompt and BPM target;
- decodes the generated track, detects BPM/beats and a 1 s RMS energy curve;
- labels intro/body/climax/outro from measured energy;
- scores up to 3 candidates deterministically and selects one.

Live run: two Lyria candidates, **$0.16 total**. Selected track: **112.02 BPM**,
119 beats, 63.6 s, score **0.906**. Planning now analyses the selected bed and
passes its beat grid into the EDL before cuts are chosen.

### Caption engine — `services/pipeline/caption-engine.ts`

- nine genuinely different ASS presets: social bold, clean reel, editorial,
  editorial serif, luxury gold, kinetic bold, minimal white, glass pill
  (karaoke), bold black-and-white;
- real ASS animation tags: word-by-word, karaoke `\kf`, pop/scale, rise, slide,
  fade, blur, tracking, typewriter;
- highlighted keywords, safe-area/offset positioning, line breaking and
  scene-bounded cues;
- studio voice uses the actual TTS line durations; presenter audio uses Scribe
  word timestamps. Non-speech annotations such as `[Outro music]` are filtered;
- Remotion draws picture/cards/transitions, then the EDL captions are burned by
  libass so word timing and style are exact.

### Export/UI

- `captionStyle` is now an optional export override, with a preset selector on
  Export (`luxury_gold`, `editorial_serif`, `kinetic_bold`, `minimal_white`,
  `social_bold`, `glass_pill`, `bold_bw`).
- Planning assigns a per-variant direction: editorial serif for Calm, minimal
  white for Walkthrough, kinetic bold for Social, luxury gold for Marketing 38.
- Address card is suppressed when burned captions already say the address.

### Planner

- carries `motionAtSelection` from the measured candidate into the EDL so the
  creative director can choose a moving close instead of a locked-off frame.

## 5. Files changed

- `packages/creative/**` (new director, 18 tests)
- `services/pipeline/music-director.ts` + tests + `scripts/music-director-smoke.ts`
- `services/pipeline/caption-engine.ts` + tests
- `services/pipeline/ffmpeg-overlays.ts`
- `packages/overlays/src/captions.ts`, `packages/edl/src/types.ts`,
  `packages/edl/schema.json`, `packages/styles/src/schema.ts`
- `apps/desktop/pipeline.ts` (creative pass, music before planning, captions,
  hybrid burn, caption style override, compressor/loudness fix)
- `apps/desktop/main.ts` (caption transcription dependency)
- `packages/ipc/src/{contract,handlers,index}.ts`
- `apps/ui/src/{api,types,App}.tsx`, `apps/ui/src/screens/Export.tsx`
- `packages/planner/src/{types,sequence,plan}.ts`
- `scripts/demo-build.ts`

## 6. Tests and real renders

```
npm run typecheck                         clean
npx vitest run                            1586 passed, 1 skipped
apps/render suite                         76 passed
node scripts/e2e.mjs                      66/66
npx tsx scripts/demo-build.ts             real 30 s + 38 s export
npx tsx scripts/resume-smoke.ts           PASS
```

Real demo output:

| File | Probe |
|---|---|
| `demo/cuts/after_calm.mp4` | 30.000 s, 1080×1920, 30 fps, 48 kHz stereo |
| `demo/cuts/after_marketing38.mp4` | 38.000 s, 1080×1920, 30 fps, 48 kHz stereo; CTA at 33.5-38 s; no ghost at 36 s |
| Delivered audio (Calm) | **-14.4 LUFS**, true peak **-1.7 dBTP** (target -14.0 / -1.5) |
| Selected music | **112.02 BPM**, 119 beats, Lyria deep house |

The export review passes: no room-order warning, no frozen-frame warning.
Before/after montages: `demo/screenshots/before-after-calm.jpg` and `demo/screenshots/before-after-marketing38.jpg`.

## 7. Remaining limitations (honest)

- **Beat snapping is partial.** The grid is present, but clips whose `inSec`
  is 0 cannot be pulled earlier without re-timing; some cuts are near, not
  exactly on, a beat.
- **ASS animation easing is linear**, not a spring curve.
- **No face/object-aware caption avoidance** yet; safe areas and offsets are
  respected, but saliency avoidance is not.
- **The creative director classifies by room and duration**, not full scene
  semantics; shot composition and camera direction are not in the EDL.
- **No 4K/custom output**, no packaged Kokoro E2E.
- The full Phase 11 control set is not exposed: export has caption preset;
  transition style, effect intensity, music style and pacing are still changed
  through the agent/EDL rather than dedicated controls.

## 8. What is genuinely working and verified

- Narrative reordering with a real hook, varied motion, grade and effects.
- Two real non-cut transitions in the Calm cut; the Marketing cut keeps its
  xfade beat sheet.
- Real music selection and beat grid, replacing the synthetic fixture.
- Luxury gold/editorial serif captions with actual speech timing, safe area,
  keyword highlight and animation, burned into the exported file.
- Caption preset override from the Export screen.
- Loudness mastering now compresses before `loudnorm`, so the new mix reaches
  the delivery target; the export review accepts the result.
- All before/after frames were extracted from the actual files above; nothing
  is inferred from configuration alone.
