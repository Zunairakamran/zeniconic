---
name: Production hardening
description: Use when Zeniconic has to survive a non-technical user on a real Windows PC — "Windows protected your PC", "it crashed mid-render and lost the job", "how do I move my projects to a new laptop", "the export failed with 3 GB free", "write the one-pager for the agent's assistant", "is my footage uploaded anywhere", "we bumped the EDL version and old projects won't open", "the uninstaller deleted my videos". Covers the NSIS build and the signing trade-off, crash-safe stages and resume, the test ladder, handoff docs, local-first privacy, portability, backup, schema migration and disk preflight.
---

# Production hardening

The person installing this app edits property videos for a living. They are not
a developer, they are under time pressure, and the footage is the only copy. A
crash, a silent upload, a deleted project or a mysterious installer warning costs
more trust than any feature earns.

The standard: **fail safely, resume automatically, explain in plain language,
and never move the user's media without saying so.**

## When to use

- Preparing the first build that leaves your machine, or the first one a client
  installs.
- A support report: crash, lost job, orphaned process, installer warning, missing
  files after a move, "it says I have no space".
- Choosing or renewing code signing, or deciding what to do without it.
- Writing the onboarding page, troubleshooting list, recording script or printed
  card that ships with the app.
- Answering "where does my footage go", "what leaves my PC", "can I work on my
  laptop", "how do I back this up".
- Bumping `edlVersion`, changing the data folder, or changing what the uninstaller
  removes.
- Cutting a release, hotfix or auto-update channel change.

## When to switch skills

| The ask | Go to |
|---|---|
| Chat tools, diffs, budgets, prompt evals | `agent-tool-design` |
| EDL validation, segment cache, render recipes | `edl-and-rendering` |
| Destinations, captions, covers, ZIP packaging | `platform-delivery` |
| Format, look, hook, copy, compliance | `real-estate-creative` |
| Screen layout, component states, UI wording | `ui-ux-for-video-tools` |
| Voice quality, music licence, loudness | `audio-restoration` |
| Shot metrics, room tags, index rebuilds | `footage-analysis` |

## Workflow

1. **Name the target machine.** Windows 11 24H2 or later, x64, 8 GB RAM minimum, 16 GB recommended, 4 GB free disk before install, integrated graphics is the baseline. No GPU is required or used. Windows 10 is not supported; it left mainstream support in October 2025.
2. **Bundle everything.** Electron with its Node 22 runtime, `ffmpeg-static`,
   `ffprobe-static`, the SQLite native module rebuilt for Electron's ABI, and the
   model catalogue. The user installs nothing else.
3. **Build the NSIS installer.** Per-user install, no admin prompt, install
   directory selectable, desktop shortcut optional, uninstall that keeps projects.
   Verify the bundled binaries from the installed location, not from `node_modules`.
4. **Decide signing honestly.** An EV certificate is $200–400 per year plus a
   hardware token; without it SmartScreen shows "Windows protected your PC" and
   "Unknown publisher". Write that down in the install guide, publish SHA-256
   checksums, and do not pretend a self-signed certificate helps.
5. **Make every stage crash-safe.** SQLite WAL, one persisted state per stage, a
   temp-file-then-rename write with `fsync`, content-addressed outputs, and a
   child-process registry that is swept on boot and on quit.
6. **Prove resume, not just claim it.** Kill the app at 30 %, 60 % and 90 % of a
   render; relaunch; assert no completed stage is redone and no segment is lost.
7. **Run the test ladder.** Vitest for metrics, validation and cost maths; three
   golden listings with snapshot EDLs; Playwright for the six-step flow; a real
   5-second render smoke in CI; the eval suite for every prompt change.
8. **Write the docs before the installer.** One page to first video, eight
   troubleshooting entries in plain language, a 5-minute recording script and a
   printed card. If the docs need a glossary, the app is too complicated.
9. **Publish the privacy facts.** A short list of exactly what leaves the machine,
   where the key lives, what is redacted, what the diagnostics bundle contains,
   and the fact that analytics are off by default.
10. **Settle the data rules.** Portable project folder, backup reminder, ordered
    schema migrations with a copy first, and a disk preflight before a multi-file
    render.
11. **Cut the release.** Tag, sign or explicitly not, build, smoke, checksum,
    publish notes, update the feed, keep N-1 available for rollback.

## Hard rules

1. **Media stays local.** The only content payloads are contact sheets, bounded voice slices, EDL summaries and prompt text; the update check sends version metadata only. No video, no master audio, no full-resolution frame.
2. **Nothing publishes automatically.** Export is a human action. No tool, no
   scheduler, no auto-update may start an export.
3. **The uninstaller never deletes projects.** It removes program files and the
   cache; it leaves the projects folder and says where it is.
4. **No destructive migration.** Copy the EDL first, migrate the copy, validate,
   then replace atomically. A failed migration leaves the old file untouched.
5. **No orphaned ffmpeg.** Every child is recorded, killed on parent exit, and
   swept on next boot after a PID and image-name check.
6. **Every stage output is atomic.** Temp file, `fsync`, rename. A half-written
   JSON or MP4 must never be observable.
7. **Keys live in Electron `safeStorage`.** Never in the renderer, never in
   `localStorage`, never in a log, never in the diagnostics bundle.
8. **No analytics by default.** The only background call is the update check,
   and it is disclosed and can be turned off.
9. **Logs are redacted at the logger, not at the reader.** Usernames, addresses,
   prices, keys and tokens never reach disk.
10. **Any prompt change re-runs the eval suite.** Same gate as `agent-tool-design`;
    a release with a skipped eval is a broken release.
11. **No release without the 5-second smoke render.** It runs the real ffmpeg,
    the real encode settings and the real muxer.
12. **Disk space is checked before the first frame.** A 9-file render needs a
    measured reserve, not hope.
13. **The installer's signing status is stated in the download page.** Unsigned is
    a decision with a cost, not an oversight.
14. **User-facing words are plain.** No "EDL", "codec", "ffmpeg", "WAL",
    "content-addressed", "schema migration" in the app or the handoff docs.

## Packaging at a glance

| Item | Value |
|---|---|
| Installer | NSIS, x64, per-user, no admin |
| Installer size | ~130 MB compressed |
| Installed size | ~310 MB (Electron ~110, ffmpeg ~80, ffprobe ~80, app ~40) |
| Runtime | Electron with bundled Node 22; no system Node, no system FFmpeg |
| Install path | `%LOCALAPPDATA%\Programs\Zeniconic` (changeable) |
| Data path | `%USERPROFILE%\Documents\Zeniconic` by default (changeable) |
| Update channel | `latest` stable, `beta` opt-in, N-1 kept for rollback |
| Update check | On launch and every 6 hours, HTTPS, disclosed |
| Uninstall | Removes program files and cache; keeps projects |

Build and verify:

```powershell
pnpm -C apps/desktop exec electron-rebuild -f -w better-sqlite3
pnpm -C apps/desktop exec electron-builder --win nsis --x64 --publish never
& "$env:LOCALAPPDATA\Programs\Zeniconic\resources\bin\ffmpeg.exe" -version
& "$env:LOCALAPPDATA\Programs\Zeniconic\resources\bin\ffprobe.exe" -version
Get-FileHash .\release\Zeniconic-Setup-1.4.0.exe -Algorithm SHA256
```

The signing trade-off, auto-update behaviour and the uninstaller script live in
`references/packaging.md`. Read it before changing `electron-builder.yml`.

## Crash recovery at a glance

```
queued → analysing → planning → rendering → reviewing → ready
                 ↘         ↘          ↘          ↘
                   failed (retryable, resumes from last completed stage)
```

| Concern | Mechanism |
|---|---|
| Metadata durability | SQLite WAL, `synchronous=NORMAL`, `busy_timeout=5000` |
| Stage state | One `job_stages` row per stage, written before and after work |
| File writes | `.tmp` → `fsync` → rename, same volume |
| Reuse | Stage outputs addressed by SHA-256 of their inputs |
| Child processes | PID + image name + start time in SQLite; `taskkill /T /F` on quit |
| Resume | First missing or failed stage; completed stages are cache hits |
| Orphan sweep | Boot-time check, kill only verified `ffmpeg.exe` from our path |

Full DDL, the atomic write helper and the sweep command are in
`references/crash-recovery.md`.

## Test ladder

| Rung | What | Gate |
|---|---|---|
| Unit | Metrics, validator, cost maths, redaction, migrations | 100 % pass, ≥85 % statements, 80 % branches |
| Golden | 3 real listings, snapshot EDLs | Byte-identical except `createdAt` and provenance counters |
| E2E | Playwright, the six-step flow | Passes on Windows CI in under 8 minutes |
| Smoke | Real 5 s render, 1080×1920, −14 LUFS | Under 90 s, ffprobe asserts exact |
| Evals | 30 scripted chat requests | ≥27/30 tool match, 30/30 invariants |
| Release | Install, first run, update, uninstall | Manual checklist, 30 minutes |

The six E2E steps: create a listing and add footage; wait for analysis; choose a
format and look; make one chat edit and apply it; preview the 8 s draft; export
one destination. The model provider is stubbed with recorded responses so the test
is free and deterministic.

## Handoff docs

| Document | Length | Reader | Must contain |
|---|---|---|---|
| Make your first video | 1 page, ≤300 words | The agent's assistant | 7 numbered steps, 3 screenshots, where the file lands |
| Troubleshooting | 8 entries | Same | Symptom in their words, cause in one line, fix in one click |
| Recording script | 5 minutes | Whoever records | Second-by-second shots and narration |
| Quick-reference card | A6, two sides | Desk | The six-step flow, 3 shortcuts, support address |

Troubleshooting entries cover: a render that seems stuck after closing the app;
a black preview that exports fine; "not enough space"; a voiceover that sounds
rushed or cuts off; missing music after a move; the SmartScreen warning; footage
not found after moving folders; and five identical exports (destinations versus
variants). Copy is second person, no jargon, no exclamation marks.

## Privacy at a glance

| Leaves the machine | Never leaves |
|---|---|
| Up to one contact sheet per shot, 1536×1024 JPEG, EXIF stripped | Source video and audio masters |
| Voice slice ≤90 s, mono 16 kHz Opus, only when captions or voice work runs | Full-resolution frames |
| EDL summary ≤8 KB: rooms, durations, scores, no address or price | Address, price, client names (except a fact you type into chat) |
| The prompt text and the editing view ≤6 KB | Model key, in plaintext or ciphertext |
| Update-check request: version, OS build, channel | File paths, usernames, project names |

The full data map, the `safeStorage` flow, the logger redaction list, the
diagnostics bundle contents and the "no analytics" position are in
`references/privacy-and-data.md`.

## Data rules

| Rule | Default | Notes |
|---|---|---|
| Projects root | `%USERPROFILE%\Documents\Zeniconic` | Changeable in Settings → Storage |
| Portability | Copy the whole root; paths are relative | Key does not travel; re-enter it |
| Backup reminder | 7 days since last copy, listing >2 GB | Non-blocking banner after export |
| Schema migration | Copy → migrate → validate → atomic replace | No down-migration |
| Disk preflight | Require ≥4.5 GB, warn <8 GB for 9 × 60 s | Formula in the reference |
| Cache ceiling | 20 GB per listing, LRU | Never evict a render referenced by a delivery |

## References

| File | Read it for |
|---|---|
| `references/packaging.md` | electron-builder config, NSIS script, signing options and costs, first-run key check, update feed, uninstall |
| `references/crash-recovery.md` | WAL pragmas, stage DDL, atomic writes, content addressing, child-process kill, resume |
| `references/testing.md` | Vitest suites, golden fixtures, Playwright flow, 5 s smoke command, CI workflow |
| `references/handoff-docs.md` | The one-pager, all 8 troubleshooting entries, the 5-minute script, the printed card |
| `references/privacy-and-data.md` | Exact outbound payloads, safeStorage, redaction, diagnostics, portability, backup, migration, disk maths |

## Verification

Run before tagging a release:

```powershell
pnpm vitest run
pnpm playwright test --project=windows
pnpm tsx services/pipeline/evals/run.ts --suite tools-v3 --mode recorded --fail-under 0.9
pnpm -C apps/desktop exec electron-builder --win nsis --x64 --publish never
powershell -File tests/smoke/render-5s.ps1
```

| Check | Pass condition |
|---|---|
| Install | Fresh Windows 11 24H2 VM, per-user, no admin, launches in <8 s |
| First run | Bad key rejected in <3 s with a plain message; good key shows its status and any credit |
| Offline | Analysis and AI editing disabled with an explanation; manual editing and export still work |
| Crash | Kill at 30/60/90 %; relaunch resumes; completed stages not repeated |
| Orphans | After kill, zero `ffmpeg.exe` children remain within 2 s |
| Atomic | No `.tmp` file is ever visible as a project file after a crash |
| Update | N-1 → N installs on quit, never mid-job; rollback to N-1 works |
| Uninstall | Projects folder survives; app data and cache removed |
| Privacy | Packet capture during analysis shows only the documented payloads |
| Migration | 1.0.0 fixture opens, migrates, renders, old copy intact |
| Portability | Move the root to another PC; projects open; key re-entered once |
| Disk | 4.0 GB free blocks with a plain message before encoding starts |
| Docs | A first-time user reaches an exported file using only the one-pager |
