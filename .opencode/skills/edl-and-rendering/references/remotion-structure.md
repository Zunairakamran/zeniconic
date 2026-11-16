# Remotion structure

Remotion renders the **composite**: transitions, overlays, text and captions over
pre-normalised segments. It never crops a source, never decodes a raw camera file
and never touches audio. FFmpeg does geometry and sound; Remotion does layout and
timing. That line is what makes the render cache work — a segment change invalidates
one chunk, and Chrome is only ever asked to draw a canvas-sized file.

## 1. Tree

```
services/pipeline/src/remotion/
  Root.tsx                  registers compositions
  index.ts                  registerRoot(RemotionRoot)
  schema.ts                 Zod schema for chunk props
  hooks/useFrames.ts        sec ↔ frame helpers, one implementation
  components/
    Chunk.tsx               transition + segment + overlays for one clip
    Segment.tsx             OffthreadVideo wrapper, frame-accurate in/out
    OverlayLayer.tsx        price, spec_row, address, logo, lower_third, cta, room_label
    CaptionLayer.tsx        burned word captions
    SafeArea.tsx            dev-only guide; never renders in production
  fonts/                    Bricolage Grotesque + Archivo, bundled
  remotion.config.ts        codec, concurrency, image format
```

Fonts are bundled files loaded through `staticFile`, not `@remotion/google-fonts`.
The Google loader fetches at render time, which breaks local-first and makes renders
non-deterministic when a font version moves.

## 2. Compositions

One composition id per render profile, plus a preview:

```tsx
const PROFILES = {
  "vertical-social": { width: 1080, height: 1920, fps: 30 },
  "feed-portrait":   { width: 1080, height: 1350, fps: 30 },
  pin:               { width: 1000, height: 1500, fps: 30 },
  landscape:         { width: 1920, height: 1080, fps: 30 },
} as const;

{Object.entries(PROFILES).map(([id, p]) => (
  <Composition key={id} id={`chunk-${id}`} component={Chunk}
    width={p.width} height={p.height} fps={p.fps}
    durationInFrames={90} defaultProps={{ chunk: null as unknown as ChunkProps }}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.round(props.chunk.durationSec * p.fps)),
      props,
    })} />
))}
```

`durationInFrames` is an integer and is derived in exactly one place:
`Math.round(seconds * fps)`. A composition summing float durations drifts one frame
per eight cuts. `calculateMetadata` never fetches; it receives what the caller passed.

Props are the EDL, projected:
`{ chunk: { clip, segSrc, transitionIn, overlays, captions, canvas, startFrame } }` —
every field copied from the EDL or the index, nothing invented, nothing read from
disk. Freeze them at plan time and hash them into the chunk key
(`references/render-cache.md` §2).

## 3. OffthreadVideo

```tsx
<OffthreadVideo
  src={staticFile(`cache/seg/${chunk.segHash}.mp4`)}
  startFrom={Math.round(chunk.trimInSec * fps)}
  endAt={Math.round(chunk.trimOutSec * fps)}
  playbackRate={1}
  muted toneMapped={false}
  style={{ width: "100%", height: "100%", objectFit: "cover" }}
/>
```

- `startFrom`/`endAt` are **frames in the source file**, not seconds. Segments are
  pre-trimmed and canvas-sized, so `trimInSec` is normally 0; the fields exist for the
  preview path, which plays raw sources.
- `muted` is not optional: audio is mixed in FFmpeg, and a stray track in the
  composition makes Remotion fight the mux.
- `playbackRate` is 1 for chunks because segments are baked at speed; the preview path
  sets it to `clip.speed` against the raw source.
- `toneMapped={false}` stops Chrome tone-mapping HDR, which otherwise makes a phone
  clip look washed out beside a DSLR clip in the same video.
- Never `<Video>`: it decodes on the main thread and doubles render time. Never point
  `src` at `raw/` — if a `staticFile` resolves to original media, the cache has been
  bypassed and the render is ~4× slower.

## 4. staticFile on Windows

`staticFile` resolves inside the bundle's public directory. Do not copy gigabyte
segments in; point Remotion at the listing workspace:

```bash
npx remotion render chunk-vertical-social out/chunk_77b1.mp4 \
  --public-dir "D:/video/data/listings/2026-11-14-14-oak-avenue" \
  --props "out/chunk_77b1.props.json" \
  --concurrency 2 --gl swangle --log info
```

Now `staticFile("cache/seg/seg_9f3c.mp4")` resolves. Rules: forward slashes only (a
backslash is a 404 on Windows); paths relative to the public dir (absolute `D:/…` in
`src` is rejected in Remotion 4); symlinks and junctions work but `fs.symlink` needs
Developer Mode or elevation on Windows 11, so prefer `--public-dir`; `cache/` inside
the public dir means the browser can request any cached file by name, which is fine
locally and must never point at a network path.

## 5. Deterministic frame maths

```ts
export const sec = (f: number, fps: number) => f / fps;
export const frame = (s: number, fps: number) => Math.round(s * fps);
```

- `useCurrentFrame()` is the only clock. No `Date.now()`, no `performance.now()`, no
  `useState` seeded from time.
- Randomness comes from `random(seed)` seeded by `clip.id`, never `Math.random()`.
- Animate from the frame: `interpolate(frame, [0, 12], [0, 1], { extrapolateRight:
  "clamp" })`; `spring()` gets both `frame` and `fps` and is deterministic with both.
- `delayRender()` only for fonts, with a 20 s timeout and `continueRender` in a
  `useEffect` cleanup. A hanging render is almost always a `delayRender` with no clear
  path. No `setTimeout`, no effects that start playback.
- Overlays position from `canvas.safeArea` and `overlay.anchor` using the same
  constants as the validator (`edl-and-rendering/references/validator-rules.md`). If
  the two disagree the user gets a preview that passes and a take that clips.
- Measure text with `@remotion/layout-utils` `measureText` and a bundled font before
  layout. The validator's estimator is 6 % conservative by design; real metrics must
  stay inside that margin.

## 6. Preview parity

The refine screen renders the same chunk composition the take will use, at draft
quality, from the same frozen props. Otherwise the user approves one video and
exports another.

| Symptom | Cause |
|---|---|
| Text 40 px too high in the take | preview used CSS line-height, composition uses font metrics |
| Colour shifted in the take | preview used `<Video>`, take uses `toneMapped={false}` |
| Cut one frame late | preview duration from float, take from `Math.round` |
| Overlay missing in the take | preview read live `edl.overlays`, chunk props frozen at plan |

## 7. Performance, no GPU

Chrome renders through SwiftShader here. Measured per 180-frame 1080×1920 chunk:

| Setting | Time |
|---|---|
| `--gl swangle --concurrency 2` | 20–30 s |
| `--concurrency 4` (4 cores) | 24–34 s — cores contend |
| `--gl angle` (no GPU present) | falls back, no faster |
| Draft 540×960, concurrency 2 | 8–12 s |

Two workers is the measured optimum on 4 cores; more spend time waiting on the same
encoder. Keep `--image-format=jpeg --jpeg-quality=90` for intermediates — PNG
triples disk I/O for nothing the final CRF 18 encode can see.

## 8. Licence

Remotion is **free for individuals and for companies of up to 3 people**. Above that
it is **$25 per seat per month**, or **$0.01 per render with a $100 per month
minimum**. The floor equals 10,000 renders, so the seat licence wins for any team
under that volume; per-render only makes sense for embedded or high-volume server use.

This is a shipping gate, not a footnote:

- `services/pipeline` refuses a non-developer build unless `REMOTION_LICENCE` (seat
  count plus company key) is present.
- Licence key and seat count sit in the release checklist beside the pinned
  `remotion` version.
- Terms change; verify on remotion.dev before a release. The figures above are
  November 2026 and are what the pipeline was budgeted against.
- The version is pinned in `package.json` and hashed into the chunk cache key.
  Bumping it invalidates every chunk — expected, and cheaper than comparing frames
  from two renderers.

## 9. Commands

```bash
# one chunk (the pipeline runs these in parallel, 2 at a time)
npx remotion render chunk-vertical-social cache/chunk/chunk_77b1.mp4 \
  --public-dir "D:/video/data/listings/<slug>" \
  --props "cache/chunk/chunk_77b1.props.json" \
  --concurrency 2 --gl swangle \
  --codec h264 --crf 18 --pixel-format yuv420p --image-format jpeg --jpeg-quality 90 \
  --log info

# still, for the shot inspector
npx remotion still chunk-vertical-social out/frame.png --frame 45 --props "…props.json"

# determinism: same props, two runs, same hash
npx remotion render chunk-vertical-social out/a.mp4 --props p.json --concurrency 2
npx remotion render chunk-vertical-social out/b.mp4 --props p.json --concurrency 2
ffmpeg -v error -i out/a.mp4 -map 0:v -f md5 -
ffmpeg -v error -i out/b.mp4 -map 0:v -f md5 -
```

Chunks are video-only. The picture is concatenated and muxed with the FFmpeg audio
master — `edl-and-rendering/references/ffmpeg-recipes.md` §7 and §9.
