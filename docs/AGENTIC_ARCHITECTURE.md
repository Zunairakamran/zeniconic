# Agentic architecture

Status: implemented foundation, Phase 1–3. See `docs/IMPLEMENTATION_STATUS.md`
for the exact per-feature state and `docs/TEST_RESULTS.md` for evidence.

## Shape

```
UI (RefineChat agent mode + autonomy control)
  │  agent:run (typed request/response)
Main process
  ├─ AgentService        context, model fallback, commit + apply
  ├─ ChatService         versions, apply, diff (unchanged facade)
  ├─ CapabilityRegistry  28 pure, validated editing operations
  ├─ AgentOrchestrator   bounded tool loop, approval gate, budgets
  ├─ Render              EDL + effects → FFmpeg filters (Remotion for text)
  ├─ Review              deterministic checks after render
  └─ Store               listing, variants, versions, (jobs store available)
        │
      EDL v2 (additive; v1 still valid)
```

One orchestrator. No multi-agent framework, no decorative roles. The agent's
vocabulary is the capability registry, so discovery and execution cannot drift.

## Request lifecycle

1. **Context** — `AgentService` reads the variant EDL, listing facts, the
   persisted shot index (when present) and recent version summaries.
2. **Understand** — one model turn with a system prompt describing the edit,
   facts, shots and capability cards.
3. **Discover** — `search_capabilities` / `describe_capability`; the registry
   scores id/name/category/description/params tokens.
4. **Edit** — `apply_capability` or a named shortcut tool applies a pure
   handler to a cloned EDL. The registry validates params (Ajv), the input EDL
   and the output EDL with the same validator the renderer uses.
5. **Approve** — risk classes: low (autonomous), medium/high (policy by
   autonomy `suggest|ask|auto`). A pending approval is streamed as an
   `agent:event`; the UI answers through `agent:approve`. One decision per
   capability per run; a 5-minute timeout denies. A denial is a tool result,
   not a crash.
6. **Preview** — `preview_render` calls the real draft renderer (540-wide
   picture + overlays, FFmpeg, silent, probed). The model can inspect the
   returned path and change the edit. A reference video's measured style
   profile (pacing, shot length, palette, motion) is part of the prompt as
   guidance, never as a property fact.
7. **Bound** — max steps (10), max tool calls (24), max run cost ($0.25).
   Every tool result is capped before it returns to the model.
8. **Commit** — `ChatService.commit` writes a version file with the same lock,
   manifest and `parentId` discipline as the old chat. Under `auto` the service
   then calls `chat:apply` so export uses the new cut.
9. **Validate** — a final draft that fails validation is never committed; the
   orchestrator reverts to the last valid draft and reports the issues.
10. **Persist** — the footage index is written after analysis, jobs hydrate
    into `JobRunner` at boot, and every billed agent run is recorded in the
    cost ledger that Settings reads.

## Capabilities

A capability is a manifest plus a pure handler:

```ts
{ id, version, name, category, description, params /* JSON Schema */,
  risk, cost, backends, preview, docs,
  apply(edl, params, { durationSec }) → { ok, edl, summary, warnings } }
```

They never touch disk, never spawn a process, and never read footage. Media work
is either a render-time descriptor in the EDL or a separate tool
(`preview_render`). This is what makes agent edits testable, reversible and
deterministic.

Categories: timeline (8), transition (2), effect (4), caption (5), overlay (3),
audio (3), camera/output (3). Full list: `docs/EDITING_CAPABILITY_REGISTRY.md`
and `docs/AGENT_TOOL_REFERENCE.md`.

## Tools

The agent sees 8 core tools (`get_project`, `search_shots`,
`search_capabilities`, `describe_capability`, `apply_capability`,
`validate_edl`, `preview_render`, `finish`) plus 8 named shortcuts
(`trim_clip`, `set_transition`, `apply_effect`, `add_text`, `set_captions`,
`apply_color_grade`, `set_music`, `set_target_duration`). All shortcuts call the
same registry; there is no second implementation.

## OpenRouter

- One client (`packages/ai`), one endpoint family, key only in the main process.
- Native tool calling (`tools` / `tool_choice`, assistant `tool_calls`, `tool`
  messages), with the strict JSON-schema path preserved for chat.
- Roles and candidates live in `services/pipeline/models.json`; no model id is
  hardcoded at a call site. A capability failure falls back to the next
  candidate, then surfaces a plain-language error.
- The verified default agent is `deepseek/deepseek-v4.1-flash`; escalation is
  `openai/gpt-6-astra`. See `docs/OPENROUTER_MODEL_CONFIGURATION.md`.

## Rendering contract

`EDL → FFmpeg filter graph` lowers transforms, speed, transitions (with source
handles), effects and grades. Order: framing → spatial effects → colour →
temporal → fps/format → global effects → captions. A document with no effects
and no transitions produces the same graph as EDL v1 (snapshot-tested).

Effects without a renderer throw `EffectRenderError` naming the effect; they
are not silently dropped. Unsupported advanced effects are not registered.

## Security boundary

- Renderer is sandboxed; only contract channels cross the bridge.
- Agent/tool inputs are validated by Ajv and the EDL validator; no shell, no
  arbitrary JS, no filesystem writes from the model.
- The model cannot change confirmed facts: fact tools are absent, and the
  prompt forbids inventing them. Fact editing stays an explicit user action.
- Cost is priced pre-flight; unknown models are refused before the network.
