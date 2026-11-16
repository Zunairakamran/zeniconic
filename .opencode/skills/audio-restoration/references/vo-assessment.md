# Assessing a voiceover

The output of this file is one record per audio file hash: a band, a mode, and
the evidence for both. Everything downstream (cleanup, TTS, captions, the review
check) reads that record.

## The trust boundary

Two kinds of evidence, never mixed:

| Source | Produces | Never produces |
|---|---|---|
| FFmpeg, run locally on the full file | loudness, true peak, noise floor, clipped samples, SNR, speech duration, pace denominator | transcript, judgements |
| `google/gemini-3.8-flash`, given a bounded slice | transcript, filler identification, intelligibility, on-topic judgement, fact mentions | any number written to the EDL |

A model asked "how loud is this" answers with a plausible number that is wrong by
several LU, and unstable between calls, which breaks determinism. So: the model
judges, the app measures, and the merge step is pure code.

## Step 1 — Measure the full file

Ingest to 48 kHz mono first; measure the working copy, not the original.

```bash
ffmpeg -hide_banner -nostats -y -i vo_raw.m4a \
  -af "aresample=48000,aformat=channel_layouts=mono" \
  -c:a pcm_s24le vo.wav

ffmpeg -hide_banner -nostats -i vo.wav \
  -af "ebur128=peak=true:framelog=quiet,astats=measure_overall=all:reset=0" \
  -f null - 2> measure.log

ffmpeg -hide_banner -nostats -i vo.wav \
  -af "silencedetect=noise=-38dB:d=0.35" -f null - 2> silence.log
```

Parse, in this order:

| Metric | Where it comes from | Use |
|---|---|---|
| `integratedLufs` | `ebur128` `I:` summary line | context only; the master re-levels |
| `truePeakDbtp` | `ebur128` `Peak:` (true peak) | pre-chain headroom check |
| `noiseFloorDbfs` | `astats` `Noise floor dB` (quietest channel) | band input |
| `clippedSamples` | `astats` `Peak count` at 0.0 dBFS ÷ `Number of samples` | fatal override |
| `speechSec` | total duration − Σ `silence_duration` | pace denominator, coverage |
| `snrDb` | speech RMS (`astats` over a speech window) − `noiseFloorDbfs` | band input |
| `sampleRate`, `channels`, `codec` | `ffprobe -show_streams` | diagnostics |

Speech windows for the SNR estimate: the two longest non-silent runs from
`silence.log`. Wind, traffic and hum all read as noise floor; a fan that switches
on mid-take does not, so if the floor moves by more than 6 dB between windows,
record the worse value.

Coverage: `speechSec ÷ variant duration`. Below 0.60 the voice is a fragment
over a mostly silent video, which reads as an editing accident. That is a
`replace` unless the variant is deliberately music-only.

## Step 2 — Slice for the judge

Local-first permits short audio slices to leave the machine. Keep them short.

- Take ≤ 90 s total. For a longer take, send three windows of 20 s: the first
  8 s (the hook), the middle, and the last 8 s (the call to action).
- Mono, 16 kHz, 24 kbps Opus. That is 60 kB for 20 s. The model does not need
  48 kHz to hear that a room is empty and a speaker is bored.

```bash
for t in 0 40 999; do
  ffmpeg -hide_banner -y -ss $t -t 20 -i vo.wav \
    -ac 1 -ar 16000 -c:a libopus -b:a 24k "slice_$t.ogg"
done
```

Send the slices as `input_audio` parts in one request, with the listing facts as
text. The prompt version string (`vo-judge@3`) is part of the cache key stored in
SQLite. It is deliberately **not** written to `provenance.promptVersions`, which
the schema restricts to `tagging` and `planning`. The model pin goes in
`provenance.models.review`.

## Step 3 — The seven checks

Two are measured locally; five are judged. They share one table so the merge step
has one shape.

| Check | Scale | What earns a poor score |
|---|---|---|
| Noise floor | dBFS, measured | Above −45 dBFS is audible on phone speakers; above −35 is disqualifying |
| Clipping | % samples, measured | Any flat-topped syllable; 0.05% is the fatal line |
| Room reverb | none / mild / moderate / severe, judged | "Moderate" plus a hard reflective room makes consonants smear |
| Pace | words/min, computed | Below 100 drags; above 175 sounds like an auctioneer; 120–165 is the window |
| Filler ratio | fillers ÷ words, computed from judged transcript | Above 4% reads as unrehearsed; above 8% is unusable |
| Describes this property | facts matched ÷ facts available, judged | Generic boilerplate ("welcome to this stunning home") matches nothing |
| Intelligibility | 0.0–1.0, judged | Below 0.65 people stop listening; below 0.8 hurts on mobile |

Filler set: `um, uh, er, ah, like, you know, sort of, kind of, I mean, so, right,
basically, actually`. Count only where it is filler by judgement, not where it
carries meaning ("kind of property" is fine). The model returns positions; the
count is arithmetic.

Fact matching is against the listing's confirmed facts, never against the
transcript alone:

- Address, price, beds, baths, parking, land size, floor area, year built.
- Named features from the facts table ("north-facing garden", "air source heat
  pump").
- Room names that exist in the footage index.

Three thresholds: fewer than 3 facts mentioned anywhere → off-topic; no fact in
the first 8 s → weak hook; a fact that **contradicts** the listing (wrong price,
wrong bedroom count, a different street) → wrong-property override.

## Response shape

```json
{ "transcript": "…", "words": [{ "text": "…", "startSec": 0.0, "endSec": 0.0 }],
  "fillers": [{ "text": "um", "startSec": 1.2 }], "intelligibility": 0.0,
  "reverb": "none|mild|moderate|severe", "energy": "flat|steady|warm|rushed",
  "factsMentioned": ["three bedrooms"], "factsContradicted": [], "notes": "…" }
```

`words[]` is accepted only if every `endSec > startSec` and the last
`endSec` ≤ the audio duration + 0.25 s; otherwise the slice drifted and the
transcript is discarded. Word timings from a slice are used for the on-topic
window only — caption timings come from the final master, after cleanup, because
cleanup shifts nothing but TTS replacement changes everything.

## Step 4 — Score and band

Six weighted sub-scores, each normalised to 0.0–1.0:

| Sub-score | Weight | 1.0 at | 0.0 at |
|---|---|---|---|
| Intelligibility | 0.30 | 1.0 | 0.55 |
| Noise | 0.20 | ≤ −60 dBFS | ≥ −35 dBFS |
| Clipping | 0.15 | 0 samples | ≥ 0.05% |
| Pace | 0.15 | 120–165 wpm | ≤100 or ≥190 |
| Filler | 0.10 | 0% | ≥ 8% |
| Facts | 0.10 | ≥ 6 matched | 0 matched |

```
composite = 0.30·intelligibility + 0.20·noise + 0.15·clipping
          + 0.15·pace + 0.10·filler + 0.10·facts
```

Store the float (0.000–1.000). Display the integer `round(composite × 100)`,
because UI scores are 0–100 integers and data scores are 0.0–1.0 floats.

| Band | Composite | Mode written to `audio.voice.mode` |
|---|---|---|
| **keep** | ≥ 0.78 | `keep` |
| **clean** | 0.55 – 0.77 | `clean` (with `enhance` flags set) |
| **replace** | < 0.55 | `replace_tts`, or `mute` when the user declines narration |

### Fatal overrides

Any one of these forces `replace` regardless of the composite, because the
composite cannot express "this is unrecoverable" or "this is untrue":

| # | Condition | Why |
|---|---|---|
| F1 | A fact is contradicted, or the address names another property | Shipping it is a misrepresentation; it is a legal problem, not an audio problem |
| F2 | Clipped samples ≥ 0.05% | Waveform information is gone; nothing restores it |
| F3 | Noise floor > −35 dBFS | The voice cannot win against that without sounding like a vocoder |
| F4 | Intelligibility < 0.65 | The listener cannot recover meaning; cleanup will not add it |
| F5 | 0 facts matched | It is not about this property, whatever else it is |
| F6 | Coverage < 0.60 with speech present | The edit has a hole where the voice should be |

F1 is surfaced immediately, before any cleanup runs, with the contradicted fact
and the listing value side by side: the user usually needs to know they recorded
the wrong house.

## Step 5 — Cache and reuse

Key: `sha256(file) + promptVersion + modelPin + factsHash`. Content-addressed,
like every stage output. Consequences:

- Re-analysing an unchanged file is free and instant.
- Editing the facts invalidates the judgement, not the measurements.
- Re-recording 4 s of a 40 s voiceover invalidates everything, which is correct:
  the transcript changed.

If the provider is unreachable, or offline mode is on: keep the measured metrics,
skip the judgements, never guess a composite. Record `band: "unknown"`, set the
mode from measurements alone (`clean` if they fit the clean band, otherwise
`mute`), and show one line in the voice card: "Couldn't check the words — offline.
Numbers are measured; the transcript is missing." Placeholder transcripts are
worse than none: they reach captions.

## Worked examples

**A — kitchen phone recording, 24 s.** Noise −31 dBFS, SNR 9, pace 191 wpm,
fillers 9%, 2 of 7 facts, intelligibility 0.72 → **replace**, also F3. No chain
removes a hard kitchen. TTS from the facts table: 52 words for 24 s.

**B — garden walkthrough, 38 s.** Noise −46 dBFS, 0.09% clipped samples on the
first "welcome", pace 148, fillers 2%, 5 of 7 facts → composite 0.79 but
**replace** on F2. Offer: re-record the first 4 s, or TTS for the hook only. Most
users re-record once they see the timestamp.

**C — indoor talking head, 31 s.** Noise −58 dBFS, pace 152, fillers 3%, 5 of 7
facts, reverb mild → **keep**. `denoise: false`; `deess` only if sibilance
measures above −30 dB in 5–8 kHz. Doing nothing is a feature: an unnecessary chain
costs time and can only hurt.

**D — bedroom, laptop mic, 27 s.** Noise −44 dBFS (fan), pace 163, fillers 2%,
4 of 7 facts, reverb mild → **clean**. DeepFilterNet with post-filter, high-pass
90 Hz, de-ess 0.35, presence +2 dB at 3.5 kHz; expect −56 dBFS after. Worse than
−50 means escalate to `replace` — an honest failure beats a processed sound.

## What the user sees

One card, four lines, no score in the headline: the band as a word ("Keep",
"Clean up", "Replace"); the reason in one sentence ("The room is echoing, so the
words smear"); the delta after cleanup ("Noise −44 → −57 dBFS"); and the action
(`[ Clean up voice ]`, `[ Write a new voiceover ]`, `[ Use music only ]`).

Scores appear only in the shot inspector and diagnostics, as integers with the
word "score" attached: a bare 64 reads as a grade on the agent's performance,
not as information about the recording.
