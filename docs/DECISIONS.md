# Decisions

Architecture decision records, newest first. Each entry is a choice that is
expensive to reverse; if you disagree with one, change it here first, then in code.

---

## ADR-017 · Video output only; marketing owns the rest

**Context.** The team already has a marketing function that handles platforms, copy,
hashtags, permits and publishing. Building a delivery layer duplicates their job and
adds legal surface we do not need to own.
**Decision.** v1 stops at the finished file: a clean master plus 9:16, 16:9 and 1:1
renders, with optional captions or an SRT. No destinations screen, no wrappers, no
hashtag sets, no upload checklists, no publishing. The Trakheesi permit line is an
optional overlay, not a gate.
**Consequence.** About two weeks of work removed, and the critical path becomes edit
quality rather than packaging. The render profiles survive because they are aspect and
loudness specs, not platform integrations. If marketing later wants wrappers, §4.7–4.8
of the spec still describe them.

---

## ADR-015 · Per-stage routing variants and prefix caching

**Context.** OpenRouter routes one model slug to many providers at different prices
and speeds. Every listing makes dozens of calls with the same instructions, schema
and style guide. Paying full input price for an identical prefix is waste.
**Decision.**
- Tagging runs `:floor` (cheapest provider), because contact sheets are high volume
  and their quality is gated by the bake-off.
- Planning and chat run `:nitro` (fastest), because a person is waiting.
- Review, music and TTS run `auto`, because nobody is waiting and volume is low.
- Every request sends `provider: { data_collection: 'deny' }` so we only use
  providers that do not train on the data.
- Prompts are stable-prefix-first: instructions, schema and style guide never change
  within a stage; the contact sheet or shot table goes last. Anthropic models get an
  explicit `cache_control: ephemeral` breakpoint; Gemini and OpenAI cache implicitly.
- Every response records `cached_tokens` and `cache_discount`; the ledger uses the
  net figure, not the estimate.
**Consequence.** Tagging gets materially cheaper and review stays predictable. `:floor`
can route to a lower-precision provider, so the tagging bake-off must pass *on the
floor route*, not on the default route. If it fails, tagging falls back to `auto` —
never to `:free`, which has rate limits and a different data policy.

## ADR-014 · No auto-publishing in v1

**Context.** Uploading to TikTok/Instagram requires business accounts, app review and
platform-specific APIs. A failed upload at 6pm is worse than a manual one.
**Decision.** v1 exports files and delivery wrappers. The app never posts.
**Consequence.** No OAuth surface, no platform tokens, no publish queue. The delivery
wrapper includes copy-paste captions and hashtags so the manual step is 30 seconds.

## ADR-013 · AI upscaling is per file, priced, and opt-in

**Context.** fal/Topaz bills per output second: $0.02/s for 720→1080p, $0.08/s above
1080p, double for 60 fps. Nine renders per listing would cost more than the analysis.
**Decision.** Never batch. One approved file at a time, with the price shown before
the call. Off by default, and disabled when the source is already 4K.
**Consequence.** The cost model stays under $1/listing. The UI must always answer
"would this even help?" before offering the button.

## ADR-012 · Bundled binaries, no system dependencies

**Context.** The user installs the app on a Windows laptop and cannot be asked to
install FFmpeg or Node.
**Decision.** `ffmpeg-static` and `ffprobe-static` are dependencies. Node ships inside
Electron.
**Consequence.** Installer ~150 MB. No PATH problems, no "works on my machine".

## ADR-011 · Bottom-up modules with test gates

**Context.** Parallel agents build fast and integrate badly.
**Decision.** Nine layers (see `docs/BUILD.md`). A module ships with tests; a higher
layer does not start until the lower layer's suite is green; integration is a
separate step with its own test.
**Consequence.** Slower first hour, far fewer seam failures. Every module has a single
public entry point.

## ADR-010 · TypeScript end to end

**Context.** Video processing usually pulls in Python, which means a second runtime,
a venv and a class of Windows failures.
**Decision.** Node + TypeScript for analysis, planning, rendering and UI. FFmpeg does
the pixel work; JS does the maths.
**Consequence.** One installer, one language, one test runner. Python remains a
dev-only tool for calibration scripts, never shipped.

## ADR-009 · The EDL is the contract

**Context.** Chat-driven editing needs to be fast, reversible and inspectable.
**Decision.** One JSON document describes a variant completely. Chat edits the EDL;
a render is a pure function of it; versions are cheap.
**Consequence.** Changes preview in seconds, undo is a document revert, and the
review record travels with the artefact. No code path mutates a take.

## ADR-008 · JSON Schema plus runtime invariants

**Context.** Schema validation alone accepts a 12-second video that claims to be 30.
**Decision.** Ajv validates structure; a second layer enforces timeline invariants
(`E_DURATION`, `E_OUT_LE_IN`, `E_CLIP_GAP`, `E_OVERLAY_RANGE`, `E_TRANSITION`,
`E_CAPTION_ORDER`).
**Consequence.** Two error families, both with stable codes. The planner's property
tests assert the invariants, not just the schema.

## ADR-007 · Destinations collapse into four render profiles

**Context.** Seven platforms × three variants looks like 21 renders.
**Decision.** Platforms map to `vertical-social`, `feed-portrait`, `landscape`, `pin`.
One file per profile, plus N delivery wrappers.
**Consequence.** Vertical text is laid out inside the *intersection* of TikTok, Reels
and Shorts safe areas, so one file is safe everywhere. Fewer renders, more wrappers.

## ADR-006 · JSON store first, SQLite later

**Context.** `better-sqlite3` is a native module that must be rebuilt for Electron's
ABI — a common Windows install failure.
**Decision.** Persist to JSON files with atomic temp-write-and-rename behind a `Store`
interface. Port to SQLite when the data outgrows it.
**Consequence.** No native build step in the first milestone. The interface must not
leak file paths, so the swap stays contained.

## ADR-005 · Two themes from one token set

**Context.** Design systems rot when a dark theme is a filter or a second palette.
**Decision.** One `tokens.css` with two `:root` palettes. Components never branch on
theme; status text is a token, not a literal.
**Consequence.** Both palettes are contrast-tested by the same script. The stage
separates by a hairline in dark mode because luminance cannot do it.

## ADR-004 · OpenRouter, pinned models, dev key in `.env`

**Context.** The account is prepaid, the budget is $20, and model IDs change.
**Decision.** All model calls go through one client. IDs and prices live in
`services/pipeline/models.json` with a `pinnedAt` date. Development reads
`OPENROUTER_API_KEY` from a git-ignored `.env`; the packaged app stores it with
Electron `safeStorage`.
**Consequence.** The key is never bundled or committed. A price drift over 10% raises
a warning rather than silently changing the cost model.

## ADR-003 · Analysis is one decode pass

**Context.** A 10-minute listing at 30 fps is 18,000 frames. Decoding per metric is
minutes of wasted CPU.
**Decision.** Decode once at 160×90 and 10 fps to grey; compute every metric from that
single stream. Contact sheets are cut from the same pass.
**Consequence.** Analysis is seconds, not minutes. The cost is resolution: defect
detection at 160×90 needs thresholds calibrated on real footage, not guessed.

## ADR-002 · No timeline in v1

**Context.** Beginners do not ask "where is the razor tool"; they ask "is this good?".
**Decision.** A storyboard strip with swap/reorder, and a chat. No tracks, no trim
handles, no keyframes.
**Consequence.** The edit model stays at shot granularity, which is exactly what the
EDL supports. Manual polish is handled by exporting FCPXML to a real NLE.

## ADR-001 · Desktop app, local-first

**Context.** Raw footage is 5–20 GB per listing; rendering is CPU-bound; property
footage is sensitive.
**Decision.** Electron app on the user's machine. Media stays local; only contact
sheets and short audio slices go to a model provider.
**Consequence.** No storage bill, no upload wait, no multi-tenancy. A hosted version
would be a different product with a queue and a storage layer.
