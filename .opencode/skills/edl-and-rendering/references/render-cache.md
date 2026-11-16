# Render cache

A 30 s variant takes 2–3 minutes on the target machine (no GPU, 4-core laptop).
The user edits one caption in chat and expects a new take, not another three
minutes. The cache is what makes that promise true, so its keys must be exact and
its invalidation must be boring.

## 1. Units

| Unit | Content | Produced by | Typical cost |
|---|---|---|---|
| `seg` | One clip, cropped/scaled to canvas, sped, no audio | FFmpeg | 12–20 s per 6 s |
| `chunk` | One clip's frames plus its incoming transition and the overlays intersecting that range | Remotion | 20–30 s per 6 s |
| `picture` | Concatenation of chunks | FFmpeg `-c copy` | 2–4 s |
| `aud` | Music + voice + duck + loudnorm | FFmpeg | 6–10 s |
| `take` | picture + aud, muxed | FFmpeg `-c copy` | 3–5 s |

Per-clip chunks are the reason a chat edit is cheap. A whole-timeline composite
would force a full re-render for a one-word price change; chunking at clip
boundaries means the changed clip's chunk re-renders and the rest are copied.
Transitions are the only cross-boundary state, so each chunk owns its *incoming*
transition and never its outgoing one — one owner per pixel of overlap.

## 2. Keys

Canonical JSON (keys sorted, no whitespace), SHA-256, first 16 hex as the filename.
Times as **integer milliseconds** — `Math.round(sec * 1000)` — never floats, or
`12.4` and `12.400000000000001` become different keys and the cache never hits.

```ts
const segKey = sha16({
  v: "seg/2",
  src: source.sha256,                 // content, not path
  inMs: ms(clip.inSec), outMs: ms(clip.outSec),
  speed: round3(clip.speed),
  mode: t.mode, focus: t.focus,
  path: t.path.map(p => ({ t: round4(p.t), x: round4(p.x), y: round4(p.y), scale: round3(p.scale) })),
  canvas: [canvas.width, canvas.height, canvas.fps],
  enc: "x264:crf14:veryfast:high:4.2:yuv420p",
  pipeline: PIPELINE_VERSION,
});

const chunkKey = sha16({
  v: "chunk/2", seg: segKey, profile: canvas.profile,
  transitionIn: { type, ms: ms(dur) },
  overlays: overlaysIntersecting(chunkRange).map(o => ({ ...o, inSec: undefined })), // times rebased
  captions: captionHashFor(chunkRange),
  remotion: REMOTION_VERSION, fonts: FONT_BUNDLE_HASH,
  ladder,                              // draft | final
});

const audKey = sha16({
  v: "aud/2", music: trackId, musicSha: track.sha256, gainDb, duckDb,
  voice: { mode, sha: voiceSha, textHash: sha256(text ?? "") },
  target: [mix.lufs, mix.truePeakDbtp], out: "aac:320k:48k:2", pipeline: PIPELINE_VERSION,
});
```

`FONT_BUNDLE_HASH` is the SHA-256 of the bundled font files. Swap Archivo
for a variable build with different metrics and every text box moves — that must
be a miss, not a stale hit.

Two different sources that happen to share `src` path are fine: the key takes the
content hash from `footage_index.json`, and validator R06 rejects an EDL whose
`sourceId` no longer matches the file on disk. A stale index is caught once, before
the render, rather than as a mysterious wrong shot.

## 3. Layout

```
data/listings/<slug>/cache/
  seg/seg_<16hex>.mp4          + seg_<16hex>.json   (manifest: key inputs, streamMd5, bytes)
  chunk/chunk_<16hex>.mp4      + .json
  picture/pic_<16hex>.mp4      + .json
  aud/aud_<16hex>.m4a          + .json
  take/take_<16hex>.mp4        + .json
```

Metadata lives in SQLite (`better-sqlite3`, WAL) in `render_cache(key TEXT PRIMARY
KEY, kind, file, bytes, created_at, last_used_at, status, take_id)`. Files are the
truth for pixels; the row is the truth for lifetime. A file with no row is an
orphan and is swept at startup; a row with no file is a miss and is re-rendered.

Writes are `name.part` → `fsync` → `rename` → row insert in one transaction. A
process killed mid-encode leaves a `.part`, never a half file that the next run
believes in.

## 4. Invalidation

| Change | seg | chunk | picture | aud | take |
|---|---|---|---|---|---|
| `inSec`/`outSec` | ✗ | ✗ | ✗ | — | ✗ |
| `speed` | ✗ | ✗ | ✗ | — | ✗ |
| `transform.mode` / `focus` / `path` | ✗ | ✗ | ✗ | — | ✗ |
| Clip order or count | ✓ | ✗ | ✗ | — | ✗ |
| Overlay text/style/timing | ✓ | ✗ (that chunk only) | ✗ | — | ✗ |
| `transitionIn` duration | ✓ | ✗ | ✗ | — | ✗ |
| Music track or gain | ✓ | ✓ | ✓ | ✗ | ✗ |
| Voice mode/text | ✓ | ✓ | ✓ | ✗ | ✗ |
| Loudness target | ✓ | ✓ | ✓ | ✗ | ✗ |
| Look (typography/colour) | ✓ | ✗ | ✗ | — | ✗ |
| Profile/canvas | ✗ | ✗ | ✗ | — | ✗ |
| Ladder draft→final | ✗ | ✗ | ✗ | ✓ | ✗ |

`✗` means invalidate, `✓` means reuse. The two rows that matter: **music changes
must not touch a single frame of picture**, and **a caption change must not
re-encode a single segment**. If either is false, the key includes something it
should not.

Draft→final invalidating everything is deliberate. Segments must be encoded at the
delivery resolution to be worth caching, and a 540p segment cannot be upscaled into
a 1080p composite. One full render at the end of creative work is the accepted
cost, measured at 2.5–3.5 min; the alternative — re-encoding every segment on every
chat turn — is worse.

## 5. Partial re-render

```ts
async function plan(edl, profile, ladder, index) {
  const units = [];
  for (const [i, c] of flatClips(edl).entries()) {
    const seg = segKey(c, profile, index);
    const chunk = chunkKey(c, seg, edl, profile, ladder);
    units.push({ kind: "seg", key: seg, status: store.status("seg", seg) });
    units.push({ kind: "chunk", key: chunk, status: store.status("chunk", chunk), seg });
  }
  units.push({ kind: "picture", key: picKey(units.filter(u => u.kind === "chunk")), status: … });
  units.push({ kind: "aud", key: audKey(edl.audio), status: … });
  return units;   // `plan --explain` prints this, one line per unit
}
```

Render only `MISS`/`STALE` units, in order: segments → chunks → picture → audio →
take. A `STALE` unit is a key whose source file mtime/size changed: re-hash the
source once, then either it is a genuine miss or the row was wrong and is repaired.

Expected behaviour after one chat edit that changes a shot:

```
seg_9f3c… HIT   seg_1a04… MISS (inSec 12.4→12.6)
chunk_77b1… HIT chunk_1a04… MISS (seg changed)
picture     MISS (chunk set changed)      4 s
aud_2c9e…   HIT
take        MISS                          5 s
```

Wall time ≈ 20 s + 28 s + 4 s + 5 s ≈ 57 s, against 180 s cold. That ratio is the
whole feature. If `plan --explain` shows every unit as MISS after a text edit, the
bug is in `chunkKey` including the whole EDL instead of the chunk's slice.

## 6. Concurrency, resume, GC

- Segments and chunks across different keys render in parallel, 2 at a time on a
  4-core laptop, 4 on 8+. More than that and FFmpeg and Chrome fight for the same
  cores; measured throughput peaks at 2× on 4 cores.
- A job takes a `status='rendering'` row per unit with the pid. On startup, rows
  stuck in `rendering` with a dead pid are reset to `miss` and their `.part` files
  deleted. That is the entire resume story, and it is why killing the app loses no
  work.
- GC keeps every unit referenced by the last 3 takes of each variant, every unit
  younger than 7 days, and deletes the rest oldest-`last_used_at` first until the
  listing cache is under 8 GB. Never GC a key held by a `rendering` row.
- Cache size sanity: a 30 s vertical listing with 9 clips is roughly 9 × 1.6 MB
  (segments) + 9 × 5 MB (chunks) + 45 MB picture + 1.2 MB audio ≈ 100 MB per take.
  8 GB holds ~80 takes, well past useful.

## 7. Verification

1. **Byte identity on hit.** Re-render an unchanged EDL from cache; the picture
   stream md5 must equal the stored `streamMd5`. A mismatch means a non-deterministic
   stage (clock, random, font fallback) or a key that omits an input.
2. **One-clip edit.** Change one `inSec` by 0.2 s: exactly one segment, one chunk,
   picture and take are misses; audio is a hit. Assert on the unit list, not on
   wall time — timings are noisy, statuses are not.
3. **Audio-only edit.** Change `music.gainDb` by 1: zero segment and chunk misses.
   This is the check that proves picture and audio are genuinely independent.
4. **Text edit.** Change one overlay's `text`: one chunk miss, zero segment misses,
   audio hit.
5. **Ladder parity.** Draft and final at 15.000 s match in content and layout
   (frame extracted, compared by eye or SSIM ≥ 0.90 after rescaling). Divergence
   means the ladder changed something other than resolution and CRF.
6. **Crash recovery.** Kill during a chunk render; restart; the unit re-renders,
   no `.part` files remain, no duplicate rows, and the wall time matches the
   remaining work rather than the whole job.
7. **Hit-rate telemetry.** Log `renderCacheHits` into the EDL provenance. A listing
   under 60 % hits after the first take has a key bug; investigate before adding
   more cache.
