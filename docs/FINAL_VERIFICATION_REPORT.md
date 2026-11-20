# Final verification report

Date: 2026-11-17. Scope: the Zeniconic agentic editor in this working tree.
Companion: `docs/IMPLEMENTATION_AUDIT.md` (feature-by-feature status).

## 1. What was already implemented

- EDL 1.0/2.0 contract with runtime invariants, migration and JSON-patch
  allowlist.
- Electron shell with a sandboxed renderer, typed IPC, settings + safeStorage,
  jobs, ledger, CSP/navigation guard.
- Deterministic planner (three 30 s looks, 38 s marketing sheet), FFmpeg render
  path, Remotion overlays, loudness mastering, deterministic review.
- 29-capability registry, agent orchestrator with tools, approvals, preview,
  completeness check, budgets.
- Vision tagging, reference analysis, beat detection, remix scene split +
  transcription, cost ledger, persisted job checkpoints.
- UI screens for intake, analysis, shot review, variants, chat, formats, export,
  remix, settings.

## 2. What was incomplete

- Gemini studio voice was misconfigured (it never worked; silently fell back).
- Rendered-output visual inspection existed only as a package, not wired.
- Segment cache / partial re-render, automatic reference-driven planning,
  manual remix editing, 4K: not implemented.
- Music generation was thought unsupported; Lyria Pro turned out to work over
  OpenRouter's streaming audio chat modality.
- Refine chat's preview stage was illustrative rather than the real draft.
- Crash-kill resume was only unit-tested, never proven by killing a process.

## 3. What was broken (found this pass)

1. **Studio TTS with the configured Gemini model always failed.** The client sent
   `response_format=mp3` and a catalogue id (`matilda`). Gemini requires `pcm`
   and its own voice names. Live probe: 400 “Gemini TTS only supports pcm”.
2. **Render inspection truncated at 700 output tokens**, producing invalid JSON
   (`Unterminated string`).
3. Analysis screen could show progress from another job.
4. Retiming changed a speed-ramped clip's scalar speed → invalid EDL.
5. A transition could borrow a handle from a ramped clip → renderer threw.
6. `analysis:start` could leave an orphan queued job.
7. Resumed jobs never updated listing status.
8. Spend caps not enforced before agent/tagging calls.
9. Browser tagging toggle appeared to persist.
10. Voice spend missing from the ledger.
11. Remix used a nonexistent `shot.id`.
12. EDL gap rule rejected deliberate remix jumps.
13. Export showed invented render minutes.
14. Settings diagnostics showed fabricated log lines.

## 4. What was fixed (this pass)

- Studio TTS: provider-aware request (PCM + 24 kHz + Gemini voice map for
  `google/gemini*`, mp3 + catalogue ids for ElevenLabs), with tests.
- Inspection: 1,800-token budget, strict schema, live-verified.
- Progress filtering, ramp/transition guards, job cancellation, resume status,
  pre-flight caps, honest browser toggle, voice spend, remix ids, gap rule,
  honest export line, real diagnostics.

## 5. What was newly implemented

- `review:inspect` channel + `apps/desktop/review-service.ts` +
  `packages/review/src/inspect.ts` and an **Inspect with AI** control on Export.
- Provider-aware Gemini TTS + live smoke script.
- **Lyria 3 Pro music generation** through OpenRouter streaming audio, a
  Settings card, selected-bed persistence and ledger recording.
- **Reference-driven planning**: measured average shot length and pacing reach
  `PlanRequest.referenceStyle`; the planner changes clip count accordingly.
- **Per-clip segment cache** for the FFmpeg picture pass: keyed normalised
  MP4s, atomic manifests, 14-day prune, hit/miss reporting, `fresh`/`off`
  switches, single-pass fallback for timeline-wide effects.
- **Real Refine draft playback**: `refine:preview` channel, `zeniconic-media`
  protocol with byte ranges, `<video>` in the stage.
- **Crash-kill resume harness** (`scripts/resume-smoke.ts`) and exported
  resume-point rules in `packages/jobs`.
- **Marketing 38 as a fourth real variant**: stable `marketing38` id, own beat
  sheet, 38 s export path; invalid pools skip only that variant.
- **Resume reuses a verified index**: folder path + size/mtime signature stored
  with `footage_index.json`; a resumed `plan` does not re-scan unchanged footage.
- **Remix editing**: persisted manual reorder, per-slot room tags, provider
  transcription cost in the ledger.
- **Honest UI**: Refine version history, variant storyboard, shot review, intake,
  analysis and Settings derive from real data; browser-only demo data is gated.
- `IMPLEMENTATION_AUDIT.md` and this report.

## 6. Tested successfully

```
npm run typecheck                       clean
npx vitest run                          1589 passed, 1 skipped (129 files)
npx vitest run --config apps/render     76 passed
npm run build                           passes
node scripts/e2e.mjs                    66/66, 12 screenshots
```

Focused suites: EDL (195), planner/render/review, capabilities (32), agent (13),
IPC (121), jobs (46), ledger (24), voice (42), reference (38), remix (64),
preview (7), music (61), segment cache (15), media protocol (5).

Live harnesses this pass:

```
npx tsx scripts/music-smoke.ts          Lyria 177.267 s, 44.1 kHz stereo, $0.08
npx tsx scripts/refine-preview-smoke.ts 540x960 draft, 200 + 206 range
npx tsx scripts/resume-smoke.ts         PASS at plan and render kill points
```

## 7. What failed and why

- **First review-smoke run:** model replied with a truncated JSON object because
  `maxTokens` was 700. Fixed to 1,800; rerun parsed.
- **Gemini TTS probes:** 400 for mp3 and for `matilda`; 200 for `pcm` + Kore/Puck/
  Aoede. This is provider behaviour, not an app failure.
- **Synthetic fixtures:** the colour clips are correctly judged “blank
  solid-colour frames” by the review model. That is a fixture limitation, not a
  vision bug.

## 8. Blocked or unfinished

| Item | Status | Reason |
|---|---|---|
| Real property footage end-to-end | **Blocked** | No client footage in this environment; all media runs use generated fixtures |
| Kokoro offline TTS | Unverified | 92 MB model not downloaded here |
| Manual remix reorder | **Implemented** | Move up/down + room tags persist and recreate the variant |
| 4K / custom output | Schema only | Profiles are 1080-based |
| Marketing segment cache | Not implemented | `marketing_38` is one xfade/ASS/card graph by design |

## 9. Model integrations verified against the real API

| Role | Model | Verified by | Result |
|---|---|---|---|
| Agent | `deepseek/deepseek-v4.1-flash` | `agent:smoke` | tool edits, $0.006–0.010/run |
| Agent fallback | `deepseek/...-1017`, `openai/gpt-6-astra` | `/models` + client tests | present, tools/json |
| Tagging | `perceptron/perceptron-mk1.5` | `tag:pipeline:smoke` | 9/9 shots, $0.004 actual |
| Review / vision | `google/gemini-4-hydrogen` | `review:smoke` | 6 frames, verdict + 7 issues, $0.0167 |
| Transcription | `elevenlabs/scribe-v2` via `/audio/transcriptions` | `remix:transcribe:smoke` | 30 words |
| Studio voice | `google/gemini-3.8-flash-tts` | `tts:smoke` | 4.28 s PCM at 24 kHz |
| Studio voice alt | `elevenlabs/eleven-v4` | direct endpoint probe | 200, mp3 |
| Music | `google/lyria-3-pro-preview` | `music-smoke` via streaming chat audio | **works**: 177.267 s stereo MP3, $0.08 |

Authentication, pricing and capabilities were read from the live key/`/models`
catalogue; nothing was invented. The key remains only in `.env`/safeStorage and
is redacted from errors.

## 10. Actual test and build results

See section 6. No failures in the final run. One documented skip is the music
bed-metadata test that requires a fixture not shipped.

## 11. Real end-to-end rendering results

| Run | Input | Result |
|---|---|---|
| `agent:smoke` | 3 generated clips | agent edits (transition + retime + price card), FFmpeg render **9.000 s**, 540×960 |
| `ramp:smoke` | 2 generated clips | speed ramp 1.5×→0.75×→0.375×, **8.000 s** |
| `remix:smoke` | 12 s generated video | 2 scenes → remix variant 8.433 s → render **8.4 s** |
| `remix:transcribe:smoke` | 12 s narrated video | 30 words → 20 remapped captions, valid EDL |
| `preview` (agent tool) | edited EDL | 540×960 drafts at 9 s and 8 s |
| `tts:smoke` | text | 4.28 s WAV at 24 kHz |
| `review:smoke` | `agent-smoke.mp4` | verdict **fail** (blank colour frames), 7 timestamped issues, $0.0167 |
| `music-smoke` | prompt | Lyria **177.267 s**, 44.1 kHz stereo, 4,262,123 bytes, **$0.08** |
| `refine-preview-smoke` | 5×0.96 s generated clips | real 540×960 / 4.8 s draft; responses **200** (9,704 B) and **206** `bytes 0-99/9704` |
| `resume-smoke` | 10 generated clips | killed at `plan@0%`; second process executed `plan → render → review`, `complete` in 1.6 s (also `render` kill point) |

Every listed file exists under `data/tmp/` and was probed after writing.

## 12. Remaining risks and next steps

1. **Marketing (`marketing_38`)** bypasses the segment cache by design; moving
   its card pass out of the single graph is the next performance win.
2. **Kokoro packaged E2E** remains unproven; verify download + synthesis in an
   installed build.
3. **Packaging**: code signing, single-instance lock, disk preflight.
4. **4K / custom output**: profiles are still 1080-based; schema-only.
5. **Transcription cost** is charged only when the provider reports it; no
   documented per-second rate is pinned yet.
6. **Real client footage** remains the only blocked verification.

No feature above is claimed as verified unless the evidence column says so.
