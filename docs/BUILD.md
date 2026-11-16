# Build plan

Bottom-up. Every module is built and tested **in isolation** before anything imports
it. No module may import "upward" — a lower layer never knows about a higher one.

```
L0  tooling        tsconfig · vitest · aliases
L1  domain         core · edl · media          ← pure, fully tested
L2  analysis       metrics · segmentation · contact sheet
L3  planning       candidates · constraints · variants
L4  render         ffmpeg graph · cache · loudness
L5  ai             openrouter client · prompts · cost ledger
L6  services       store · jobs · pipeline stages
L7  desktop        electron main · preload · IPC
L8  ui             components · screens · chat
L9  packaging      installer · signing · docs
```

## Rules

1. **One module, one public entry.** `packages/<name>/src/index.ts` is the only
   import surface; tests import that or relative internals, never another module's
   internals.
2. **A module ships with tests.** `npm test` must pass before the next layer starts.
   "It compiles" is not a gate.
3. **No I/O in L1.** Pure functions only: no fs, no network, no child processes.
   `media` is the exception and keeps all process spawning behind an injectable
   runner so tests never shell out.
4. **Contracts are types, not prose.** If two modules disagree, the type wins and
   the prose is corrected.
5. **Integration is a separate step** with its own test. A green unit suite does not
   prove the pieces fit.

## Layer 1 — domain

### `packages/core` — time, geometry, formatting

```ts
export type Seconds = number;

roundTime(value: number): number                  // 3 dp, deterministic
framesFor(seconds: number, fps: number): number
secondsFor(frames: number, fps: number): number

snapToBeat(t: number, beats: number[], toleranceSec: number): number

interface Rect { x: number; y: number; w: number; h: number }
interface SafeArea { top: number; bottom: number; left: number; right: number }

safeRect(width: number, height: number, safe: SafeArea): Rect
estimateTextBox(text: string, style: TextStyle, canvas: Size): Size
placeOverlay(box: Size, anchor: Anchor, canvas: Size, safe: SafeArea): Placement

slugify(value: string): string
listingId(address: string, date: Date): string     // YYYY-MM-DD-<slug>
formatPrice(amount: number, currency: Currency): string
totalDuration(clips: { inSec: number; outSec: number; speed: number }[]): number
```

Test gate: rounding is stable across platforms; snapping only moves within
tolerance; every anchor produces a box inside the safe area; overflow is reported,
never silently clamped; `formatPrice` refuses to drop trailing zeros on a price.

### `packages/edl` — the contract

```ts
export const EDL_VERSION = '1.0.0';
export interface ValidationIssue { path: string; code: string; message: string }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[] }

validateEdl(input: unknown): ValidationResult     // schema + runtime invariants
assertEdl(input: unknown): asserts input is Edl
durationSec(edl: Edl): number
```

Schema is `packages/edl/schema.json` (already written and validated). Runtime
invariants beyond JSON Schema:

1. `outSec > inSec` for every clip.
2. Clips contiguous except explicit gaps.
3. Total duration within ±0.5 s of `format.targetDurationSec`.
4. Every overlay ends inside the timeline.
5. Transition duration ≤ 1.5 s and ≤ the shorter neighbour.
6. Caption words ascending and non-overlapping.

Text fit is not checked here: it depends on measured font metrics and belongs to the
render-time validator, so `edl` stays independent of `core`.

Test gate: the committed `example.edl.json` passes; one broken fixture per invariant
fails with the right `code`, not a generic schema error.

### `packages/media` — the only module allowed to spawn processes

```ts
interface ProbeResult {
  durationSec: number; width: number; height: number; fps: number;
  codec: string; bitrate: number; hasAudio: boolean;
  orientation: 'landscape' | 'portrait' | 'square'; rotation: number;
}

parseProbeJson(raw: unknown): ProbeResult          // pure, fixture-tested
ffmpegPath(): string                                // ffmpeg-static
ffprobePath(): string                               // ffprobe-static

buildFramePipeArgs(file: string, opts: { width: number; height: number; fps: number }): string[]
buildContactSheetArgs(file: string, opts: ContactSheetOpts): string[]
buildTrimArgs(input: string, output: string, opts: TrimOpts): string[]

probe(file: string, runner?: Runner): Promise<ProbeResult>
interface Runner { run(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> }
```

Test gate: `parseProbeJson` handles rotation 90/270, missing audio, variable frame
rate, and a portrait phone clip. Command builders are snapshot-tested. The real
`probe()` is tested against a generated 1-second colour clip **only if** ffmpeg is
present; otherwise skipped, never failed.

## Layer 2 — analysis

```ts
interface Frame {
  index: number; t: number; width: number; height: number;
  gray: Uint8Array;          // luma, width*height
  colour?: Uint8Array;       // optional RGB, width*height*3
}
interface FrameMetrics {
  index: number; t: number;
  meanAbsDiff: number;     // vs previous frame, 0..255 scale
  blur: number;            // 0 (sharp) .. 1
  shake: number;           // residual after ±3 px shift search
  exposureClipLow: number; // 0..1
  exposureClipHigh: number;
  motionEnergy: number;
  colourfulness: number;   // 0 when `colour` is absent
}
interface Shot {
  id: string; startIndex: number; endIndex: number;
  startSec: number; endSec: number;
  representativeFrames: number[];
}

analyseFrames(frames: Frame[], opts: AnalysisOpts): FrameMetrics[]
segmentShots(metrics: FrameMetrics[], opts: SegmentOpts): Shot[]
```

Pure: no decoding here.

Test gate: synthetic sequences — black frames, a hard cut, a 3 px shift per frame,
a blurred gradient — produce the expected ordering and thresholds.

## Layer 3 — planning

```ts
interface Candidate {
  shotId: string; sourceId: string; src: string;
  room: Room; score: number; inSec: number; outSec: number; reason: string;
}
interface Facts {
  address: string; price?: string; beds?: number; baths?: number;
  currency: 'GBP' | 'USD' | 'EUR';
}
interface PlanRequest {
  listingId: string;
  format: FormatSpec; look: LookSpec; profile: Profile;
  canvas: { width: number; height: number; fps: number; safeArea: SafeArea };
  candidates: Candidate[]; facts: Facts;
  music: { trackId: string; src: string; beatGrid: number[]; gainDb: number; duckUnderVoiceDb: number };
  seed: number; now: string;                 // ISO time, injected for determinism
}

validateSequence(clips: PlannedClip[], spec: SequenceSpec): ValidationIssue[]
planVariant(request: PlanRequest): Edl        // deterministic for a given seed + now
```

Test gate: 200 generated candidate pools produce EDLs that pass `validateEdl`;
rooms never repeat consecutively; the hook is the highest-scoring shot in its pool;
duration lands in tolerance; the same request twice produces an identical EDL.

## Layer 4 — render

```ts
buildFilterGraph(edl: Edl, profile: RenderProfile): string
buildRenderArgs(edl: Edl, profile: RenderProfile, quality: Quality): string[]
segmentCacheKey(clip: Clip, transform: Transform): string
```

Test gate: snapshot the argv and graph for the example EDL in all four profiles;
change one clip and assert only that segment's cache key changes.

## Layer 5 — AI

`packages/ai` wraps OpenRouter behind an interface so tests never hit the network:

```ts
interface ChatClient { complete(req: ChatRequest): Promise<ChatResponse> }
```

Test gate: mocked transport; 429 retries with backoff; budget refusal happens
*before* the request; a malformed JSON reply is rejected with a recoverable error.

## Layer 6 — services

`store` (atomic JSON persistence, ports to SQLite later) and `jobs` (stage state
machine, resume, cancel). Test gate: kill a job mid-stage, reopen, assert it
resumes at the last completed stage and never duplicates work.

## Layer 7–9 — desktop, UI, packaging

Electron main owns the store and jobs; the renderer talks over a typed IPC
contract in `packages/ipc`. The renderer has no filesystem access and no fetch.

UI is built from the components in `docs/mockups` and the tokens in
`docs/design/tokens.css` — the mockups are the spec, not inspiration.

## Sequence and gates

| Step | Builds | Gate |
|---|---|---|
| 1 | core | unit suite green |
| 2 | edl | example passes, 7 invariants fail correctly |
| 3 | media | fixture + snapshot suite green |
| 4 | **integrate 1–3** | one command probes 3 clips and prints a valid index |
| 5 | analysis | synthetic frames suite green |
| 6 | **integrate 4–5** | real folder → `footage_index.json` |
| 7 | planner | 200-pool property test green |
| 8 | render | argv snapshots + one real 5 s render |
| 9 | **integrate 7–8** | 30 s video from fixture clips |
| 10 | ai, store, jobs | mocked + crash-resume suites |
| 11 | desktop, ipc | app opens, lists a listing |
| 12 | ui | nine screens, both themes, keyboard pass |
| 13 | packaging | installer on a clean VM |

Nothing in step 5 starts until step 1–3 tests are green. That is the point of the
exercise: a failure at step 4 is a seam, not a mystery.
