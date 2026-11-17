# Editing Capability Registry

Status: design + initial catalogue. Code: `packages/capabilities`.

## Why

Today the planner is a fixed three-look function and the assistant can only
apply a JSON patch against a fixed allow-list. The agent needs a discoverable,
validated vocabulary of editing operations that grows without touching the
orchestrator.

A capability is **data + a pure function**:

```ts
export interface CapabilityManifest {
  id: string;                    // stable, kebab-case: set_transition
  version: string;               // semver of the manifest/handler pair
  name: string;                  // human label
  category: CapabilityCategory;  // timeline | transition | effect | caption
                                 // | overlay | motion | audio | camera
  description: string;           // what it does, in editor language
  params: object;                // JSON Schema (Ajv, strict)
  risk: 'low' | 'medium' | 'high';
  cost: 'free' | 'cheap' | 'render' | 'paid';
  backends: Array<'edl' | 'ffmpeg' | 'remotion' | 'native'>;
  preview: boolean;              // safe to preview in a draft render
  requires?: string[];           // runtime prerequisites (ffmpeg, kokoro…)
  conflictsWith?: string[];      // mutually exclusive capability ids
  docs: string;                  // short usage note for the model
}

export interface Capability extends CapabilityManifest {
  apply(edl: Edl, params: unknown, ctx: CapabilityContext): CapabilityResult;
}

export type CapabilityResult =
  | { ok: true; edl: Edl; summary: string; warnings?: string[] }
  | { ok: false; issues: CapabilityIssue[] };
```

`apply` is pure and synchronous: it never touches disk, never spawns a process
and never re-reads footage. Anything that needs media execution is either a
render-time descriptor in the EDL or a separate agent **tool** (`preview_render`,
`export_video`) that calls the existing renderer.

## Registry

```ts
createRegistry(capabilities) => {
  list(filter?): CapabilityManifest[];
  get(id): Capability | undefined;
  search(query, limit): CapabilityManifest[];   // deterministic keyword score
  validate(id, params): { ok: true; params } | { ok: false; issues };
  apply(id, edl, params): CapabilityResult;      // validates, then applies
  describe(id): string;                          // compact prompt card
  check(edl): CapabilityIssue[];                 // whole-EDL compatibility
}
```

- Manifests are exported from the same module as the handler, and a JSON
  snapshot test pins the catalogue so it cannot drift from the docs.
- `search` scores category/name/description tokens; no embeddings, no network.
- Duplicate ids throw at construction. Unknown ids are an error, never a no-op.
- `apply` clones the input EDL; the caller decides when to persist.

## Initial catalogue (must be real before registration)

| id | category | params | backends | risk |
|---|---|---|---|---|
| `trim_clip` | timeline | `clipId`, `inSec`, `outSec` | edl | low |
| `split_clip` | timeline | `clipId`, `atSec` | edl | low |
| `delete_clip` | timeline | `clipId`, `rebalance` | edl | medium |
| `duplicate_clip` | timeline | `clipId` | edl | low |
| `reorder_clips` | timeline | `order: string[]` | edl | medium |
| `set_clip_speed` | timeline | `clipId`, `speed` 0.25..4 | edl | low |
| `set_clip_duration` | timeline | `clipId`, `durationSec` | edl | low |
| `set_target_duration` | timeline | `targetSec` 5..90 | edl | medium |
| `set_transition` | transition | `clipId` (incoming), `type`, `durationSec` | ffmpeg/remotion | low |
| `apply_effect` | effect | `target: 'clip'\|'timeline'`, `clipId?`, `type`, `amount?`, `params?` | ffmpeg/remotion | low |
| `remove_effect` | effect | `effectId` | edl | low |
| `apply_grade` | effect | `target`, `clipId?`, `preset?`, `params?` | ffmpeg/remotion | low |
| `set_caption_style` | caption | `style`, `font?`, `box?`, `position?` | remotion/ffmpeg | low |
| `set_caption_animation` | caption | `animation`, `maxWordsPerLine?` | remotion/ffmpeg | low |
| `set_caption_mode` | caption | `mode` | edl | low |
| `upsert_caption_words` | caption | `words[]` | edl | low |
| `add_overlay` | overlay | `kind`, `text?`, `inSec`, `outSec`, `style`, `anchor`, `animation?`, `keyframes?` | remotion/ffmpeg | low |
| `update_overlay` | overlay | `overlayId`, fields | remotion/ffmpeg | low |
| `remove_overlay` | overlay | `overlayId`, `exceptRequired?` | edl | medium |
| `set_music` | audio | `trackId?`, `src?`, `gainDb?`, `duckUnderVoiceDb?` | edl/native | low |
| `set_audio_fades` | audio | `fadeInSec`, `fadeOutSec` | native | low |
| `set_voice` | audio | `mode`, `text?`, `voiceId?` | native | medium |
| `set_transform` | camera | `clipId`, `mode`, `focus`, `keyframes?` | edl/ffmpeg | low |
| `ken_burns` | camera | `clipId`, `fromScale`, `toScale`, `direction` | edl/remotion | low |
| `set_output` | execution | `width?`, `height?`, `fps?` | edl | low |

Deferred until a real renderer exists (schema supports them, registry does not
register them): `freeze_frame`, `reverse`, `stabilize` (vidstab), `mask`,
`object_removal`, `background_replace`, `track_subject`, `frame_interpolation`,
`motion_tracking`. Each needs a renderer + tests before it appears in `list()`.

## Risk and approval

- `low`: timeline trims inside indexed windows, transitions, effects, captions,
  overlays, grade, audio gain. Autonomous under `auto` autonomy.
- `medium`: delete/reorder clips, voice mode, target duration change, removing
  overlays, changing facts-adjacent copy. Ask under `ask` (default).
- `high`: anything that changes confirmed facts, deletes footage, spends money
  or installs a dependency. Always explicit approval, never batched silently.

Autonomy policy lives in settings: `suggest | ask | auto`. Risk classes map to
`allow | ask | deny` per level. The orchestrator enforces it; capabilities never
decide on their own.

## Extension workflow

1. Add/reuse a renderer path (FFmpeg filter chain or Remotion component) with a
   real output test.
2. Add an EDL field only if the renderer needs data the EDL cannot express;
   otherwise keep it a parameter.
3. Write the handler + manifest + Ajv schema.
4. Add unit tests (valid/invalid params, before/after EDL, determinism) and a
   render test if it lowers to media.
5. Register it; update the catalogue table and `docs/EDITING_CAPABILITY_REGISTRY.md`.
6. Version it; breaking param changes get a new major in `version`.

Runtime never loads third-party code. "Plugins" are compile-time manifests in
the repo, validated by the catalogue snapshot test.
