# Remix stage

Pure pieces for re-editing an **already finished** marketing video (MP4/MOV,
≤ 2 minutes) into a better order with better captions.

Nothing here reads settings, owns a job, touches IPC or writes an EDL. The
orchestrator supplies the file, the runner, the OpenRouter key provider and the
room tags, then hands the results to the existing planner.

## Pipeline and wiring contract

```
imported video
  │
  ├─ splitScenes(file)             → Shot[] + warnings
  ├─ probe(file)                   → orientation / fps (packages/media)
  ├─ tag rooms                     → room per shot (existing tagger)
  ├─ buildCandidates(shots, opts)  → RemixCandidate[] (planner Candidate shape)
  ├─ transcribeAudio(audio, opts)  → word-timed Transcript
  ├─ cleanCaptions(words)          → 6-word / 2-line cues
  └─ build*Order(shots, facts)     → TimelineSlot[]
                                      ↓
                                   existing planner → EDL → render
```

Suggested orchestration:

1. `probe(file)` from `@zeniconic/media` gives `orientation` and `fps`.
2. `splitScenes(file, { fps, durationSec })` returns shots and, if the file has
   no scene changes, `method: 'fallback'` with a `W_NO_SCENES` warning and
   fixed 4 s chunks. An ffmpeg/probe failure is a `SceneSplitError`, not a
   silent fallback.
3. Tag one frame per shot for `room` (and optionally creative `tags`).
4. `buildCandidates(shots, { sourceId, src, orientation, room, score })` turns
   the shots into `RemixCandidate`s. Every candidate points at the same `src`;
   `inSec`/`outSec` are source time. Pass the tagger's room/score per shot by
   calling it once per shot or mapping the result afterwards.
5. Extract the audio and call `transcribeAudio`. The normalised words feed both
   `cleanCaptions` and the existing caption/EDL writer.
6. Pick a preset: `buildMarketingOrder`, `buildOriginalOrder` or
   `buildPriceLedOrder` (or `orderForPreset`). Each returns `TimelineSlot[]`
   with a `shotId`, full `inSec`/`outSec` window, `targetSec` and a human
   `reason`.
7. Feed the slots back into the planner as candidates whose window is
   `inSec` + `targetSec`, or let the planner allocate within the full window.
   The returned `reason` is designed to fit `Candidate.reason`.

## Public signatures

```ts
splitScenes(file: string, options?: SplitScenesOptions): Promise<SceneSplitResult>
shotsFromCuts(cuts: readonly number[], durationSec: number, options?): Shot[]
fallbackShots(durationSec: number, chunkSec?: number, options?): Shot[]
detectScenes(file: string, options?: SceneDetectOptions): Promise<SceneDetection>
detectSceneCuts(file: string, options?: SceneDetectOptions): Promise<number[]>

buildCandidates(shots: readonly Shot[], options: CandidateBuildOptions): RemixCandidate[]

createTranscriber(options: TranscribeOptions): Transcriber
transcribeAudio(audio, options: TranscribeOptions): Promise<TranscriptionResult>

buildMarketingOrder(shots: readonly TaggedShot[], facts: Facts, options?): TimelineSlot[]
buildOriginalOrder(shots: readonly TaggedShot[], facts: Facts, options?): TimelineSlot[]
buildPriceLedOrder(shots: readonly TaggedShot[], facts: Facts, options?): TimelineSlot[]
orderForPreset(preset, shots, facts, options?): TimelineSlot[]

reorderSlots(slots: readonly RemixSlotDto[], order: readonly string[]): RemixSlotDto[]
setSlotRoom(slots: readonly RemixSlotDto[], shotId: string, room: RemixRoom): RemixSlotDto[]
requireRoom(value: unknown): RemixRoom
isRemixRoom(value: unknown): value is RemixRoom

cleanCaptions(words: readonly TranscriptWord[], options?): CleanedCaptionCue[]
```

`RemixCandidate` extends the planner `Candidate`, adds `id` (an alias of
`shotId`) and `orientation`, so it can be passed directly anywhere a
`Candidate` is expected.

## Assumptions the orchestrator must satisfy

- **Audio size:** OpenRouter accepts up to 25 MB per request. `transcribeAudio`
  byte-slices larger inputs, but only WAV/MP3 are safe that way. For MP4/M4A,
  the caller must first extract/split the audio into independently decodable
  parts and pass them as an array (or supply `chunkAudio`). If the source audio
  is larger than 25 MB, **split it before calling**; do not rely on byte cuts of
  a container with an index.
- **Key handling:** pass a `getApiKey` callback owned by Settings. It is read on
  every call, never stored, and redacted from every message. Do not pass an
  empty key: the client fails with `E_AUTH` before touching the network.
- **Process execution:** production uses `nodeRunner` and `ffmpeg-static`
  through `@zeniconic/media`. Tests must inject `runner` / `ffmpegBin`.
  `splitScenes` can use `durationSec` to avoid a second ffprobe process.
- **Room tags:** `buildCandidates` defaults to `room: 'unknown'` and
  `score: 0.5`. Run the tagger/scorer first if you want meaningful room order;
  the presets fall back to any unused shot when a preferred room is absent.
- **Fact availability:** presets never invent a price. A missing `facts.price`
  produces a price beat with no card and a reason that says so.
- **Determinism:** all five modules are pure apart from injected ffmpeg/fetch
  calls. Given the same inputs they return the same output: no randomness, no
  timestamps created at call time.
- **Scene threshold:** the default is `0.3`. A different threshold is passed
  straight into `select='gt(scene,<threshold>)'`; shots shorter than `0.8 s`
  are merged before candidates are built.

## Tests

```
npx vitest run services/remix
```

The suite uses a recorded `showinfo` fixture, a fake `Runner`, fake fetch
responses and fixed word timings. It never spawns ffmpeg, never calls
OpenRouter and never needs an API key.
