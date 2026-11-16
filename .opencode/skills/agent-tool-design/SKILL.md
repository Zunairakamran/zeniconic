---
name: Agent tool design
description: Use when building, reviewing or debugging the Zeniconic chat layer that edits an EDL — "the assistant rewrote the whole video", "add a tool so it can swap the music", "it invented a timestamp that doesn't exist", "the preview didn't match the export", "it burned $6 on upscaling", "we changed the planning prompt and every plan went stale", "why does it keep choosing the kitchen", "write evals for the editing assistant". Covers the 15-tool catalogue with exact JSON schemas, the indexed-shot time rule, proposal/apply diffs, budget caps and the cost ledger, prompt versioning, and the 30-case eval gate.
---

# Agent tool design

The chat is not a chatbot that writes code, and it is not an editor that writes
EDL JSON. It is a constrained editing surface: the model names an intent and
indexed things, the app owns timestamps, schema shape, money and undo.

One sentence holds the design together:

> **The model proposes typed changes; the app validates, previews, prices and applies them.**

If a feature cannot be expressed as a validated tool call against `packages/edl/schema.json`, it is not a chat feature yet.

## When to use

- Adding, renaming, splitting or removing a chat tool, or wiring a new one into
  the renderer's preview card.
- A production report says the assistant edited the wrong shot, invented a
  timestamp, repeated a shot, changed two variants at once, or applied an edit
  with no preview.
- A tool call failed validation in the wild and the model could not recover.
- A paid action ran without a price, the ledger disagrees with the provider, or a
  job passed its cap.
- You are changing a prompt, a model ID in `services/pipeline/models.json`, or a
  tool schema, and need to know what cache and evals that invalidates.
- You are writing or extending the 30-case eval suite.

Do **not** use this skill for render maths, ffmpeg flags, look tokens, packaging, or onboarding copy.

## When to switch skills

| The ask | Go to |
|---|---|
| Installer, crash recovery, backups, privacy, handoff docs | `production-hardening` |
| Format, look, hook, beat timing, room order, on-screen copy | `real-estate-creative` |
| Shot metrics, room tags, crop anchors, index rebuilds | `footage-analysis` |
| Voice judgement, music bank, loudness, ducking | `audio-restoration` |
| Canvas, safe areas, type scale, colour | `docs/design/tokens.css` and `docs/SPEC.md` |
| "Add a field to the EDL" | Change `packages/edl/schema.json` first, bump `edlVersion`, then add the migration in `production-hardening` |
| "Make a TikTok version" when the user means a destination | Not a tool. Destinations are packaging; see `docs/CONVENTIONS.md` |
| "Make a second creative variant" | `regenerate_variant` here, or the Create variant flow in the UI |

## Workflow

1. **Start from a sentence a user actually says.** Name the tool verb + object:
   `swap_shot`, `shorten_to`, `rewrite_cta`. Never `mutateClips` or `applyDiff`.
   If you cannot name the user sentence, the tool is too abstract.
2. **Check the schema before the design.** Every write must land in a field that
   exists. The EDL has no `hook`, no `roomList`, no `gap`, and no `timelineStart`.
   A hook is `clips[0]` plus its overlay plus `reason`; a room is the `room` enum
   on clips. Never smuggle a concept into `reason` or a fake overlay.
3. **Write the input schema.** `additionalProperties: false`, every enum copied
   from the schema, patterns from `docs/CONVENTIONS.md` (`c03`,
   `s_4f2a1b9c`, `sh_s4f2a1b9c_003`), six properties maximum, no free-form time.
4. **Route all time through `TimeRef`.** `{ "clipId": "c03", "offsetSec": 1.2 }`
   or a clip-relative fraction. There is no tool that accepts a global timeline
   second. The app resolves it; the model never does arithmetic on the timeline.
5. **Declare validation layers.** L0 JSON Schema, L1 references, L2 EDL
   invariants, L3 policy, L4 media preflight. Each layer has its own error codes
   so the model can repair; see `references/validation-and-guardrails.md`.
6. **Assign one latency class** from the table below, and make the UI honest
   about it. A tool that claims "instant" and takes six seconds has already
   broken trust.
7. **Define the preview.** Three stills at 0 %, 50 % and 100 % of the affected
   range, or an 8.000 s draft when motion or timing changes. Plus two to five
   human-readable diff lines. No preview, no tool.
8. **Price it before it runs.** Paid calls return an estimate and require a click.
   The executor enforces the cap, not the model. See `references/cost-guards.md`.
9. **Version it.** Prompts and tool schemas carry versions; the plan cache key
   includes both. A prompt change evicts plans, never the footage index.
10. **Add evals and gate the build.** Every new tool or prompt change lands with
    cases in `references/evals.md`. The suite must pass before release.

## Hard rules

1. **No code, no EDL JSON.** The model emits tool calls only. A response that
   contains a patch, a script or a whole EDL is rejected at the transport layer.
2. **No global timestamps.** Every time is a `TimeRef` anchored to a clip, and
   the clip is anchored to an indexed shot. `offsetSec` outside
   `[0, outSec − inSec]` is an error with the allowed range in the message.
3. **No unindexed nouns.** Shot IDs must exist in `footage_index.json` for this
   listing. The validator returns up to five valid alternatives, never a silent
   substitution.
4. **Every mutation is previewed, then applied by a human click.** Chat text
   alone never commits. Undo and redo are the only reversible exception and show
   their diff inline.
5. **One turn of content edits = one changeset = one revision = one undo step.**
   Up to three calls commit atomically against one `baseEdlId`; undo is a
   pointer move, not a revision. A moved head rejects with `E_STALE_PROPOSAL`.
6. **The model never sees the whole EDL.** It sees a ≤6 KB editing view with clip
   IDs, room, source shot, in/out, score, reason, overlays, the top three unused
   candidates per room, audio summary and budget. Full EDLs are for the validator
   and the renderer.
7. **Labels, prices and paths are app-supplied.** The model chooses `lookId`,
   never `look.label`; `trackId`, never `src`; `shotId`, never `src` or `inSec`.
8. **Facts gate applies to every text write.** Price, address, beds, baths, area,
   phone and dates must match the confirmed record character for character after
   formatting. `E_FACT_UNCONFIRMED` and `E_FACT_MISMATCH` stop the apply.
9. **A paid action never runs without an estimate and a click.** AI upscaling is
   opt-in per delivery, never automatic, never bundled into "Export all", and never a chat tool; chat may quote the price.
10. **Prompt or tool-schema change without a green eval run is a broken build.**
    The CI label `prompt-change` enforces it.
11. **`explain_choice` is read-only.** It may cite scores, reasons and
    alternatives; it may never create a proposal.
12. **No repeated shot.** The `no_repeated_shot` review check is a validator
    rule too: a swap or add that duplicates a source shot is rejected unless the
    format is `before_after` and the pair is explicit.

## The catalogue

Fifteen model-facing tools; full schemas, returns and failure modes live in `references/tool-catalog.md`.

| Tool | What it changes | Latency class | Paid |
|---|---|---|---|
| `swap_shot` | one clip's source shot and timing | Draft | no |
| `reorder_rooms` | `clips[]` order, IDs stable | Draft | no |
| `shorten_to` | `format.targetDurationSec` + clip timing | Draft | no |
| `change_hook` | `clips[0]`, hook overlay, its `reason` | Draft | no |
| `rewrite_cta` | the `cta` overlay text and placement | Instant | no |
| `swap_music` | `audio.music` track and gains | Draft | no |
| `set_crop` | `clips[].transform` | Instant | no |
| `set_look` | `look` | Draft | no |
| `add_room` | one to four new clips | Draft | no |
| `remove_shot` | one clip or one overlay | Draft | no |
| `regenerate_variant` | a whole new EDL revision | Full | possible |
| `set_captions` | `captions` | Conditional | possible |
| `set_voice_mode` | `audio.voice` | Draft | possible |
| `undo` | the head pointer | Instant | no |
| `explain_choice` | nothing (read-only) | Instant | no |

**Latency classes.**

| Class | Definition | Budget |
|---|---|---|
| Instant | Patch the EDL and repaint; no encode | ≤150 ms p95 |
| Draft | 8.000 s draft at 540p (540×960 vertical), 30 fps, from cached segments | 4–9 s p95 |
| Full | Complete render at the target render profile | 1.5–4× realtime |
| Conditional | Instant for `sidecar`/`none`; draft for `burn`/`both` | per branch |

## Call envelope

Every model turn returns zero to three calls in this shape. The app resolves the
base EDL from the session; the model cannot name another listing.

```json
{
  "turnId": "turn_7f3a2c91",
  "baseEdlId": "edl_cinematic-calm_v4",
  "calls": [
    { "tool": "shorten_to", "args": { "targetDurationSec": 20, "strategy": "both" } },
    { "tool": "change_hook", "args": { "hookShotId": "sh_s4f2a1b9c_012", "hookText": "The garden sold it" } }
  ]
}
```

The editing view is deliberately small. An excerpt:

```json
{
  "edlId": "edl_cinematic-calm_v4",
  "format": { "id": "cinematic_hero", "targetDurationSec": 30 },
  "look": "calm",
  "durationSec": 29.840,
  "clips": [
    { "clipId": "c01", "shotId": "sh_s4f2a1b9c_003", "room": "exterior",
      "inSec": 2.100, "outSec": 6.400, "speed": 1, "score": 0.84,
      "reason": "Best light on the facade" }
  ],
  "overlays": [{ "id": "o04", "kind": "cta", "text": "Book a viewing" }],
  "audio": { "musicTrackId": "calm-02", "voiceMode": "clean", "lufs": -14 },
  "captions": { "mode": "burn", "style": "clean_lower" },
  "budget": { "softUsd": 2.0, "hardUsd": 5.0, "spentUsd": 0.1840 }
}
```

The live view carries every clip in this shape; the model is told the count and total duration and is never asked to add up timeline positions.

## TimeRef

| Field | Type | Rule |
|---|---|---|
| `clipId` | string `^c[0-9]{2,3}$` | Must exist in the base EDL |
| `offsetSec` | number, 3dp | Source seconds from `clip.inSec`; `0 ≤ offsetSec ≤ outSec − inSec` |

Resolution: `timelineSec = sum(previous (outSec − inSec) / speed) + offsetSec / speed`.
The source shot's own `inSec`/`outSec` bound the clip's range, so a TimeRef can
never escape an indexed shot even if the clip range is wider than the shot.

Rejection is specific and repairable:

```json
{ "code": "E_OFFSET_OUTSIDE_SHOT",
  "message": "c03 runs 0.000–6.400 s at speed 1.0.",
  "allowed": { "min": 0, "max": 6.4 },
  "hint": "Use offsetSec between 0 and 6.4, or pick another clip." }
```

The chat layer feeds the error back as a tool result. Maximum two repair attempts per call, then the turn fails in plain language with up to three valid alternatives. No silent clamping: clamping a time is a silent edit.

## Proposal, apply, undo

1. Tool calls are evaluated against an immutable `baseEdlId`. All calls in a turn
   merge into one **changeset** with one `proposalId` (`prop_` + 8 hex).
2. The preview card shows the combined diff, three stills or an 8.000 s draft,
   warnings, and the price if any. Proposals expire after 10 minutes or when the
   head EDL changes.
3. **Apply** re-validates every call against the current head, writes the new EDL
   atomically, and creates exactly one revision: `parentId = baseEdlId`, for
   example `edl_cinematic-calm_v5`. One undo step.
4. **Undo** moves the head to `parentId`; **redo** moves it forward. Undo restores
   the previous EDL byte-for-byte because revisions are immutable. A new edit
   after undo clears the redo stack and branches from the restored head.
5. Renders are cached by EDL hash. Undo never deletes them; cache GC keeps the last three per variant plus any render referenced by a delivery.

Diff lines are written for a beginner, in second person, no jargon:

```
Opening shot: kitchen wide (score 0.61) → living room, window light (score 0.83)
Total length: 30.0 s → 20.0 s
Two clips trimmed; the CTA still holds for 3.0 s
```

## Cost guards

Defaults, owned by `services/pipeline/budget.json`:

| Guard | Value | Behaviour |
|---|---|---|
| Per chat turn, model tokens | $1.0000 | Reject the next model call; media actions are priced separately |
| Per-job soft budget | $2.0000 | Warn, require an explicit click |
| Per-job hard cap | $5.0000 | Block; offer the local or cheaper route |
| Monthly soft ceiling | $50.0000 | Banner at 80 %, no block |
| Upscale confirm threshold | $0.5000 | Any estimate above it needs a second click |

AI upscaling is priced per **output** second, not source second:

| Route | Unit price | 30 s output | 60 s output |
|---|---|---|---|
| Topaz on fal, low | $0.0100/s | $0.3000 | $0.6000 |
| Topaz on fal, high | $0.0800/s | $2.4000 | $4.8000 |
| ByteDance | $0.0072/s | $0.2160 | $0.4320 |

A 3-variant, 3-destination job at 60 s is 540 output seconds: $43.2000 on Topaz high (blocked by the $5 cap) or $3.8880 on ByteDance (over the soft budget, so it asks). The price is shown before the click, in dollars and in "about N minutes of your time"; the ledger reconciles actual spend to four decimals.

## Prompt versioning

| Artefact | Version lives in | Changing it invalidates |
|---|---|---|
| Tagging prompt | `provenance.promptVersions.tagging` (`tag-1.3.0`) | Plans built from that index, not the index itself |
| Planning prompt | `provenance.promptVersions.planning` (`plan-1.4.0`) | Cached plans and cached changesets |
| Chat, review, TTS prompts | `stage_runs.prompt_version` in SQLite | Cached proposals and reviews only |
| Tool schema contract | `toolSchemaVersion` in SQLite + `pipelineVersion` | Proposals, replay fixtures, evals |
| Model IDs | `services/pipeline/models.json` + `provenance.models` | Plans and review, same as a prompt change |

`provenance.promptVersions` has exactly two slots, `tagging` and `planning`, because the schema says so; do not add a third. Chat, review and TTS prompt versions live in SQLite and are copied into the diagnostics bundle.

The plan cache key is
`sha256(sourceIndexHash + tagging + planning + models + toolSchemaVersion)`.
A prompt change evicts plans. The footage index is keyed by source hashes plus
the analysis pipeline version, so it survives every prompt change. Same inputs
and same versions must produce a byte-identical EDL.

## References

| File | Read it for |
|---|---|
| `references/tool-catalog.md` | All 15 tools: exact JSON schema, validation, return shape, latency, failure modes |
| `references/validation-and-guardrails.md` | L0–L4 layers, error catalogue, TimeRef fuzzing, fact gate, injection posture |
| `references/cost-guards.md` | Ledger DDL, estimate/confirm/execute/reconcile, caps, upscale maths, reconciliation |
| `references/evals.md` | The 30 cases, first 12 in full, harness, scoring, gate, CI wiring |

## Verification

Run before merging a tool or prompt change:

```powershell
pnpm vitest run services/pipeline/tools
pnpm vitest run services/pipeline/evals/tool-suite.test.ts
pnpm tsx services/pipeline/evals/run.ts --suite tools-v3 --fail-under 0.9
pnpm tsx services/pipeline/tools/replay.ts --turn turn_7f3a2c91
pnpm ajv validate -s packages/edl/schema.json -d "data/listings/2026-11-14-14-oak-avenue/edl/*.json" --spec=draft2020 -c ajv-formats
```

| Check | Pass condition |
|---|---|
| Schema validity | 30/30 eval calls validate at L0 |
| Tool choice | ≥27/30 exact expected tool (90 %) |
| Invariants | 30/30 post-apply EDLs satisfy L2, zero violations |
| Safety | Every adversarial case refuses; zero paid calls, zero cross-listing writes |
| Determinism | Replaying a logged turn reproduces the EDL hash exactly |
| No silent edit | Head hash unchanged until Apply; proposal expiry enforced |
| Undo | Apply then undo restores the base hash; redo restores the applied hash |
| Time rule | 1,000 fuzzed offsets, 100 % outside-shot rejected with `E_OFFSET_OUTSIDE_SHOT` |
| Cost | Estimate matches ledger to $0.0001 on fixed units; cap blocks at $5.0000 |
| Latency | Instant p95 ≤150 ms; draft p95 ≤9 s on the CI machine |
