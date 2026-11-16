---
name: Audio restoration
description: Use when a listing video's voiceover is weak, noisy, echoing, clipped, over-fast, full of filler, off-topic or missing, when music fights the voice, or when a delivery misses its loudness target. Judges the voice, picks keep/clean/replace, runs the CPU-only enhancement chain, masters to the render profile, and supplies licensed music or narration.
---

# Audio restoration

The voice is the part of a listing video that a buyer trusts. A hissy, echoing,
rambling voiceover makes a good property look cheap, and no amount of colour
grading rescues it. This skill exists so the audio is never the reason a video
fails, and so the app never lies about what it did.

Two sentences carry the whole skill:

1. **A weak voice gets fixed, replaced, or removed. It is never shipped as-is.**
2. **Restoration cleans what is there. It does not invent what is missing.**

## When to use

Load this skill when any of these is true:

- A source clip or an uploaded voiceover track exists and will carry narration.
- The user says any of: "the audio is bad", "it's noisy", "it echoes", "too
  quiet", "music is too loud", "add a voiceover", "it sounds like a phone",
  "make it sound professional".
- A variant is being built for `vertical-social`, `feed-portrait`, `landscape`
  or `pin` and the `audio` block of the EDL is not yet final.
- A review check with `id: "loudness"` has failed.
- The user is choosing music, or asking whether a track is safe to use.

## When to switch skills

- **Format, look, hook, beat timing, room order, on-screen copy** →
  `real-estate-creative`. That skill decides a mood; this skill supplies the bed
  that fits it and the mix that carries it.
- **Visual problems, framing, shot order, text placement** → `ui-ux-for-video-tools`
  for anything the user sees; shot-level craft lives with the pipeline planning
  stage, not here.
- **Building or modifying a screen, component, diff block or empty state** →
  `ui-ux-for-video-tools`. This skill describes what audio UI must say, not how
  it is laid out.
- **Render pipeline, muxing, EDL validation** → the pipeline's own docs. This
  skill produces parameters and files; it does not own the renderer.
- **Music licensing disputes, takedowns, rights questions** → escalate to the
  human owner. Do not improvise a legal position beyond what
  `references/music-and-licensing.md` records.

## Workflow

1. **Locate the voice.** Identify which source clip, or which uploaded file,
   carries speech. Check `audio.voice.mode` in the EDL and the listing's
   `raw/` directory. Record the file's SHA-256: it keys every cached result.
2. **Measure locally, first.** Numbers come from FFmpeg, never from a model.
   Run the measurement pass from `references/vo-assessment.md` to get
   integrated loudness, true peak, noise floor, clipped-sample count, speech
   duration and SNR. If the file is shorter than 0.8 s of speech, stop: there
   is nothing to judge.
3. **Judge content and delivery.** Send a bounded slice (≤90 s, mono 16 kHz
   Opus) to `google/gemini-3.8-flash` for a transcript plus the seven delivery
   checks — two measured locally, five judged. The model scores; the app measures.
   Merge the two into one record. See `references/vo-assessment.md`.
4. **Band it, and write the mode.** Composite score `< 0.55` → replace;
   `0.55–0.77` → clean; `≥ 0.78` → keep. Any fatal defect overrides the
   composite. Map the band to `audio.voice.mode`:
   `keep` → `keep`, `clean` → `clean`, `replace` → `replace_tts` or `mute`.
   Never leave the mode unset.
5. **Clean, if the band is `clean`.** Run the ordered chain from
   `references/enhancement-chain.md`: DeepFilterNet or `afftdn` → high-pass
   90 Hz → de-ess → presence EQ → gentle compression. Cleanup is gain-neutral
   by design; levelling happens later, once, at master.
6. **Replace, if the band is `replace`.** Write a script under the word budget
   (≤2.2 words/second), then render with `openai/gpt-audio` or local Piper.
   When the voice is replaced, the old captions are wrong: retranscribe and
   rewrite `captions.words` from the new audio in the same job.
7. **Choose the bed.** Pick from the 15-track bank by mood → look mapping, or
   generate once with `google/lyria-3-pro-preview` if the bank genuinely has no
   fit, then review the result into the bank. Write `audio.music` with the
   cached `beatGrid`, measured gain and a complete `license` record. Never
   generate music during a render. See `references/music-and-licensing.md`.
8. **Duck, then mix.** Duck the bed under the voice by −18 dB with a 200 ms
   attack and 400 ms release, applied as a gain envelope built from the voice clip
   times and pre-rolled 200 ms before each onset, so the bed is already down at the
   first consonant. Sum with `amix` at `normalize=0`. See
   `references/loudness-and-ducking.md`.
9. **Master to the profile.** Two-pass `loudnorm` to the render profile target:
   `vertical-social`, `feed-portrait`, `pin` → −14 LUFS; `landscape` → −16 LUFS;
   true peak −1.5 dBTP in every case. −23 LUFS only as an explicit per-delivery
   override. Master after ducking, never before.
10. **Write it down and verify.** Fill `audio.mix.lufs` and
    `audio.mix.truePeakDbtp`, `audio.voice.enhance`, `audio.music.gainDb` and
    `duckUnderVoiceDb`. Then run the verification checklist at the end of this
    file. A variant whose measured loudness is more than 1 LU from its target
    does not ship.

## Hard rules

1. **Never claim "audio upscaling".** Resampling 16 kHz to 48 kHz adds no
   information above 8 kHz. Restoration removes defects; it does not raise a
   quality tier. The UI verb is "Clean up voice", never "Enhance quality".
2. **Never put a model's number in the EDL.** Loudness, true peak, noise floor,
   clipping, SNR, pace and word counts are computed from the file with FFmpeg.
   Model output contributes judgements and transcript text only.
3. **Never send more than 90 s of audio off the machine.** Local-first is a
   non-negotiable. For longer takes, send three 20 s windows and measure the
   full file locally.
4. **Always work at 48 kHz, mono for voice, internally.** `amountDb`-style
   resampling happens once, at ingest.
5. **Clipping is not repairable.** Above 0.05% clipped samples the band is
   `replace` even if every other metric is excellent. `adeclip` falsifies
   waveforms; it does not restore them.
6. **Order is not negotiable:** denoise → EQ → compress → duck → sum → master.
   Mastering before ducking means the duck depth is wrong; ducking before
   denoise means you modulate the noise.
7. **Cleanup output is gain-neutral within ±1 dB.** If the chain changed level,
   the chain is wrong, and the master will chase it forever.
8. **Every music bed needs a licence record.** `audio.music.license` with
   `source`, `licenseId` and `attribution` when the terms require it. A bed
   without a record cannot reach a Destination.
9. **Music comes from the bank at render time.** Generation is a supply
   activity that fills the bank, never a render step. Determinism and cost both
   depend on this.
10. **Narration script budgets are hard:** ≤2.2 words/second, one idea per
    sentence, ≤18 words per sentence, no exclamation marks, numbers written as
    words, no abbreviations. `audio.voice.text` is capped at 1200 characters by
    the schema; at 2.2 words/second that is roughly 90 s of speech, so longer
    variants need more than one voice block of thinking, not a longer string.
11. **Replace the captions when you replace the voice.** A caption track that
    disagrees with the shipped audio is a factual defect, and it fails the
    `facts_present` review check.
12. **No audible voice is a valid outcome.** If the facts are carried by
    overlays, `mute` with a bed at −22 dB is better than a bad fake voice. Say
    so in the UI rather than narrating badly.
13. **Report the delta, not a promise.** Every cleanup run stores before/after
    measurements. The user sees "noise floor −38 → −57 dBFS", not "improved".

## Reference map

| File | Read it for |
|---|---|
| `references/vo-assessment.md` | Band definitions, the seven checks, measurement commands, the judge response shape, worked examples |
| `references/enhancement-chain.md` | Filter-by-filter chain, exact FFmpeg commands, DeepFilterNet packaging, degrade paths, what each step cannot fix |
| `references/loudness-and-ducking.md` | Profile targets, two-pass `loudnorm`, LRA, true-peak limiting, ducking maths and the early-key trick |
| `references/music-and-licensing.md` | The 15-bed bank, beat grids, licence records, why per-listing generation is wrong, TTS script rules |

## Verification

Run all of these before the variant leaves `reviewing`:

- [ ] `ffprobe` reports 48 000 Hz for every audio stream in the master.
- [ ] Two-pass `loudnorm` second pass reports measured integrated loudness
      within ±1.0 LU of the profile target, and measured true peak ≤ −1.5 dBTP.
- [ ] Duck depth measured on the golden fixture is −18 dB ±2 dB, with no more
      than 1 dB of voice onset audible over the bed.
- [ ] `audio.voice.mode` is one of `keep`, `clean`, `replace_tts`, `mute` and
      matches the band that was recorded for the file's hash.
- [ ] If `mode` is `replace_tts`, `audio.voice.text` is present, ≤1200 chars,
      ≥8 words, and its word count ÷ words-per-second ≤ the variant duration.
- [ ] If `mode` is `replace_tts`, `captions.words` were regenerated from the
      new audio, and the first and last word times fall inside the timeline.
- [ ] `audio.music.license.source` and `licenseId` are non-empty; attribution is
      present when the track's terms require it.
- [ ] `audio.music.beatGrid` is non-empty, ascending, and its first beat is
      < 30 s (a bed whose grid starts late cannot snap a 15 s variant).
- [ ] No clipping in the master: clipped-sample count is 0 at −1.5 dBTP.
- [ ] Re-running the audio stage on the same inputs and the same model pins
      produces byte-identical audio, because the bed came from the bank and the
      chain is deterministic.
- [ ] The review check `loudness` passes, and `review.checks` records the
      measured LUFS in its `detail` string.
- [ ] Nothing in user-facing copy says "upscale", "HD audio", "studio quality"
      or "AI-enhanced" about a cleaned take.
