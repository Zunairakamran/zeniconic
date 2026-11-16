# AGENTS.md — read this first

You are in **Zeniconic**: a local-first Windows desktop app that turns raw property
footage into short marketing videos (EDL → FFmpeg/Remotion → MP4). Electron 45 +
React 19 + Vite, TypeScript end to end, Remotion for overlays, FFmpeg for picture
and the fast marketing path. No server, no account; media stays local.

**Start here, then read `docs/HANDOFF.md`** for the current state, what is wired,
what is not, and the exact next tasks. `docs/AUDIT.md` and `docs/AUDIT-STATUS.md`
record the last audit and the fixes.

## 60-second orientation

```
apps/ui           React renderer (nine screens)
apps/desktop      Electron main, IPC wiring, chat, pipeline, updater, splash
apps/render       Remotion composition (overlays, captions, transitions)
packages/edl      JSON schema + invariants — the contract
packages/planner  shot selection, pacing, marketing_38 beat sheet
packages/render   FFmpeg filter graphs, profiles, xfade mapping
packages/review   deterministic checks before/after render
services/pipeline analyse → plan → render, FFmpeg overlays, ASS
services/voice    Kokoro (offline) + ElevenLabs studio voice + model downloader
services/remix    scene split, Scribe transcription, ordering presets, captions
scripts/marketing one-off marketing cuts and audio generation
```

- Dev data dir: `D:\video\data` (or `ZENICONIC_DATA_DIR`).
- Packaged data dir: `%APPDATA%\Zeniconic\data`.
- Secrets: `.env` holds `OPENROUTER_API_KEY`; never commit or log it. The app stores
  a user key with Windows `safeStorage` only.

## Commands

```powershell
npm install
npm run dev          # Electron + Vite
npm test             # vitest (820+); also run apps/render suite separately
npm run typecheck
node scripts/e2e.mjs # 66 route checks, writes tests/e2e/screens
npm run dist         # NSIS installer → release/
```

Real render / QA harnesses live in `scripts/` (e.g. `qa-landscape-export.ts`,
`marketing/*`). They write to `data/`, which is gitignored.

## Hard rules

1. **EDL is the contract.** A change is a validated patch + re-render, never a
   re-analysis. Run `assertEdl` / schema tests.
2. **Never commit `data/`, `.env`, installers, or node_modules.** All ignored.
3. **No silent model downloads.** Kokoro is an explicit Settings download;
   ElevenLabs is called only with a configured key.
4. **Do not invent facts.** Price, beds, size, location minutes: only from
   confirmed listing facts or a cited source.
5. **Marketing cuts**: the client rejected the room-by-room tour. Keep the
   `marketing_38` beat sheet, lift near the end, price late.
6. CI workflow files are **not pushed** (the automation token lacks `workflow`
   scope). Add them through GitHub UI or with a scoped token.

## Where the work stands

- Installer `0.1.0` is published (fixed sharp runtime deps); source is private.
- Studio voice gallery, Kokoro downloader, marketing_38, chat refine: shipped.
- Remix modules are built and tested but **not wired into IPC/UI**.
- Delivery cuts live in `data/marketing/out/deliver_*.mp4` and are copied to
  `deliverables/` for handover.

Open `docs/HANDOFF.md` for the full list and priorities.
