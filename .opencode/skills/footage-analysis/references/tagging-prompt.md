# Tagging prompt — one sheet, one shot, strict JSON

Model: `google/gemini-3.8-flash` (reads image, video, audio, file; $0.83/M in,
$4.13/M out). Temperature 0, `top_p` 1, `max_tokens` 700, `response_format` =
JSON schema below. One request per shot. Prompt version is stored in the index;
bump `tag-1.3.0` whenever a single word of the system prompt changes.

## Call shape

```json
POST https://openrouter.ai/api/v1/chat/completions
{
  "model": "google/gemini-3.8-flash",
  "temperature": 0,
  "top_p": 1,
  "max_tokens": 700,
  "response_format": { "type": "json_schema", "json_schema": { "name": "shot_tags", "strict": true, "schema": { … } } },
  "messages": [
    { "role": "system", "content": SYSTEM },
    { "role": "user", "content": [
      { "type": "text", "text": USER },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…", "detail": "high" } }
    ]}
  ]
}
```

Send the sheet inline as base64 for listings under 20 MB total (the whole batch
then fits in one connection pool and never touches a temp upload). Never send six
`image_url` parts. Never send `video_url`. A 40 s clip is not a cheaper signal
than six tiles — it is 40× the tokens and worse at picking a boundary.

## Sheet layout (fixed, told to the model)

1536×1024 JPEG q80, six 512×512 tiles, padded to square with `0x141414` so every
source aspect produces the same geometry. Tile order: `1 2 3` on top, `4 5 6`
below, ascending in time at 0 %, 20 %, 40 %, 60 %, 80 %, 100 % of the shot.

Because tiles are **padded**, a bbox coordinate refers to the padded tile, not the
source frame. `references/crop-anchors.md` §2 un-maps it. Do not let the model
report padded pixels as if they were picture — the prompt below says so twice,
because it is the single most common error.

## System prompt (verbatim)

```
You are a property-video shot tagger for a tool used by estate-agency assistants.
You receive ONE image: six frames from ONE continuous shot, in time order, in a
3x2 grid (top row: frames 1-3, bottom row: frames 4-6). Each frame is padded to a
square with dark grey (#141414) bars: the bars are padding, not letterboxing, not
part of the room, and never the subject.

Report only what is visible. If you cannot tell, use "unknown" and lower
confidence. Never guess a room from furniture you cannot see. Never name, describe
or identify a person; if a person is visible, add "visible_person" to defects and
say nothing more. Never state a price, address, bedroom count or view direction.

Choose:
- room: the single dominant room. If the six frames disagree, choose the room
  occupying the most frames and lower confidence by 0.2.
- camera_move: the dominant motion across the six frames. "static" only if
  frames 1 and 6 are nearly identical in framing.
- selling_points: 1-5 short snake_case tags, visible evidence only.
- defects: 0-4 tags from the fixed list, visible evidence only.
- best_in / best_out: seconds relative to the START of this shot. best_out must
  be at least 1.2 s after best_in. Trim the first and last frames if they are
  mid-motion, soft or badly exposed.
- score: 0-100 for use in a 30-second marketing video. Penalise wobble, soft
  focus, clutter, blown windows, visible people. Reward light, a clear subject,
  and a move that reveals the room.
- confidence: 0-1 for the room and camera_move calls together.
- frames: for each of the six frames, subject_bbox = [x, y, w, h] as fractions of
  the 512x512 tile, origin top-left, describing the visually dominant subject
  (the thing a vertical crop should keep). If there is no single subject, return
  the frame centre as [0.33, 0.30, 0.34, 0.40].

Return only JSON matching the schema. No prose, no markdown, no code fence.
```

## User prompt (verbatim)

```
Shot {{shotId}} from {{fileName}}.
Shot length {{durationSec}} s. Frames sampled at 0%, 20%, 40%, 60%, 80%, 100%.
Detector priors: shake {{shake}} (0 stable, 1 unusable), sharpness {{sharpness}}
(1 sharp, 0 soft), pan {{panX}} px/frame at 160x90, motion {{liveliness}}.
Priors are hints; the image decides. If you disagree with a prior, tag what you
see and say so only through confidence.
```

Priors are included because they measurably help on drone footage (the model
mistakes smooth gimbal motion for static) and cost ~40 tokens. They are never
authoritative: the tagger may override them, the metrics may not be overridden
after the fact by the model's prose — only by its JSON fields.

## Response schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["room", "camera_move", "selling_points", "defects",
               "best_in", "best_out", "score", "confidence", "frames"],
  "properties": {
    "room": { "enum": ["exterior","building","entry","living","kitchen","dining",
                       "bedroom","bathroom","balcony","view","amenity","unknown"] },
    "camera_move": { "enum": ["static","pan_left","pan_right","tilt_up","tilt_down",
                              "dolly_in","dolly_out","handheld","gimbal_walk",
                              "drone_orbit","drone_forward","zoom_in","zoom_out","rack_focus"] },
    "selling_points": { "type": "array", "minItems": 1, "maxItems": 5,
                        "items": { "type": "string", "maxLength": 40 } },
    "defects": { "type": "array", "maxItems": 4,
                 "items": { "enum": ["blown_windows","crushed_shadows","cluttered",
                   "visible_person","reflection","lens_flare","motion_blur","soft_focus",
                   "watermark","construction","distracting_object","tilted_horizon",
                   "underexposed"] } },
    "best_in":  { "type": "number", "minimum": 0 },
    "best_out": { "type": "number", "minimum": 0 },
    "score":    { "type": "integer", "minimum": 0, "maximum": 100 },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "frames": { "type": "array", "minItems": 6, "maxItems": 6,
      "items": { "type": "object", "additionalProperties": false,
        "required": ["subject_bbox"],
        "properties": { "subject_bbox": { "type": "array", "minItems": 4, "maxItems": 4,
          "items": { "type": "number", "minimum": 0, "maximum": 1 } } } } }
  }
}
```

`room` and `camera_move` enums are closed sets; anything outside them is a
validation failure. `subject_bbox` is `[x, y, w, h]`, not `[x1,y1,x2,y2]` —
state it in the schema name and assert `x+w ≤ 1.05` on ingest (1.05 tolerates
float slop; 1.2 means the model used corner coordinates and the response is
rejected).

## Post-validation (before the index is written)

1. Schema validation. Failure → one retry with the raw error appended as a user
   message. Second failure → fallback record (§ below).
2. `best_out − best_in ≥ 1.2` and `best_out ≤ shotDuration + 0.2`. If violated,
   clamp rather than retry: `best_in = 0` if unknown, `best_out = duration` if
   absurd. A clamped boundary is better than a wasted call.
3. `room = "unknown"` for more than 25 % of a listing's shots → the sheets are
   probably bad (black, padded wrong, tiles out of order). Stop and inspect before
   spending another dollar.
4. `selling_points` that are free prose ("a lovely bright space with…") are
   normalised to snake_case only if a vocabulary term is a substring; otherwise
   dropped. Never store a sentence as a tag: the planner matches strings.
5. `confidence < 0.45` → the shot is still indexed, but the planner treats the
   room as a soft preference and the shot inspector shows "unsure".

## Suggested vocabulary for `selling_points`

Open list, but steer with the user prompt's examples so tags cluster:
`natural_light, open_plan, high_ceiling, garden, pool, view_skyline, view_water,
renovated, furnished, parking, garage, fireplace, walk_in_wardrobe, ensuite,
island_bench, heritage_features, smart_home, solar, ev_charger, acreage,
waterfront, balcony_access, quiet_street, near_transport`. The planner matches
these strings; a listing where 60 % of tags are novel strings is a vocabulary bug,
not creativity.

## Fallback record

When a shot cannot be tagged (two schema failures, timeout, 402/429 exhausted):

```json
{ "room": "unknown", "cameraMove": "unknown", "sellingPoints": [],
  "defects": [], "bestIn": 0.0, "bestOut": 0.0,
  "modelScore": 0, "confidence": 0.0, "tagError": "schema_invalid_after_retry" }
```

`bestIn`/`bestOut` of 0 means "use the whole shot, minus 0.3 s at each end". The
planner skips these shots for the hook, may use them as filler, and the inspector
shows a retry button. Never leave a shot untagged *and* unlisted.

## Cost control

- Cache the response by `sha256(sheet bytes) + promptVersion + modelId`. Editing a
  shot's in/out rebuilds its sheet and its tags; editing the EDL does neither.
- Batch nothing. Parallelise at 4 connections; OpenRouter rate-limits per key, and
  8-way parallelism on a 72-sheet listing produces 429s that cost more in retries
  than they save in wall time.
- Log `usage.prompt_tokens` and `usage.completion_tokens` per call to the cost
  ledger. A 1 190-token sheet that bills 4 800 tokens means the image was sent at
  full resolution — a bug in the sheet exporter, not the model.
- Expected spend: 72 sheets per 12-clip listing ≈ **$0.16** of tagging at
  `gemini-3.8-flash` (109 k in, 17 k out), plus **$0.05** for the
  `gemini-4-carbon` review pass over the 12 selected shots. Budget $0.15–0.35.
