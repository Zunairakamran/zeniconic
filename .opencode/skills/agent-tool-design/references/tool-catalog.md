# Tool catalogue

Fifteen model-facing tools. Every call is a **proposal**; nothing mutates until a human clicks Apply. Schemas are draft 2020-12 with `additionalProperties: false`, and the loader injects the shared `$defs` below, so `#/$defs/ClipId` resolves in every call. The model never supplies `src`, `sourceId`, `label`, `inSec` or `outSec`; the app derives them from the indexed shot.

## Shared definitions

```json
{
  "$defs": {
    "ClipId": { "type": "string", "pattern": "^c[0-9]{2,3}$" },
    "OverlayId": { "type": "string", "pattern": "^o[0-9]{2,3}$" },
    "ShotId": { "type": "string", "pattern": "^sh_s[a-f0-9]{8}_[0-9]{3}$" },
    "Room": { "enum": ["exterior","building","entry","living","kitchen","dining","bedroom","bathroom","balcony","view","amenity","unknown"] },
    "LookId": { "enum": ["calm","social","walkthrough","editorial"] },
    "Anchor": { "enum": ["top_left","top_center","top_right","center","bottom_left","bottom_center","bottom_right"] },
    "CropFocus": { "enum": ["saliency","center","left","right","top","bottom"] },
    "CropMode": { "enum": ["cover","pad_blur","contain"] },
    "CaptionMode": { "enum": ["burn","sidecar","both","none"] },
    "CaptionStyle": { "enum": ["clean_lower","bold_center","editorial_serif"] },
    "VoiceMode": { "enum": ["keep","clean","replace_tts","mute"] },
    "TimeRef": { "type": "object", "additionalProperties": false, "required": ["clipId","offsetSec"],
      "properties": { "clipId": { "$ref": "#/$defs/ClipId" }, "offsetSec": { "type": "number", "minimum": 0 } } }
  }
}
```

## Shared return envelope

One proposal, no mutation. Stills resolve under `cache/preview/prop_9c41ab02/`; `draftSec` is `8.0` or `null`.

```json
{ "ok": true,
  "proposal": { "proposalId": "prop_9c41ab02", "baseEdlId": "edl_cinematic-calm_v4",
    "expiresAt": "2026-11-15T10:42:00Z", "latency": "draft",
    "preview": { "stills": ["00.jpg","01.jpg","02.jpg"], "draftSec": 8.0 },
    "diff": ["Opening shot: kitchen wide (0.61) → living room (0.83)"],
    "warnings": [], "costUsd": 0.0000, "budget": { "spentUsd": 0.1840, "hardRemainingUsd": 4.8160 } } }
```

Failures carry a code, the offending value with an `allowed` range, and a `hint` the model can act on.

```json
{ "ok": false, "error": { "code": "E_OFFSET_OUTSIDE_SHOT",
  "message": "c03 runs 0.000–6.400 s at speed 1.0.", "allowed": { "min": 0, "max": 6.4 },
  "hint": "Use offsetSec between 0 and 6.4, or pick another clip." } }
```

## Tools
### 1. `swap_shot`
Replace the source shot inside one clip slot, keeping the slot's place on the timeline.
```json
{ "type": "object", "additionalProperties": false, "required": ["clipId","shotId"],
  "properties": { "clipId": { "$ref": "#/$defs/ClipId" }, "shotId": { "$ref": "#/$defs/ShotId" },
    "keepTiming": { "type": "boolean", "default": true }, "allowRoomChange": { "type": "boolean", "default": false },
    "reason": { "type": "string", "maxLength": 160 } } }
```
**Validates** clip and shot exist in this listing; shot unused by another clip (a `before_after` pair is the only exception); shot covers the slot when `keepTiming`; room tag matches unless allowed; new range inside the shot; total still ±0.5 s.
**Returns** proposal + 8 s draft + score delta · **Latency** Draft · **Fails** `E_SHOT_NOT_INDEXED`, `E_SHOT_TOO_SHORT`, `E_SHOT_DUPLICATE`, `E_ROOM_MISMATCH`, `E_DURATION_DRIFT`.
### 2. `reorder_rooms`
Reorder clip blocks to follow a walking order; clip IDs stay stable handles.
```json
{ "type": "object", "additionalProperties": false, "required": ["order"],
  "properties": { "order": { "type": "array", "minItems": 2, "maxItems": 12, "uniqueItems": true,
      "items": { "$ref": "#/$defs/Room" } },
    "placeUnlisted": { "enum": ["end","start"], "default": "end" } } }
```
**Validates** every named room exists; no room repeated; named rooms move as blocks preserving intra-room order; unlisted rooms follow `placeUnlisted`; no timing change.
**Returns** proposal + 8 s draft + room sequence diff · **Latency** Draft · **Fails** `E_ROOM_ABSENT`, `E_ROOM_DUPLICATE`, `E_NO_CHANGE`.
### 3. `shorten_to`
Set a new target length inside the format's house range and refit every clip.
```json
{ "type": "object", "additionalProperties": false, "required": ["targetDurationSec"],
  "properties": { "targetDurationSec": { "type": "number", "minimum": 5, "maximum": 90 },
    "strategy": { "enum": ["trim","drop","both"], "default": "both" },
    "protectClipIds": { "type": "array", "maxItems": 3, "uniqueItems": true, "items": { "$ref": "#/$defs/ClipId" } } } }
```
**Validates** target inside the format range (`cinematic_hero` 30–45, `social_hook` 12–22, `just_listed` 15–25); protected clips untouched; every clip ≥0.6 s; hook and CTA overlays stay in their beats; sum within ±0.5 s.
**Returns** proposal + 8 s draft + per-clip delta · **Latency** Draft · **Fails** `E_TARGET_OUTSIDE_FORMAT`, `E_PROTECTED_OVERFLOW`, `E_TOO_SHORT_FOR_CONTENT`, `E_DURATION_DRIFT`.
### 4. `change_hook`
Replace the opening beat: `clips[0]`, the hook overlay and its reason.
```json
{ "type": "object", "additionalProperties": false, "required": ["hookShotId"],
  "properties": { "hookShotId": { "$ref": "#/$defs/ShotId" },
    "hookText": { "type": "string", "maxLength": 42 }, "trimToSec": { "type": "number", "minimum": 0.8, "maximum": 4.0 },
    "overlayId": { "$ref": "#/$defs/OverlayId" } } }
```
**Validates** shot indexed, unused, long enough; room in the hook-worthy set; clip 0 no longer than the format's hook beat +0.5 s; 3–6 words, no unconfirmed fact; hook overlay is `lower_third` at `top_center`, no other overlay in the window except `logo`.
**Returns** proposal + 8 s draft + old/new hook diff · **Latency** Draft · **Fails** `E_HOOK_SHOT_NOT_INDEXED`, `E_HOOK_ROOM_WEAK`, `E_HOOK_TEXT_LENGTH`, `E_OVERLAY_OVERLAP`, `E_FACT_UNCONFIRMED`.
### 5. `rewrite_cta`
Rewrite the single call to action and its hold.
```json
{ "type": "object", "additionalProperties": false, "required": ["text"],
  "properties": { "text": { "type": "string", "maxLength": 90 },
    "subtext": { "type": "string", "maxLength": 90 },
    "overlayId": { "$ref": "#/$defs/OverlayId" },
    "anchor": { "enum": ["bottom_center","center","bottom_left","bottom_right"], "default": "bottom_center" },
    "holdSec": { "type": "number", "minimum": 2, "maximum": 5, "default": 3 },
    "createIfMissing": { "type": "boolean", "default": false } } }
```
**Validates** a `cta` overlay exists or `createIfMissing`; style is `cta_card`; text and subtext fit; anchor inside safe area; one action, no second verb; price, phone and address match the confirmed record; hold inside the timeline.
**Returns** proposal + 3 stills + copy diff · **Latency** Instant · **Fails** `E_CTA_MISSING`, `E_ANCHOR_UNSAFE`, `E_TEXT_TOO_LONG`, `E_FACT_MISMATCH`, `E_OVERLAY_OVERLAP`.
### 6. `swap_music`
Change the bed and its gain, keeping the cached beat grid.
```json
{ "type": "object", "additionalProperties": false, "required": ["trackId"],
  "properties": { "trackId": { "type": "string", "pattern": "^[a-z]+-[0-9]{2}$" },
    "gainDb": { "type": "number", "minimum": -40, "maximum": 12 }, "duckUnderVoiceDb": { "type": "number", "minimum": -30, "maximum": 0, "default": -18 } } }
```
**Validates** track in the local bank; complete `license` record; `beatGrid` cached and ascending; duck at most −12 dB under speech; mix target unchanged; no generation during the call.
**Returns** proposal + 8 s audio draft + loudness delta · **Latency** Draft · **Fails** `E_TRACK_UNKNOWN`, `E_LICENSE_MISSING`, `E_BEATGRID_MISSING`, `E_NO_VOICE_TO_DUCK`.
### 7. `set_crop`
Set the crop mode, focus and zoom for one clip; the app derives the keyframe path from index anchors.
```json
{ "type": "object", "additionalProperties": false, "required": ["clipId","focus"],
  "properties": { "clipId": { "$ref": "#/$defs/ClipId" }, "focus": { "$ref": "#/$defs/CropFocus" },
    "mode": { "$ref": "#/$defs/CropMode" }, "zoom": { "type": "number", "minimum": 1, "maximum": 2.5, "default": 1 } } }
```
**Validates** clip exists; `contain` plus zoom >1 rejected; anchors exist; subject box stays inside the crop at every path point; path `t` ascending, 1–12 points; scales 1–2.5; no timing change.
**Returns** proposal + 3 stills + focus/zoom diff · **Latency** Instant · **Fails** `E_SUBJECT_OUTSIDE_CROP`, `E_CROP_UNSUPPORTED`, `E_NO_ANCHORS`.
### 8. `set_look`
Change the visual and typographic treatment to another catalogue look.
```json
{ "type": "object", "additionalProperties": false, "required": ["lookId"],
  "properties": { "lookId": { "$ref": "#/$defs/LookId" } } }
```
**Validates** look in registry; format/look pairing (no `social` inside `cinematic_hero`); overlay styles remapped within the schema enum; text refits at the new type scale; transitions 0–1.5 s; no timing change.
**Returns** proposal + 8 s draft + pacing/type diff · **Latency** Draft · **Fails** `E_LOOK_UNKNOWN`, `E_LOOK_FORMAT_CONFLICT`, `E_TEXT_OVERFLOW`.
### 9. `add_room`
Insert one missing room from its best shots, paying for it by trimming others.
```json
{ "type": "object", "additionalProperties": false, "required": ["room","shotIds"],
  "properties": { "room": { "$ref": "#/$defs/Room" },
    "shotIds": { "type": "array", "minItems": 1, "maxItems": 4, "uniqueItems": true,
      "items": { "$ref": "#/$defs/ShotId" } },
    "position": { "enum": ["spine","start","end"], "default": "spine" }, "afterRoom": { "$ref": "#/$defs/Room" } } }
```
**Validates** room is a real enum value other than `unknown`; room absent; shots indexed, unused, tagged with that room; clip total ≤40; each new clip ≥0.6 s; others trimmed no more than 15 % each; total ±0.5 s; no duplicate dhash.
**Returns** proposal + 8 s draft + inserted/shortened diff · **Latency** Draft · **Fails** `E_ROOM_PRESENT`, `E_CLIP_LIMIT`, `E_NO_ROOM_IN_BUDGET`, `E_SHOT_ROOM_MISMATCH`.
### 10. `remove_shot`
Remove one clip or one overlay; clips refill from their own shots.
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "clipId": { "$ref": "#/$defs/ClipId" }, "overlayId": { "$ref": "#/$defs/OverlayId" },
    "refill": { "type": "boolean", "default": true } },
  "oneOf": [ { "required": ["clipId"] }, { "required": ["overlayId"] } ] }
```
**Validates** exactly one reference; at least two clips remain; refill extends neighbours within shot bounds; total ±0.5 s; removing the only `cta` warns that `cta_legible` will fail.
**Returns** proposal + 8 s draft + removal diff · **Latency** Draft · **Fails** `E_LAST_CLIP`, `E_REF_UNKNOWN`, `E_REFILL_IMPOSSIBLE`.
### 11. `regenerate_variant`
Rebuild this variant's edit from the current index, same format and look, new choices.
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "reason": { "enum": ["too_slow","boring","different_angle","new_footage","user_request"], "default": "user_request" },
    "keepMusic": { "type": "boolean", "default": true },
    "keepHook": { "type": "boolean", "default": false },
    "seed": { "type": "integer", "minimum": 0, "maximum": 999999 } } }
```
**Validates** index hash current; facts confirmed; no delivery locked without confirmation; new EDL id `v<N+1>` with `parentId`; estimate under remaining budget; format unchanged.
**Returns** estimate + proposal; Apply queues the full render · **Latency** Full · **Fails** `E_BUDGET_EXCEEDED`, `E_STALE_INDEX`, `E_VARIANT_LOCKED`, `E_NO_CANDIDATES`, `E_UNCONFIRMED_FACTS`.
### 12. `set_captions`
Turn captions on, off, or into a sidecar, and choose their style.
```json
{ "type": "object", "additionalProperties": false, "required": ["mode"],
  "properties": { "mode": { "$ref": "#/$defs/CaptionMode" }, "style": { "$ref": "#/$defs/CaptionStyle" },
    "language": { "type": "string", "pattern": "^[a-z]{2}(-[A-Z]{2})?$", "default": "en" },
    "rebuildWords": { "type": "boolean", "default": false } } }
```
**Validates** `burn`/`both` need a style and words (or a rebuild); caption box inside safe area at 1080 width; cues ≤42 characters per line, two lines; words ascending and inside the timeline; language supported by ASR.
**Returns** proposal + 8 s draft for burn, or sidecar diff, plus an estimate when rebuilding words · **Latency** Conditional · **Fails** `E_CAPTION_STYLE_REQUIRED`, `E_WORDS_MISSING`, `E_LANGUAGE_UNSUPPORTED`, `E_SAFE_AREA`.
### 13. `set_voice_mode`
Keep, clean, replace or mute the voice, with explicit enhancement flags.
```json
{ "type": "object", "additionalProperties": false, "required": ["mode"],
  "properties": { "mode": { "$ref": "#/$defs/VoiceMode" },
    "text": { "type": "string", "maxLength": 1200 },
    "voiceId": { "type": "string", "pattern": "^[a-z0-9-]{2,32}$" },
    "enhance": { "type": "object", "additionalProperties": false,
      "properties": { "denoise": { "type": "boolean", "default": true }, "dereverb": { "type": "boolean", "default": false },
        "isolate": { "type": "boolean", "default": false }, "deess": { "type": "boolean", "default": true } } } } }
```
**Validates** source audio exists for `keep`/`clean`; `replace_tts` has text, a registered `voiceId`, ≥8 words and ≤2.2 words/second for the runtime; `mute` keeps a bed so output is not silent; `enhance` only with `clean` or `replace_tts`; replaced voice forces caption rebuild.
**Returns** proposal + 8 s voice draft + estimate for TTS · **Latency** Draft · **Fails** `E_VOICE_UNKNOWN`, `E_TEXT_TOO_LONG_FOR_RUNTIME`, `E_NO_SPEECH`, `E_SILENT_OUTPUT`, `E_TTS_BUDGET`.
### 14. `undo`
Step the head pointer back through immutable EDL revisions.
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "steps": { "type": "integer", "minimum": 1, "maximum": 10, "default": 1 },
    "toEdlId": { "type": "string", "pattern": "^edl_[a-z0-9-]+_v[0-9]+$" } } }
```
**Validates** exactly one of `steps`/`toEdlId`; target in this variant's revision chain; stack depth; delivery pointers newer than the restored EDL are flagged.
**Returns** applied immediately + restored-field diff · **Latency** Instant · **Fails** `E_UNDO_EMPTY`, `E_UNDO_DEPTH`, `E_TARGET_NOT_IN_CHAIN`.
### 15. `explain_choice`
Answer why the edit is the way it is, citing EDL fields and index scores. Read-only.
```json
{ "type": "object", "additionalProperties": false, "required": ["target"],
  "properties": { "target": { "enum": ["opening_shot","room_order","music","cta","duration","captions","voice","crop"] },
    "clipId": { "$ref": "#/$defs/ClipId" }, "at": { "$ref": "#/$defs/TimeRef" } } }
```
**Validates** target relevant (`crop` requires `clipId`); an optional `at: TimeRef` resolves inside its shot; citations exist in the EDL or index; alternatives are indexed, unused shots; never creates a proposal.
**Returns** ≤600-character answer + citations + up to 3 alternatives · **Latency** Instant · **Fails** `E_TARGET_UNKNOWN`, `E_NO_PROVENANCE`, `E_CLIP_REQUIRED`.
