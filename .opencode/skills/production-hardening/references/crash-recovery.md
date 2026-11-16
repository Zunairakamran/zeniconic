# Crash recovery

The promise is concrete: **kill the app at any moment and the next launch continues from the last completed stage, without re-spending money or re-encoding finished work.** A render that starts from zero is a bug, not bad luck.

Three mechanisms carry it: a write-ahead SQLite database, atomic writes with content-addressed outputs, and a child-process registry that survives the parent.

## What survives what

| Failure | Survives | Lost | Recovery |
|---|---|---|---|
| App killed mid-render | All completed stages and segments | The segment in flight | Resume on next launch |
| Power loss during a write | Previous complete file | The uncommitted temp file | Temp ignored, stage retried |
| ffmpeg crashes | Earlier segments | Current segment | Retry the segment |
| Disk fills | DB and completed outputs | The write in progress | Free space, retry |
| Windows reboots for update | Everything committed | In-flight work | Resume banner |
| SQLite corruption | Last WAL checkpoint | Recent progress rows | `integrity_check`, restore backup |

## SQLite

Set these once, at open, before any statement:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA wal_autocheckpoint = 1000;
```

WAL lets the renderer write progress while the UI reads, without blocking. `NORMAL` is durable across an app crash; on power loss SQLite may lose the last transaction but cannot corrupt the database. `FULL` would fsync every progress row and make the renderer wait for the disk.

The database lives at the projects root, so a folder copy is a backup: `%USERPROFILE%\Documents\Zeniconic\zeniconic.db`, with `-wal` and `-shm` siblings. On clean quit run `PRAGMA wal_checkpoint(TRUNCATE)`. Never copy the `.db` while the app runs; use `VACUUM INTO 'backup.db'`.

## Stage state

One row per job and stage, plus one row per render segment. `unit_key` is empty for stage-level rows and the segment index for segment rows.

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, variant_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN
    ('queued','analysing','planning','rendering','reviewing','ready','failed')),
  attempt INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE job_stages (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN
    ('probe','scenes','index','tag','score','plan','draft','segment','composite','mux','review','package')),
  unit_key TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('pending','running','done','failed')),
  output_hash TEXT, attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, ended_at TEXT,
  PRIMARY KEY (job_id, stage, unit_key)
);
CREATE TABLE child_processes (
  pid INTEGER PRIMARY KEY, image TEXT NOT NULL, started_at TEXT NOT NULL,
  job_id TEXT, stage TEXT
);
```

Transitions are single statements in a transaction: `beginStage` sets `running`, `started_at=now`, `attempt=attempt+1`; `finishStage` sets `done`, `output_hash`, `ended_at`; `failStage` sets `failed` and writes `jobs.last_error`.

On boot, before any job is shown:

```sql
UPDATE job_stages SET state = 'failed', ended_at = datetime('now') WHERE state = 'running';
```

The stage is marked retryable and the UI says "Interrupted by app exit". The resume banner then lists every job in `analysing`, `planning`, `rendering` or `reviewing`.

## Atomic writes

Every JSON, subtitle, sidecar and manifest goes through one helper. Media is written by ffmpeg to `.part`, then renamed by the same helper.

```ts
export async function writeAtomic(file: string, data: Buffer | string) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const fh = await fs.open(tmp, 'w');
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  for (let i = 0; i < 3; i++) {
    try { await fs.rename(tmp, file); return; }
    catch (e: any) {
      if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
      await new Promise(r => setTimeout(r, 50));
    }
  }
  throw new Error(`Could not replace ${file}; it may be open in another program.`);
}
```

The temp file sits in the **same directory**, so the rename is same-volume and atomic. Never write to `%TEMP%` and move across drives. Keep the name distinctive so a startup sweep can delete `*.tmp` older than an hour. A rename that still fails after three retries fails the stage; it never truncates the destination.

## Content addressing

A stage output is named by the SHA-256 of its canonical inputs, not by a timestamp:

```
data/listings/2026-11-14-14-oak-avenue/cache/stages/plan/9c1f4a2b.json
data/listings/2026-11-14-14-oak-avenue/cache/segments/4b91c0de.mp4
data/listings/2026-11-14-14-oak-avenue/renders/edl_8f2a1c07.mp4
```

The key includes stage name, input hashes, model IDs, prompt versions and pipeline version. If the file exists and its size and hash verify, it is a hit and costs nothing. A corrupt entry is deleted and recomputed, with one log line naming the hash. A plan failure reuses the footage index; a copy change reuses every segment and the audio bed.

GC keeps every stage referenced by a current EDL, every render referenced by a delivery, and the last three renders per variant. The per-listing cache ceiling is 20 GB, evicted least-recently-used. Deletion moves to the recycle bin for 24 hours, so a mistaken GC is recoverable.

## Child processes

Spawn hidden and record the PID before reading a byte:

```ts
const child = spawn(ffmpeg, args, { windowsHide: true });
db.prepare(`INSERT INTO child_processes (pid, image, started_at, job_id, stage)
            VALUES (?, 'ffmpeg.exe', ?, ?, ?)`)
  .run(child.pid!, new Date().toISOString(), jobId, stage);
child.on('exit', () => db.prepare('DELETE FROM child_processes WHERE pid = ?').run(child.pid!));
```

On quit, before the app exits, run `taskkill /PID 4242 /T /F` for every recorded row. `/T` kills the tree; `/F` is required on Windows. Do not rely on `child.kill()`: it sends a signal the process may ignore, and the parent may be gone before it lands.

On boot, verify before killing, because PID reuse is real:

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = 4242" |
  Select-Object Name, CreationDate, ExecutablePath
```

Kill only if `Name` is `ffmpeg.exe`, `ExecutablePath` starts with the app's `resources\bin`, and `CreationDate` is within two minutes of the recorded start. Otherwise delete the row and leave the process alone. A support sweep for a stuck child:

```powershell
Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" |
  Where-Object { $_.ExecutablePath -like "$env:LOCALAPPDATA\Programs\Zeniconic\*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

A Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is worth adding as a second line of defence; the registry and sweep are the baseline.

## Resume

1. Flip every `running` stage to `failed` with "Interrupted by app exit".
2. Show "Pick up where you left off" with the listing name, the last completed stage and estimated minutes remaining.
3. Walk stages in order: `done` with a valid output hash is a skip; `failed` or `pending` runs.
4. Within `segment`, skip segments whose hash verifies; render the missing ones; run `composite` only when all are present.
5. Never re-run `probe`, `scenes`, `index`, `tag` or `score` because a later stage failed.
6. Resume is idempotent: twice produces the same EDL and render hash.

Granularity is stage-level by contract and segment-level within a render. The default is four segments per variant, so the worst case is one segment of lost work, typically 10–40 seconds of encode. Do not promise frame-level resume; the encoder does not support it across processes.

## Failure taxonomy

| Stage | Typical cause | Retryable | What the user is told |
|---|---|---|---|
| `probe` | Corrupt or truncated file | No | "This file can't be read. Remove it or replace it with a copy." |
| `tag` | Network or provider 5xx | Yes | "The connection dropped. Retrying in 20 seconds." |
| `plan` | Invalid model JSON twice | Yes | "The edit didn't come through. Try again, or pick a shot yourself." |
| `segment` | Disk full | Yes, after space | "There isn't enough space. Free 3 GB and continue." |
| `composite` | Out of memory | Yes, concurrency 1 | "The machine ran out of memory. Closing other apps will help." |
| `mux` | Output open in a player | Yes | "Close the video player and try again." |
| `review` | Model timeout | Yes | "The quality check timed out. The video is still safe to preview." |
| `package` | Path too long | No | "The file name is too long for this folder. Shorten it." |

## Verification

| Test | Pass condition |
|---|---|
| Kill at 30/60/90 % | Resume; no completed stage re-runs; lost work ≤ one segment |
| Kill during a JSON write | Target is old or new, never partial |
| `integrity_check` after `taskkill /F` | `ok`; WAL replays |
| Orphan sweep | Zero `ffmpeg.exe` from our bin within 2 s of quit |
| PID reuse | A foreign process with a recycled PID is not killed |
| Content address | Second run: zero stage misses, zero model spend |
| Corrupt cache | One bad file recomputed; the rest are hits |
| Idempotent resume | Two resumes produce the same EDL and render hash |

```powershell
node services/pipeline/cli.mjs resume --job job_7f3a2c91
node services/pipeline/cli.mjs db-check --db "$env:USERPROFILE\Documents\Zeniconic\zeniconic.db"
Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Measure-Object
```
