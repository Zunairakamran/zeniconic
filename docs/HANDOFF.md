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
| Tests | 820+ vitest, 66/66 route checks, both themes AA |
| Data | dev `D:\video\data`, packaged `%APPDATA%\Zeniconic\data` |

## Shipped and wired

- **Intake → analysis**: folder picker, indexing, vision tagging, cost estimate,
  facts persistence (`listings:updateFacts`, AED).
- **Planning**: three 30 s looks plus the `marketing_38` beat sheet
  (hook → light → ritual → craft → space → entrance/lift → price → close).
- **Variants / export**: approve, preview, export 9:16 / 16:9 / 1:1; two-pass
  loudness, SRT + cover, review gate, FFmpeg-first marketing render.
- **Voice**: Kokoro downloader (resumable, checksummed) **and** ElevenLabs
  `eleven-v4` through OpenRouter with a Settings gallery (matilda default,
  bundled samples, `voice:list` / `voice:setVoice`). Presenter audio restore.
- **Chat refine**: `chat:send/apply/versions` with semantic guardrails.
- **Settings**: key in safeStorage, data folder, spend, version, voice model.
- **Shell**: splash ident, auto-update from the public releases repo, CSP.
- **Packaging**: NSIS installer; `sharp` + `detect-libc` + `semver` now bundled
  (the first installer crashed on launch without them).

## Built but not wired

- `services/remix/**`: `splitScenes`, `buildCandidates`, `createTranscriber`
  (Scribe v2), `buildMarketingOrder` / `buildOriginalOrder` / `buildPriceLedOrder`,
  `cleanCaptions`. 56 tests. **No IPC channels, no screen, no job type yet.**
  To wire: add `remix:start/preview` + a job, a Home entry “Improve a video”,
  file picker, storyboard review, then feed the slots into the existing planner.

## Delivery cuts (client review)

Two cuts are the current best answer to the rejected tour:

- `data/marketing/out/deliver_focus.mp4` — his voice throughout, location-first
  opening (font-cycling `DUBAI MARINA` hook, 6 fonts / 2 frames), 2.6 s
  blur-to-clear, proximity card, presenter hook, elevator at ~24 s, price,
  private-viewing close.
- `data/marketing/out/deliver_hybrid.mp4` — same picture; his opening line, then
  matilda with ElevenLabs emotion tags.

Copies for handover: `deliverables/2026-11-17/`. Scripts: `scripts/marketing/`
(`render-deliver.mjs`, `master.mjs`, `generate-voice.mjs`,
`generate-emotional.mjs`, `generate-music.mjs`, `transcribe.mjs`).

### Decisions still open

1. **Price**: reference says one-bedroom from **AED 1,400,000**; stored listing
   facts say **3 bed · 2 bath at AED 1,850,000**. The cuts use 1.4 M.
2. **Proximity claims**: Marina Walk 1 min, Spinneys 3 min, Marina Mall 5 min,
   JBR 10 min walk. Sourced from the building listing + area guides; confirm
   before publishing.
3. **Agent contact** for the end card (name, WhatsApp) — not in the data yet.
4. **Music clearance**: the Lyria beds are AI-generated and not unambiguously
   cleared for client work (`docs/MUSIC-LICENCES.md`). Get a licensed track for
   delivery, or record sign-off.

## Known gaps / next tasks, in order

1. **Remix UI** — the biggest missing feature. Wire the modules, add the screen,
   run a real 2-minute edit end to end.
2. **Location claims in the app** — the marketing copy and proximity card are
   script-only; move them into the planner/copy layer so the app generates them.
3. **Variant wiring** — `planVariants` still emits the three 30 s looks; expose
   `marketing_38` as a variant so the app can produce these cuts.
4. **Facts address** — `listings:updateFacts` accepts `address` but the store
   keeps the top-level one; decide mirror vs reject.
5. **Analysis enqueue** — `analysis:start` enqueues before `prepareAnalysis`;
   a throw leaves an orphan job.
6. **Single-instance lock** — two instances can race on the model `.part`.
7. **Packaged voice E2E** — download + synthesis inside the installed app is
   still unproven (module-level verified).
8. **CI workflows** — local only; token lacks `workflow` scope.
9. **Code signing** — SmartScreen warning until an OV/EV certificate is used.
10. **Batch export, job persistence, Arabic voice** — deferred.

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
