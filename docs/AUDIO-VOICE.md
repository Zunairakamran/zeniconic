# Audio, voice and captions

The honest starting point: **there is no "upscale" for a voice.** You can restore a
recording, or you can replace it. Anything sold as voice upscaling is one of those two
with a better name. So the product offers three explicit paths, and tells the user
which one she is on.

## What "studio level" actually decomposes into

| Axis | Solvable? | How |
|---|---|---|
| Loudness and consistency | **Yes, fully** | Two-pass `loudnorm` to −14/−16 LUFS, true peak −1.5 dBTP, gentle compression |
| Noise, hiss, hum, room tone | **Mostly** | DeepFilterNet (speech-preserving), high-pass 90 Hz, `afftdn` fallback |
| Reverb / boxy room | **Partly** | De-reverb helps at 20–40%; a tiled bathroom stays a tiled bathroom |
| Dull, muffled, clipped mic | **No** | Clipping is unrecoverable; EQ adds presence but cannot restore detail |
| Voice timbre / "make her sound better" | **No** | That is synthesis, not restoration — offer TTS instead, labelled as such |

The only real path to studio sound is a better recording. The app must say so: when
SNR is below ~20 dB or reverb tail exceeds ~0.4 s, the reshoot list says *"re-record
the voiceover with a lav mic; the room is doing more damage than software can undo."*

## Four modes, chosen per delivery

| Mode | What plays | When to use |
|---|---|---|
| `restore` | Original VO, cleaned and mastered | Default when the verdict is keep/clean |
| `replace` | AI voice reading a generated script | Original is unusable, or no VO exists |
| `hybrid` | Original VO + AI pickups for missing lines | Script exists and only some lines are missing. v2. |
| `music_only` | Music + captions, no voice | Fastest, most robust; often the best social cut |

`hybrid` is deliberately deferred: matching an AI voice to a real one mid-sentence is
the hardest audio problem here, and a bad match is worse than either alternative.

## The restoration chain (CPU only, no GPU)

Order matters; each step assumes the previous one ran.

1. **Measure** — `ebur128` (integrated LUFS, true peak), noise floor, clipped-sample
   count, speech duration. These numbers decide the mode before anything is processed.
2. **Repair** — `adeclick` / `adeclip` only when the measurement says clipping exists.
3. **Denoise** — DeepFilterNet at `--post-filter --atten-lim-db 15`. Speech-preserving;
   this is the step that makes phone audio usable.
4. **High-pass** — 90 Hz, 12 dB/oct, removes HVAC rumble and handling noise.
5. **De-ess** — 6–8 kHz dynamic cut, only if sibilance is measured.
6. **Presence** — a 2–3 dB shelf at 2.5–4 kHz, only if the source is dull.
7. **Compress** — 3:1, 10 ms attack, 120 ms release, 2–3 dB gain reduction. Not a
   loudness tool; it stops the quiet sentences disappearing.
8. **Master** — two-pass `loudnorm` to the render profile, then verify with `ebur128`
   **after** muxing, not before.

Never run denoise twice, and never "normalise" before denoise — you amplify the noise
floor and then try to remove it.

## Voice bank (TTS)

**English: Kokoro-82M.** Apache-2.0, 54 voices, near real-time on a plain CPU, and
blind-listener quality competitive with paid APIs. No per-character cost, no network,
no data leaving the machine. That combination is why it wins over ElevenLabs for the
default path.

**Arabic: a separate engine, because Kokoro does not speak Arabic.** Its eight
languages are English, Spanish, French, Hindi, Italian, Japanese, Portuguese and
Chinese. Options, in order of fit:

| Engine | Licence | Notes |
|---|---|---|
| **SILMA TTS** (150M, bilingual AR/EN) | open source | Purpose-built for Arabic/English; best default for a Dubai agency |
| **Qwen3-TTS** | open source | Streaming, strong quality, larger download |
| **ElevenLabs** | paid, commercial | Best quality and cloning; per-character cost shown before generating |
| XTTS v2 | Coqui Public Model Licence | **Avoid for commercial work** — the licence is not a commercial grant |

Ship **10 English voices** plus **4 Arabic voices** (2 male, 2 female; Gulf neutral and
Levantine neutral). Arabic captions are right-to-left: the caption renderer must use
`direction: rtl`, an Arabic-capable font, and mirrored safe-area padding.

- **Previews are generated once and cached.** Each voice gets a 6-second sample of the
  same line ("Marina Gate 1. Three bedrooms, two baths, and a marina view."). The user
  auditions by ear; no tokens are spent at selection time.
- Store `voiceId`, `voiceVersion`, `language` and the preview hash. Changing voice
  re-renders only the VO stem, not the picture.
- Script rules: ≤2.2 words/second, one idea per sentence, numbers written as spoken
  ("fourteen", not "14") unless the engine handles it better.

**Cloning is opt-in and consent-gated.** If the agent wants their own voice, that is
ElevenLabs (paid, commercial licence) or a locally licensed clone — never the default,
never without a signed consent record stored with the listing. A cloned voice must be
labelled in the export metadata.

## Captions

**Engine: whisper.cpp**, bundled binary, `base.en` by default (`small.en` for noisy
rooms). Chosen over faster-whisper because it needs no Python on Windows and gives the
more precise word timings that captions depend on.

- Language: `en-GB` by default; spelling and punctuation normalised to British English.
- Word-level timings feed the EDL `captions.words`; the user can edit a word and the
  timing follows the edit, not a re-transcription.
- Modes: `none`, `burn`, `sidecar`, `both`. Styles: `clean_lower`, `bold_center`,
  `editorial_serif`.
- Layout is safe-area aware: bottom margin = `safeArea.bottom`, max two lines, no
  more than 32 characters per line at 1080 wide.
- Captions are on by default for `vertical-social`; 70%+ of social views are muted.

## What the user sees

One card, three rows:

1. **Voice** — a verdict badge (`Good`, `Cleanable`, `Replace`) with the measured
   reason, and a play button for the before/after.
2. **Mode** — four radio options, with the recommended one preselected and the cost of
   each shown (`Free` for restore/music, `Free, local` for Kokoro).
3. **Captions** — off / burned / sidecar / both, plus the style.

If the verdict is `Replace`, the card says why in plain language: *"The room echoes and
the mic clips on loud words. A new recording would be better; an AI voice is the
fallback."* No euphemisms.

## Cost

| Path | Cost |
|---|---|
| Restore (DeepFilterNet + FFmpeg) | $0, CPU, ~1–2× real time |
| Captions (whisper.cpp base.en) | $0, CPU, ~0.3–0.8× real time |
| Kokoro voiceover | $0, CPU, ~0.5–1× real time |
| ElevenLabs clone (optional) | per character, shown before generating |
| `openai/gpt-audio` fallback | per audio token |

All local paths are free, which matters because a 30s voiceover is generated once per
variant and re-rendered on every script tweak.
