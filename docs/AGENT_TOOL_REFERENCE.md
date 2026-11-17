# Agent tool reference

Status: implemented in `packages/agent` and `packages/capabilities`. All tools
are synchronous EDL mutations unless stated otherwise; the desktop host owns
persistence and media execution.

## Core tools

| Tool | Params | Risk | What it does |
|---|---|---|---|
| `get_project` | — | low | Returns duration, format, look, clips, overlays, grade, effects, captions, music, voice. |
| `search_shots` | `query?`, `room?`, `minScore?`, `limit?` | low | Finds indexed shots by text/room/score. Empty when no index was persisted. |
| `search_capabilities` | `query`, `limit?` | low | Deterministic keyword search over the registry. |
| `describe_capability` | `id` | low | Full params schema, risk, cost, backends, docs. |
| `apply_capability` | `id`, `params` | manifest | Validates and applies one capability to the draft. |
| `validate_edl` | — | low | Schema + timeline invariants on the draft. |
| `preview_render` | — | low | Renders a real 540-wide draft (picture + overlays) when the desktop host supplies the preview port; probes it and returns the path. Never fakes a file. |
| `finish` | `reply` | low | Stops the loop with one or two plain sentences. |

## Named shortcuts

Each is a thin wrapper over `apply_capability`; no duplicate logic.

| Tool | Capability | Params |
|---|---|---|
| `trim_clip` | `trim_clip` | `clipId`, `inSec?`, `outSec?`, `keepTarget?` |
| `set_transition` | `set_transition` | `clipId`, `type`, `durationSec?` |
| `apply_effect` | `apply_effect` | `target`, `clipId?`, `type`, `amount?`, `params?` |
| `add_text` | `add_overlay` | `kind`, `text?`, `inSec`, `outSec`, `style?`, `anchor?`, `animation?`, `keyframes?` |
| `set_captions` | `set_caption_animation` | `animation`, `maxWordsPerLine?` |
| `apply_color_grade` | `apply_grade` | `target`, `clipId?`, `preset?`, `look?`, `intensity?` |
| `set_music` | `set_music` | `trackId?`, `src?`, `gainDb?`, `duckUnderVoiceDb?` |
| `set_target_duration` | `set_target_duration` | `targetSec` (5–90) |

## Capability catalogue (28)

**Timeline** `trim_clip`, `split_clip`, `delete_clip`, `duplicate_clip`,
`reorder_clips`, `set_clip_speed`, `set_clip_duration`, `set_target_duration`,
`speed_ramp`. Every retime trims tails or slows clips; it never invents source
frames, and it clamps overlays that would fall past the new end. `speed_ramp`
rescales its knots so the clip length is unchanged and is rendered as a
per-segment trim/setpts/concat chain.

**Transition** `set_transition`, `set_transition_all`. A non-cut transition
borrows a real `handleOutSec` from the outgoing clip (trimming it) so the
`xfade` overlap does not shorten the assembled film; the timeline is then
retimed to the target. If the clip is too short to lend the handle, the
capability refuses with an actionable message.

**Effect** `apply_effect`, `remove_effect`, `apply_grade`, `clear_effects`.
Registered types: `blur`, `motion_blur`, `grain`, `vignette`, `sharpen`,
`chromatic_aberration`, `saturation`, `exposure`, `contrast`, `lut`. Grade
presets: `warm_cinematic`, `cool_cinematic`, `luxury`, `natural`, `vivid`,
`noir`.

**Caption** `set_caption_style`, `set_caption_animation`, `set_caption_mode`,
`upsert_caption_words`, `set_caption_highlight`.

**Overlay** `add_overlay`, `update_overlay`, `remove_overlay`. The last price
card and the last disclaimer cannot be removed.

**Audio** `set_music`, `set_audio_fades`, `set_voice`.

**Camera / output** `set_transform`, `ken_burns`, `set_output`.

## Not registered (no renderer, or no safe implementation yet)

`freeze_frame`, `reverse`, `speed_ramp`, `stabilize`, `glow`, `mask`,
`object_removal`, `background_replace`, `subject_tracking`,
`frame_interpolation`, `motion_tracking`, multi-track video layers.

The EDL schema accepts `glow`/`stabilize` for forward compatibility, but the
FFmpeg lowering throws `EffectRenderError` rather than dropping them; the agent
cannot select them.

## Failure and approval semantics

- Unknown capability/tool → tool result error; the model may retry.
- Invalid params → Ajv issues returned verbatim; no mutation.
- Invalid output EDL → reverted to the last valid draft, reported as a tool
  failure.
- Risk `low` runs autonomously; `medium`/`high` ask or refuse per autonomy.
  An approval is requested once per capability per run; a denial is not
  re-asked. A 5-minute timeout denies.
- Run limits: 10 model steps, 24 tool calls, $0.25 estimated cost.
