# Handoff — Zeniconic

Last updated: 2026-11-17. Read `AGENTS.md` first if you are new.

## What this is

A Windows desktop app for a Dubai estate agent. Drop in raw clips, confirm the
facts, get 30–40 s marketing cuts with voice, captions, music, price card and an
end card. Local-first: footage stays on the machine; only derivative frames and
short audio slices go to the model provider.

## Snapshot

| | |
|---|---|
| Source | private `Zunairakamran/zeniconic`, branch `main` |
| Releases | public `Zunairakamran/zeniconic-releases`, tag `v0.1.0` |
| Installer | `Zeniconic-Setup-0.1.0-x64.exe`, ~198 MB, unsigned |
| Tests | 1566 root + 76 renderer vitest, 66/66 route checks, both themes AA |
| Data | dev `D:\video\data`, packaged `%APPDATA%\Zeniconic\data` |

## Shipped and wired

- **Intake → analysis**: folder picker, indexing, vision tagging, cost estimate,
  facts persistence (`listings:updateFacts`, AED).
- **Planning**: four variants — the three 30 s looks plus the 38 s
  `marketing38` beat sheet (hook → light → ritual → craft → space → lift →
  price → close).
- **Variants / export**: approve, preview, export 9:16 / 16:9 / 1:1; two-pass
  loudness, SRT + cover, review gate, FFmpeg-first marketing render; per-clip
  segment cache for re-renders.
- **Voice**: Kokoro downloader (resumable, checksummed) **and** ElevenLabs
  `eleven-v4` through OpenRouter with a Settings gallery (matilda default,
  bundled samples, `voice:list` / `voice:setVoice`). Presenter audio restore.
- **Chat refine**: `chat:send/apply/versions` with semantic guardrails, plus the
  agentic editor (`agent:run/approve`, approvals, real draft playback).
- **Reference style**: local analysis feeds both agent guidance and planner
  pacing (`referenceStyle.averageShotSec`).
- **Music**: Lyria 3 Pro generation through OpenRouter, selected bed persisted.
- **Performance**: per-clip segment cache for the FFmpeg picture pass, with
  atomic manifests and 14-day prune.
- **Reliability**: persisted jobs resume after a hard kill and reuse a verified
  footage index (verified smoke).
- **Remix**: scene split, three preset orders, transcription + captions, manual
  move up/down, per-slot room tags, provider-reported transcription cost.
- **Settings**: key in safeStorage, data folder, spend, version, voice model.
- **Shell**: splash ident, auto-update from the public releases repo, CSP.
- **Packaging**: NSIS installer; `sharp` + `detect-libc` + `semver` now bundled
  (the first installer crashed on launch without them).

## Built but not wired

Nothing major. Remix, the agentic editor, reference-guided planning, Lyria music,
the segment cache, real Refine playback and crash-safe resume are all wired and
tested. The remaining items are stretch features, not broken wiring.

## Known gaps / next tasks, in order

1. **Marketing cache** — `marketing_38` renders in one graph and skips the
   segment cache; decide whether to segment it.
2. **4K / custom output** — profiles are 1080-based; custom output is schema-only.
3. **Location claims in the app** — the marketing copy and proximity card are
   still partly script-only; move them into the planner/copy layer.
4. **Packaged voice E2E** — Kokoro download + synthesis inside the installed app
   is still unproven (Gemini/ElevenLabs are live-verified).
5. **Transcription pricing** — cost is recorded when the provider reports it;
   pin a documented Scribe per-second rate for the pre-flight estimate.
6. **CI workflows** — local only; token lacks `workflow` scope.
7. **Code signing** — SmartScreen warning until an OV/EV certificate is used.
8. **Batch export, Arabic voice** — deferred.

## Environment and secrets

- `.env` (gitignored) holds `OPENROUTER_API_KEY`. Never commit, log, or paste it.
- A user key saved in the app is encrypted with Windows `safeStorage`; when that
  is unavailable the app keeps it in memory and refuses to write plaintext.
- GitHub automation token: `repo` scope only. It cannot push
  `.github/workflows/**`. Use a workflow-scoped token or the GitHub UI.
- TEMP/TMP should point at `data/tmp` on small C: drives (Remotion/FFmpeg).

## Run, test, release

```powershell
npm install
npm run dev
npm run typecheck
npx vitest run
npx vitest run --config apps/render/vitest.config.ts
node scripts/e2e.mjs
npm run dist          # release/Zeniconic-Setup-<version>-x64.exe + latest.yml
```

Release: bump `version`, `npm run dist`, upload exe + blockmap + `latest.yml` to
a GitHub release in `zeniconic-releases` (public), publish `latest.yml` last.
The updater reads that repo; the source repo stays private.

## Gotchas learned the hard way

- electron-builder `files` needs an explicit allow-list for runtime node_modules;
  `sharp` needs `detect-libc` and `semver` or the app dies on launch.
- Do not run two renders against the same `data/marketing/work/*` dir; partial
  MP4s poison the next run (`moov atom not found`). Clean, then run one job.
- Remotion at 1080p is ~11 min for 30 s; the marketing format uses FFmpeg + ASS
  (~2–3 min). Do not put the marketing cut back on Remotion.
- Caption lines over ~18 characters wrap at 72 px. Keep them short.
- Voice lines must be extracted with a 0.35 s tail; 0.12 s clips the last word
  (“ready”).
- `data/` is ignored; anything the client must receive has to be copied to
  `deliverables/` or uploaded separately.

## Where to look

- Contract: `packages/edl/schema.json`, `packages/edl/src/types.ts`
- Fast render: `services/pipeline/marketing.ts`, `services/pipeline/ffmpeg-overlays.ts`
- Studio voice: `services/voice/src/studio-tts.ts`, `voices.ts`, `gallery.ts`
- Remix: `services/remix/README.md`
- Marketing rationale: `docs/MARKETING-CUTS.md`
- Audit: `docs/AUDIT.md`, `docs/AUDIT-STATUS.md`
- Updates: `docs/UPDATES.md`
