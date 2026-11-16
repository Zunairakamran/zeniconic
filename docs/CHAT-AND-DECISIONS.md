# Chat and decisions

Two things are deliberately *not* hardcoded: what the user can ask for, and which
model makes which call. What stays hardcoded is the safety boundary.

## Why there is no list of intents

An intent list is a menu the user cannot see and the model must guess. It fails the
moment someone says "make it feel more expensive" or "the agent wants the garden
first, and can we lose the hallway?".

Instead the chat has **primitives**: small, typed operations on the EDL. The model
composes them. "Make it feel more expensive" becomes `set_look(editorial)` +
`set_music(calm_02)` + `adjust_durations(slower)` + `add_overlay(logo)` — a
composition nobody had to anticipate.

## The tool surface

| Tool | Kind | What it does |
|---|---|---|
| `read_edl` | read | Returns the current EDL, shot list and timeline summary |
| `list_shots` | read | Indexed shots with room, score, duration, reason |
| `patch_edl` | write | **JSON Patch** against an allowlist of paths, validated by schema + invariants |
| `set_look` | write | Changes typography, pacing and transition vocabulary |
| `set_music` | write | Track, gain, ducking; re-snaps cuts to the cached beat grid |
| `set_captions` | write | Mode, style, language, word edits |
| `set_voice` | write | Mode, voice id, script text |
| `set_profile` | write | Canvas and safe area; triggers a reframe plan |
| `regenerate_variant` | write | New seed, same constraints |
| `preview` | action | 3 stills or an 8s draft at a given timestamp |
| `render` | action | Full render, budget-gated |
| `explain` | read | Why a shot was chosen, what a check failed |

`patch_edl` is the escape hatch that makes the surface genuinely open-ended. It accepts
RFC 6902 operations, but only against allowlisted paths (`/clips/*/inSec`, `/overlays/*`,
`/audio/music/trackId`, …). It cannot touch `provenance`, `id`, `createdAt`, or add
unknown keys. Every patch is validated with the same `validateEdl` the renderer uses.

### Guardrails that do not depend on the model behaving

1. **Indexed time rule.** The model cannot reference a timestamp that is not inside an
   indexed shot. Violations return `E_OFFSET_OUTSIDE_SHOT` with the nearest valid
   window, so the model can recover instead of guessing again.
2. **Preview before apply.** Every write produces a diff summary and a preview; apply
   is a separate call. The user can discard with no trace.
3. **One changeset, one undo.** All operations in a turn commit atomically as a single
   EDL version.
4. **Budget before request.** A paid action is refused before it is sent if it would
   exceed the listing or daily cap.
5. **No code execution.** Tools mutate data; they never run shell, never fetch arbitrary
   URLs, never write outside the listing workspace.

### Extensibility

The same tools are exposed over MCP, and the tool list is generated from a registry at
runtime. Adding `set_transition` later is one file plus a schema — no prompt rewrite,
no intent table. The system prompt includes the registry's JSON schemas, so the model
always sees the current surface.

## Typed decisions, not free text

Every model output that influences the edit is schema-constrained:

```ts
const RoomDecision = z.object({
  room: z.enum(['exterior','building','entry','living','kitchen','dining',
                'bedroom','bathroom','balcony','view','amenity','unknown']),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(120),
});
```

- Requests use OpenRouter `response_format: { type: 'json_schema', strict: true }`.
- The reply is validated with Ajv against the same schema; a parse failure retries
  **once** with the validation error attached, then fails closed with `E_JSON`.
- Nothing downstream ever parses prose. If a value matters, it has a schema.

### Two tiers of model

| Tier | Used for | Model policy | Output |
|---|---|---|---|
| **Decide** | Room labels, hook choice, voice verdict, caption style, which tool next | cheap and fast (`:floor`) | one small typed object |
| **Plan** | Shot selection, sequence, script, chat composition | strong (`:nitro`) | a full schema or tool calls |

Small decisions are ~90% of calls and are cheap on a small model. Planning is rare and
worth the price. This is the practical version of "use decision models": route the
bounded questions to bounded models, and keep the expensive model for judgement.

Every decision records `{ model, promptVersion, schemaHash, confidence, latency, cost }`
in the EDL provenance or the job log, so a regression can be traced to a model change
rather than argued about.

## What is still hardcoded

Only the boundary: allowed paths, enum values, budget caps, and the invariants. Those
are not preferences the user should be able to talk the model out of.

## Open questions

- **Undo granularity for chat.** One turn = one version is right for a beginner; power
  users may want per-tool undo. Default: one version per turn.
- **Silent fallback on `:floor` failure.** If the cheapest provider degrades, does the
  call retry on `auto` automatically or surface a warning? Default: retry `auto` once,
  then warn.
