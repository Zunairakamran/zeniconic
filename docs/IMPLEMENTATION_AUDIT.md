# Implementation audit

Audited 2026-11-17 against the working tree. Every status below is backed by a
file, a test, or a live run noted inline.

## Verification snapshot

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run` | **1566 passed, 1 skipped** (126 files) |
| `apps/render` suite | **76 passed** |
| `node scripts/e2e.mjs` | **66/66**, 12 screenshots |
| `npm run build` | passes |
| Live model runs | agent, tagging, transcription, TTS, render review, Lyria music (below) |
| Crash-kill resume | **PASS**, two kill points (`scripts/resume-smoke.ts`) |

## Feature status

### Core contracts

| Feature | Status | Evidence |
|---|---|---|
| EDL 1.0.0 compatibility | Verified | `packages/edl` regression tests; `example.edl.json` |
| EDL 2.0.0 (effects, grade, ramps, captions, overlays, output) | Verified | 195 EDL tests, schema + runtime invariants |
| EDL migration 1→2 | Verified | `migrate.test.ts` |
| EDL patch allowlist | Verified | `packages/chat/test/chat.test.ts` |
| EDL validation (duration, gaps, handles, captions) | Verified | `validate.test.ts`, v2 suites |

### Desktop shell and IPC

| Feature | Status | Evidence |
|---|---|---|
| Sandboxed renderer, CSP, navigation guard | Verified | `main.ts`; e2e console checks |
| 41-channel typed IPC allow-list | Verified | `packages/ipc` handler/arity tests |
| Settings, safeStorage key, theme | Verified | `settings.test.ts`, `settings:get` spend test |
| Jobs persist + resume | **Verified by crash-kill** | `scripts/resume-smoke.ts`: SIGKILL mid-plan, second process resumed `plan → render → review`, finished `complete` in 1.6 s; `packages/jobs` 46 tests |
| Cost ledger + caps | Verified | 24 ledger tests; pre-flight wired in agent/tagging |
| Diagnostics panel | Fixed this pass | Fake log rows replaced with real build/model IDs |

### Analysis and planning

| Feature | Status | Evidence |
|---|---|---|
| Index, shots, metrics | Verified | `services/pipeline` tests; real fixture runs |
| Footage index persistence | Verified | `index-store.test.ts`; tmp/real pipeline run |
| Vision tagging | Verified live | `tag:pipeline:smoke`: 9/9 shots, $0.004 actual |
| Tagging toggle/estimate/manual run | Verified (UI via tests/build; not click-tested) | Settings/ShotReview code, IPC tests |
| Planner (3 looks, marketing_38) | Verified | 55 planner tests; `marketing38` is now a fourth persisted variant |
| Marketing 38 variant | Verified | `PLANNED_VARIANTS`; 38 s EDL, price late, real export `..._marketing38_...mp4` 38.000 s; invalid pools skip only that variant |
| Job resume index reuse | **Verified by crash-kill** | `resume-smoke` resumes at `plan` with `footage index reused untouched`; folder signature (path + size/mtime hash) prevents stale reuse |
| Remix manual reorder / rooms | Verified | persisted order/room tags, recreated EDL, 13 tests; live 8.4 s render |
| Reference profile → agent guidance | Verified live | `reference:smoke` |
| Reference profile → automatic planner | **Verified** | measured `averageShotSec`/pacing flows to `PlanRequest.referenceStyle`; planner test proves fast vs slow counts differ |
| Remix scene split + presets | Verified live | `remix:smoke` 8.4 s render |
| Remix transcription/captions | Verified live | 30 words → 20 remapped; valid captions |

### Editing capabilities and rendering

| Feature | Status | Evidence |
|---|---|---|
| 29 capabilities (timeline/transition/effect/caption/overlay/audio/camera) | Verified | registry tests + capability suites |
| Speed ramps | Verified live | `ramp:smoke` 8.000 s render |
| Effects + grades in FFmpeg | Verified | effect lowering tests; render smoke |
| Custom `.cube` LUT | Implemented, no real LUT fixture | path validation tested |
| Transitions incl. v2 palette | Verified | xfade names checked against bundled FFmpeg |
| ASS caption animations | Verified | 16 overlay tests + FFmpeg parse |
| Remotion caption animations | Verified at unit level | 20 tests; full Remotion render not re-run this pass |
| Preview draft render | Verified live | preview 9 s / 8 s, 540×960 |
| Export 9:16 / 16:9 | Verified (fixtures) | agent/remix smoke renders |
| 1:1 and `pin` profiles | Implemented | no live render this pass |
| 4K / custom resolution | **Not implemented** | schema only |
| Segment cache / partial re-render | **Verified with real ffmpeg** | `services/pipeline/test/segment-cache.test.ts`: run 2 `hits=2 misses=0`, identical duration, unchanged segment mtimes; changed clip → `hits=1 misses=1` |
| Rendered-output visual inspection | Verified live | `review:smoke`: verdict fail on colour fixtures, 7 timestamped issues, $0.0167 |

### Audio

| Feature | Status | Evidence |
|---|---|---|
| Studio TTS (Gemini) | **Fixed + verified live** | Was sending mp3 + a Matilda id; now PCM + Gemini voice map; `tts-smoke` 4.28 s audio |
| Studio TTS (ElevenLabs) | Verified live (provider call) | curl 200, mp3 with `matilda` |
| Kokoro offline | Implemented, **not verified** | model not downloaded in this environment |
| Voice mixing, ducking, mastering | Verified | audio/mixer tests, export QA |
| Music bank | Verified (fixtures) | music tests; synthetic beds |
| AI music generation (Lyria) | **Implemented + verified live** | `scripts/music-smoke.ts`: `google/lyria-3-pro-preview` streamed a **177.267 s**, 44.1 kHz stereo MP3 (4,262,123 bytes) for **$0.08**; generation selects the bed for new exports |
| Music settings | Implemented | Settings “Music bed” card, `music:generate`, `settings.musicTrack`, ledger role `music` |
| Transcription (Scribe v2) | Verified live | remix transcript smoke |

### Agent

| Feature | Status | Evidence |
|---|---|---|
| Tool loop, discovery, validation | Verified | 13 orchestrator tests + live runs |
| Approvals (event/approve, one per capability) | Verified at unit level; UI wired | IPC tests; live approval run |
| Preview tool | Verified live | draft renders |
| Commit + apply | Verified live | version files, `auto` applies |
| Completeness check | Verified | skipped grade reported |
| Budget caps | Verified | ledger evaluation pre-flight |
| Reference guidance | Verified live | reference smoke |
| Same state for chat and visual controls | Partially | chat edits EDL; visual controls (Formats) select profiles; no full visual EDL editor |

### UI truth

| Screen | Status | Notes |
|---|---|---|
| Home / Intake / Variants / Formats / Export / Settings / Remix / Shot review | Real data | Shot review reads `shots:list`; Intake look picker is still decorative |
| Analysis | Real progress + real shot contact sheet | stale-job filter added |
| Refine chat | Agent + approvals real; **renders and plays the real draft**; version rail/history reads real versions, empty state when none | `refine:preview` → `zeniconic-media://preview/…`; 200/206 verified; e2e empty-state checks |
| Variants / Shot review / Intake / Analysis | Real shot index, rooms, durations, scores and footage counts; no fabricated storyboard, camera moves or room cards | `api.shots.list`; e2e 66/66 |
| Settings | Model roles/spend cap/reset/music bank derive from `models.json` + catalogue; no fake test state | e2e model-row + “No test run yet” checks |
| Settings diagnostics | Real IDs | fixed this pass |
| Export estimate | Honest | invented minutes removed |

## Bugs found and fixed in this pass

1. **Gemini TTS was broken** — wrong response format and voice ids. Fixed and
   verified live.
2. Review inspection truncated JSON at 700 tokens → raised to 1,800; live run
   now parses.
3. Analysis accepted stale progress from another job — filtered by job id.
4. Ramps were retimed through a scalar speed — skipped.
5. Transition could borrow a handle from a ramped clip — refused.
6. `analysis:start` could orphan a queued job — cancelled on preparation failure.
7. Resumed jobs did not restore listing status — fixed.
8. Budget caps were not enforced pre-flight — fixed for agent/tagging.
9. Browser tagging toggle pretended to persist — now refuses.
10. Voice spend was invisible — character-rate estimate recorded.
11. Remix used a nonexistent `shot.id` — fixed to `sh{index+1}`.
12. EDL gap rule rejected remix jumps — now keyed on `sourceId` + `src`.
13. Export displayed invented minutes — replaced with an honest line.
14. Settings diagnostics showed fabricated example logs — replaced with real
    build/model IDs.

## Remaining work, by severity

**High**
1. Kokoro packaged path unverified; Gemini TTS is now the working studio path.

**Medium**
2. Remix manual reorder + room tagging of imported shots.
3. Transcription spend in the ledger.
4. 4K/custom output.
5. Marketing (`marketing_38`) still renders in one pass and bypasses the segment cache.

**Low**
6. Packaging/signing, single-instance lock, disk preflight.
7. Resume from `plan` rebinds and re-indexes the folder (the stage is not repeated, but its work is).
8. Intake look picker is decorative.

## Architecture weaknesses

- Two renderers (FFmpeg and Remotion) share the EDL but not a single lowered
  plan; effects exist in both, captions differ in fidelity.
- Export is not a `JobRecord`; it reports progress through a synthetic id.
- Remix variants reuse `look: 'social'`, which is cosmetic but confusing.
- Cost ledger records voice as a character-rate upper bound, not the invoice.
