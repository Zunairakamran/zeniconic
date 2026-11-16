# Zeniconic — Product and Technical Specification

| | |
|---|---|
| **Document** | `docs/SPEC.md` — single authoritative specification |
| **Version** | 1.0.0 |
| **Status** | Approved for build |
| **Scope** | Windows 10 22H2 / Windows 11 desktop app, v1 |
| **Audience** | Engineering, design, QA, and whoever inherits support |

**Precedence.** `packages/edl/schema.json` defines what a valid edit is. `docs/CONVENTIONS.md` defines vocabulary and fixed decisions. This document defines behaviour. Where they disagree, the schema wins, then CONVENTIONS, then this file — and the disagreement is a bug to be fixed in the lower document, not worked around in code.

**Vocabulary.** Listing, source clip, shot, candidate, format, look, variant, destination, render profile, delivery, EDL, take. These words are used in this document with exactly the meanings in CONVENTIONS.md. They do not appear in user-facing copy.

> **Scope correction — 15 November 2026.** v1 produces **finished video files only**.
> Posting, copy, hashtags, platform wrappers, permits and publishing belong to the
> marketing team. The app delivers a clean master plus aspect variants (9:16, 16:9,
> 1:1) and optional burned captions or an SRT. Destinations, delivery wrappers,
> hashtags, ZIP bundles, upload checklists and auto-publishing are **deferred to v2**:
> §4.7 and §4.8 keep the design for later, but they are not built now. The Trakheesi
> permit line becomes an optional overlay, not an export gate, because compliance is
> the marketing team's responsibility.
>
> This removes roughly two weeks of work and moves the milestone that matters — a
> watchable 30-second cut — forward. Everything that touches the *edit* stays:
> selection, pacing, overlays, music, captions, voice, aspect reframing.

---

## 1. Product definition

Zeniconic is a local-first Windows application that converts a folder of raw property footage into a set of finished marketing videos. The user drops in what she filmed, confirms a short list of facts about the property, and receives three or more creative variants — rendered for the aspects the marketing team needs, with captions optional and a clean master always. Everything the app knows about an edit lives in an EDL: a small, validated JSON document that a model can edit, a human can diff, and a renderer treats as a pure input. The app never publishes, never invents a fact about a property, never changes an edit without showing the change first, and never loses work when it is closed.

### 1.1 The job to be done

> When a listing goes live and I have footage on my laptop, I want to hand the whole folder to something that returns finished, correctly sized videos for every platform, so the agent has marketing ready the same afternoon without me learning an editor.

Four job statements, in priority order:

| # | Job | Success looks like |
|---|---|---|
| J1 | Turn a folder into finished videos | 3 variants × 3 aspects, correct durations, no visible defects |
| J2 | Keep the property facts true | Every on-screen claim traces to something she typed or confirmed |
| J3 | Cover every platform without making five identical videos | 3 creative variants × 3 profiles, genuinely different edits |
| J4 | Finish inside one 20-minute slot | Interactive work ≤18 minutes, rendering runs unattended |

### 1.2 Non-goals (v1)

| Not building | Why | What we do instead |
|---|---|---|
| Timeline editor | The user is a beginner; a timeline transfers the hard problem back to her | Chat refinement with previewable diffs, plus shot swap |
| Auto-publishing | A wrong price on TikTok is a legal problem, not a UX problem | Explicit export to a folder; she uploads |
| Multi-user, accounts, roles | One assistant, one laptop, one agent | Single local profile; the agent approves on her screen |
| Cloud storage or sync | Footage is large, often confidential, and uploads are unreliable | Local workspace; only derivative frames and short audio slices leave the machine |
| Mobile app, macOS, web | Windows is the machine in the office | Windows-only installer, Electron bundles Node 22 |
| Music licensing marketplace | Out of scope, adds legal surface | 40-track cleared library, AI-generated tracks, user-supplied files with licence metadata |
| Frame-accurate colour grading | Not the job | Four LUT-free look presets and a single exposure/white-balance correction pass |
| Multi-language UI at launch | Time | Localisation-ready architecture, en-GB only in v1 |

---

## 2. Personas and context

### 2.1 Primary — Dani, listing assistant

- 27, runs marketing for a 6-agent branch. Films on an iPhone 15 and a DJI Mini 4.
- Edits in CapCut today, badly and slowly: trims by dragging until it "looks right", gives up on captions, exports one vertical video and reuses it everywhere.
- Knows property, not video. Does not know what a codec, bitrate or safe area is, and should never need to.
- Measures success in "is it done before the agent asks for it".
- Trusts the app only after it survives one busy week. One lost render costs more trust than ten good ones build.

### 2.2 Secondary — Marcus, the agent

- Owns the listing and the risk. Approves facts and the final look. Never operates the app himself.
- Cares about: price correct, address correct, no claims the vendor did not make, his face and logo not embarrassing.
- Receives: a folder link or nine files, plus a one-line summary of what was made and what it cost.
- Approval path: Dani shows him the three variants on her laptop, or sends the 540p drafts; he says yes or names one change. He does not open the project.

### 2.3 Edge case — Priya, human editor

- Exists at the branch for luxury listings and drone-heavy jobs.
- Uses Zeniconic to get coverage, a rough cut and a shot list, then finishes in Final Cut Pro.
- Needs one artefact: FCPXML 1.10 with clips, cuts, markers and overlay text as titles, referencing the copied sources. She does not need the app's look, music or captions.
- If FCPXML import fails, the listing is not blocked: she can still export MP4s.

### 2.4 Day in the life — constraints that shape every decision

| Constraint | Consequence for the build |
|---|---|
| **20 minutes per listing**, usually between viewings, sometimes three listings in an afternoon | The interactive flow is budgeted at 18 minutes (§3); every screen has a default that is good enough |
| Works on a **laptop**, often on battery, sometimes on a kitchen counter | No hover-only controls; target sizes ≥24 px; drafts before finals; renders throttle on battery |
| **May have no internet** for uploads and for the agent's CRM | Nothing depends on upload. Export is a local folder |
| **Needs models online** | Model stages require connectivity; the app degrades to a manual mode with a clear explanation rather than failing silently |
| Filename discipline matters: files land in shared drives | Deterministic naming, no spaces, no collisions, no overwriting |
| The agent may ask for a change at 18:50 on a Friday | Resumable queue, unattended batch render, version history |

**Explicit non-persona:** a professional colourist, a social media manager scheduling posts, or an IT administrator. If a feature only makes sense to one of those, it is not in v1.

---

## 3. The 18-minute flow

One listing, three variants, three profiles, from opening the app to a queued export. Times are her attention, not wall-clock. Machine work overlaps wherever it can; finals render after she walks away.

| # | Step | Her time | She does | The system does | If it goes wrong |
|---|---|---|---|---|---|
| 1 | Open listing | 1:00 | Drops the footage folder on *New listing*, types the address | Creates slug `YYYY-MM-DD-<address-slug>`, hashes and copies sources, probes them | E01 no video found; E02 unreadable file |
| 2 | Short brief | 1:00 | Optionally pastes the agent's WhatsApp message, types price if she has it | Extracts candidate facts from the text; starts analysis in the background | Skipped silently if she types nothing |
| 3 | Analysis | 3:30 | Watches contact sheets appear, skips anything obviously unusable | Single decode pass per clip, scene detection, metrics, room tagging | E03 HDR, E05 too short, E08 dark shots |
| 4 | Facts | 2:30 | Confirms price, address, beds, baths, features; fixes one wrong number | Shows every fact with its source and confidence; blocks export until confirmed | E15 unconfirmed or conflicting facts |
| 5 | Choose | 0:45 | Presses *Surprise me* (the default), or picks formats and a look | Pre-selects `cinematic_hero` + `social_hook` + `vertical_tour` with looks calm/social/walkthrough | Disabled formats explain why (E06) |
| 6 | Review | 3:30 | Plays three drafts, swaps one shot, approves two, regenerates one | Builds three EDLs, renders 540p drafts in parallel, scores each against ten checks | E07 repeated shots; E12 engine crash |
| 7 | Refine | 2:00 | Types "start on the garden, drop the second bedroom, price card earlier" | One planning call per request; returns a diff card; applies only on *Apply* | E11 invalid model output; E09 offline |
| 8 | Destinations | 0:30 | Ticks TikTok, Reels, Instagram feed, YouTube, MLS | Collapses five destinations into three render profiles and shows the file count | Warns if footage cannot fill a profile |
| 9 | Export setup | 1:15 | Chooses finals, captions burned + sidecar, keeps voice, picks a cover from three suggestions | Shows per-file cost, total cost, disk estimate, loudness target | E10 budget, E13 disk, E14 locked file |
| 10 | Queue | 0:30 | Presses *Export 9 files* | Enqueues nine takes, starts the first, shows a finish estimate | E10 stops before charging |
| 11 | Reshoot list | 1:00 | Reads the top five gaps, copies the list to her phone | Derives gaps from failed checks and missing rooms | — |
| 12 | Collect | 0:30 | Opens the deliveries folder, checks filenames and the caption file | Writes MP4, `.srt`, `.jpg`, `.txt` per delivery plus `manifest.csv` | E14 file locked |

**Budget:** interactive total 18:00. Two minutes of slack inside the 20-minute slot absorb a slow analysis or one extra refine turn.

### 3.1 Unattended machine time

Analysis typically takes 55 s (ceiling 90 s), tagging and planning 35 s (90 s), three 540p drafts 2 min 20 s (3 min), and nine 1080p finals 32 min (72 min). She never waits for finals: rendering continues with the window in the tray, survives sleep, and notifies once.

### 3.2 Time-box rules (hard)

- **At 12:00** without an approved variant: the app offers *Use the recommended three* and approves the highest-scoring variant per format.
- **At 16:00**: *Export what is approved* becomes the primary button; unapproved variants are dropped from the export with a one-line explanation.
- **At 18:00**: the app writes a draft export if nothing is approved, clearly labelled `DRAFT`, so the slot never ends with nothing.
- **No step may require more than two decisions.** If a screen needs three, it is redesigned.

---

## 4. Functional requirements

Every requirement is testable as written. "Accept" is the test. Requirements marked **[gate]** cannot be disabled by settings.

### 4.1 Intake

**FR-01 · A folder is the only required input.** Dropping a folder onto *New listing* creates a listing and indexes every video file it contains; no other field is mandatory.
*Why:* she has footage and a deadline, not a brief.
*Accept:* drop a folder with 10 clips → 10 `sources` rows, slug matches `YYYY-MM-DD-<address-slug>`, no blocking dialog, listing opens in ≤2 s.

**FR-02 · Accept, copy, never modify.** Accepted containers: `.mp4 .mov .m4v .mts .mkv .avi .webm`; accepted video codecs H.264, HEVC, ProRes, VP9, AV1. The original file is opened read-only and never written.
*Why:* a corrupted original is unrecoverable and the office shares drives.
*Accept:* after a full pipeline run, the SHA-256 of every original is unchanged; a read-only source folder still works in copy mode.

**FR-03 · Copy by default, link on request, verified on open.** Copy into `data/listings/<slug>/raw/`; use a hard link when source and workspace are on the same volume, a byte copy otherwise. Link mode is opt-in per listing and labels the listing *Linked footage*.
*Why:* links break when a phone syncs to a new folder, and broken links mid-listing are the worst failure mode.
*Accept:* copy mode works with the source volume unplugged afterwards; link mode shows a warning at creation; a missing linked file raises E02 with the original path quoted, and copy mode never does.

**FR-04 · Optional brief, never required.** A free-text brief (≤2,000 characters) plus optional agent name, phone, licence number and price. Absent fields are inferred or left blank; blank is a valid state.
*Why:* half her listings arrive as a voice note and a price.
*Accept:* create a listing with only a folder → flow completes to export with no empty-field validation error and a facts list containing only what was confirmed.

**FR-05 · Pre-flight report before any model spend.** After probe, show clip count, total duration, resolution mix, rotation, audio presence, estimated analysis time and estimated model cost; require one confirmation before the first paid call.
*Why:* she should never be surprised by a charge or a 20-minute analysis.
*Accept:* a listing with one 40-minute clip shows a warning and an estimated cost before any request reaches the relay.

**FR-06 · Duplicate sources collapse.** Identical SHA-256 files are indexed once, with the duplicate paths listed on the source row.
*Why:* phones produce `IMG_1234.MOV` and `IMG_1234(1).MOV`.
*Accept:* drop the same file twice → one source, one shot set, analysis time unchanged.

### 4.2 Facts extraction and confirmation **[gate]**

**FR-07 · Facts are a closed set.** Address, price, currency, beds, baths, receptions, internal area, plot area, tenure, EPC, year built, key features (≤8), agent name, agent phone, agent licence, disclaimer, listing status, previous price, open-house date.
*Why:* an open set cannot be confirmed, and confirmation is the product's integrity guarantee.
*Accept:* the facts screen lists only these fields; an unknown property in the brief is stored as a feature candidate, never as a new field.

**FR-08 · Every fact carries a source and a confidence.** Source ∈ {typed, spoken, inferred}; confidence ∈ {high, medium, low}. Shown inline as plain language ("from your brief", "heard in the walkthrough", "check this").
*Why:* she must know what to check without re-reading the brief.
*Accept:* for a brief containing only "3 bed 2 bath, £485,000", beds/baths/price show *typed*, address shows *check this*.

**FR-09 · Four facts always require a human.** Price, address, beds, baths are never auto-accepted; they must be typed or explicitly confirmed, even at high confidence.
*Why:* these four appear on screen and in the caption and are the four the agent will be judged on.
*Accept:* with all four inferred correctly, export stays blocked until each is confirmed by click or edit.

**FR-10 · Conflicting facts block progress.** A spoken "three bedroom" against a typed "4 bed" raises E15 with both values side by side; nothing downstream runs until one is chosen.
*Why:* silent resolution picks the wrong number half the time.
*Accept:* conflicting input → planning does not start; resolving the conflict starts it within 2 s.

**FR-11 · Confirmation is versioned, not sticky.** Editing a confirmed fact creates new EDL versions carrying the new text; previously exported takes keep the old value and are flagged *out of date*.
*Why:* a price drop must not silently alter a file already sent to a client.
*Accept:* change price after export → the delivery row shows *out of date*, takes stay byte-identical, new exports use the new price.

### 4.3 Analysis

**FR-12 · One decode pass per source clip.** Analysis invokes FFmpeg once per source with multiple outputs: 480p frame extraction, scene scores, loudness and speech metrics. No stage re-decodes a file it has already decoded.
*Why:* decode is the bottleneck; three passes triples the wall clock on a laptop.
*Accept:* instrumented run on a 5-minute clip shows exactly one video decode; total FFmpeg invocations for analysis ≤ 2 per source.

**FR-13 · Shots are stable and addressable.** Scene detection at threshold 0.25; minimum shot 0.6 s (merged upward), maximum 12 s (split at the lowest-motion frame). IDs are `sh_<sourceId>_<index>` with index ≥3 digits.
*Why:* shot identity is referenced by EDLs across versions, so it must not shift between runs.
*Accept:* re-analysing the same folder produces an identical shot set and identical IDs.

**FR-14 · Every shot carries metrics.** Duration, mean luma, black-frame ratio, freeze ratio, sharpness (variance of Laplacian), motion magnitude, saliency box, audio presence, speech ratio, exposure clipping.
*Why:* quality gating and honest review checks need numbers, not opinions.
*Accept:* a deliberately black 3 s clip is rejected from candidates with reason "too dark" and never appears in a variant.

**FR-15 · Contact sheets, one per source.** A 4×5 JPEG grid per source (20 thumbnails, 320×180 each, ≤1,600 px wide), cached and shown as analysis progresses.
*Why:* she recognises rooms faster than any model, and this is how she catches a bad card pull in ten seconds.
*Accept:* a 10-clip listing shows 10 sheets; sheets are readable on a 1,366 px-wide laptop screen without zoom.

**FR-16 · Tagging is batched, capped and schema-validated.** At most 24 keyframes per listing (≤1,280 px long edge, JPEG q80) plus at most 3 audio slices (≤15 s each, mono 16 kHz) when speech matters. Output must validate against the room enum and the tag schema.
*Why:* cost and privacy are both proportional to pixels sent.
*Accept:* a 60-shot listing sends ≤24 images; a malformed response triggers one repair attempt, then E11.

**FR-17 · Candidates are scored 0–1, shown 0–100.** Weighted base score: sharpness 0.25, exposure 0.15, motion 0.15, saliency confidence 0.15, room desirability 0.15, novelty 0.15.
*Why:* one number drives selection, sorting and the UI badge; two representations keep data exact and copy plain.
*Accept:* identical inputs produce identical scores to 3 decimal places.

**FR-18 · Everything is content-addressed and reusable.** Stage outputs are keyed by SHA-256 of (input hashes, stage id, prompt version, model id, parameters). Unchanged inputs are never recomputed.
*Why:* a re-run after one added clip must not cost another full decode.
*Accept:* add one clip to a 10-clip listing → only the new clip is decoded; the other nine reuse cache hits, visible in the job detail.

### 4.4 Format and variant selection

**FR-19 · Ten formats, declared as data.** Each format declares id, label, default duration, shot budget, required inputs, and availability rules.

| Format id | Default | Range | Shot budget | Requires |
|---|---|---|---|---|
| `cinematic_hero` | 45 s | 30–60 | 8–12 | ≥4 rooms, ≥1 exterior |
| `social_hook` | 22 s | 15–30 | 5–7 | 1 strong opening shot |
| `room_walkthrough` | 60 s | 45–90 | 12–18 | 5+ distinct rooms |
| `just_listed` | 30 s | 20–40 | 7–10 | price, address |
| `amenity_lifestyle` | 35 s | 25–45 | 8–12 | amenity or lifestyle b-roll |
| `price_drop` | 20 s | 15–30 | 5–7 | previous price, new price |
| `agent_intro` | 40 s | 30–50 | 8–12 | agent name, phone, ≥1 portrait shot |
| `before_after` | 25 s | 15–40 | 6–9 | renovation pairs (same room) |
| `drone_hero` | 30 s | 20–45 | 6–9 | ≥2 aerial shots |
| `vertical_tour` | 35 s | 25–50 | 9–14 | continuous room order |

*Why:* formats are the product's creative vocabulary and must be configurable without a code change.
*Accept:* every row above is loadable from `formats.json`, validates against the schema enum, and its default duration sits inside 5–90 s.

**FR-20 · Four looks, fixed IDs.** `calm` (serif lower-thirds, slow dissolves, muted palette), `social` (bold centre captions, snappy cuts, high contrast), `walkthrough` (room labels, steady pacing, restrained type), `editorial` (magazine grid, generous margins, slow fades).
*Why:* the schema pins four; a fifth is a schema change, not a settings toggle.
*Accept:* each look renders a distinguishable variant from the same shots: different type, transition and caption style in a side-by-side still.

**FR-21 · "Surprise me" is the default and it is opinionated.** The preselected set is `cinematic_hero` (calm), `social_hook` (social), `vertical_tour` (walkthrough). The button sits top-right of the format screen and is focused on open.
*Why:* the fastest correct answer must be one click, not a grid of ten boxes.
*Accept:* open a listing and press Enter twice (Surprise me, Continue) → three variants planned, zero other choices made.

**FR-22 · Unavailable formats explain themselves.** A format that cannot be filled is disabled with a plain reason and the shortest path to fix it ("Needs two aerial shots. Add drone footage, or choose another format.").
*Why:* a greyed-out control with no reason is the most common beginner frustration.
*Accept:* footage with no aerial shots disables `drone_hero`, and footage with no portrait disables `agent_intro`, each showing a reason and a working *Choose another* action.

**FR-23 · Duration is adjustable inside schema bounds.** A single slider per variant, showing seconds; the value is written to `format.targetDurationSec` and validated within 5–90 s and the format's own range.
*Why:* a 22-second hook is right for TikTok and wrong for a luxury reel.
*Accept:* setting 38 s on `cinematic_hero` passes validation; 62 s is refused with bounds shown.

**FR-24 · Variants are cheap; planning is the only shared cost.** One planning call produces three EDLs. Adding a fourth variant afterwards reuses the shot plan and costs one extra planning call.
*Why:* the product promise is three options, and three separate planning calls triple the bill.
*Accept:* creating the default three costs one planning call; adding a fourth costs exactly one more.

### 4.5 Variant review and approval

**FR-25 · Three-up review, ordered by score.** Poster frame, duration, score badge, one-line description ("Opens on the garden, ends on the price"), and profile thumbnail. Keyboard: ←/→ to move, Space to play, A to approve.
*Why:* comparison is the decision; anything that hides two variants behind tabs doubles the time.
*Accept:* all three play from one screen at ≥24 fps UI; approving with the keyboard alone completes in ≤10 s.

**FR-26 · Drafts arrive before approval.** Each variant gets a 540p draft automatically, rendered in parallel, target ≤60 s per variant. No approval is possible before its draft exists.
*Why:* approving an unseen edit is how trust dies.
*Accept:* a 45 s variant has a playable draft within 60 s on the reference machine.

**FR-27 · Shot inspector exposes the why.** Each clip lists shot id, room, score, and the plain-language `clip.reason` (≤160 characters). *Swap shot* shows ranked alternatives with a thumbnail; swapping preserves duration by trimming the replacement.
*Why:* one bad shot is the most common objection, and the fix must be two clicks.
*Accept:* swap a bathroom shot → clip count unchanged, total duration changes by ≤0.5 s, overlays re-flow, review re-runs.

**FR-28 · Ten review checks, plain language.** `duration`, `no_black_frames`, `no_freeze`, `text_safe_area`, `cta_legible`, `room_order`, `loudness`, `no_repeated_shot`, `hook_visible`, `facts_present`. Blocking: duration, no_black_frames, text_safe_area, no_repeated_shot, loudness, facts_present.
*Why:* the six blocking checks are the six ways a video embarrasses the agent.
*Accept:* a variant with a repeated shot cannot be approved; the blocking check names both clips and offers *Swap one*.

**FR-29 · Approve 1..n, explicitly.** Approval is per variant head, stored with timestamp and reviewer name; unapproved variants cannot be exported.
*Why:* the gate is the product's only quality contract with the agent.
*Accept:* with one variant approved, export lists only that variant's files.

**FR-30 · Regenerate with a reason.** *Try another* takes an optional one-line reason and re-plans that variant only, keeping the previous version in history.
*Why:* "this one is boring" is legitimate feedback that a model can act on.
*Accept:* regenerating variant 2 leaves variants 1 and 3 byte-identical and adds exactly one EDL version.

### 4.6 Refine chat

**FR-31 · Chat is scoped to one variant and never edits facts.** The panel is titled with the variant name; requests touching price, address, beds or baths are refused with an explanation and a link to the facts screen.
*Why:* creative editing and factual editing must not share a surface.
*Accept:* "change the price to 495" returns a refusal, no diff, and no cost beyond the classification call.

**FR-32 · Every request becomes a tool call, never free text.** The planner may only emit calls from the tool catalogue; unknown tools and out-of-range arguments are rejected before touching the EDL.

| Tool | Changes | Guardrails |
|---|---|---|
| `swap_clip` | one clip's source/in/out | replacement must be ≥ clip duration |
| `trim_clip` | `inSec`/`outSec` | min 0.6 s, ≤ source length |
| `reorder_clips` | clip order | first clip must pass `hook_visible` |
| `set_clip_speed` | `speed` | 0.5–2.0 |
| `set_transition` | `transitionIn`/`Out` | 0–1.5 s, not on the first clip's in |
| `set_crop_focus` | `transform.focus`/`path` | ≤12 points, scale 1–2.5 |
| `add_overlay` | new overlay | ≤30 overlays, text ≤90 chars |
| `edit_overlay_text` | `text`/`subtext` | facts-derived text must match confirmed facts |
| `move_overlay` | `anchor`/`inSec`/`outSec` | inside timeline, inside safe area |
| `remove_overlay` | removes one overlay | never removes a required disclaimer |
| `set_captions` | mode/style/language | burn/sidecar/both/none |
| `set_voice` | voice mode | `replace_tts` needs script ≤1,200 chars |
| `set_music` | track and gain | licence metadata required |
| `set_look` | look id | one of four |
| `set_format` | format id/duration | duration inside bounds |

*Why:* an unconstrained text editor is an editor; the tool catalogue is what keeps a beginner safe.
*Accept:* a request with no valid tool mapping returns "I can't do that as an edit" plus three suggested valid requests; EDL unchanged.

**FR-33 · Preview before apply, always.** The result is a diff card: what changes, on which clip or overlay, and a before/after still or a 3 s loop. Two buttons: *Apply* and *Discard*. Nothing applies on generation.
*Why:* non-negotiable 3 in CONVENTIONS; silent edits destroy trust.
*Accept:* every applied change has a preceding diff card; the EDL hash is unchanged until *Apply*.

**FR-34 · Diffs must validate before they are shown.** Schema validation plus the seven runtime invariants in §7.2 (ordering, contiguity, duration ±0.5 s, overlays inside the timeline, sources resolve, transition limits, caption word order). Invalid diffs are never displayed as applicable.
*Why:* showing an impossible edit and failing on Apply teaches the user the app is unreliable.
*Accept:* a diff producing 91 s on a 60 s target is rejected pre-display with "That would make it 31 seconds too long".

**FR-35 · Six turns per variant per session, cost visible.** The panel shows turns used and dollars spent in this conversation; the seventh turn requires a click on *Keep going*.
*Why:* chat is the most expensive surface and the easiest to loop.
*Accept:* turn 7 is refused until confirmed; the running total matches `cost_ledger` to 4 dp.

**FR-36 · Each applied diff is a version, the conversation persists.** Version numbers increment per variant; reopening the listing restores the conversation and the current head.
*Why:* "what did I change yesterday" is a support ticket otherwise.
*Accept:* quit and relaunch → same head version, same transcript, same thumbnails.

### 4.7 Destinations and delivery wrappers

**FR-37 · Destinations are packaging, never creative.** Destinations map to four render profiles; selecting more destinations changes file count, captions limits and specs, and nothing about the edit.

| Destination | Profile | Caption limit | Notes |
|---|---|---|---|
| TikTok | `vertical-social` | 2,200 | 3–5 hashtags appended |
| Instagram Reels | `vertical-social` | 2,200 | cover frame used as grid thumbnail |
| Stories / Shorts | `vertical-social` | 100 (overlay) | no caption file, on-screen CTA instead |
| Instagram feed | `feed-portrait` | 2,200 | 4:5 required for feed |
| Facebook feed | `feed-portrait` | 63,206 | first 125 chars matter |
| YouTube | `landscape` | 5,000 | title ≤100 chars in spec sheet |
| Website / email | `landscape` | 800 | −16 LUFS for mixed playback |
| MLS | `landscape` | 1,000 | no music-only variant; captions off |
| Pinterest | `pin` | 500 | 2:3 vertical |

*Why:* conflating destinations with variants produces five identical videos (CONVENTIONS).
*Accept:* selecting six destinations that collapse to three profiles produces exactly three files per approved variant.

**FR-38 · Cross-profile projection is deterministic and minimal.** Exporting an approved EDL to another profile creates a derived EDL with `parentId` set, identical `clips` (including order, in/out, speed, text) and only `canvas` plus overlay `anchor`/`maxWidthPct` adjusted for the safe area.
*Why:* this is the mechanism that makes "packaging only" testable rather than aspirational.
*Accept:* diffing approved and projected EDLs shows changes confined to `canvas` and overlay geometry; clip arrays are byte-identical.

**FR-39 · Safe areas are per profile and enforced at render.**

| Profile | Top | Bottom | Left | Right |
|---|---|---|---|---|
| `vertical-social` | 250 | 340 | 60 | 120 |
| `feed-portrait` | 180 | 220 | 60 | 60 |
| `landscape` | 60 | 90 | 60 | 60 |
| `pin` | 60 | 90 | 60 | 60 |

*Why:* vertical numbers are fixed by CONVENTIONS; the others follow the same intersection logic.
*Accept:* any overlay whose bounding box intersects a reserved edge fails `text_safe_area` and cannot be exported.

**FR-40 · Captions, hashtags and copy are generated per destination, from confirmed facts only.** Captions are ≤ the destination limit, contain no claim absent from the facts, and pass the compliance linter (no "guaranteed", no investment or income claims, no fair-housing phrasing such as "ideal for families", "safe neighbourhood", "perfect for young professionals").
*Why:* the caption is the part most likely to create a legal problem, and the part she is least likely to re-read.
*Accept:* a fact set without an EPC produces no EPC mention; a caption containing "guaranteed" is blocked with a suggested rewrite and a one-click fix.

**FR-41 · Delivery wrappers are complete or absent.** Each delivery has: MP4, `.srt` (if any caption mode other than none), `.jpg` cover at profile size, `.txt` caption with hashtags, and a spec row. Sidecars share the delivery stem.
*Why:* an MP4 without its caption is a file she has to finish by hand.
*Accept:* every delivery row resolves to existing files with matching stems; a missing sidecar marks the delivery incomplete and blocks the batch summary from saying "done".

### 4.8 Export

**FR-42 · Quality is a preset, never a slider.** *Draft* (540p, single pass, CRF 28), *Final* (native, two-pass ABR at profile bitrate), or *Both*. Default: Final, with drafts offered if finals exceed 30 minutes.
*Why:* bitrate sliders are how beginners produce 400 MB TikToks.
*Accept:* Draft export produces profile dims halved exactly; Final produces the exact profile table in §9.1.

**FR-43 · Captions: burn, sidecar, both, none.** Maps to `captions.mode`; word timings come from `captions.words`; when whisper-class timing is unavailable, captions are phrase-timed from the transcript and marked approximate in the spec sheet.
*Why:* TikTok needs burned captions, YouTube wants a sidecar, MLS wants neither.
*Accept:* each of the four modes produces exactly the expected artefacts (0, 1 or 2 caption outputs) and a passing `text_safe_area` check when burned.

**FR-44 · Voice: keep, clean, replace, mute.** `keep` uses source audio at `volumeDb`; `clean` applies denoise, optional dereverb, optional isolate, de-ess; `replace_tts` synthesises `voice.text` (≤1,200 chars) in the chosen `voiceId`; `mute` drops voice and keeps music.
*Why:* half the walkthroughs have wind, echo or a dog.
*Accept:* a 10 s preview renders before commit for clean and replace modes; `replace_tts` without a script is refused with the character limit shown.

**FR-45 · Cover frame: three suggestions plus scrub.** Suggestions are the highest-scoring frames from the first 3 s, the widest room, and the exterior; the choice is exported as `.jpg` at profile size and used as the platform thumbnail.
*Why:* the cover is the only frame that decides whether anyone watches.
*Accept:* the chosen cover appears as the first frame of the exported still file and in the delivery row.

**FR-46 · No music without a licence record.** Library tracks carry `licenseId`; AI tracks record `ai_generated`; user files require the user to pick a licence and type an attribution. Export is blocked if `music.license.licenseId` is empty.
*Why:* a claimed video costs the branch more than the app.
*Accept:* deleting the licence id in a test fixture blocks export with a plain explanation and a one-click *Choose another track*.

**FR-47 · Loudness is measured, not assumed.** Every take is normalised to the profile target with a two-pass `loudnorm` and measured afterwards; a take more than 0.5 LU from target is re-encoded once, then failed.
*Why:* platform loudness normalisation punishes quiet mixes by raising noise.
*Accept:* all nine files measure within ±0.5 LU of their profile target and ≤ −1.5 dBTP.

**FR-48 · Paid upscale is opt-in, per file, priced before it runs.** Disabled by default. The price for the selected file is shown as a number before confirmation, using duration × tier rate (plus the 60 fps multiplier). Never applied to a batch, never remembered as a default.
*Why:* one careless "apply to all" is a $64.80 charge on a $0.45 listing.
*Accept:* with 9 files selected, the upscale control shows the price for the currently previewed file only, and no control exists to apply it to the set.

**FR-49 · Cost is shown before any spend and recorded after.** Pre-export summary lists model cost incurred so far, projected upscale cost, and total. After export, `cost_ledger` totals match to 4 dp and appear in the listing header.
*Why:* she is spending someone else's money, on a prepaid balance.
*Accept:* the pre-export total equals the sum of subsequent ledger rows for that export, within $0.001.

**FR-50 · Export gates are absolute.** Export is blocked when: facts unconfirmed or stale, variant unapproved, any blocking review check failing, disk free < 2× estimate, projected cost > remaining budget, or Remotion licence unverified for a >3-seat organisation.
*Why:* each of these has caused a real incident in a comparable tool.
*Accept:* each gate, tested alone, blocks with one plain sentence and one action; removing the cause allows export without restarting the app.

**FR-51 · Naming is deterministic and collision-safe.** `<listing-slug>_<format>_<look>_<profile>_v<N>.mp4`. `v<N>` is the EDL version, not an export counter. Existing files are never overwritten; a re-export of the same version creates `_v<N>-2` and both rows are kept.
*Why:* shared drives and duplicate filenames are how the wrong video gets posted.
*Accept:* export twice → two files, distinct suffixes, both listed; filename regex passes for all 10 formats × 4 looks × 4 profiles.

### 4.9 Batch queue

**FR-52 · Batch is a queue of listings, not a folder of jobs.** Multiple listings can be queued; each shows stage, progress, estimate and cost; order is drag-adjustable with a *due first* pin.
*Why:* Friday afternoons are three listings at once.
*Accept:* queue 4 listings, quit the app, relaunch → all 4 present with preserved order and stage.

**FR-53 · One render at a time, two on big machines.** Render concurrency is 1 by default, 2 when ≥16 logical cores and ≥32 GB RAM. Analysis may overlap with rendering but never exceeds 2 concurrent decodes.
*Why:* parallel renders on a laptop produce thermal throttling and missed estimates.
*Accept:* on the reference machine, concurrency is 1 and total wall clock is within 15% of the sum of individual renders.

**FR-54 · Pause, resume, cancel with honest consequences.** Pause finishes the current segment and holds; cancel discards the partial take after confirmation and does not refund model cost already spent.
*Why:* a cancel that leaves a half file is worse than no cancel.
*Accept:* cancel mid-render leaves no `.mp4` in the deliveries folder and one `takes` row marked cancelled.

**FR-55 · Unattended mode.** With the window closed to tray: keep the system awake (where the OS allows), suppress modal dialogs, batch errors into a summary, notify once at the end with counts and total cost.
*Why:* finals take 30–70 minutes and she has left the building.
*Accept:* an overnight batch of 3 listings completes with zero modal dialogs and one notification.

**FR-56 · Batch summary is the handover artefact.** Files created, failures with plain reasons, total model cost, total upscale cost, reshoot items, and a *Copy summary* button that produces text suitable for a WhatsApp message.
*Why:* she reports to the agent in messages, not in dashboards.
*Accept:* the summary lists every delivery filename and totals; pasting it into a text field preserves line breaks.

### 4.10 Reshoot list

**FR-57 · Reshoot items are derived, not invented.** Each item comes from a failed review check, a missing required room, a format that was unavailable, or a shot below the quality floor.
*Why:* "film more" is useless; "the kitchen shot is 0.4 s and blurred" is actionable.
*Accept:* a listing with no bathroom footage produces exactly one bathroom item with the reason "no usable bathroom shot".

**FR-58 · Each item names the room, the shot, the why and the target length.** Plus one example frame from the closest existing shot, greyed if none exists. Maximum five items, priority-ordered.
*Why:* five items get filmed; fifteen get ignored.
*Accept:* every item has all four fields and a priority; the list never exceeds five.

**FR-59 · The list is portable and re-checkable.** *Copy list* produces plain text; adding footage and re-analysing marks resolved items as done and keeps unresolved ones.
*Why:* the phone is where the filming happens.
*Accept:* copying produces text with one item per line; re-analysis after adding a bathroom shot removes that item and updates the count.

### 4.11 Version history and undo

**FR-60 · EDL versions are immutable and append-only.** Every applied plan, refine diff, swap or regeneration writes a new EDL row with `parentId`; no version is ever mutated.
*Why:* immutability is what makes renders reproducible and diffs meaningful.
*Accept:* no UPDATE statement targets the `edls` table in the codebase; every change increases `version` by exactly 1.

**FR-61 · History shows trigger, cost and score delta.** Time, trigger (plan / refine / swap / regenerate / projection), model cost added, review score change, and who did it.
*Why:* she needs to answer "what changed and was it better".
*Accept:* a history of 8 versions lists 8 rows with correct deltas summing to the listing's model cost.

**FR-62 · Compare any two versions side by side.** Field-level diff for text and timing, plus a still at the same timestamp for both.
*Why:* numbers alone do not settle "which opening was better".
*Accept:* comparing v2 with v5 shows the clip-level differences and two stills at matched times.

**FR-63 · Restore is forward-only.** *Restore this version* creates a new version whose content equals the chosen one, with `parentId` pointing at the current head.
*Why:* rewriting history breaks the audit trail the agent relies on.
*Accept:* restoring v2 produces v9 with identical content hash to v2 and a parent of v8.

**FR-64 · Undo covers the last 50 actions in session; takes are retained while referenced.** Ctrl+Z/Ctrl+Shift+Z walk applied diffs, swaps and approvals. Takes referenced by a delivery are never deleted; unreferenced takes are pruned after 30 days.
*Why:* approvals and swaps are the two things people click by accident.
*Accept:* undo an approval → variant returns to unapproved, export list updates; 31-day-old undelivered takes are gone, delivered ones remain.

---

## 5. Non-functional requirements

**Reference machine** for every number below: 8-core x86-64 (4P+4E), 16 GB RAM, NVMe SSD, integrated graphics, Windows 11, mains power.

| ID | Requirement | Test |
|---|---|---|
| NFR-01 | Analysis of 5 minutes of 4K/30 footage completes in ≤90 s; ≤150 s on a 4-core/8 GB machine | Stopwatch on golden fixture, 3 runs, median |
| NFR-02 | A 540p draft of a 45 s variant renders in ≤60 s | Same fixture, measured from job start to playable file |
| NFR-03 | A 1080p final renders in ≤8 min per profile file | 45 s variant, all four profiles, each ≤8 min |
| NFR-04 | Cold start to the listing list is ≤6 s; listing open is ≤2 s | Measured from process start, 5 runs |
| NFR-05 | Every click gives visible feedback within 100 ms; no operation blocks the UI thread | Playwright interaction timing on 20 controls |
| NFR-06 | Preview playback holds ≥24 fps at 540p; scrubbing is frame-accurate to ±1 frame | Manual + instrumented frame counter |
| NFR-07 | Peak disk per listing ≤3× source bytes; segment cache capped at 25 GB with LRU eviction | Fill a 5 GB fixture, assert usage, force eviction |
| NFR-08 | Warn below 10 GB free; block export below 2× estimated output size | Simulated volume quota |
| NFR-09 | Total RSS ≤4.0 GB across all processes: main ≤700 MB, renderer ≤800 MB, each worker ≤2.5 GB | Task Manager and `process.getProcessMemoryInfo` sampling |
| NFR-10 | Offline: intake, analysis, review of existing variants, export of existing approved EDLs all work. Only model stages require connectivity | Disable network adapter, run every non-model step |
| NFR-11 | Offline model stages queue and resume automatically when the network returns; no work is lost | Kill network mid-planning, restore after 30 s, assert completion |
| NFR-12 | Crash-only reliability: `taskkill /F` at any of 12 instrumented points loses no completed work and resumes to `ready` | Automated kill matrix, one run per point |
| NFR-13 | No state lives only in memory: queue, approvals, conversation, budget all survive a hard kill | Kill after each user action, relaunch, assert |
| NFR-14 | WCAG 2.2 AA: contrast ≥4.5:1 for body text, ≥3:1 for large text and UI boundaries; 2.4.11 focus not obscured; 2.5.8 targets ≥24 px (ours are 36 px) | axe-core zero critical/serious; manual keyboard and screen-reader pass |
| NFR-15 | Full keyboard operation, visible 2 px brass focus ring, logical tab order, no keyboard traps | Complete the 18-minute flow without a mouse |
| NFR-16 | Colour is never the only signal: every status has text and an icon | Greyscale screenshot review |
| NFR-17 | Respect `prefers-reduced-motion`: transitions ≤1 ms, no autoplay motion in the shell | OS setting toggled, token rule verified |
| NFR-18 | Screen-reader labels for scores ("Score 84 out of 100, good"), player controls, and every progress bar | Narrator pass on all 12 flow steps |
| NFR-19 | Localisation-ready: ICU MessageFormat, no string concatenation, all copy in `locales/en-GB.json`, 20% expansion headroom, `Intl` for numbers/dates/currency, RTL-safe layout | Pseudo-locale build runs the full flow without clipping |
| NFR-20 | Media never leaves the machine except derivative frames, short audio slices, and text (see §8.6) | Network capture during a full run, assert no media-sized upload |
| NFR-21 | Security: `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, CSP `default-src 'self'`, no remote code, typed and validated IPC channels, ASAR integrity, signed installer | Electron security checklist + `electronegativity` clean |
| NFR-22 | Secrets: no provider key on disk; relay token in OS credential storage; logs never contain tokens or file paths from outside the workspace | Log scan of a full run |
| NFR-23 | Fonts are bundled locally (Bricolage Grotesque/Archivo as woff2); the app makes no font or CDN request | Network capture with the adapter offline |
| NFR-24 | Determinism: same inputs + same pinned versions produce a byte-identical EDL; renders compared by EDL hash, not pixels | Two runs from a clean cache, hash equality |

---

## 6. Architecture

### 6.1 Process model

| Process | Runtime | Owns | Must never |
|---|---|---|---|
| Electron main | Node 22, Electron | SQLite (sole writer), file system, job scheduler, relay client, OS notifications | Decode media or render frames |
| Renderer | React 19 + Vite, sandboxed | UI, player, chat panel, diff cards | Touch the file system or SQLite directly |
| `pipeline-worker` | Node 22 child process (×1) | ffprobe/ffmpeg orchestration, analysis, contact sheets, metrics | Write to SQLite; talk to the network |
| `render-worker` | Node 22 child process (×1–2) | Remotion bundle, headless Chrome, FFmpeg encode and mux | Open the project database |
| Relay (remote) | Our service | OpenRouter key, account budget, model allow-list, metering | Store media or prompts beyond the request |

Rules: main is the only SQLite writer; workers receive job envelopes over IPC and report progress as `{jobId, stage, pct}`; a worker crash marks the job `failed` and main restarts it from the last completed stage. IPC is typed (`channels.ts` generated from a zod schema), never a generic `invoke(path, args)`. Protocol version is negotiated at handshake; mismatch refuses to start the worker with a plain message.

### 6.2 SQLite schema

Nine tables, WAL, `foreign_keys = ON`, `user_version` migrations forward-only. Times stored as ISO-8601 UTC; media times as REAL seconds, 3 dp.

| Table | Holds | Key columns | Constraints and indexes |
|---|---|---|---|
| `listings` | one property project | `id`, `slug`, `address`, `status`, `facts_json`, `facts_confirmed_at`, `prep_budget_usd`, `created_at`, `updated_at` | `slug` unique; index on `status` |
| `sources` | indexed source clip | `id` (`s_`+8 hex), `listing_id`, `rel_path`, `sha256`, `bytes`, `duration_sec`, `width`, `height`, `fps`, `rotation`, `has_audio`, `copied`, `created_at` | FK listing cascade; unique `(listing_id, sha256)` |
| `shots` | detected shot + metrics | `id` (`sh_…`), `source_id`, `listing_id`, `idx`, `start_sec`, `end_sec`, `scene_score`, `mean_luma`, `black_ratio`, `freeze_ratio`, `sharpness`, `motion`, `saliency_json`, `room`, `tags_json`, `score`, `keyframe_path` | FK source cascade; index `(listing_id, room)`, `(listing_id, score desc)` |
| `edls` | one immutable EDL version | `id` (`edl_<variant>_v<N>`), `listing_id`, `variant_id`, `version`, `parent_id`, `hash`, `json_path`, `format_id`, `look_id`, `profile`, `score`, `created_at` | unique `(variant_id, version)`; FK `parent_id` self; index `(variant_id, version desc)` |
| `takes` | a rendered file from one EDL version | `id`, `edl_id`, `profile`, `quality` (`draft`/`final`), `path`, `bytes`, `width`, `height`, `duration_sec`, `lufs`, `sha256`, `status`, `created_at` | FK edl cascade; index `(edl_id, profile, quality)`; unique `(edl_id, profile, quality, status)` where status=done |
| `jobs` | unit of work | `id`, `listing_id`, `variant_id`, `kind`, `state`, `stage`, `attempt`, `progress`, `payload_json`, `error_code`, `created_at`, `started_at`, `finished_at` | index `(state)`, `(listing_id, created_at)`; state CHECK in the enum |
| `deliveries` | exported file + wrapper | `id`, `take_id`, `listing_id`, `stem`, `mp4_path`, `srt_path`, `jpg_path`, `txt_path`, `destination_ids_json`, `spec_json`, `complete`, `created_at` | FK take; index `(listing_id, created_at)`; `stem` unique per listing |
| `cost_ledger` | every paid call | `id`, `listing_id`, `variant_id`, `edl_id`, `job_id`, `stage`, `provider`, `model`, `input_tokens`, `output_tokens`, `audio_tokens`, `units`, `unit_price_usd`, `amount_usd`, `created_at` | money as REAL 4 dp; index `(listing_id, created_at)` |
| `settings` | key/value app + licence state | `key`, `value_json`, `updated_at` | `key` primary |

View `variant_heads` = latest `edls` row per `variant_id` (variant metadata is the EDL's own `format` and `look`, so no extra table). Derived index tables (contact sheets, thumbnails) are files under `analysis/`, keyed by content hash.

### 6.3 Job state machine

```
queued → analysing → planning → rendering → reviewing → ready
                ↘         ↘          ↘          ↘
                  failed (retryable, resumes from last completed stage)
```

| State | Entered when | Allowed next | Resume semantics |
|---|---|---|---|
| `queued` | job inserted | `analysing` | Nothing done; safe to reorder or delete |
| `analysing` | worker picks up | `planning`, `failed` | Completed per-source analysis is cached; resume skips done sources |
| `planning` | facts confirmed | `rendering`, `failed` | EDL either exists (version written) or does not; never half-written |
| `rendering` | variant approved or draft requested | `reviewing`, `failed` | Completed segments are cached; resume starts at the first missing segment |
| `reviewing` | all segments muxed | `ready`, `failed` | Checks are cheap and idempotent; always re-run |
| `ready` | review passed or warned | — | Terminal; re-export creates a new job |
| `failed` | any stage error | same stage | Attempt counter; transient errors retry ≤3 with backoff (2 s, 8 s, 30 s), deterministic errors retry 0 |

Every transition is written in the same transaction as its stage output pointer. A listing-level job walks the full chain once; later re-exports are jobs that enter at `rendering` and use the same states from there. Stage outputs are written to `<target>.part` and renamed; a `.part` on launch is deleted, never resumed. A job is identified by `(listing_id, kind, payload_hash)`, so double-clicks cannot duplicate work.

### 6.4 FFmpeg strategy

- `ffmpeg-static` and `ffprobe-static` resolved from `asar.unpacked`; every invocation via `spawn` with an argument array, never a shell string. Probe once per source with `ffprobe -show_streams -show_format -print_format json` and store the parsed result on the `sources` row.
- Analysis is one invocation per source with multiple outputs: `-map 0:v` frames at 2 fps scaled to 480p, scene metadata from the same filtergraph, and `-map 0:a` to `ebur128`/silence detection written to `null`. One video decode, one audio decode, one process.
- Hardware encode is probed once at install (`h264_nvenc`, `h264_qsv`, `h264_amf`) and recorded in `settings`. **Drafts may use hardware; finals always use libx264** so output is reproducible across machines.
- Progress from `-progress pipe:1 -nostats`, parsed as `out_time_ms` against expected duration; stall detection if no line for 30 s.
- Cancel sends graceful termination, then force-kills after 5 s; the `.part` file is removed.
- Loudness: `loudnorm` two-pass with measured values, then verification with `ebur128`; target per profile, true peak ≤ −1.5 dBTP.
- Never trust frame counts from the container: durations for the EDL always come from `ffprobe`, never from the UI.

### 6.5 Remotion render service

- One bundled Remotion 4 project at `services/pipeline/remotion`, composition `Variant` taking the EDL as props plus `{profile, scale}`; `Still` composition for cover frames.
- Rendering order per take: per-segment Remotion render (video only, no audio track) → FFmpeg assembles audio graph → single mux pass with `-movflags +faststart`.
- Chrome via `@remotion/renderer`'s bundled headless build. Launch flags start with GPU enabled; on two consecutive GPU-related crashes, fall back to `--disable-gpu --gl=swiftshader` and record the fallback in `settings`.
- Concurrency: `min(4, floor(cores/2))`; one Chrome instance per render worker, pages reused across segments.
- Determinism: `fps` from the profile, `durationInFrames = round(durationSec × fps)`, no `Math.random`, no `Date.now`, fonts loaded from disk before the first frame.
- Licence gate: `settings.remotion_seats` is asked once at first run. Seats ≤3 → free use. Seats >3 → a licence key is required before finals; a 14-day trial allows drafts only, watermarked and marked in the spec sheet.

### 6.6 OpenRouter client

- All model traffic goes to the relay (`https://api.zeniconic.app/v1/*`) over TLS with the app token; the desktop never holds an OpenRouter key.
- Pinned IDs live in `services/pipeline/models.json`, are read-only at runtime and checked against a relay-side allow-list; an unknown ID fails closed with E11 rather than falling back.
- Request shape: `{stage, model, promptVersion, inputs, responseSchema, maxTokens, temperature}`. Tagging temperature 0.2, planning 0.4, review 0.1, TTS n/a.
- Timeouts: tagging 90 s, planning 120 s, review 60 s, TTS 60 s, music 120 s. Two retries on 429/5xx/timeout with jittered backoff; no retry on 4xx validation errors.
- Structured output is requested as JSON Schema where the model supports it; otherwise the response is parsed, validated with zod, and repaired once by a cheap follow-up call before failing.
- Chat tokens stream over SSE; all other calls are request/response.
- Every response's usage is written to `cost_ledger` before the result is used, so a crash cannot lose spend.

### 6.7 File layout

```
D:\video\
  apps\desktop\src\       main (window, ipc, scheduler, db, relay), preload bridge
  apps\ui\src\            routes, components, player, chat, diff cards
  services\pipeline\      analysis, planning, review, render, remotion,
                          models.json (pinned IDs + prices), prompts\<stage>\<v>.md
  packages\edl\           schema.json, validate.ts, project.ts, hash.ts
  docs\                   SPEC.md, CONVENTIONS.md, design\, mockups\
  data\
    zeniconic.db        SQLite (sole writer: main)
    cache\segments\       <hash>.mp4, 25 GB LRU
    cache\analysis\       <hash>\ contact sheets, keyframes, probe results
    listings\<slug>\      raw\ analysis\ edls\ takes\ deliveries\
```

`data/` is git-ignored. The installer writes to `%LOCALAPPDATA%\Zeniconic` by default; the workspace root is configurable and must be a local NTFS volume (a network share is refused with an explanation, because SQLite over SMB corrupts under interruption).

---

## 7. Data model

### 7.1 What the EDL contains

`schema.json` (v1.0.0) is the contract. Summary by block:

| Block | Fields | Purpose |
|---|---|---|
| Identity | `edlVersion`, `id`, `listingId`, `createdAt`, `parentId` | Which variant, which version, which predecessor |
| Creative | `format` (id, label, targetDurationSec), `look` (id, label) | The two creative axes; a variant is format + look |
| Canvas | `profile`, `width`, `height`, `fps`, `safeArea` | Render target and the text keep-out box |
| `clips[]` (1–40) | `id`, `sourceId`, `src`, `inSec`, `outSec`, `speed`, `volumeDb`, `room`, `transform`, `transitionIn`, `transitionOut`, `reason`, `scoreAtSelection` | The cut: what plays, from where, how it fills the frame |
| `overlays[]` (≤30) | `id`, `kind`, `text` ≤90, `subtext` ≤90, `inSec`, `outSec`, `anchor`, `style`, `maxWidthPct`, `opacity`, `animation` | Everything drawn on top; eight kinds from `price` to `room_label` |
| `audio` | `music` (track, gain, duck, beatGrid, licence), `voice` (mode, src, text ≤1,200, voiceId, enhance), `mix` (lufs, truePeakDbtp) | The sound bed, the spoken layer, the target loudness |
| `captions` | `mode`, `style`, `language`, `words[]` | Burned or sidecar subtitles with per-word timings |
| `review` | `score`, ten `checks[]` with id/passed/detail, `reviewedBy` | The quality record, stored with the edit it judged |
| `provenance` | `pipelineVersion`, `sourceIndexHash`, `models`, `promptVersions`, `costUsd`, `renderCacheHits` | Reproducibility and accounting |

**Runtime invariants** (enforced on load and on every diff, beyond JSON Schema):

1. `clip.outSec > clip.inSec` for every clip.
2. Clips are ordered and contiguous, except where a gap is explicit.
3. Σ (out−in)/speed = `format.targetDurationSec` within ±0.5 s.
4. Every overlay interval lies inside the timeline.
5. Every `clip.src` resolves to an indexed source (and `sourceId` matches its hash-derived ID).
6. Transition durations ≤1.5 s and never exceed the shorter neighbouring clip.
7. `captions.words` are non-overlapping and ascending when present.

### 7.2 Why the EDL is the contract

**Chat edits the EDL, not the video.** A refine request becomes tool calls (§FR-32) that produce a candidate document. The diff card is the document diff rendered as pictures and sentences. Applying it writes a new file. No code path mutates a take.

**Renders are pure functions.** A take is `render(EDL, profile, quality)` plus referenced media. Two machines with the same pinned models and pipeline version produce byte-identical EDLs, so equality is decided by hash (`edls.hash`), not pixel comparison. That is what allows caching, resumption and QA without watching video.

**Versions are cheap.** An EDL is 4–18 KB of JSON. A listing with 30 versions costs under 600 KB. Re-rendering is the only expensive operation, and it happens only on export — approval, comparison, export-planning and history are all free.

**The agent can be shown the truth.** `review` and `provenance` ride inside the same document as the edit, so "what was checked, with which model, at what cost" cannot drift from the artefact it describes.

---

## 8. AI layer

### 8.1 Model assignments

| Role | Model ID | Price (per 1M tokens, in/out) | Input | Notes |
|---|---|---|---|---|
| Tagging | `google/gemini-3.8-flash` | $0.83 / $4.13 | image + video + audio | Rooms, amenities, shot quality, speech gist; ≤24 frames per listing |
| Planning | `openai/gpt-6-astra` | $10.00 / $50.00 | text + images | Shot selection, beat structure, overlays, captions, chat tool calls |
| Review | `google/gemini-4-carbon` | $2.00 / $10.00 | image + text | Watches sampled frames of the draft; returns the ten checks |
| Music | `google/lyria-3-pro-preview` | metered per track | text | 3 candidate tracks per variant in one call; beat grid extracted locally |
| TTS | `openai/gpt-audio` | metered per audio token | text | `replace_tts` only; stock voices in v1 |

All IDs live in `services/pipeline/models.json` with the price snapshot and a `pinnedAt` date. A price change in the wild does not silently change our cost model: the relay's snapshot wins, and a drift >10% raises an alert.

### 8.2 Cost model per listing

Typical listing: 5 minutes of footage, 3 variants, 3 profiles.

| Stage | Calls | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| Tagging | 1 | 24,000 | 3,200 | $0.033 |
| Planning (3 variants, one call) | 1 | 14,000 | 3,000 | $0.290 |
| Review (3 drafts) | 3 | 13,500 | 2,100 | $0.048 |
| Music (1 call per variant) | 3 | — | — | $0.060 |
| TTS (optional, 35 s script) | 1 | 900 | — | $0.020 |
| **Base total** | | | | **$0.45** |

Cost scales with footage and variant count. A 90-second listing with two variants costs about **$0.25**; the typical 5-minute, three-variant listing above costs **$0.45**; one refine round takes it to **$0.57**, two to **$0.69**. **Band: $0.20–$0.60 per listing** for the default flow, so the $20.00 balance covers roughly 40 typical listings. A second refinement is allowed but pushes a listing past the $0.60 warning; nothing can exceed the $1.00 cap without a typed confirmation. These are the numbers the UI quotes before the first paid call.

### 8.3 Budget, caps and hard stops

| Control | Value | Behaviour at the limit |
|---|---|---|
| Prepaid balance | $20.00 on the account | Balance shown in the header; top-up link when < $2.00 |
| Per-listing default cap | $1.00 | Job refuses to start; *Raise for this listing* requires typing the new cap |
| Per-listing absolute cap | $2.00 | Cannot be exceeded by any setting |
| Warning threshold | $0.60 per listing | Amber badge, no interruption |
| Daily cap | $5.00 | New paid stages pause until tomorrow or an explicit override |
| Refine turns | 6 per variant per session | Seventh requires *Keep going* |
| Retry storm guard | 3 attempts per stage | Stage fails rather than retrying forever |

Reservation: before a paid stage, the projected maximum is reserved against the balance; on completion the actual is written and the remainder released. Two listings cannot spend the same dollar.

### 8.4 Mandatory bake-off before pinning tagging

No tagging model is pinned until it passes the bake-off. It is re-run every 90 days, on any model version bump, and on any tagging prompt version bump.

| Element | Specification |
|---|---|
| Golden set | 40 clips from 12 real listings: 4 poor-light, 4 handheld, 4 drone, 4 walkthrough, 24 room coverage; hand-labelled rooms and key subjects |
| Candidates | ≥5 models, including the incumbent and at least one cheaper option |
| Runs | 3 per candidate, temperature 0.2, same prompt version, 24 frames per listing |
| Metrics | Room-label accuracy vs human ≥85%; schema-valid responses ≥99%; saliency hit (subject inside crop) ≥80%; p50 latency ≤25 s per listing; cost per listing ≤$0.06 |
| Human check | Blind side-by-side of 10 listings, 2 reviewers, forced choice; winner must not be the incumbent by default |
| Outcome | Winner pinned with `pinnedAt`, the scorecard committed to `docs/`, and the losers recorded with the reason they lost |

A candidate that wins on accuracy but doubles latency is rejected: analysis has a 90 s ceiling and tagging shares it.

### 8.5 Prompts, versions, determinism

Prompts are files, not strings in code: `services/pipeline/prompts/<stage>/<version>.md` with a declared `promptVersion` written into `provenance.promptVersions`. Bumping a prompt invalidates every cache entry for that stage (the cache key includes the version). Planning and tagging outputs must be stable for identical inputs at temperature ≤0.4; where a model offers a seed, it is fixed to the listing hash.

### 8.6 Security and privacy boundary

| Leaves the machine | Never leaves | Conditions |
|---|---|---|
| Up to 24 JPEG frames per listing, ≤1,280 px long edge, q80 | Original video and audio files | Frames are extracted at analysis time and cached locally |
| Up to 3 audio slices per listing, mono 16 kHz, ≤15 s | Full audio track, full transcript beyond the analysed slice | Only when speech content is needed for facts or caption timing |
| The brief text the user typed, the confirmed facts, and the shot table (ids, timestamps, room labels, scores) | File names, folder paths, drive letters, GPS EXIF | Source paths are reduced to `sourceId` before any request |
| Prompts and the EDL being refined (text only) | Any other listing's data | Requests are scoped to one listing |

**Retention.** The relay is stateless: it forwards, meters, and drops the payload when the response is returned. It logs request id, account, model, token counts and status — never prompt text, never image bytes. Upstream providers are called with zero-retention flags where offered; a provider without a zero-retention option is not used for tagging.

**People in frames.** Derivative frames can contain faces. The app shows a one-time notice at first run: footage of people is the user's responsibility, and the app does not attempt face identification. No biometric processing is performed, locally or remotely.

**Local security.** SQLite is unencrypted but stays inside the user profile; the relay token lives in OS credential storage; logs redact everything outside the workspace; the renderer has no network permission except the relay origin, enforced by CSP `connect-src`.

**Development key handling.** In development the OpenRouter key may be read from a git-ignored `.env` at the repository root. It is never logged, never serialised into a job payload, and never bundled into the installer. The packaged app asks for it once in Settings and stores it with Electron `safeStorage`; `scripts/check-openrouter.mjs` reports usage and balance without printing the key.

---

## 9. Rendering

### 9.1 Render profiles

| Profile | Dimensions | FPS | Video | Target bitrate | Peak | Audio | Loudness | True peak |
|---|---|---|---|---|---|---|---|---|
| `vertical-social` | 1080×1920 | 30 | H.264 High@4.1, yuv420p, 2 s GOP | 12 Mbps | 16 Mbps | AAC-LC 320 kbps, 48 kHz, stereo | −14 LUFS | −1.5 dBTP |
| `feed-portrait` | 1080×1350 | 30 | H.264 High@4.1, yuv420p, 2 s GOP | 10 Mbps | 14 Mbps | AAC-LC 320 kbps, 48 kHz, stereo | −14 LUFS | −1.5 dBTP |
| `landscape` | 1920×1080 | 30 | H.264 High@4.1, yuv420p, 2 s GOP | 16 Mbps | 20 Mbps | AAC-LC 320 kbps, 48 kHz, stereo | −16 LUFS | −1.5 dBTP |
| `pin` | 1000×1500 | 30 | H.264 High@4.0, yuv420p, 2 s GOP | 8 Mbps | 12 Mbps | AAC-LC 320 kbps, 48 kHz, stereo | −14 LUFS | −1.5 dBTP |

All outputs: `-pix_fmt yuv420p`, BT.709 tags, `+faststart`, no B-frames beyond 3, keyframe every 60 frames, MP4 container with `moov` first. True peak ≤ −1.5 dBTP. A 45 s `vertical-social` final is ≈70 MB; a 45 s draft is ≈9 MB.

### 9.2 Quality presets

| Preset | Dimensions | Encode | Audio | Time budget (45 s variant) | Use |
|---|---|---|---|---|---|
| Draft | Half of profile, exact even numbers (`540×960`, `540×675`, `960×540`, `500×750`) | x264 CRF 28, `veryfast`, single pass | AAC 96 kbps | ≤60 s | Review, approval, agent preview, WhatsApp |
| Final | Native profile | x264 two-pass ABR at target, `slow` | AAC at profile rate | ≤8 min per file | Upload |

Drafts are always 30 fps regardless of source. Finals inherit 30 fps and are never interpolated in v1 (60 fps only via paid upscale, §9.6).

### 9.3 Segment-level cache

The timeline is cut into segments at clip boundaries, split further so no segment exceeds 6 s. Each segment is rendered independently and stored as `cache/segments/<hash>.mp4`, where `hash = sha256(segmentSlots, edlSlice, lookVersion, profile, fps, rendererVersion)`.

| Property | Rule |
|---|---|
| Granularity | Per segment, never per whole take |
| Scope | Shared across variants and listings (a garden shot reused in two variants renders once) |
| Expected hit rate | ≥40% of segments when rendering the second variant of a listing; ≥60% when re-rendering after a text-only refine |
| Invalidation | Any change to `look` assets, fonts, renderer version, profile dimensions, or fps |
| Eviction | LRU at 25 GB; never evict segments used by a take referenced by a delivery |
| Reporting | `provenance.renderCacheHits` on every rendered EDL, shown in the job detail ("reused 14 of 22 segments") |

Re-rendering a variant after a caption text change re-renders only the segments containing that overlay; the rest are concatenated. This is what keeps refine cheap.

### 9.4 Pipeline order for one take

1. Project the approved EDL to the target profile (§FR-38) and validate.
2. Compute the segment plan and look up cache hits.
3. Render missing segments in `render-worker` (video only, ProRes-free intermediate at CRF 12 for fast concat).
4. Build the audio graph in FFmpeg: clip audio with `volumeDb`, music with ducking, voice, then two-pass `loudnorm`.
5. Concatenate video segments, mux the audio, `+faststart`.
6. Measure loudness and duration, run the seven hard checks (`duration`, `no_black_frames`, `text_safe_area`, `loudness`, `no_repeated_shot`, `facts_present`, plus freeze), then write the take row atomically (temp → rename) and prune segment temporaries older than 24 h.

### 9.5 Remotion licensing, stated plainly

| Plan | Cost | Applies when |
|---|---|---|
| Free | $0 | Individual or company with ≤3 people |
| Company seat | $25 per seat per month | Company with >3 people; each person using the app needs a seat |
| Per render | $0.01 per render, **$100 per month minimum** | Alternative to seats; the minimum applies whether you make 1 render or 10,000 |

Consequences for us: the first-run licence question asks headcount; >3 people without a key get watermarked drafts for 14 days, then all rendering is blocked with the licence screen as the only action; the per-render option is noted in the licence screen but not offered as a default, because a branch producing 40 listings a month (≈360 renders) would pay $100 instead of $25–$75 in seats. Licence state is stored in `settings`; the app never phones home with project data, only a licence key validation.

### 9.6 Paid AI upscale

| Provider | Tier | Price per output second | Notes |
|---|---|---|---|
| fal · Topaz | Tier 1 (fast) | $0.01 | 1080p source, ≤2× |
| fal · Topaz | Tier 2 (balanced) | $0.02 | default suggestion |
| fal · Topaz | Tier 3 (max) | $0.08 | archival only |
| fal · Topaz | 60 fps multiplier | ×2 on any tier | frame interpolation doubles billed seconds |
| ByteDance (fal) | 1080p | ≈$0.0072 | cheapest; softer on fine texture |

**Rules.** Per file. Opt-in. Price displayed as a dollar figure before confirmation, computed from the take's duration and the selected tier with the 60 fps multiplier applied. Never applied to a batch, never remembered between exports, never enabled by default. If the remaining budget is less than the displayed price, the control is disabled with the shortfall stated. There is no partial resumption: a cancelled upscale is billed for the seconds processed and must be re-run from the start.

Worked examples, shown in the UI: a 45 s file at Tier 2 costs $0.90; the same at 60 fps costs $1.80; Tier 3 at 60 fps costs $7.20; all nine files at Tier 2 would cost $8.10 — which is why the button is per file, and why the confirmation dialog says the total for that one file in words.

---

## 10. Error taxonomy

Every failure reaches the user as one sentence of what happened, one reason, one next action. Codes are for logs and QA, never shown. Retryable errors auto-recover per §6.3; deterministic errors never loop.

| ID | What she sees | Cause | Automatic recovery | Manual escape hatch |
|---|---|---|---|---|
| E01 | "There are no videos in that folder. Pick the folder that has the clips in it." | Folder contains only stills, or a parent folder was dropped | None needed; scan offers the nearest subfolder containing video | *Choose another folder*; a list of detected subfolders |
| E02 | "This file can't be read: `IMG_4821.MOV`. It may still be copying or the card was removed." | Truncated file, no `moov` atom, unplugged source | Re-probe once after 3 s; excluded from the listing if still unreadable | *Try again*, *Remove clip*, or copy mode from the original location |
| E03 | "This clip is HDR, so colours look flat in the preview. The export will look correct." | 10-bit HLG/PQ footage, tone-mapped for preview only | Automatic tone-map to BT.709 for preview and export | *Use as is* (SDR conversion) or *Remove clip* |
| E04 | "This clip has no sound, so it'll be used without audio." | No audio stream, or silent track | Clip enters the variant muted; music carries the bed | *Keep it*, *Remove clip*, or *Add music* |
| E05 | "There isn't enough usable footage for a 45-second video — about 18 seconds so far." | Short source, or most shots rejected | Offers the longest format that fits and lowers the target within bounds | *Use 30 seconds*, *Choose another format*, *Add footage* |
| E06 | "No bathroom footage, and no aerial shots, so two formats are unavailable." | Coverage gap | The two formats are disabled with reasons; the rest proceed | *See reshoot list*, *Add footage and re-analyse* |
| E07 | "The same shot appears twice, at 0:12 and 0:31. That looks like a mistake." | Insufficient variety; planner reused a shot | Blocks approval; offers the best unused alternative automatically | *Swap one*, or *Keep as draft only* |
| E08 | "14 shots are too dark or too soft to use. The rest are fine." | Underexposure, motion blur, wrong white balance | Below-floor shots excluded from candidates; exposure correction applied to borderline ones | *Show rejected shots*, *Use anyway* per shot |
| E09 | "We can't reach the planning service. Your footage is safe and analysis is done." | No internet, relay down, firewall | Retries with backoff; job holds at `planning`; resumes when reachable | *Retry now*, *Work offline* (manual format choose, no refine, no captions from speech) |
| E10 | "This would cost $1.12 and your limit for this listing is $1.00." | Per-listing cap or balance exhausted | Nothing runs; no partial charge | *Raise the limit for this listing* (typed), *Top up* |
| E11 | "The planning service returned something unusable. We've asked it again." | Malformed JSON, schema violation, truncated response | One automatic repair call, then one full retry; then fail with the shot plan intact | *Try again*, *Choose a different format*, *Report this* (attaches the redacted request id) |
| E12 | "Rendering stopped unexpectedly. 6 of 9 segments were finished and are saved." | Chrome crash, GPU driver reset, out of memory | Restart worker from the first missing segment; GPU disabled after two crashes | *Resume*, *Render at draft quality* |
| E13 | "There isn't enough disk space. This export needs about 1.4 GB and 600 MB is free." | Cache growth, small SSD | Offers cache cleanup with the reclaimable amount | *Free up space*, *Export 3 files instead of 9* |
| E14 | "Windows won't let us write the file — it's open in another app, or the folder is read-only." | File locked by a player, OneDrive sync, permissions | Retries once after 2 s; writes to a sibling name if allowed | *Close the app and retry*, *Choose another folder* |
| E15 | "The price isn't confirmed yet. Confirm it and we can export." / "The video says 3 bedrooms, your brief says 4." | Facts gate; conflicting sources | Blocks export or planning; highlights the field | *Confirm*, *Edit the fact*, *Use the spoken value* |

Error envelope: `{code, stage, userMessage, cause, retryable, autoAction, escapeActions[], requestId, redactedContext}`. Every error writes one row to the job log and appears once in the batch summary; the same error is never shown twice in one session.

---

## 11. Acceptance criteria for v1

A non-technical person can run this list with a stopwatch, one folder and a browser. Pass requires all items.

**Setup.** Install the app on a clean Windows 11 laptop with 16 GB RAM, an internet connection, and no FFmpeg or Node installed. Sign in with the prepaid account.

| # | Check | Pass condition |
|---|---|---|
| AC-01 | Drag one folder containing 10 clips (≈5 min total, mixed portrait and landscape, one clip with no audio) onto *New listing* | Listing opens; 10 sources listed; no error dialogs |
| AC-02 | Time steps 1–12 of §3 | ≤18 minutes of interaction, measured by stopwatch |
| AC-03 | Facts | Every fact shows a source; price, address, beds, baths require confirmation; export is impossible before confirmation |
| AC-04 | Plan the default set | Three variants appear, each with a distinct format; the draft for each plays within 60 s |
| AC-05 | Approve one variant (or all three) and export finals to destinations that collapse to three profiles | File count matches the on-screen number exactly: 3 per approved variant, so 9 for three variants and 3 for one |
| AC-06 | Durations | Every file is within ±0.5 s of its variant's stated duration; no file is 0 bytes |
| AC-07 | Black frames and freezes | Scrubbing every file finds no black frame longer than 2 frames and no freeze longer than 0.5 s |
| AC-08 | Text placement | Every overlay sits inside the profile safe area (§FR-39) on all four edges, checked on the longest text overlay in each file |
| AC-09 | Filenames and sidecars | All 9 filenames match `<slug>_<format>_<look>_<profile>_v<N>.mp4`; each has `.txt`; captioned files have `.srt`; covers are `.jpg` at profile size |
| AC-10 | Loudness | Every file measures within ±0.5 LU of its profile target and ≤ −1.5 dBTP (checked in the app's report) |
| AC-11 | Cost | Listing total is under $1.00 and matches the pre-export estimate within $0.01 |
| AC-12 | Kill test | Force-quit during the final render; relaunch; the job resumes and finishes without redoing completed segments |
| AC-13 | Offline test | Disable the network after approval; drafts and exports still work; a refine request shows the offline message and loses nothing |
| AC-14 | Wrong price test | Change the price after export; the old files are unchanged and marked *out of date*; a new export uses the new price |
| AC-15 | Refusal test | Ask chat to change the price; it refuses, explains, and neither the on-screen price nor the next export changes |
| AC-16 | Keyboard and screen reader | The whole flow completes without a mouse; Narrator announces every score, progress and error |
| AC-17 | Reshoot list | A listing missing bathrooms produces a list of ≤5 items, each naming room, shot, reason and length, copyable as text |
| AC-18 | Version history | After 3 refines, history shows 4 rows with cost and score deltas; restore an early version and confirm content matches |
| AC-19 | Batch | Queue 3 listings, close the window to tray, return after 45 minutes: all finished or failed with a plain reason; one notification; one summary |
| AC-20 | Unattended honesty | No modal dialog appeared while unattended; the summary's file list matches the folder exactly |

---

## 12. Delivery plan

Eight phases, 13 weeks, one full-stack engineer plus a designer at 50% for the first five phases. Durations assume no parallel engineering on the same files.

| Phase | Duration | Depends on | Exit criteria | Demoable at the end |
|---|---|---|---|---|
| **P1 · Foundations** | 1.0 wk | — | Electron shell builds and signs; SQLite migrations run; EDL validator and hash pass unit tests; CI runs Vitest + Playwright on Windows | App opens, creates a listing, stores it, reopens it |
| **P2 · Intake and analysis** | 1.5 wk | P1 | Folder intake, probe, copy/link, single-pass analysis, shot metrics, contact sheets, content-addressed cache; NFR-01 met | Drop a folder, see contact sheets and scored shots in under 2 minutes |
| **P3 · Facts and planning** | 2.0 wk | P2 | Facts extraction, confirmation gate, conflict detection, three-variant plan, tagging bake-off completed and a model pinned | Confirmed facts produce three EDLs you can read and validate |
| **P4 · Render core** | 1.5 wk | P3 | Remotion composition for one profile, segment cache, FFmpeg mux and loudness, take rows; NFR-02 met, NFR-03 within 2× | A vertical variant plays, correctly loud, from a real EDL |
| **P5 · Review and refine** | 2.0 wk | P4 | Three-up review, drafts, ten checks, shot swap, chat with 15 tools, diff cards, version history | Approve, refine by chat, watch the diff apply and the score change |
| **P6 · Destinations, export, batch, resilience** | 2.5 wk | P5 | Four profiles, projection rule, delivery wrappers, captions in four modes, voice modes, cover, all gates; queue, unattended mode, kill-matrix, reshoot list, cache eviction, disk guards | Nine files with sidecars and a manifest; kill the app mid-render and watch it recover |
| **P7 · Hardening, accessibility, bake-off rerun** | 1.5 wk | P6 | axe-core clean, keyboard flow, pseudo-locale build, security checklist, budget caps, error taxonomy implemented, installer signed; NFR-03 met | Full accessibility and crash demo; cost caps enforced live |
| **P8 · Pilot and handover** | 1.0 wk | P7 | 10 real listings run by the pilot user; acceptance checklist (§11) passed twice; support runbook; installer shipped | A real listing, start to upload, by the pilot alone |

**Milestones.** Week 6: usable core (P1–P4). Week 10.5: feature complete (P1–P6). Week 13: shipped.

### 12.1 Two-track option

If a demo is needed earlier, split the plan. **Core** (P1 + P2 + P3 + a reduced P4: one profile, no cache) lands at weeks 5–6 with one listing, three variants, one vertical export, facts gated and cost under $1. **Complete** (P5–P8, cache and remaining profiles restored) then takes a further 7 weeks. The reduced P4 is deliberate debt: re-renders cost full time and there is no feed or landscape output. It is demoable, not shippable, and the debt is paid in P5 before review ships.

---

## 13. Risks

| # | Risk | Likelihood | Impact | Mitigation | Early warning |
|---|---|---|---|---|---|
| R1 | A wrong fact reaches a published video | Medium | High (legal, trust) | Mandatory confirmation of the four critical facts; facts-only caption generation; out-of-date flagging | Any export with an inferred price in the pilot logs |
| R2 | Vertical reframe crops the subject out of frame | High | Medium | Saliency focus with manual override; `text_safe_area` and `hook_visible` checks; contact-sheet review | Swap-shot rate per variant above 40% in pilot |
| R3 | Finals exceed 8 minutes on real laptops | Medium | High (unusable) | Draft-first flow; segment cache; hardware encode for drafts; estimates before queueing | p90 render time above 6 minutes on the reference machine |
| R4 | Model IDs, prices or behaviour change under us | High | Medium | Pinned IDs, relay allow-list, price snapshot, 90-day bake-off, fail-closed on unknown model | Cost per listing drifting >20% week over week |
| R5 | Relay outage blocks planning | Medium | Medium | Retries, offline mode, queued resumption, status page | Error rate E09 above 2% of jobs |
| R6 | Licence misunderstanding (Remotion, music) | Medium | High (legal) | Headcount gate at first run, licence state in settings, cleared music library, attribution stored per track | Any render with `licence_verified = false` in telemetry |
| R7 | User ships a draft as if final | High | Medium | Drafts stay in `takes\`, never in `deliveries\`; any draft exported through the time-box fallback (§3.2) carries a 0.5 s watermark and a `DRAFT` badge in its spec row | Draft files found in shared drives during pilot |
| R8 | Disk exhaustion on 256 GB laptops | Medium | Medium | 3× source budget, 25 GB cache cap with LRU, pre-export space check, one-click cleanup | Free space below 15 GB on the pilot machine |

---

## 14. Open questions

Six, each with a default that ships if nobody answers by the phase gate.

| # | Question | Default decision | Needed by |
|---|---|---|---|
| Q1 | Does the desktop hold an OpenRouter key directly, or always go through our relay? | **Relay.** Keeps the key off client machines, enforces budget server-side, allows fail-closed model pinning. A bring-your-own-key mode is a v2 question | P3 |
| Q2 | Is the $20 prepaid balance per seat, per branch, or per account? | **Per account**, topped up by the branch manager; the per-listing cap protects the individual listing regardless | P6 |
| Q3 | Do we allow cloned agent voices for `replace_tts`, or stock voices only? | **Stock voices only in v1.** Cloning raises consent and impersonation questions that a one-week phase cannot settle | P5 |
| Q4 | Do we integrate an MLS feed for specs, or keep facts manual? | **Manual with a paste field.** MLS APIs are region-specific and slow to approve; pasting the listing text already works | P3 |
| Q5 | Should linked footage be offered at all, given the failure mode? | **Yes, opt-in, with a persistent warning** on the listing. Power users with a NAS-worthy workflow will ask for it; copy stays the default | P2 |
| Q6 | Do deliveries sync to a shared drive automatically? | **No.** Export writes to a local folder she chooses; syncing is the office's job. A "copy to network path" button is v1.1 | P6 |
