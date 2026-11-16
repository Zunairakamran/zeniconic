# Music and narration

Two decisions live here: which bed, and who speaks. Both are supply problems that
must be solved before the cut plan exists, because the plan snaps to the beat and
the captions come from the voice.

## The bank

Fifteen beds, three moods, five per mood. Pre-rendered, pre-measured,
pre-licensed, pre-gridded. Stored under `data/assets/music/<mood>/` and indexed in
SQLite.

| id | Mood | BPM | Duration | Measured | Structure | Best for |
|---|---|---|---|---|---|---|
| `bed_calm_01` | calm / luxury | 72 | 48 s | −21.4 LUFS | piano + pad, no drums | `cinematic_hero`, `just_listed` |
| `bed_calm_02` | calm / luxury | 78 | 62 s | −23.0 LUFS | felt piano, room noise, tail | `agent_intro`, `price_drop` (soft) |
| `bed_calm_03` | calm / luxury | 84 | 55 s | −20.8 LUFS | nylon guitar, brushed texture | `amenity_lifestyle` |
| `bed_calm_04` | calm / luxury | 70 | 70 s | −24.2 LUFS | sustained strings, no rhythm | `cinematic_hero` (slow), `pin` |
| `bed_calm_05` | calm / luxury | 88 | 45 s | −19.9 LUFS | marimba ostinato + sub | `vertical_tour`, `room_walkthrough` |
| `bed_social_01` | upbeat / social | 112 | 40 s | −18.6 LUFS | pluck hook, clap, kick | `social_hook`, `just_listed` |
| `bed_social_02` | upbeat / social | 120 | 35 s | −17.9 LUFS | filtered disco guitar | `social_hook`, `price_drop` |
| `bed_social_03` | upbeat / social | 104 | 50 s | −19.2 LUFS | house piano, soft hats | `vertical_tour` |
| `bed_social_04` | upbeat / social | 124 | 30 s | −17.4 LUFS | trap-ish hats, sparse | `social_hook` (fast) |
| `bed_social_05` | upbeat / social | 108 | 45 s | −18.8 LUFS | funk bass, rim clicks | `before_after`, `amenity_lifestyle` |
| `bed_cine_01` | cinematic / walkthrough | 96 | 58 s | −22.6 LUFS | pulse + low strings, builds | `drone_hero`, `room_walkthrough` |
| `bed_cine_02` | cinematic / walkthrough | 102 | 64 s | −23.4 LUFS | arpeggio, no percussion | `room_walkthrough` |
| `bed_cine_03` | cinematic / walkthrough | 90 | 75 s | −24.0 LUFS | drone bed, single motif | `cinematic_hero`, `drone_hero` |
| `bed_cine_04` | cinematic / walkthrough | 110 | 52 s | −21.9 LUFS | toms, rising strings | `before_after`, `price_drop` |
| `bed_cine_05` | cinematic / walkthrough | 98 | 60 s | −22.1 LUFS | rhodes + tape hiss | `agent_intro`, `editorial` look |

Each row also stores, in the index: `sampleRate` (48 000), `bpm`, `bpmConfidence`,
`beatGrid` (see below), `truePeakDbtp`, `loopable` (true for 11 of 15),
`stemsAvailable` (music-only and no-drums where the licence allows stem
delivery), `license`, and `reviewedBy`.

Mood maps to Look, and Look is already fixed by the variant:

| Look | Bed mood | Never |
|---|---|---|
| `calm` | calm / luxury | Drums over a voiceover |
| `social` | upbeat / social | A 124 BPM bed under a 45 s walkthrough |
| `walkthrough` | cinematic / walkthrough | Vocals — sample or otherwise — under narration |
| `editorial` | calm / luxury or `bed_cine_05` | Anything with a hook louder than the voice |

Selection is a query, not a judgement call, but it is not a single answer: take
the mood, filter by `duration ≥ variant duration + 2 s` unless `loopable`, filter
by BPM window for the format (social 104–124, walkthrough 90–110, cinematic hero
70–96), rank by 1 − |bpmConfidence − 1|, then **show the user the top three with
colour-coded mood tags**. Choice inside a mood is a taste decision that belongs
to the agent, not to us.

## Why generation per listing is the wrong shape

Generating a bespoke bed for every listing sounds like a feature. It is a
structural mistake, for five reasons in order of severity:

1. **The beat grid must exist before the cut plan.** Cuts snap to beats
   (`audio.music.beatGrid`, cached by the schema precisely so cuts can snap
   "without re-analysis"). If the music does not exist yet, planning waits on an
   8–20 s model call, or plans blind and re-plans afterwards. Either way the
   user waits, twice, for a decision that changes nothing creative.
2. **It breaks determinism.** `CONVENTIONS.md` requires the same inputs and
   versions to produce a byte-identical EDL, and renders are compared by EDL
   hash. A generation call is non-deterministic: re-rendering yesterday's
   variant would ship different music under the same EDL id. "Same video,
   re-rendered" stops being true.
3. **Cost per listing never amortises.** A bank is fifteen one-off decisions. At
   six listings a week with two variants each, per-listing generation is roughly
   600 calls a year versus fifteen, and every one of those calls needs a listen,
   a licence record and a quality gate. The marginal cost of a bank track is
   zero; the marginal cost of a generated track is a call plus human review.
4. **Quality gate bandwidth.** Unreviewed AI music in a client-facing listing is
   brand risk with no upside: at best it is as good as a curated bed, and nobody
   listened to it. Every bank track has a `reviewedBy`.
5. **Licence provenance.** Bank tracks have a written licence today. Generated
   audio has provider terms, an account, a date, and a moving disclosure
   expectation. That record can be made, but it is work per track.

**Generation is a supply activity.** Use `google/lyria-3-pro-preview` when:

- The bank genuinely has no fit (a specific brand theme, a seasonal listing, a
  developer's sonic identity).
- A mood is missing for a new Format.
- The agent asks for something the bank cannot do ("something with a cello").

Pipeline: generate at 48 kHz, measure loudness and true peak, extract the beat
grid, get a human to listen and approve, write the licence record with
`source: "ai_generated"`, `licenseId: "lyria:<generation-id>"`, and only then add
it to the bank and make it selectable. Never generate inside a render, and never
let an unapproved generation reach a Destination.

## Royalty-free sources and what to verify

| Source | Typical licence | Verify before use |
|---|---|---|
| Artlist, Epidemic Sound, Musicbed | Subscription, account-scoped | Advertising/commercial use is covered by the tier; the record must name the account so it stays valid |
| Uppbeat | Free tier with credit, paid without | Attribution is mandatory on free tier — write it into `license.attribution` |
| Free Music Archive | Per-track Creative Commons | Check NC (no commercial) and ND (no derivatives: a 28 s cut is a derivative) |
| Pixabay Audio | Broad, no attribution | Still record the asset URL and download date |

Hard rules:

- "Royalty-free" is not "no licence". The bank record **is** the licence; a track
  without a record cannot be selected.
- YouTube Content ID claims appear on licensed tracks. The licence record is the
  dispute evidence, so `licenseId` must be specific enough to win one.
- MLS destinations default to no music. Some boards prohibit it outright, others
  treat it as advertising material. Warn on the Destination tile, do not decide
  silently.
- Never ship a bed with vocals, chopped or otherwise, under narration.
- Do not re-encode a bed that is already 48 kHz; `-c:a copy` when trimming on a
  frame boundary is not possible, so trim with `atrim` and accept one generation
  at PCM, not three at lossy.

## Beat grid

Extract once per track, at ingest into the bank, and store both the grid and the
tempo:

```bash
aubio beat -i bed_social_01.wav > bed_social_01.beats.txt
```

Grid rules:

- Times ascending, seconds, 3 dp — the schema requires ascending numbers and caps
  the array at 2400 entries. At 124 BPM a 40 s bed needs 83 beats; the cap only
  binds on beds longer than ten minutes, which the bank does not contain.
- Store `bpmConfidence` (0.0–1.0) from the detector's own agreement across the
  track. Below 0.7, treat the bed as ambient: **do not snap cuts** to it.
- Validate: consecutive intervals must be within ±8% of `60/bpm`, and the first
  beat must be under 2 s. A grid that starts at 12 s is a misdetection.
- Snapping: move a cut to the nearest beat only when |Δ| ≤ 0.12 s. Larger
  offsets mean the beat is not where the picture wants to cut, and forcing it
  truncates the reveal. A 0.3 s snap turns a doorway push into a stumble.
- Never snap a cut earlier than the shot's action onset. If the beat is before
  the door opens, the beat loses.

## Trimming and looping

- Lead-in: bed starts at 0.000 s, first voice at 0.400 s or later. The gap tells
  the viewer sound is coming.
- Tail: bed fades out over 1.2 s, ending no later than 1.5 s after the last word.
- Loop a `loopable` bed only on a bar boundary, with a 30 ms equal-power
  crossfade. A hard loop on a piano note is instantly audible.
- A non-loopable bed at 40 s for a 50 s variant: cut the structure, not the end.
  Find the last bar line, drop the middle, keep the ending.
- Stems: when available, drop drums under narration and keep them in the gaps.
  That reads as intentional scoring and costs nothing at mix time.

## Narration replacement

Two engines, one output contract: 48 kHz mono PCM, then the **master** chain only.
Skip denoise, skip de-ess, skip compression — synthetic speech arrives clean, and
running the cleanup chain on it only adds artefact.

| Engine | When | Notes |
|---|---|---|
| `openai/gpt-audio` via OpenRouter | Default for replacement | Natural prosody, handles British place names better than older TTS. Costs a call per variant and needs network |
| Piper (local) | Offline, or the user refuses provider calls | Zero cost, no network, robotic but intelligible. Use `en_GB-alba-medium` for a female voice, `en_GB-northern_english_male-medium` for a northern male |

```bash
piper --model voices/en_GB-alba-medium.onnx \
      --length_scale 1.06 --sentence_silence 0.35 \
      --output_file work/tts.wav < work/script.txt
```

`length_scale 1.06` slows delivery about 6%, which is what makes a script that
tests at 2.2 words/second sound unhurried rather than clipped.

### Script rules

1. **≤ 2.2 words per second.** The budget assumes lead and tail silence.
2. **One idea per sentence.** No sentence carries both a feature and a location.
3. **≤ 18 words per sentence.** Long sentences are where TTS prosody collapses.
4. **No exclamation marks.** They read as shouting in a listing video.
5. **Numbers as words.** "Three bedrooms, two bathrooms", not "3 bed 2 bath".
   Digits are for overlays, not for the voice.
6. **No abbreviations.** "Square feet", "heat pump", "en suite" — spelled out.
7. **Say the address once, in the first two sentences, and never again.** It is
   the fact that proves the video is about this property.
8. **No superlatives that cannot be checked.** "Stunning" and "must-see" are
   claims with no content; "south-facing garden" is a fact.

Word budget by variant duration:

| Target | Words | Example use |
|---|---|---|
| 15 s | 30 | `social_hook` |
| 30 s | 62 | `just_listed`, `price_drop` |
| 45 s | 94 | `room_walkthrough` |
| 60 s | 128 | `cinematic_hero` |

A 30 s script that comes to 62 words:

> Fourteen Oak Avenue. A three-bedroom semi on a quiet road, five minutes from
> the station. The kitchen runs the full width of the back, with doors onto a
> south-facing garden. Upstairs, two double bedrooms and a family bathroom.
> Parking for two cars, and a heat pump fitted last year. Viewings from Saturday.

That is 60 words, 4 facts beyond the address, one idea per sentence, no
exclamation marks.

After rendering, **regenerate captions from the new audio** and rewrite
`captions.words`. The schema carries word-level timings, and stale captions fail
the `facts_present` review check as surely as a wrong price would.

## QA checklist for a bed

- [ ] `license.source` and `licenseId` present; attribution written when required.
- [ ] Measured loudness in the bank index matches a fresh measurement (±0.3 LU).
- [ ] `beatGrid` ascending, first beat < 2 s, intervals within ±8% of `60/bpm`.
- [ ] No vocals; no melodic hook that competes with the first spoken word.
- [ ] Bed duration ≥ variant duration + 2 s, or the track is `loopable`.
- [ ] Mood matches Look; nothing from the social mood under a `calm` look.
- [ ] Gains computed from measurement, not from the preview player's volume.
