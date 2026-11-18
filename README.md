# Zeniconic

**Listings, made iconic.**

![Zeniconic](docs/screenshots/brand-intro.jpg)

A local-first Windows app that turns a folder of raw property footage into finished,
platform-sized marketing videos. Built for an assistant who is a beginner at editing
and has no time: she drops in what she filmed, confirms the facts, and gets edits she
can approve or ask to change.

![Home](docs/screenshots/home.png)

## What it does

- **Watches the footage.** One decode pass scores every shot for sharpness, shake,
  exposure and motion; with `ZENICONIC_TAG=1` a vision model names the room, the
  camera move, the selling points and the defects, and ShotReview shows the real
  index instead of demo data.
- **Builds complete edits, not clips.** Four variants: three 30-second looks (Calm,
  Walkthrough, Social) plus the 38-second **Marketing 38** campaign cut. Each is a
  full edit with music, voice, captions, price card and end card.
- **Says why.** Every shot carries a reason; every rejected shot stays visible with
  the defect that sank it.
- **Studio voice.** Gemini TTS (`google/gemini-3.8-flash-tts`) is the working
  studio path, with ElevenLabs `eleven-v4` as the alternate and a Settings gallery
  of bundled samples. Kokoro remains the offline fallback, downloaded on request
  (92 MB, resumable). Voice spend is recorded in the ledger.
- **Captions that look designed.** Bricolage 800 uppercase, two lines maximum, no
  background plate, accent on the most substantial word.
- **Aspect-aware.** 9:16, 16:9 and 1:1 from one edit; portrait into landscape uses a
  contained frame over a blurred fill rather than a hard crop.
- **Edits on request, executed.** The agent inspects the edit, discovers from a
  29-operation capability registry, applies validated changes (trim, split,
  reorder, speed, speed ramps, transitions with real source handles, effects,
  grades, captions, overlays, audio) and commits a version. Under *Auto* the new
  cut is made current; under *Ask* it is saved for your approval. A request that
  cannot be done safely is refused, never half-applied; if a requested change is
  skipped, the reply says so. Draft renders play back in the Refine stage. See
  `docs/AGENTIC_ARCHITECTURE.md`.
- **Borrow a reference look.** Add a reference video in Refine: its pacing, shot
  lengths, palette and style are measured locally, handed to the agent as
  guidance (never as a property fact) and used to pace automatic planning.
- **Improve a finished video.** The Remix screen splits an existing cut into
  scenes and proposes three reorders (marketing, original, price-led), optionally
  transcribes the speech and burns captions, then lets you move scenes, tag rooms,
  see the provider-reported transcription cost, and save the result as a variant.
- **Music that fits.** Generate a bed with Lyria 3 Pro through OpenRouter from
  Settings (about $0.08 per song); it is saved locally and used by new exports.
- **Fast re-renders.** A per-clip segment cache reuses unchanged picture segments
  after a chat edit, so only the clips you changed are encoded again.
- **Crash-safe.** Analysis jobs persist checkpoints; after a hard kill a restart
  resumes at the right stage and reuses a verified footage index.
- **Location-led marketing cut.** A 38-second beat sheet (hook → light → ritual →
  craft → space → lift → price → close) with slice/zoom/light transitions and a
  proximity card. Rendered in FFmpeg, not Remotion, so it takes minutes.
- **Local by default.** Media never leaves the machine except derivative frames and
  short audio slices sent to the model provider.

| Variants | Refine |
|---|---|
| ![Variants](docs/screenshots/variants.png) | ![Refine](docs/screenshots/refine.png) |

## Demo

`demo/` contains a real build from 18 presenter clips: a 30 s Calm cut, the 38 s
Marketing 38 cut, cover frames, the presenter transcript and ten Electron
screenshots. Facts were taken from the presenter's audio (one bedroom, from
AED 1,400,000) and the Marina Gate 1 listing already cited in
`docs/MARKETING-CUTS.md`; baths and sq ft were left blank because they are not
stated. Rebuild with `npx tsx scripts/demo-build.ts` and
`node scripts/demo-capture.mjs`.

## Install

Download `Zeniconic-Setup-<version>-x64.exe` from Releases and run it. Windows may
show "Windows protected your PC" until the installer is code-signed; choose **More
info → Run anyway**.

First run asks for an OpenRouter API key. It is stored in Windows credential storage
and never written to a listing, a log, or the installer.

Voice is optional and explicit: **Settings → Voice model → Download** fetches Kokoro
82M (92 MB) once. The download is checksummed and resumable, so closing the app or
losing the connection costs only the bytes in flight. Everything else works without it.

Requirements: Windows 10/11 x64, ~600 MB disk for the app, ~2 GB during a render.

## Five-minute start
1. **New video** → choose the folder of clips.
2. **Check the facts** — price, beds, baths, address. A missing fact is better than a
   wrong one; export is gated on this.
3. **Pick the shapes** — 9:16 for social, 16:9 for portals, 1:1 for WhatsApp.
4. **Analyse** — roughly 90 seconds for five minutes of footage. You can leave it.
5. **Approve** the variants you would send, refine in chat if needed, then **Export**.

Files land in `%APPDATA%\Zeniconic\data\listings\<slug>\exports\`.

## How it is built

```
apps/ui            React 19 + Vite renderer, nine screens, light/dark
apps/desktop       Electron main, IPC, agent host, export pipeline
apps/render        Remotion composition: overlays, captions, crossfades
packages/edl       JSON Schema + runtime invariants — the contract (v2)
packages/planner   shot selection, pacing, overlays, deterministic EDLs
packages/render    FFmpeg filter graphs, effects/grade lowering, profiles
packages/review    deterministic checks before vision review
packages/capabilities  capability registry: 28 validated editing operations
packages/agent     orchestrator: context → tools → draft → commit
services/pipeline  analyse → plan → render orchestration
services/voice     studio TTS with Kokoro backup, ducking, mastering
services/reference reference-video style analysis (local + optional vision)
```

Every stage is a module with tests. An EDL (edit decision list) is the single source
of truth: the chat edits it, the planner writes it, the renderer treats it as pure
input. That is why a change is a validated patch and a re-render, not a re-analysis.

See `docs/SPEC.md` for the full specification and `docs/BUILD.md` for the module map.

## Models and cost

| Stage | Model | Notes |
|---|---|---|
| Agent | `deepseek/deepseek-v4.1-flash` | tool calling; escalates to `openai/gpt-6-astra` |
| Tagging | `perceptron/perceptron-mk1.5` | video/image/audio; Gemini fallback |
| Planning / chat | `openai/gpt-6-astra` | `:nitro`; tool calling |
| Review | `google/gemini-4-hydrogen` | rendered frames, Gemini Carbon fallback |
| Music | `google/lyria-3-pro-preview` | one bank, not per listing |
| Voice | `google/gemini-3.8-flash-tts` | optional; Kokoro-82M offline backup |

Model ids live in `services/pipeline/models.json`; no call site hardcodes one.
The agent's capability catalogue and safety limits are documented in
`docs/AGENT_TOOL_REFERENCE.md`.

Typical listing: **$0.20–0.60** in model spend. Rendering is local and free; AI
upscaling is opt-in and priced per file.

## Develop

```powershell
npm install
npm run dev            # Electron + Vite
npm test               # unit + integration (700+)
npm run typecheck
node scripts/e2e.mjs   # nine routes in headless Chrome
npm run dist           # NSIS installer → release/
```

The real listing used for calibration is in `data/listings/marina-gate-1`; see
`docs/PROTOTYPE.md` for the end-to-end run and `docs/RESEARCH.md` for the decisions
behind tagging, rendering and voice.

## Honest status

Working end to end on real footage: indexing, vision tagging, planning, 30-second
edits, the 38-second marketing cut, Remotion overlays, presenter + studio voice,
captions, crossfades, export, installer, splash and auto-update. Verified: 820+
tests, 66/66 route checks, both themes AA, 30.000 s exports at −14/−16 LUFS with
SRT and cover, and a 198 MB installer that launches on a clean profile.

Not yet wired: the remix engine (scene split, Scribe transcription, ordering
presets) is built and tested in `services/remix` but has no screen or IPC yet.
Also open: code signing, licensed music for delivery, Arabic voice, in-memory job
queue, batch export, and real shot data in the shot review screen. New sessions
should start with `AGENTS.md` and `docs/HANDOFF.md`.

## Updates

The app checks GitHub Releases on launch and prompts before restarting. Source is
private; release binaries live in a public releases repository so no token ever
ships to a client machine. See `docs/UPDATES.md`.

## Licences

Remotion (free ≤3 people), FFmpeg, Kokoro (Apache-2.0), Bricolage Grotesque and
Archivo (SIL OFL). Full list and obligations: `THIRD-PARTY.md`. Music licensing:
`docs/MUSIC-LICENCES.md`.

---

Private repository. © 2026 Zeniconic.
