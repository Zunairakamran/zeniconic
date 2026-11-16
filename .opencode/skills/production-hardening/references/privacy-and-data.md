# Privacy and data

Local-first is a promise with a list attached. The list is short, exact and shown
in the app under **Settings → Privacy**, not buried in a policy page.

**Media stays on the machine.** What leaves is derivative and bounded: contact sheets, short voice slices, EDL summaries, prompt text, and the update check's version metadata. No video, no master audio, no full-resolution frame, no address book.

## Data map

| Data | Where it lives | Leaves? |
|---|---|---|
| Source clips | `listings/2026-11-14-14-oak-avenue/raw/` | No |
| Footage index | `listings/2026-11-14-14-oak-avenue/footage_index.json` | No |
| Contact sheets | `listings/2026-11-14-14-oak-avenue/cache/contact-sheets/` | Yes, when tagging runs |
| EDLs and revisions | `listings/2026-11-14-14-oak-avenue/edl/`, SQLite | Summary only |
| Renders and deliveries | `listings/2026-11-14-14-oak-avenue/renders/`, `deliveries/` | No |
| Facts (price, address, phone) | SQLite `facts` | No |
| Model key | `%APPDATA%\Zeniconic\secrets.bin` | No |
| Logs | `%LOCALAPPDATA%\Zeniconic\logs\` | No |
| Telemetry | Does not exist | No |

## What leaves, exactly

| Payload | When | Content and size | Destination |
|---|---|---|---|
| Contact sheet | Analysis, one per shot | 1536×1024 JPEG q80, EXIF stripped, 180–400 KB | OpenRouter → pinned vision model |
| Voice slice | Captions or voice work only | ≤90 s, mono 16 kHz Opus 24 kbps, ≈270 KB; typical 20–30 s | OpenRouter → pinned audio model |
| EDL summary | Planning, review, chat | ≤8 KB JSON: format, look, duration, ordered rooms, scores, overlay kinds | OpenRouter → pinned planning model |
| Prompt and editing view | Every AI turn | ≤6 KB text, clip ids, rooms, in/out, scores, reasons | OpenRouter → pinned planning model |
| Update check | Launch and every 6 h | Version, OS build, arch, channel; no identifier | `updates.zeniconic.app` |

Contact sheets can contain anything visible in the frame, including a house number or a street sign. They are sent only for the shots being tagged, at 1536×1024, never as full-resolution frames.

OpenRouter routes to the pinned provider in `services/pipeline/models.json`. Retention is set by that provider; the Privacy panel names the route used for the last job and links its policy. The app requests zero retention where the route supports it, and does not claim it where it does not.

Never sent: video, audio masters, GPS, full paths, client names, the facts record, or sheets for shots that are not being tagged. A fact you type into chat is sent as prompt text; the confirmed record itself is not.

## Key storage

The key is encrypted with Electron `safeStorage` (DPAPI on Windows, bound to the current Windows user). The ciphertext lives at `%APPDATA%\Zeniconic\secrets.bin`; the plaintext exists only in the main process for the duration of a request. If `safeStorage.isEncryptionAvailable()` is false, keep the key in memory for the session and say so; never fall back to plaintext on disk.

| Rule | Reason |
|---|---|
| Never send the key to the renderer | A compromised renderer must not read it |
| Never put it in the EDL, a log, a crash dump or diagnostics | It would leak on the first support email |
| IPC returns status and usage only | `key:test` returns `{ ok, label, limitUsd, usageUsd }` |
| Clear deletes the file | `key:clear` deletes `secrets.bin` and the in-memory copy |
| No secure storage means session-only | Warn once; never fall back to plaintext |
| The key does not travel with projects | DPAPI is per user and per machine; re-enter after a move |

Rotating a key is a paste-and-test; it affects future calls only. No re-render is
needed because the key is not part of any cache key.

## Log redaction

Redaction happens in the logger's serialisers, before bytes reach disk. The pino `redact.paths` list is `*.apiKey`, `*.key`, `*.token`, `*.authorization`, `*.cookie`, `*.password`, all censored to `<redacted>`.

| Value | Replacement |
|---|---|
| `C:\Users\amy\Videos\kitchen.mp4` | `%USERPROFILE%\Videos\kitchen.mp4` |
| `£795,000` | `<price>` |
| `14 Oak Avenue, SW19` | `<address>` |
| `020 7946 0812` | `<phone>` |
| `sk-or-v1-4f2a1b9c` | `<key>` |
| `2026-11-14-14-oak-avenue` | `<listing:8f2a1c>` |

Prompts, editing views, model responses and EDL bodies are never logged, at any level. Electron `crashReporter` is off by default; if a user opts in, it may contain memory fragments, which the dialog says plainly.

Test: feed a fixture containing a key, a price, an address and a username through every logger call, then `Select-String` the log for each literal. Zero hits.

## Copy diagnostics

The button sits in **Help** and on every error card. It builds a zip of at most 2 MB, shows the file list, and lets the user deselect. It never uploads; the user sends it.

| Included | Excluded |
|---|---|
| App, Electron, Node and OS build; locale; GPU vendor | Media, contact sheets, audio, renders |
| Last 200 redacted log lines | API key, tokens, cookies |
| Job and stage state without paths | Address, price, phone, client names |
| EDL hashes, versions and a redacted EDL | Full EDL text fields |
| `ffprobe` report: codec, timebase, duration, stream count | The file name and folder |
| Disk free, RAM, CPU cores | Usernames, machine name, IP |
| Model IDs, prompt versions, last 10 ledger rows | Provider credentials |

The zip is named `zeniconic-diagnostics-2026-11-15-9c41ab02.zip`. The UI says: "This contains what the app was doing, not your videos. Check the list before you send it."

## No analytics

There is no telemetry SDK, no device identifier, no usage event, no session recording, no A/B assignment. The only background request is the update check. It is disclosed, it sends version, OS build, arch and channel only, and it has an off switch; turning it off gives a manual **Check for updates** button.

Crash reports are opt-in, default off. Website download analytics are separate from the app and disclosed on the download page. The update server sees an IP address, as any HTTPS request does; it is kept for 7 days in the access log and not joined to anything.

## Portability

The projects root defaults to `%USERPROFILE%\Documents\Zeniconic` and holds
everything that matters:

```
Zeniconic/
  zeniconic.db        jobs, facts, revisions, ledger (WAL siblings alongside)
  listings/2026-11-14-14-oak-avenue/
    raw/                source clips, copied at intake, never modified
    footage_index.json  edl/  renders/  deliveries/
    cache/              regenerable; excluded from backups
```

All EDL `src` values are relative to `raw/`. SQLite stores relative paths plus a `roots` table resolved at open; absolute paths are not stored in the EDL or the database. Moving to another PC is: close the app, copy the folder, open the app, **Settings → Storage → Locate**, pick the folder.

On locate, verify size and SHA-256 of the first 1 MiB of each source, then a full hash in the background. A missing file opens **Relink**, which matches by content hash, so renamed files still resolve. The model key does not move; enter it once.

OneDrive, Dropbox and network shares are allowed but discouraged during a render: sync clients lock files mid-write. The app warns once.

## Backup

No cloud backup is built in. After an export, if the last copy is older than 7
days and the listing is over 2 GB, a non-blocking banner says: "Last backup 9 days
ago. Copy this folder to your backup drive." Buttons: **Show folder**, **Remind
me later**.

An append-only copy that skips the cache. Close the app first, so the database is not mid-write:

```powershell
robocopy "$env:USERPROFILE\Documents\Zeniconic" "E:\Backups\Zeniconic" `
  /E /XD cache /R:2 /W:2 /LOG+:"E:\Backups\zeniconic-backup.log"
```

`/E` copies without deleting anything at the destination. Never use `/MIR` for a
user's only backup: a mistake at the source becomes a mistake in the backup.
Restore is a copy back plus **Locate**. Keep the last two copies, on two media, one
off-site if the client's footage is irreplaceable.

## Schema migration

`edlVersion` is a `const` in `packages/edl/schema.json`. Bumping it requires a
schema change, a migration and a fixture for every prior version.

1. Copy the EDL to `listings/2026-11-14-14-oak-avenue/migrations/backup/edl_cinematic-calm_v3.json`.
2. Run the ordered migrations in `services/pipeline/migrations/`, for example
   `1.0.0_to_1.1.0.ts`.
3. Validate the result against the new schema, including the runtime invariants.
4. Write atomically, then record `migrated_from` and `migrated_at` in SQLite
   `edl_revisions`. Never add a migration field to the EDL itself:
   `additionalProperties: false` forbids it.
5. On failure, leave the original untouched, mark the project **Needs attention**
   and say which variant could not be opened.

Migrations are forward-only and idempotent. An older app refuses a newer EDL with
a plain message instead of guessing. Export is blocked until every variant in the
project migrates. Take a full project copy before migrating a batch.

Test per version: duration within ±0.05 s, clip count unchanged, every
`review.checks` id preserved, and a render that passes `loudness` and
`text_safe_area`. Byte-identical output is required only for a no-op migration.

## Disk preflight

Check before the job, and again before each segment. A render that fills the disk
mid-write is a corrupt segment and a lost afternoon.

```
peak = outputs + intermediates + sidecars
require = 2 × peak + 2 GB reserve
```

| Output | Bitrate | 60 s file |
|---|---|---|
| `vertical-social` 1080×1920 | 8 Mbps | 60 MB |
| `feed-portrait` 1080×1350 | 6 Mbps | 45 MB |
| `landscape` 1920×1080 | 10 Mbps | 75 MB |
| `pin` 1000×1500 | 4 Mbps | 30 MB |
| Intermediate segment | 25 Mbps | 188 MB per 60 s |

A 9-file job is 3 variants × 3 destinations at 60 s: 540 MB of outputs, 564 MB of
intermediates, 18 MB of sidecars — 1,122 MB peak. Require 4.5 GB free; warn below
8 GB. Block with "Free 4.5 GB, or move the project to another drive" before the
first frame. Mid-render, below 1 GB free, pause and keep the completed segments.

Intake checks the same way: source bytes × 1.1 + 2 GB, because the clips are
copied into the project folder.

## Verification

| Check | Pass condition |
|---|---|
| Packet capture | Only OpenRouter and the update host; no media bytes |
| Payload size | Contact sheet ≤400 KB, voice slice ≤300 KB, summary ≤8 KB |
| Key grep | No `sk-or-` in any log, EDL, diagnostic or crash dump |
| Diagnostics | Zip ≤2 MB; no media, key, address, price or full path |
| Off switch | Update check off means zero background requests |
| Move | Copy the root to another PC; every project opens; key re-entered |
| Relink | Rename a source file; content hash still resolves it |
| Migration | 1.0.0 fixture opens, migrates, renders; backup byte-identical |
| Disk | 4.0 GB free blocks before encoding; 8 GB warns; 1 GB mid-render pauses |
| Backup | `robocopy /E /XD cache` copies deliveries and omits cache |
