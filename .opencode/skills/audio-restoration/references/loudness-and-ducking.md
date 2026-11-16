# Loudness and ducking

Loudness is a delivery promise, not a taste. Platforms turn down what is too hot
and never turn up what is too quiet, so a −9 LUFS master sounds squashed next to
the video before it, and a −22 LUFS file sounds broken next to the agent's own
walkthrough.

## Targets

Straight from the render profiles in `CONVENTIONS.md`. Do not invent a fifth.

| Render profile | Covers | Integrated | True peak | LRA |
|---|---|---|---|---|
| `vertical-social` | TikTok, Reels, Stories, Shorts | −14 LUFS | −1.5 dBTP | ≤ 9 LU |
| `feed-portrait` | Instagram feed, Facebook feed | −14 LUFS | −1.5 dBTP | ≤ 9 LU |
| `pin` | Pinterest | −14 LUFS | −1.5 dBTP | ≤ 9 LU |
| `landscape` | YouTube, website, MLS, email | −16 LUFS | −1.5 dBTP | ≤ 11 LU |

`audio.mix.lufs` and `audio.mix.truePeakDbtp` carry the **measured** values of the
master, not the target. The target lives in the render profile; the EDL records
what happened. Writing the target into the EDL is how a pipeline starts lying to
its own review stage.

### The −23 LUFS question

Some MLS boards and broadcast deliverables ask for −23 LUFS (EBU R128 / ATSC
A/85). That does not change the `landscape` profile, defined at −16 LUFS and the
default for MLS. It is a per-delivery override: a chip on the Destination, written
into `audio.mix.lufs` as −23, and named on the spec sheet. It is never applied
because a competitor does, or because someone read a loudness article.

## The order that always works

```
clean voice → bed level → duck → sum → two-pass loudnorm → true-peak limiter → mux
```

Two rules that cause most loudness bugs when broken:

1. **Normalise after the sum.** Normalising the voice alone and then adding music
   produces a master that is hot by exactly the music's contribution.
2. **Measure after muxing.** AAC and Opus encoders push inter-sample peaks up by
   0.2–0.5 dB. A master measuring −1.5 dBTP as WAV can read −1.1 in the MP4. If
   the muxed file exceeds −1.5, re-master at −1.8 and record that.

## Two-pass loudnorm

Pass 1 measures. The numbers arrive on stderr as JSON.

```bash
ffmpeg -hide_banner -nostats -i work/mix.wav \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" \
  -f null - 2> work/loudnorm_pass1.json
```

Parse `input_i`, `input_tp`, `input_lra`, `input_thresh`, `target_offset`.

Pass 2 applies, using the same filter with the measurements supplied. `linear=true`
preserves the dynamics the cleanup chain earned; dynamic mode is a last resort.

```bash
ffmpeg -hide_banner -y -i work/mix.wav \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:\
measured_I=-21.4:measured_TP=-2.8:measured_LRA=6.1:\
measured_thresh=-32.0:offset=0.3:linear=true:print_format=summary" \
  -ar 48000 -c:a pcm_s24le work/master.wav
```

Rules for this step:

- `loudnorm` must be the only filter in the pass-2 graph, or the last one with
  nothing level-affecting after it. A `volume` after `loudnorm` invalidates it.
- Resample **before** the chain, never after: measurements are rate dependent.
- If the input is already within 1.0 LU of target **and** true peak ≤ −1.5, skip
  pass 2. Re-normalising a correct file adds limiter touch for nothing.
- If `linear=true` cannot hit the target within the peak ceiling it falls back to
  dynamic silently. Detect it: compare `output_i` to the target and warn —
  "Music and voice squeezed to fit −14 LUFS. Consider a quieter bed."
- Two-pass on a 60 s mix costs about 1.5 s. There is no reason to single-pass.

## True-peak limiter

`loudnorm`'s own limiter is adequate but its true-peak handling is
sample-domain. For a guaranteed ceiling, oversample around a lookahead limiter:

```bash
ffmpeg -hide_banner -y -i work/master.wav -af "\
aresample=192000,\
alimiter=limit=0.841:attack=5:release=50:level=0,\
aresample=48000" \
  -ar 48000 -c:a pcm_s24le work/master_tp.wav
```

`0.841` is −1.5 dBFS linear. `attack=5` ms catches transients without pumping;
`release=50` ms is fast enough for speech and slow enough for a bed. Verify with
`ebur128=peak=true`, reading the true-peak line — not the sample peak.

## Ducking

The bed sits at a measured level in the gaps and drops by 18 dB whenever the
voice is present. Three numbers define it, and all three are in the EDL:
`audio.music.gainDb`, `audio.music.duckUnderVoiceDb` (−18), and the voice clip
times that drive the envelope.

### Levels

| State of the bed | Target | Why |
|---|---|---|
| In a gap, no voice | −24 LUFS measured (±1) | Present, lively, but clearly not the message |
| Under voice, after duck | −42 LUFS measured | 26–28 dB under a −16 or −14 LUFS voice: audible on a phone, never competing |
| Intro, before the first word | −22 LUFS, fading to −24 | Half a second of music tells the viewer sound is coming |
| Outro, after the last word | −24 LUFS, tail 1.5 s | Gives the call to action somewhere to land |

`gainDb` is computed, never guessed:

```
gainDb = −24 − trackIntegratedLufs      (clamp to [−40, +12])
```

A bed measured at −18 LUFS gets `gainDb: -6.0`; a quiet ambient bed at −31 gets
`+7.0`. Beyond ±12 dB the bed is wrong for the job: replace it rather than
amplifying its noise floor.

### The duck: envelope first

A 200 ms attack is not the problem; where the ramp starts is. A causal compressor
moves only once the voice is audible, so the first consonant lands over unducked
music — exactly where intelligibility is won. Delaying the key makes it worse: a
key lags a compressor, never leads it. So the render builds the gain envelope from
the EDL, where voice clip times are known, and applies it with `amultiply`. The
attack ramp starts 200 ms *before* the onset, so the bed is down before the first
phoneme.

| Segment | Value | Shape |
|---|---|---|
| Gap | 1.0 | flat |
| 200 ms before onset | 1.0 → 0.126 | linear in dB, 200 ms |
| Under speech | 0.126 (−18 dB) | hold |
| 400 ms after the last word | 0.126 → 1.0 | linear in dB, 400 ms |

```bash
ffmpeg -hide_banner -y -i work/bed.wav -i work/duck_env.wav -i work/vo_clean.wav \
-filter_complex "\
[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=-4dB[bed];\
[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[env];\
[bed][env]amultiply[ducked];\
[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[vo];\
[ducked][vo]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mix]" \
-map "[mix]" -ar 48000 -c:a pcm_s24le work/mix.wav
```

The envelope is a pure function of the EDL — regions closer than 400 ms merged, so
the bed does not pop between sentences — and the render cache can reuse it.

### Fallback: a sidechain compressor

For live preview, where no envelope exists, drive `sidechaincompress` from the
voice instead: `[bed][key]sidechaincompress=threshold=0.02:ratio=12:attack=200:release=400`,
then `amix` the ducked bed with the voice at `normalize=0`. It is audio-reactive,
so it cannot lead the onset and will leak.

Gain reduction is roughly `GR = (key_dBFS − threshold_dBFS) × (1 − 1/ratio)`: at
`threshold=0.02` (−34 dBFS), `ratio=12`, and a −16 dBFS voice, the excess is 18 dB
and GR ≈ 16.5 dB. Add 2 dB of key pre-gain to reach 18.3. The stated −18 is a
calibrated outcome the pipeline asserts, not a knob it turns. Expect 3–6 dB of
leakage in the first 200 ms: fine for preview, not for export.

Two details for both paths:

- `amix=normalize=0` is mandatory. The default halves every input and quietly
  costs 6 dB, which the master then normalises back, making the bed loud.
- 400 ms release bridges sentence gaps shorter than 400 ms without pumping.

### Verifying the duck

You cannot measure the bed while the voice is over it. Render one diagnostic pass
with the voice branch muted — same graph, same envelope — and measure two windows:

```bash
ffmpeg -hide_banner -y -i work/bed.wav -i work/duck_env.wav -filter_complex "\
[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=-4dB[bed];\
[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[env];\
[bed][env]amultiply[duck]" -map "[duck]" -ar 48000 -c:a pcm_s24le work/duck_solo.wav
```

Then `ebur128` over a 2 s window inside speech and a 2 s window in a gap:

| Assertion | Passes when |
|---|---|
| Duck depth | 18 dB ±2 between the two windows |
| Onset leak | ≤ 1 dB with the envelope, ≤ 3 dB with the compressor fallback |
| No pump | Gain does not oscillate by more than 3 dB inside a sentence |
| Recovery | Back within 2 dB of the gap level 600 ms after speech ends |

If the duck is too deep for a sparse voiceover (coverage < 35%), use −12 dB in the
EDL and say why in the variant notes: a 15 s walkthrough with two sentences does
not need a 26 dB hole in the music.

### When not to duck at all

- **Voice coverage > 70%**: mute the bed under the voice with hard automation.
  Ducking for 25 of 30 s is a quieter bed with extra artefacts.
- **MLS**: default to no music. If the agent insists, record the licence and keep
  the bed at −30 LUFS unducked.
- **`pin`**: sound is off by default. Ship a bed at −24 LUFS for the minority who
  unmute, but never rely on it for the hook.

## Review check `loudness`

The check passes only when all four hold:

1. Measured integrated loudness within 1.0 LU of the profile target.
2. Measured true peak ≤ −1.5 dBTP in the **muxed** file.
3. LRA ≤ the profile ceiling.
4. Duck depth on the diagnostic pass 18 dB ±2 (or the recorded override, ±2).

Its `detail` string carries the numbers so the review screen never shows a bare
pass: `"−16.3 LUFS, −1.6 dBTP, duck −18.1 dB"`.
