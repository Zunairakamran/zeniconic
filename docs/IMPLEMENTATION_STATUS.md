# Implementation status

Last updated: 2026-11-17. This file is the honest ledger: what runs, what is
partial, what is planned, and what is blocked.

## Evidence in one line

- Root suite: **1489 passed, 1 skipped** (`npx vitest run`).
- Renderer suite: **76 passed** (`apps/render`).
- E2E: **66/66** (`node scripts/e2e.mjs`), 12 screenshots.
- Typecheck: clean.
- Real agent run: 3 edits, 9.000 s FFmpeg render, **$0.006** of model spend
  (`npx tsx scripts/agent-smoke.ts`).
- Crash-kill resume: **PASS** (`npx tsx scripts/resume-smoke.ts`).
- Music generation: **177.267 s** stereo MP3 for **$0.08** (`npx tsx scripts/music-smoke.ts`).

## Implemented and tested

| Area | What runs | Tests |
|---|---|---|
| EDL v2 | Additive schema: effects, grade, speedRamp, caption/overlay styling, output, 9 new transition types; v1 still validates; `migrateEdl` 1→2 | 195 |
| Capability registry | 28 capabilities, Ajv params, pure handlers, search/cards/describe, input+output EDL validation | 30 |
| Agent loop | Native tool calling, discovery, approval policy, step/tool/cost limits, draft revert, events | 9 |
| Effects lowering | FFmpeg filters for blur/motion blur/grain/vignette/sharpen/aberration/saturation/exposure/contrast/LUT + grade presets, clip and timeline scope | 7 |
| Transitions | v2 palette mapped to real `xfade` names; source handles keep the assembled duration | in render/capability suites |
| Desktop agent | `agent:run` IPC, model fallback, context, commit + apply under `auto` | typecheck + smoke |
| UI | Agent mode toggle, autonomy selector, committed-version display and apply gate in RefineChat | e2e 66/66 |
| Reference analysis | Local shot/pacing/motion/palette/loudness profile, optional vision seam, URL refusal | 35 |
| Beat detection | Energy-flux + autocorrelation BPM/beats, file decode, catalogue fixtures | 60 |
| Job persistence | `JsonJobStore`, hydrate/load, store failure isolation, additive job fields; wired in `main.ts` | 46 |
| Draft preview | `renderPreview`: source resolution, draft FFmpeg picture + real overlay pass, probe, temp cleanup | 7 |
| Cost ledger | Persisted append-only ledger, UTC day/month totals, daily/monthly/listing caps, Settings spend | 24 |
| Footage index | Atomic `footage_index.json` persistence, tolerant read, `indexShotRows`; written after analysis and read on a cold start | 18 |
| Approvals | `agent:event` stream + `agent:approve`; one decision per capability per run; 5-minute timeout denies | 5 IPC tests + smoke |
| Vision tagging | Real Perceptron Mk1.5 pass at the end of analysis (opt-in `ZENICONIC_TAG=1`), budget-capped, ledger-recorded, tagged index persisted | live smoke: 9/9 shots, $0.0144 |
| Shot review data | `shots:list` channel; ShotReview shows real rooms/scores/defects from the persisted index | 3 IPC tests |
| Animated captions | EDL animations rendered in Remotion **and** in the FFmpeg/ASS marketing path (fade, pop, rise, slide, tracking, blur, scale, word-by-word, typewriter) | 20 + 16 tests |
| Tagging controls | Settings toggle, per-listing estimate, manual "Tag shots with AI" on Shot review; provider-reported cost recorded | live $0.004 actual |
| Speed ramps | `speed_ramp` capability + FFmpeg segment/concat lowering; ramp integrates to 1 so the cut length is unchanged | render smoke 8.000 s |
| Reduced motion | Windows reduced-motion preference threaded to the Remotion overlay pass (`--reduce-motion`) | render tests |
| Reference style | Reference video picker, local style analysis, persisted profile, shown in Refine chat, fed to the agent as guidance **and to the planner** (`referenceStyle.averageShotSec` changes clip count) | 38 reference + 4 IPC + planner pacing test, live smoke |
| Instruction completeness | Deterministic check: a requested grade/caption change that was not applied is reported in the reply and warnings | 2 tests |
| Refine draft playback | `refine:preview` renders the current variant, `zeniconic-media://` serves it with real 200/206 ranges, the stage plays it in a `<video>`; `media-src` CSP updated | 5 media-protocol tests + live 540×960 render smoke |
| Segment cache | Per-clip normalised MP4s keyed by source bytes + window + speed + lowered picture chain + profile/quality/canvas; unchanged clips reuse on re-export; atomic manifests; 14-day prune; `fresh`/`off` switches | 8 key tests + 7 cache/real-ffmpeg tests; run 2 `hits=2 misses=0`, ~6× faster |
| Crash-kill resume | Child process SIGKILLed mid-`plan`; second process resumes at the persisted stage, never re-runs `index`, finishes `complete` | `scripts/resume-smoke.ts` PASS at `plan` and `render` kill points |
| UI truth | No fabricated rows/stats left in Refine, Variants, ShotReview, Intake, Analysis, Settings: versions, storyboards, rooms, scores, model IDs, spend cap, reset date and music bank all read real data | e2e 66/66 + build |
| Music generation | Lyria 3 Pro via OpenRouter streaming audio; MP3 saved under `<data>/assets/music`, selected in Settings, $0.08 pre-flight cap, ledger role `music` | live 177.267 s stereo song ($0.08); 3 SSE tests |
| Remix | Scene split, three preset orders, optional Scribe transcription with words remapped onto the new order and burned captions, persisted storyboard, new screen, `remix` variant. Manual move up/down reorder, per-slot room tagging, and provider-reported transcription cost (ledger role `transcription`) | live 8.4 s render + 20 remapped caption words; 13 reorder/retag/cost tests |
| Studio TTS | Provider-aware Gemini (PCM + voice map) and ElevenLabs (mp3 + catalogue ids) | live 4.28 s WAV |
| Render inspection | `review:inspect`: six sampled frames → multimodal model → verdict/issues; UI button on Export | live verdict + 7 issues, $0.0167 |
| Job resume | Analysis jobs persist folder + kind; a restart rebinds the source, resumes the job and restores the listing status | runner + IPC tests |
| Voice spend | Studio provider/characters recorded in the ledger (estimated from characters; cached lines over-count) | voice tests |
| Spend caps | Pre-flight cap checks on agent + tagging | ledger tests |
| Models | Verified OpenRouter roles/capabilities; agent fallback chain; Kokoro as backup | probe + suite |

## Implemented but not fully wired

| Area | State | Next step |
|---|---|---|
| Agent streaming | `agent:event` streams activity to the window; the final response still returns once | Optional token streaming |
| Preview audio | Draft preview is picture + overlays (silent by design) | Add the mastered track when a voice bed exists |
| Footage tagging | Toggle + estimate + manual run shipped; auto runs at the end of analysis when enabled | Record tags in the analysis success copy |
| Remix | Picture + optional speech/captions; rooms are placeholders | Tag imported shots, edit the order manually |
| Cost ledger | Agent, tagging and voice spend recorded; transcription spend is not | Capture Scribe usage/cost |
| Marketing cache | `marketing_38` renders xfade + ASS + cards in one graph, so it bypasses the segment cache by design | Segment it only if the card pass moves out of the graph |
| Caption animation | Both paths animate; ASS modes are linear approximations of the Remotion curves | Port the easing curves where ASS allows |

## Not implemented (no renderer or no safe design yet)

- Freeze frame, reverse, stabilization (`vidstab` two-pass), glow.
- Masks, subject tracking, object removal, background replacement, rotoscoping.
- Multi-track video layers / compositing.
- 4K encode path (profiles are 1080-based; custom output is schema-only).
- Arabic voice.

## Known limitations / risks

1. **EDL version default** is still 1.0.0 for planner output; capabilities
   upgrade to 2.0.0 on write. Planned: flip the planner and migrate on read.
2. **Transition semantics** depend on `handleOutSec`. Legacy EDLs with
   transitions but no handles still render short; the desktop export uses a
   cut-only picture pass + Remotion crossfades, which masks this. Fix by
   migrating handles or teaching the validator assembled-duration semantics.
3. **Effect windows** use `enable='between(t,…)'`; filter support varies. The
   validator does not yet reject a window on a filter without timeline support.
4. **Approvals** default to deny when no UI is present (safe, but the agent
   cannot complete a medium-risk request until the approval channel lands).
5. **Model capability probing** is config-driven; the pinned TTS model
   (`google/gemini-3.8-flash-tts`) is not in `/models` and is only verified when
   the speech endpoint is called.
6. **E2E** still runs on demo data for most screens; the real proof is the
   agent smoke + export harness.

## Phase log

| Phase | Result |
|---|---|
| 0 Baseline | Install, typecheck, 954/2 failed (missing music fixtures), render 44/1 stale, e2e 64/2 stale |
| 1 Contracts | EDL v2, audit, capability/registry/agent docs; stale tests fixed |
| 2 Agent foundation | `packages/ai` tools, `packages/agent`, `packages/capabilities`, jobs store |
| 3 Capabilities + render | 28 capabilities, FFmpeg effect lowering, transition handles, real smoke render |
| 4+ | Reference/beat/jobs packages landed; planner wiring and preview/review loop next |

### Phase 2 — trustworthy loop (this session)

- `services/preview`: real 540-wide draft render with overlays, probed result,
  typed source errors. `preview_render` is now a working agent tool.
- Approvals: `agent:event` / `agent:approve`, one decision per capability per
  run, 5-minute timeout denies, UI approval card in RefineChat.
- Footage index persisted after analysis and read on a cold start.
- Cost ledger persisted; Settings spend reads the real month total.
- `JsonJobStore` constructed in `main.ts`; jobs hydrate at boot.
- Smoke: preview 9 s → approval → retime 8 s → preview 8 s, $0.002.

### Phase 3 — footage intelligence (this session)

- Vision tagging runs at the end of the index stage when `ZENICONIC_TAG=1`:
  pre-flight estimate, `$0.25` batch cap, client only when a key exists,
  progress events, tagged index written, spend recorded in the ledger.
  Live run: 9/9 shots, 0 failures, **$0.0144** (fixtures are synthetic, so the
  model honestly reports `unknown` rooms and `too_dark`).
- `shots:list` channel + ShotReview now renders real rooms, scores, selling
  points and defects from the persisted index (demo data only before analysis).
- Remotion captions animate all EDL modes (`fade`, `rise`, `slide_in`, `pop`,
  `typewriter`, `word_by_word`, `tracking_in`, `blur_in`, `scale_in`) with a
  reduced-motion option; 20 new tests.

### Phase 4 — fixes and speed ramps (this session)

- Tagging: Settings toggle, per-listing estimate, manual run from Shot review,
  provider-reported cost (`TagReport.costUsd`), actual $0.004 on the fixture
  batch vs $0.0144 estimated.
- Captions: horizontal `slide_in` (`translateX`) and `reduceMotion` threaded
  from Windows → desktop pipeline → Remotion CLI.
- FFmpeg/ASS captions now animate all EDL modes (linear approximations).
- `speed_ramp` capability + FFmpeg lowering; real render 8.000 s at 540×960.
- Reference style: native video picker, local `analyseReference`, profile stored
  as `reference-profile.json`, shown in Refine chat (pacing, average shot,
  palette) and passed to the agent as guidance. A live run retimed the cut to
  9 s and applied a warm grade from the reference; when the model skipped the
  grade, the new completeness check said so instead of claiming success.
- Remaining: manual remix editing, segment cache, transcription cost, 4K.

## Phase 5 — Remix wired (this session)

- New Remix screen and `dialog:chooseRemix` / `remix:analyze` / `remix:get` /
  `remix:create` channels.
- Scene split → three preset orders (`marketing`, `original`, `price_led`) →
  persisted storyboard → a `remix` variant that reads the preset order exactly
  (no planner re-sorting) and validates.
- Smoke: 12 s three-colour source → 2 scenes → 8.433 s variant → rendered 8.4 s.
- Speech: optional Scribe transcription in Remix; words are remapped from the
  old timeline onto the new shot order, dropped when they fall outside a slot,
  and burned as `social_bold` captions. Live: 30 words → 20 remapped → valid
  captioned EDL.
- EDL gap rule now uses `sourceId` (plus `src`) so a deliberate remix jump is
  legal while legacy same-source gaps still fail.
- Remaining: manual storyboard editing, transcription cost, segment cache.

### Phase 6 — reliability and bug sweep

- Analysis jobs persist `kind` + folder checkpoint; on boot the main process
  rebinds the source, resumes queued/running jobs and restores the listing
  status (success/failed/draft).
- `analysis:start` cancels the queued job if preparation or the status write
  fails, instead of leaving an orphan.
- Studio voice returns its provider and synthesised character count; exports
  record the cost in the ledger.
- Agent runs and tagging batches are refused before the call when the persisted
  daily/monthly/listing budget is exhausted.
- Fixed: ramped clips were being retimed through a scalar speed; transitions
  could request a handle from a ramped clip; the Analysis screen accepted stale
  progress from another job; the browser tagging toggle pretended to persist.

### Phase 7 — music, reference planning, cache, resume

- **Lyria music generation**: `packages/ai/src/audio.ts` streams SSE audio from
  `google/lyria-3-pro-preview`; `music:generate` writes
  `<data>/assets/music/generated-*.mp3`, selects it in Settings and records the
  provider cost. Live: **177.267 s**, 44.1 kHz stereo, **$0.08**.
- **Reference → automatic planning**: persisted `averageShotSec`/`pacing` flow
  through `PlanRequest.referenceStyle`; a planner test proves the clip count
  changes with the measured average.
- **Segment cache**: per-clip normalised segments keyed by source bytes, window,
  speed, lowered picture chain, profile/quality/canvas; atomic manifest + rename,
  14-day prune, `fresh`/`off` switches, hit/miss reporting. Real ffmpeg test:
  second run `hits=2 misses=0`, identical duration, unchanged segment mtimes;
  a changed clip misses only itself.
- **Refine draft playback**: `refine:preview` renders the current variant;
  `zeniconic-media://preview/<name>.mp4` serves it with 200/206 byte ranges; the
  Refine stage plays it in a real `<video>`.
- **Crash-kill resume**: `scripts/resume-smoke.ts` kills a child mid-`plan`; a
  second process resumes at `plan`, never re-runs `index`, and completes.

### Phase 8 — final product pass

- **Marketing 38 is a real variant**: fourth persisted variant, own beat sheet,
  38 s export, invalid pools skip only that variant.
- **Resume reuses a verified index**: folder signature (path + file size/mtime
  hash) stored with the index; resume at `plan` no longer re-scans unchanged
  footage. `resume-smoke` asserts `footage index reused untouched`.
- **Remix editing**: manual move up/down, per-slot room tags, provider-reported
  transcription cost (ledger role `transcription`); 13 new tests, live 8.4 s
  render.
- **UI truth sweep**: Refine version history, Variants storyboard, ShotReview,
  Intake, Analysis and Settings all read real data; Settings models/spend/reset/
  music bank derive from `models.json` + catalogue. Browser demo data is gated
  to the no-Electron preview.
- **Verification**: typecheck clean; root **1489 passed / 1 skipped** (123
  files); render **76 passed**; e2e **66/66**; build passes; resume
  smoke PASS.

## Next priorities (in order)

1. Marketing (`marketing_38`) segment caching, or move its card pass out of the
   single graph.
2. 4K / custom output profiles (currently schema-only).
3. Packaging: code signing, single-instance lock, disk preflight.
4. Kokoro packaged download + synthesis in an installed build.
5. Pin a documented Scribe per-second rate if provider cost is ever absent.
