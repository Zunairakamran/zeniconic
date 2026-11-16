# The enhancement chain

One linear chain, applied to the voice only, at 48 kHz, before any mixing. It
removes defects and leaves level alone. Levelling is a separate, single step at
master (`references/loudness-and-ducking.md`).

## Why this order

```
ingest 48k → denoise → high-pass → de-ess → EQ → compress → [dereverb if mild]
           → measure → vo_clean.wav (gain-neutral ±1 dB)
```

- **Denoise first** because every later stage is level-dependent. A compressor
  fed noise compresses the noise; an EQ fed hiss boosts the hiss.
- **High-pass early** so rumble never reaches the de-esser's detector or the
  compressor's sidechain, where it would cause pumping that only shows up later.
- **De-ess after denoise.** Learned denoisers can exaggerate sibilance by
  suppressing the noise around it; you de-ess the result, not the input.
- **EQ before compression** so the compressor reacts to the tonal balance that
  will ship, not to one you are about to change.
- **Compress last** to even out the delivery, using a slow, gentle setting that
  a beginner cannot hear as "processing".
- **Dereverb only if mild**, and only as a partial measure. See the honesty
  section below.

## Defect to filter map

| Symptom | Measured as | Filter | Starting parameters | Realistic gain | Cannot fix |
|---|---|---|---|---|---|
| Broadband hiss, fan, air-con | noise floor −35…−50 dBFS | `afftdn` or DeepFilterNet | `nr=12:nf=-40:tn=1:gs=5` | 10–18 dB noise floor | Speech that is already gone |
| Traffic, HVAC gusts, non-stationary | noise floor moves >6 dB | DeepFilterNet (post-filter on) | `--post-filter --atten-lim-db 15` | 12–20 dB | Sudden bangs, door slams |
| Mains hum, fridge tone | narrow peak at 50/100/150 Hz | `afftdn` then notch | `equalizer=f=50:t=q:w=6:g=-20` per harmonic | 20+ dB on the tone | Hum that modulates |
| Rumble, handling, wind | energy < 120 Hz | `highpass` | `f=90:poles=2` (male) / `f=110` (female) | kills most of it | Wind gusts above 200 Hz |
| Harsh "sss", "tss" | 5–8 kHz peaks | `deesser` | `i=0.35:m=0.5:f=0.5` | 3–5 dB on sibilants | Whistling dentures |
| Boxed, muddy | 200–400 Hz build-up | `equalizer` | `f=280:t=q:w=1.0:g=-2` | clarity, not accuracy | A small room's sound |
| Dull, distant | weak 2–4 kHz | `equalizer` | `f=3300:t=q:w=1.2:g=2.5` | presence | A mic pointed at a wall |
| Uneven delivery | 12+ LU swing | `acompressor` | `threshold=-20dB:ratio=3:attack=6:release=180:makeup=3` | 3–5 LU | Shouting, whispering |
| Clicks, chair knocks | isolated transients | `adeclick` | defaults | most clicks | Clicks over a vowel |
| Flat-topped syllables | ≥0.05% clipped samples | `adeclip` (cosmetic only) | `threshold=0.9` | nothing real | Clipping — band is replace |

## The commands

### A. Full chain, DeepFilterNet available

```bash
# 0. Ingest: one resample, one format, no more.
ffmpeg -hide_banner -y -i vo_raw.m4a \
  -af "aresample=48000,aformat=channel_layouts=mono" \
  -c:a pcm_s24le work/vo_48k.wav

# 1. Learned speech-preserving denoise. Output lands in work/dfn/.
deep-filter --post-filter --atten-lim-db 15 -o work/dfn work/vo_48k.wav
#    → work/dfn/vo_48k.wav

# 2. High-pass, tonal cut, presence, de-ess, gentle compression.
ffmpeg -hide_banner -y -i work/dfn/vo_48k.wav -af "\
highpass=f=90:poles=2,\
equalizer=f=280:t=q:w=1.0:g=-2,\
equalizer=f=3300:t=q:w=1.2:g=2.5,\
deesser=i=0.35:m=0.5:f=0.5,\
acompressor=threshold=-20dB:ratio=3:attack=6:release=180:makeup=3:knee=2.5" \
  -ar 48000 -c:a pcm_s24le work/vo_clean.wav

# 3. Measure both ends, store the delta. No delta, no claim.
ffmpeg -hide_banner -nostats -i work/vo_clean.wav \
  -af "ebur128=peak=true:framelog=quiet,astats=measure_overall=all:reset=0" \
  -f null - 2> work/vo_clean.measure.log
```

### B. Full chain, DeepFilterNet unavailable (fallback)

```bash
ffmpeg -hide_banner -y -i work/vo_48k.wav -af "\
highpass=f=90:poles=2,\
afftdn=nr=12:nf=-40:tn=1:gs=5,\
equalizer=f=280:t=q:w=1.0:g=-2,\
equalizer=f=3300:t=q:w=1.2:g=2.5,\
deesser=i=0.35:m=0.5:f=0.5,\
acompressor=threshold=-20dB:ratio=3:attack=6:release=180:makeup=3:knee=2.5" \
  -ar 48000 -c:a pcm_s24le work/vo_clean.wav
```

`afftdn` is stationary-noise oriented and will dull the voice if pushed. Stay at
`nr ≤ 12`; above that, intelligibility drops before the hiss disappears. If the
noise floor is still above −45 dBFS after this chain, do not add a second
denoiser — escalate the band to `replace` and tell the user.

### C. Tonal noise and short takes (`anlmdn`)

`anlmdn` is excellent on hum, fridge tones and air-con, and expensive: budget
roughly 2–4× the runtime of `afftdn` for the same duration.

```bash
ffmpeg -hide_banner -y -i work/vo_48k.wav -af "\
anlmdn=s=0.00008:p=0.002:r=0.006:m=a:smooth=11,\
highpass=f=90:poles=2,\
deesser=i=0.30:m=0.5:f=0.5" \
  -ar 48000 -c:a pcm_s24le work/vo_clean.wav
```

### D. Clicks and clipping, cosmetic

```bash
ffmpeg -hide_banner -y -i work/vo_48k.wav -af "\
adeclick,\
adeclip=threshold=0.9,\
highpass=f=90:poles=2" \
  -ar 48000 -c:a pcm_s24le work/vo_pre.wav
```

Use D only when clipping is between 0.005% and 0.05% and confined to a
non-speech part. Run it **before** the denoiser so the denoiser is not asked to
model a click as noise. It smooths the waveform; it does not recover the
information, and the voice card must not imply that it did.

## DeepFilterNet specifics

- **Model:** DeepFilterNet3, 48 kHz native, CPU-only, real-time factor far below
  1. No GPU, no Python at runtime: ship the prebuilt CLI binary at
  `services/pipeline/bin/win32-x64/deep-filter.exe` and the model directory
  beside it. Pin the version string in `models.json` and surface it in Settings
  & diagnostics.
- **Flags that matter:**
  - `--post-filter` — extra residual suppression. On for noisy rooms, off for
    already-clean takes where it can thin the voice.
  - `--atten-lim-db 15` — attenuation limit. 15 dB keeps the voice intact while
    removing most noise; 30 dB is audible as "underwater" on weak takes.
  - `--no-delay-compensate` — only for real-time monitoring, never for render.
- **Expected result:** a clean 8–14 dB noise-floor improvement on speech with
  almost no artefact, on a 60 s take in under 10 s on a 4-core laptop. Measure
  and store the actual; do not promise the budget in UI copy.
- **If the binary is missing:** fall back to chain B, and mark the voice card
  "Cleaned with the built-in denoiser". The delta is smaller. Hiding that is a
  lie by omission.

## Dereverb: the honest section

No CPU-only open-source tool removes room reverb well. DeepFilterNet suppresses
some tail energy as a side effect; `afftdn` with residual tracking nibbles at it;
neither produces a dry voice. Options in order of preference:

1. **Re-record in a softer room.** Forty seconds of work beats every filter.
2. **TTS replacement**, if the content is factual and short.
3. **Mild chain:** `afftdn=nr=6:tn=1:tr=1` plus `deesser=i=0.45`, high-pass at
   110 Hz. Expect 1–2 dB of perceived clarity, not removal. Say "less echoey",
   never "echo removed".
4. **Moderate or severe:** do not pretend. Replace or accept.

A gate (`agate`, `sidechaingate`) is an anti-pattern for voiceover: it chops word
tails, and the resulting gaps sound worse than the room. Never ship a gate on
narration.

## Restoration versus cosmetic resampling

Two operations get sold as one thing; keep them separate in code and in copy.

**Restoration** removes what should not be there: noise, hum, clicks, sibilance,
uneven level. Every gain is measured before and after. It cannot add information.

**Cosmetic resampling** changes the container: 16 kHz to 48 kHz, 128 to 320 kbps,
mono to stereo. It adds samples, not signal. A 16 kHz recording has nothing above
8 kHz; upsampling interpolates there, it does not create detail. Tools that
"restore" missing highs are synthesising harmonics, which on a voice usually
sounds glassy or lispy: brighter, not clearer.

Rules: never say "upscaling", "HD audio" or "studio quality"; convert sample rate
once at ingest; never upmix mono voice to fake width; re-measure intelligibility
after the chain and revert if it fell; report deltas, not verdicts.

## Verification of the chain

Run after every cleanup, automatically:

| Assertion | Fail action |
|---|---|
| Output is 48 kHz, mono, PCM | Re-run from ingest; a format drift means a filter chain typo |
| Noise floor improved by ≥ 6 dB, or input was already ≤ −58 dBFS | Log "no measurable change"; do not show a delta |
| Integrated loudness changed by ≤ 1.0 LU | Chain is not gain-neutral; find the stage and fix it |
| Speech duration within ±50 ms of input | A dent denotes gating or over-compression |
| No sample at or above −0.1 dBFS | Add nothing; the master limiter handles peak |
| Intelligibility re-judge does not fall below the input score | The chain hurt the words; revert and use TTS |

That last row is the one everyone skips. Re-judging costs one more slice call and
catches the failure mode where a denoiser makes a file measurably quieter and
perceptually worse.

## Capability checks at boot

`ffmpeg-static` is a fixed build. Probe once, cache the result, show it on
**Settings & diagnostics** as a plain table:

```bash
ffmpeg -hide_banner -filters | findstr /C:"afftdn" /C:"anlmdn" /C:"deesser" \
  /C:"loudnorm" /C:"sidechaincompress" /C:"adeclip" /C:"adeclick" /C:"ebur128"
deep-filter --version
```

Missing filters are not an error state. They are a capability downgrade with a
visible row, a copyable report, and a documented fallback: `deesser` absent →
fixed `equalizer=f=6600:t=q:w=2:g=-2` with a warning chip "Sibilance reduced with
a fixed filter"; `ebur128` absent → refuse to master and block export, because
loudness targets are a delivery promise.

## Performance budget

| Stage | 60 s mono take | Note |
|---|---|---|
| Ingest | < 0.5 s | One resample |
| DeepFilterNet | 6–10 s | Single thread per file; parallelise across files, not within |
| `afftdn` | 1–2 s | Cheaper, duller |
| `anlmdn` | 15–40 s | Only for tonal noise |
| De-ess + EQ + compress | < 1 s | One pass, one filter graph |
| Measure | < 1 s | Two `-f null` passes |

Total for a typical take: under 15 s, which fits inside the `analysing` stage's
budget and never needs its own progress bar. If a take exceeds 60 s of audio,
process in 20 s blocks with 0.5 s overlap and crossfade the joins at −60 dB;
`anlmdn` and `afftdn` are not internally block-parallel and will otherwise stall
on a single core.
