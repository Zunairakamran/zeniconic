# Research notes

Findings that changed decisions, with the source and the consequence. Keep this file
short; it is not a link dump.

## Render performance (Remotion 4.0.543)

- `imageFormat: 'jpeg'` is materially faster than PNG and is fine for video frames.
- `x264Preset: 'veryfast'` at CRF 23 is visually indistinguishable for social video
  and roughly 30% faster than `medium`.
- **Concurrency is not "more is better" on Windows.** A reported regression with
  `OffthreadVideo` + WebCodecs shows logical-thread concurrency can be *slower* than
  half the cores. Current setting: `min(4, cores/2)` for standard, 2 for draft.
- `gl: 'swangle'` avoids GPU driver issues on headless Windows.

Consequence: keep JPEG + veryfast, benchmark concurrency once on the target laptop
before changing the default. A 30 s 1080p render is ~8–10 min on this machine.

## Disk pressure

Remotion writes frames to the OS temp directory. C: has ~9 GB free; a 1080p render
plus Chrome can exhaust it. Consequence: the app sets `TEMP`/`TMP` to
`<dataDir>/tmp` before spawning the Remotion CLI, and cleans it after a render.
Never render with the system temp on a small system drive.

## Arabic voice

| Engine | Licence | Notes |
|---|---|---|
| **Qwen3-TTS** | Apache-2.0 | 10 languages, streaming, voice design/cloning; heavier download |
| **SILMA TTS** | Apache-2.0 (code MIT) | 150M bilingual AR/EN, purpose-built for Arabic |
| XTTS v2 | Coqui Public Model Licence | **Not** a commercial grant; avoid |
| ElevenLabs | Paid, commercial | Best quality/cloning, per-character cost |

Consequence: Arabic ships as an optional engine selection (Qwen3-TTS or SILMA), not a
hidden default. Kokoro remains the English default because it is 82M, CPU-real-time
and Apache-2.0.

## Packaging

- `ffmpeg-static` and `ffprobe-static` locate their binaries via `__dirname`; they
  must be `asarUnpack`ed or the packaged app cannot spawn them.
- Do not bundle `.env`, `data/`, or logs. The model key is entered at first run and
  stored with `safeStorage`.
- Without a code-signing certificate, Windows SmartScreen shows "Windows protected
  your PC". This is a trust cost, not a bug; document it for the client.

## OCR / listing text

Not implemented. The product accepts pasted listing text now; reading a PDF or a
screenshot of an MLS sheet is a later feature. If added, run it locally (Tesseract)
or through the same vision model, and always require confirmation of price/beds.

## Music

Lyria can produce a usable bed in one call (`modes: audio`, SSE streaming). It is
metered per track; generate a bank once, cache beat grids, never per listing. A
120 BPM "catchy house" prompt produced a bed that sits under a voiceover at 0.30 gain
with sidechain ducking.

## What not to do

- Do not use `force_original_aspect_ratio=decrease` without `pad`: it does not
  guarantee output dimensions, and a raw-frame reader will misalign.
- Do not call Remotion with default concurrency on Windows.
- Do not ship `:free` OpenRouter variants; rate limits and data policy differ.
- Do not burn captions with a fixed font size across aspects; always scale from the
  1080 reference.
