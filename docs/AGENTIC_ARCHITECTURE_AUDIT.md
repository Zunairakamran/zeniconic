# Agentic Architecture Audit — Zeniconic

Status: Phase 1 deliverable. Every claim below was checked against source on the
`950cc9d` checkout, not taken from older docs.

Last updated: 2026-11-17.

## 1. What exists today

Zeniconic is a local-first Electron 45 + React 19 + TypeScript desktop app that
turns a folder of property clips into 30 s variants or a 38 s marketing cut. The
EDL (`packages/edl/schema.json`, v1.0.0) is the single source of truth; the
planner is deterministic; FFmpeg does picture/audio and Remotion owns styled
overlays for non-marketing formats.

```
Renderer (sandboxed, no Node)
  └─ window.zeniconic.invoke(channel)     24 channels, allow-listed in preload
Main process (apps/desktop/main.ts)
  ├─ JsonStore                listings/<YYYY-MM-DD-slug>/listing.json
  ├─ JobRunner                in-memory stage machine: index → plan → render → review
  ├─ DesktopPipeline          analysis, variants, preview stills, export
  ├─ ChatService              one model turn → JSON patch → version file
  ├─ Settings                 theme/voice in settings.json; key in safeStorage
  └─ Kokoro downloader        resumable, checksummed, explicit
Contracts
  ├─ packages/edl             schema + runtime invariants + v1 migration
  ├─ packages/planner         room-order planner + marketing_38 beat sheet
  ├─ packages/render          FFmpeg filter graph, profiles, args
  ├─ packages/review          deterministic checks (+ optional vision)
  ├─ packages/ai              OpenRouter client, budget ledger, JSON validation
  └─ packages/store, jobs, ipc
Services
  ├─ pipeline                 decode metrics, shots, candidates, FFmpeg marketing film
  ├─ tagging                  contact-sheet vision tagging (CLI only)
  ├─ voice                    Kokoro + optional studio voice, mixing, mastering
  └─ remix                    scene split, transcription, presets, captions (unwired)
```

## 2. Working functionality (verified)

- Intake → facts persistence → analysis job → three planned variants → preview
  stills; `listings:updateFacts`, AED, listing ids and path traversal guards.
- `marketing_38` planner: eight beats, 38.000 s, explicit transition handles,
  beat-grid aware, deterministic.
- Export: profile framing, cut-only picture pass, Remotion or FFmpeg text pass,
  one voice pass per listing, two-pass loudness with hard delivery gate, review
  gate, SRT and cover sidecars, atomic-ish work dir cleanup, duration assertion.
- Chat: strict JSON patch, pointer allow-list, source/overlay/duration
  guardrails, version files, apply-by-pointer, repair turn once.
- Voice: Kokoro downloader (resume/checksum), presenter audio restore, offline
  and studio engines, line cache, mixing and mastering.
- Security: sandboxed renderer, typed IPC, validated args, CSP, navigation
  guard, key never crosses IPC, studio key read per call and redacted.
- Tests: 91 files / ~988 cases; admin/QA harness `qa-landscape-export.ts` is the
  only real end-to-end export proof.

## 3. Missing capabilities (the assignment's gap list)

1. **No agent.** `ChatService` has no tool loop, no context inspection beyond a
   single EDL snapshot, no preview render, no self-correction, no approvals.
2. **No tool calling in `packages/ai`.** `ChatRequest` exposes no `tools`,
   `tool_choice` or tool-role messages. (Verified: grep for `tool` returns
   nothing in that package.)
3. **No capability registry.** Editing behaviour is a fixed planner plus a
   fixed JSON-patch allow-list.
4. **No effects/keyframes/grade/speed-ramp in the EDL.** v1 has clips
   (in/out/speed scalar/transform path/transitions), overlays, caption words,
   music/voice. Requests like "blur transition", "kinetic captions", "premium
   grade" cannot be represented, let alone rendered.
5. **Two renderers without a shared plan.** Remotion path and marketing FFmpeg
   path diverge; effects added to one are invisible to the other.
6. **The app never persists the footage index or tags.** `DesktopPipeline`
   holds index/candidates in memory and writes only `clipCount`; chat's source
   guardrail therefore sees an empty candidate list after a restart. Tagging is
   called only by `scripts/tag-clips.ts`.
7. **No persistent jobs.** A relaunch loses queued work; export is not a
   `JobRecord`.
8. **No cost ledger.** `main.ts` passes `spendUsd: 0`; `BudgetLedger` exists but
   nothing persists it.
9. **No reference analysis, transcription, or beat detection wired.** Music
   grids are computed from a supplied BPM; nothing detects beats.
10. **No real preview of a chat edit.** Apply swaps a pointer; no draft render.
11. **UI truth gaps.** `#shots` is unreachable and shows demo data; RefineChat's
    stage is a mock; analysis contact-sheet rooms are synthesised; export has
    dead cover/permit controls.
12. **Model capability assumptions.** `models.json` pins IDs but nothing probes
    image/tool/structured-output support; `response_format` is sent whenever a
    schema is requested.

## 4. Hardcoded restrictions found in code

- `VARIANT_LOOKS = ['calm','walkthrough','social']` in `apps/desktop/variants.ts`;
  `planVariants` always plans those three. `marketing_38` is only reachable by
  `edl.format.id` and the `ZENICONIC_REMOTION` env flag.
- `PROFILES` is a closed set of four (`packages/render/src/profiles.ts`); no
  custom resolution/fps.
- Chat allow-list in `apps/desktop/chat.ts` (`ALLOWED_PATHS`) and the pointer
  tree in `packages/chat/src/patch.ts` must both change for any new field.
- Marketing length is fixed at 38 s; the 30 s planner target is 30 s
  (`TARGET_SECONDS`).
- Transition map is a closed enum (`packages/edl/src/types.ts`).
- Export filename omits the format token required by `docs/CONVENTIONS.md`.

## 5. Technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| EDL v2 breaks v1 files | Lost projects | Additive schema, migration on read, v1 fixtures in tests |
| Effects diverge between FFmpeg and Remotion | Preview ≠ export | One `EDL → RenderPlan → backend` compiler; capability declares backends; validator rejects unsupported combos |
| Agent writes invalid/destructive edits | Corrupted projects | Draft EDL + validate + version file + approval risk classes; never mutate in place |
| Model/tool hallucinations | Broken renders | Strict tool schemas, indexed-time rule, allow-list, repair turn, bounded loop |
| Long renders repeated per chat turn | Time/battery | Draft previews (540p/range), segment cache + invalidation |
| Cost drift | Budget loss | Ledger persisted, per-task caps, cheap role routing, pre-flight pricing |
| Renderer/key exposure | Credential leak | Keep key in main; never log; agent runs in main; CSP unchanged |
| Two sources of truth for versions | Lost history | Versions stay EDL files + manifest; agent writes through the same store |

## 6. Recommended architecture changes

1. **EDL v2** (additive): effects, grade, speedRamp, text animation, caption
   styling, output overrides, transition palette. Migration 1 → 2.
2. **Capability registry** (`packages/capabilities`): versioned manifests +
   pure EDL-mutating handlers, risk/cost/backends metadata, search/validate/apply.
3. **Render plan compiler** (`packages/render`): `EDL → RenderPlan` with effects
   lowered to FFmpeg filters or Remotion props; one validation point.
4. **Agent orchestrator** (`packages/agent`): context → plan → tools → draft →
   preview → review → correct, bounded, cancellable, event-streamed.
5. **AI client extension**: native tool calls + JSON-action fallback, model
   capability probing, per-role model config.
6. **Persistence**: job store, footage index + tags on disk, cost ledger,
   project operation log/snapshots.
7. **IPC + UI**: `agent:*`, `project:*`, `capabilities:*`, `shots:*`,
   `jobs:cancel`; agent panel with approvals and real preview; visual controls
   that emit the same EDL operations.
8. **Reference analysis** (`services/reference`): local style metrics +
   optional vision pass, `StyleProfile` fed to the planner as guidance.

## 7. Files to modify

`packages/edl/{schema.json,src/types.ts,src/validate.ts,src/migrate.ts,src/index.ts,test/*}`
`packages/ai/src/{types,client,messages,envelope,cost}.ts`
`packages/planner/src/{types,plan,sequence,marketing}.ts`
`packages/render/src/{graph,args,profiles}.ts`
`packages/review/src/{review,checks}.ts`
`packages/jobs/src/{types,runner}.ts`
`packages/ipc/src/{contract,handlers,settings}.ts`
`apps/desktop/{main,pipeline,chat,variants}.ts`
`apps/ui/src/{api,types,App}.tsx`, `screens/{RefineChat,ShotReview,Variants,Export,Settings}.tsx`
`services/pipeline/{service,indexer,marketing}.ts`
`services/tagging/src/tag-index.ts` (wire), `services/remix/src/transcribe.ts` (wire)
`services/pipeline/models.json`
`README.md`, `docs/HANDOFF.md`

New: `packages/capabilities/**`, `packages/agent/**`, `services/reference/**`,
`apps/ui/src/screens/Agent*`, `tests/fixtures/`.

## 8. Files to leave untouched

- `docs/design/tokens.css` and the visual language (no redesign).
- `packages/core` primitives (time/text/geometry) unless a bug is proven.
- Marketing FFmpeg filter logic and its timing assertions (extend, never rewrite).
- `services/voice` engines and downloader (only wiring changes).
- The EDL JSON-patch mechanism itself (extend the allow-list tree; do not replace
  it with free-form object writes).
- `scripts/e2e.mjs` (extend with routes; do not weaken assertions).

## 9. Migration strategy

1. Land EDL v2 schema + migration with v1 fixtures; renderer must produce
   byte-identical output for v1 documents with no new fields.
2. Land capability registry + tests without changing the current entry points.
3. Land AI tool calling behind an option; keep the JSON-schema chat path.
4. Add agent orchestrator and new IPC channels; old `chat:*` remains as a
   facade until the new screen passes its tests.
5. Move preview/export onto `RenderPlan`; keep the marketing fast path as a
   `RenderPlan` profile, not a fork.
6. Persist jobs/index/ledger with read-compat for existing data dirs.
7. Only then expand capabilities (effects, captions, motion, reference).

## 10. Baseline evidence

Static: 91 test files, ~988 cases. Runtime numbers are recorded in
`docs/TEST_RESULTS.md` after the first green run.
