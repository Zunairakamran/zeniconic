/**
 * Crash-kill resume smoke test.
 *
 * Proves the real thing: a genuine analysis is started in a child process, the
 * child is hard-killed (SIGKILL + `taskkill /F /T`) once the job has persisted a
 * checkpoint, and a second process loads the persisted job from `jobs.json`,
 * rebinds the source folder and resumes at the stage after the last completed
 * one — not from zero.
 *
 * Nothing in the production path is mocked: `DesktopPipeline` indexes real
 * footage with FFmpeg, `JobRunner` drives the stages and `JsonJobStore` writes
 * the checkpoint. The only harness addition is a *hold* inside the child's
 * executor wrapper: after the stage boundary the child parks instead of running
 * the next stage, which gives the parent a deterministic kill window (in the
 * app, plan/render take minutes anyway). The hold does no work and returns no
 * result — it exists only so the kill lands mid-stage.
 *
 *   npx tsx scripts/resume-smoke.ts
 *   npx tsx scripts/resume-smoke.ts --hold render --folder <dir>
 *
 * Exits 0 only when every assertion passes; otherwise prints the failure and
 * exits 1.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ffmpegPath } from '../packages/media/src/index';
import {
  JobRunner,
  JsonJobStore,
  JOB_STORE_FILE,
  lastCompletedStage,
  previousStage,
  resumeStage,
  sanitiseJobRecord,
} from '../packages/jobs/src/index';
import type { JobRecord, Stage } from '../packages/jobs/src/index';
import { JsonStore } from '../packages/store/src/index';
import { DesktopPipeline } from '../apps/desktop/pipeline';

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(here), '..');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function log(event: Record<string, unknown>): void {
  console.log(`SMOKE ${JSON.stringify(event)}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the job row straight off disk: this is the crash artifact, not a cache. */
async function readPersistedJob(root: string, jobId: string): Promise<JobRecord | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(root, JOB_STORE_FILE), 'utf8');
  } catch {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const rows = (parsed as { jobs?: unknown }).jobs;
  if (!Array.isArray(rows)) return undefined;
  for (const row of rows) {
    const job = sanitiseJobRecord(row);
    if (job?.id === jobId) return job;
  }
  return undefined;
}

/** Four short, real clips with room-named files, made with the repo FFmpeg. */
async function makeFixtureFolder(folder: string): Promise<string[]> {
  await mkdir(folder, { recursive: true });
  const clips = [
    { name: 'living-room.mp4', color: '0x2e4a62', width: 640, height: 360 },
    { name: 'kitchen.mp4', color: '0x6b4a2e', width: 640, height: 360 },
    { name: 'master-bedroom.mp4', color: '0x2e624a', width: 540, height: 960 },
    { name: 'balcony-view.mp4', color: '0x4a2e62', width: 640, height: 360 },
    { name: 'bathroom.mp4', color: '0x2e6262', width: 640, height: 360 },
    { name: 'exterior-facade.mp4', color: '0x62462e', width: 640, height: 360 },
    { name: 'living-room-view.mp4', color: '0x3a5a72', width: 640, height: 360 },
    { name: 'kitchen-island.mp4', color: '0x7a5a36', width: 640, height: 360 },
    { name: 'master-bedroom-balcony.mp4', color: '0x36725a', width: 540, height: 960 },
    { name: 'balcony-marina-view.mp4', color: '0x5a3672', width: 640, height: 360 },
  ];

  const made: string[] = [];
  for (const clip of clips) {
    const target = join(folder, clip.name);
    if (existsSync(target)) {
      made.push(target);
      continue;
    }
    const args = [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      `-i`,
      `testsrc2=size=${clip.width}x${clip.height}:rate=30:duration=10`,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=420:sample_rate=48000:duration=10',
      '-vf',
      `hue=h=8:s=1.1,drawbox=x=0:y=0:w=iw:h=ih:color=${clip.color}@0.35:t=fill`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-shortest',
      target,
    ];
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`ffmpeg exited ${String(code)} making ${clip.name}: ${stderr.slice(-400)}`));
      });
    });
    made.push(target);
  }
  return made;
}

// ---------------------------------------------------------------------------
// Child process: run the pipeline for real
// ---------------------------------------------------------------------------

interface ChildOptions {
  root: string;
  listingId: string;
  folder: string;
  /** `run` = fresh analysis; `resume` = adopt the persisted job. */
  mode: 'run' | 'resume';
  /** Stage whose executor call parks, giving the parent a kill window. */
  hold?: Stage;
}

async function childMain(options: ChildOptions): Promise<void> {
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  const store = new JsonStore(options.root);
  await store.init();
  const jobStore = new JsonJobStore(options.root);
  await jobStore.init();

  const pipeline = new DesktopPipeline({
    store,
    dataDir: options.root,
    repoRoot,
    onProgress: (event) => {
      log({
        mode: options.mode,
        event: 'progress',
        stage: event.stage,
        percent: event.percent,
        detail: event.detail,
        ms: elapsed(),
      });
    },
  });

  /** Stages actually handed to the production pipeline, in order. */
  const executed: Stage[] = [];

  let runner: JobRunner | undefined;
  const hold = options.mode === 'run' ? options.hold : undefined;

  const executor = {
    async run(job: JobRecord, signal: AbortSignal): Promise<{ stage: Stage; detail?: string }> {
      executed.push(job.stage);
      log({ mode: options.mode, event: 'stage', stage: job.stage, ms: elapsed() });

      if (hold !== undefined && job.stage === hold) {
        const persisted = await readPersistedJob(options.root, job.id);
        log({
          mode: options.mode,
          event: 'hold',
          stage: job.stage,
          ms: elapsed(),
          persisted,
          resumeAt: persisted === undefined ? undefined : resumeStage(persisted),
          lastCompleted: persisted === undefined ? undefined : lastCompletedStage(persisted),
        });
        // Park forever; the parent kills the process. A real stage here would be
        // busy for minutes, so this only makes the kill window deterministic.
        setInterval(() => undefined, 1_000);
        await new Promise<never>(() => undefined);
      }

      return pipeline.run(job, signal);
    },
  };

  if (options.mode === 'run') {
    runner = new JobRunner({ executor, store: jobStore });
    const job = runner.enqueue(options.listingId, {
      kind: 'analysis',
      checkpoint: options.folder,
    });
    log({ mode: options.mode, event: 'enqueued', jobId: job.id, checkpoint: options.folder });
    pipeline.prepareAnalysis({ jobId: job.id, listingId: options.listingId, folder: options.folder });
    await runner.flush();

    // Mirrors `analysis:start`: the contract returns immediately, the work runs
    // detached. The parent kills this process while the promise is pending.
    void runner.run(job.id).then(
      (finished) => log({ mode: options.mode, event: 'finished', status: finished.status, stage: finished.stage }),
      (error: unknown) => log({ mode: options.mode, event: 'error', error: messageOf(error) }),
    );
    return;
  }

  // Resume: hydrate from the store exactly like `main.ts` does at launch.
  runner = await JobRunner.hydrate({ executor, store: jobStore });
  const jobs = runner.list();
  const job = jobs.find((candidate) => candidate.kind === 'analysis' && candidate.checkpoint);
  if (job === undefined) {
    log({ mode: options.mode, event: 'fatal', error: 'no persisted analysis job with a checkpoint' });
    process.exitCode = 1;
    return;
  }

  const pending = await runner.resumePending();
  const checkpoint = job.checkpoint as string;
  log({
    mode: options.mode,
    event: 'loaded',
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    checkpoint,
    pending,
    resumeAt: resumeStage(job),
    lastCompleted: lastCompletedStage(job),
    ms: elapsed(),
  });

  // `main.ts` rebinds the folder from the checkpoint before resuming.
  pipeline.prepareAnalysis({ jobId: job.id, listingId: job.listingId, folder: checkpoint });

  const finished = await runner.run(job.id);
  await store
    .update(job.listingId, { status: finished.status === 'complete' ? 'ready' : 'failed' })
    .catch(() => undefined);

  log({
    mode: options.mode,
    event: 'finished',
    jobId: job.id,
    status: finished.status,
    stage: finished.stage,
    progress: finished.progress,
    error: finished.error,
    executed,
    ms: elapsed(),
  });
}

// ---------------------------------------------------------------------------
// Parent process: fixture, child, kill, resume, assertions
// ---------------------------------------------------------------------------

interface SmokeFailure {
  message: string;
  detail?: unknown;
}

class Failures {
  readonly items: SmokeFailure[] = [];

  check(condition: boolean, message: string, detail?: unknown): boolean {
    if (condition) return true;
    this.items.push({ message, ...(detail === undefined ? {} : { detail }) });
    return false;
  }

  throwIfAny(): void {
    if (this.items.length === 0) return;
    for (const item of this.items) {
      console.error(`[resume-smoke] FAIL ${item.message}`);
      if (item.detail !== undefined) {
        console.error(`[resume-smoke]      ${JSON.stringify(item.detail)}`);
      }
    }
    throw new Error(`${this.items.length} resume-smoke assertion(s) failed.`);
  }
}

interface ChildRun {
  pid: number;
  events: Array<Record<string, unknown>>;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

function spawnChild(args: string[], onEvent: (event: Record<string, unknown>) => void): {
  child: ReturnType<typeof spawn>;
  result: Promise<ChildRun>;
  collected: { events: Array<Record<string, unknown>>; stdout: string; stderr: string; startedAt: number };
} {
  const collected = { events: [] as Array<Record<string, unknown>>, stdout: '', stderr: '', startedAt: Date.now() };
  const child = spawn(
    process.execPath,
    [join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), here, ...args],
    {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ZENICONIC_REMOTION: 'off' },
    },
  );

  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    collected.stdout += text;
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('SMOKE ')) continue;
      try {
        const event = JSON.parse(line.slice('SMOKE '.length)) as Record<string, unknown>;
        collected.events.push(event);
        onEvent(event);
      } catch {
        // A non-JSON SMOKE line is noise, not a signal.
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    collected.stderr += chunk.toString();
  });

  const result = new Promise<ChildRun>((resolvePromise) => {
    child.on('error', (error) => {
      collected.stderr += `\nspawn error: ${messageOf(error)}`;
    });
    child.on('close', (code, signal) => {
      resolvePromise({
        pid: child.pid ?? -1,
        events: collected.events,
        stdout: collected.stdout,
        stderr: collected.stderr,
        code,
        signal,
        durationMs: Date.now() - collected.startedAt,
      });
    });
  });

  return { child, result, collected };
}

/** SIGKILL the child, then take the whole tree down (FFmpeg grandchildren). */
function hardKill(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
  // Windows ignores the POSIX signal for the tree; taskkill /F /T is the
  // equivalent of "the app crashed", without a shutdown handler.
  const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  killer.on('error', () => undefined);
}

function expect<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

async function parentMain(): Promise<void> {
  const holdStage = (argument('--hold') ?? 'plan') as Stage;
  const root = resolve(argument('--data') ?? join(repoRoot, 'data', 'tmp', 'resume-smoke'));
  const folder = resolve(argument('--folder') ?? join(root, 'footage'));
  const listingId = '2026-11-17-resume-smoke';
  const watchdogMs = Number(argument('--timeout-ms') ?? 5 * 60_000);
  const failures = new Failures();
  const startedAt = Date.now();
  const elapsed = (): string => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

  const watchdog = setTimeout(() => {
    console.error(`[resume-smoke] TIMEOUT after ${(watchdogMs / 1000).toFixed(0)} s — a child never reached its marker.`);
    process.exit(1);
  }, watchdogMs);

  try {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    const store = new JsonStore(root);
    await store.init();
    const clips = await makeFixtureFolder(folder);
    const listing = await store.create({
      address: 'Resume Smoke Tower, Dubai Marina',
      facts: {
        price: 'AED 1,850,000',
        beds: 3,
        baths: 2,
        sqft: 1450,
        currency: 'AED',
        confirmedAt: new Date().toISOString(),
      },
      now: new Date().toISOString(),
    });

    console.log(`[resume-smoke] data dir   ${root}`);
    console.log(`[resume-smoke] listing    ${listing.id}`);
    console.log(`[resume-smoke] footage    ${clips.length} real clips in ${folder}`);
    console.log(`[resume-smoke] hold stage ${holdStage} (kill window)`);

    // -- phase 1: start the analysis and hard-kill it mid-stage --------------

    let childHandle: ReturnType<typeof spawn> | undefined;
    let killedAt = 0;

    const phase1 = spawnChild(
      [
        '--mode',
        'run',
        '--root',
        root,
        '--listing',
        listing.id,
        '--folder',
        folder,
        '--hold',
        holdStage,
      ],
      (event) => {
        if (event.event === 'hold' && childHandle !== undefined) {
          // Kill as soon as the child says the stage boundary is persisted.
          hardKill(childHandle);
          killedAt = Date.now();
        }
      },
    );
    childHandle = phase1.child;

    const first = await phase1.result;
    console.log(
      `[resume-smoke] phase 1   exit=${String(first.code)} signal=${String(first.signal)} after ${(first.durationMs / 1000).toFixed(2)}s`,
    );

    const hold = expect(
      first.events.find((event) => event.event === 'hold'),
      'phase 1 never reported a stage hold; the analysis did not reach the kill window.',
    ) as { persisted?: JobRecord; resumeAt?: Stage; lastCompleted?: Stage; stage: Stage };

    console.log(
      `[resume-smoke] killed    ${(first.durationMs / 1000).toFixed(2)}s into phase 1, while stage "${String(
        hold.stage,
      )}" was starting`,
    );

    failures.check(killedAt !== 0, 'phase 1 was not killed (no hold event reached the parent)');
    failures.check(
      first.signal === 'SIGKILL' || (first.code !== null && first.code !== 0),
      'phase 1 exited cleanly, so the process was never hard-killed',
      { code: first.code, signal: first.signal },
    );
    failures.check(
      !first.events.some((event) => event.event === 'finished'),
      'phase 1 reported a completed job, so it was not killed mid-stage',
    );
    failures.check(
      first.events.some((event) => event.event === 'stage' && event.stage === 'index'),
      'phase 1 never ran the index stage',
    );

    // The persisted row is the crash artifact: it must still claim "running"
    // (no shutdown handler ran) and expose the completed index checkpoint.
    const crashed = expect(
      await readPersistedJob(root, String(hold.persisted?.id ?? '')),
      'jobs.json has no row for the killed job',
    );
    console.log(
      `[resume-smoke] on disk   status=${crashed.status} stage=${crashed.stage} progress=${String(
        crashed.progress?.stage,
      )}@${String(crashed.progress?.percent)}% checkpoint=${String(crashed.checkpoint)}`,
    );

    failures.check(crashed.status === 'running', 'a crash must leave the job "running", not failed/queued', {
      status: crashed.status,
    });
    failures.check(crashed.stage === holdStage, `persisted stage should be "${holdStage}"`, { stage: crashed.stage });
    failures.check(
      crashed.progress?.percent === 0,
      'the persisted stage that was killed should still be at 0% (so resume re-runs it)',
      crashed.progress,
    );
    failures.check(
      lastCompletedStage(crashed) === previousStage(holdStage),
      `the last completed stage should be "${String(previousStage(holdStage))}"`,
      { lastCompleted: lastCompletedStage(crashed) },
    );
    failures.check(
      crashed.checkpoint === folder,
      'the checkpoint should be the footage folder',
      { checkpoint: crashed.checkpoint },
    );

    const indexArtifact = join(store.dirFor(listing.id), 'footage_index.json');
    const indexed = existsSync(indexArtifact);
    failures.check(indexed, 'the index stage did not persist footage_index.json before the kill');
    const indexBefore = indexed ? (await stat(indexArtifact)).mtimeMs : 0;
    if (indexed) {
      const parsedIndex = JSON.parse(await readFile(indexArtifact, 'utf8')) as {
        clips?: Array<{ shots?: unknown[] }>;
      };
      const indexedClips = parsedIndex.clips?.length ?? 0;
      const indexedShots = (parsedIndex.clips ?? []).reduce(
        (sum, clip) => sum + (Array.isArray(clip.shots) ? clip.shots.length : 0),
        0,
      );
      console.log(
        `[resume-smoke] artifacts footage_index.json written by phase 1: ${indexedClips} clips, ${indexedShots} shots`,
      );
      failures.check(indexedClips > 0 && indexedShots > 0, 'the persisted index has no shots', {
        indexedClips,
        indexedShots,
      });
    }

    // -- phase 2: load the persisted job and resume ---------------------------

    const expectedResume = resumeStage(crashed);
    console.log(`[resume-smoke] expect    resume at "${expectedResume}"`);

    const phase2 = spawnChild(
      ['--mode', 'resume', '--root', root, '--listing', listing.id, '--folder', folder],
      () => undefined,
    );
    const second = await phase2.result;

    const loaded = expect(
      second.events.find((event) => event.event === 'loaded'),
      'phase 2 never reported the loaded job',
    ) as { resumeAt?: Stage; lastCompleted?: Stage; checkpoint?: string; status?: string; progress?: JobRecord['progress'] };

    const finished = expect(
      second.events.find((event) => event.event === 'finished'),
      'phase 2 never finished; a resumed job should run to completion',
    ) as {
      status?: string;
      stage?: string;
      executed?: Stage[];
      error?: string;
      progress?: JobRecord['progress'];
      ms?: number;
    };

    const executed: Stage[] = Array.isArray(finished.executed) ? finished.executed : [];

    console.log(
      `[resume-smoke] phase 2   exit=${String(second.code)} loaded status=${String(loaded.status)} stage progress=${String(
        loaded.progress?.stage,
      )}@${String(loaded.progress?.percent)}%`,
    );
    console.log(
      `[resume-smoke] resumed   first executed="${String(executed[0])}" executed=[${executed.join(' → ')}]`,
    );
    console.log(
      `[resume-smoke] finished  status=${String(finished.status)} stage=${String(finished.stage)} in ${(
        (finished.ms ?? 0) / 1000
      ).toFixed(1)}s`,
    );
    if (finished.error !== undefined) console.log(`[resume-smoke] error     ${finished.error}`);

    failures.check(second.code === 0, 'phase 2 exited non-zero', { code: second.code, stderr: second.stderr.slice(-800) });
    failures.check(
      loaded.resumeAt === expectedResume,
      `loaded resume point should be "${expectedResume}"`,
      { resumeAt: loaded.resumeAt },
    );
    failures.check(
      loaded.lastCompleted === previousStage(holdStage),
      `the loaded job should report "${String(previousStage(holdStage))}" as the last completed stage`,
      { lastCompleted: loaded.lastCompleted },
    );
    failures.check(
      executed[0] === expectedResume,
      `the first resumed stage should be "${expectedResume}", not "${String(executed[0])}"`,
      { executed },
    );
    failures.check(
      !executed.includes('index'),
      'the resumed run re-ran the index stage instead of starting after it',
      { executed },
    );
    failures.check(
      executed.includes('render') && executed.includes('review'),
      'the resumed run did not continue through render and review',
      { executed },
    );
    failures.check(finished.status === 'complete', 'the resumed job did not complete', {
      status: finished.status,
      error: finished.error,
    });
    failures.check(finished.stage === 'done', 'the resumed job should end at "done"', { stage: finished.stage });

    const variantDir = join(store.dirFor(listing.id), 'variants');
    const variantFiles = existsSync(variantDir)
      ? (await readdir(variantDir)).filter((name) => name.endsWith('.json'))
      : [];
    const previewDir = join(variantDir, 'previews');
    const previews = existsSync(previewDir)
      ? (await readdir(previewDir)).filter((name) => name.endsWith('.jpg'))
      : [];
    failures.check(
      variantFiles.includes('variants.json'),
      'the resumed plan stage wrote no variant plans',
      { variantFiles },
    );
    failures.check(
      previews.length >= 3,
      'the resumed render stage produced no preview stills',
      { previews },
    );

    const finalListing = await store.get(listing.id);
    failures.check(finalListing?.status === 'ready', 'the listing was not marked "ready" after resume', {
      status: finalListing?.status,
    });

    // The resumed plan stage must not re-probe footage that is provably
    // unchanged. The index carries a signature (folder + per-file size/mtime),
    // so a matching signature means reuse; a changed folder would re-index and
    // move this file's mtime.
    const indexAfter = existsSync(indexArtifact) ? (await stat(indexArtifact)).mtimeMs : 0;
    const reindexed = indexAfter !== indexBefore;
    console.log(
      `[resume-smoke] signature footage index ${reindexed ? 'RE-WRITTEN' : 'reused untouched'} by the resumed plan stage`,
    );
    failures.check(
      !reindexed,
      'the resumed plan stage re-indexed unchanged footage instead of reusing the persisted index',
      { indexBefore, indexAfter },
    );

    // Keep the evidence for inspection; `data/` is gitignored.
    await writeFile(
      join(root, 'resume-smoke.json'),
      `${JSON.stringify(
        {
          killed: { exitCode: first.code, signal: first.signal, durationMs: first.durationMs, stage: crashed, killedAt },
          resumed: { exitCode: second.code, durationMs: second.durationMs, loaded, finished, variantFiles, previews },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    failures.throwIfAny();

    console.log('');
    console.log(`[resume-smoke] PASS in ${elapsed()}`);
    console.log(
      `[resume-smoke]   phase 1 killed mid-"${holdStage}" after indexing ${clips.length} clips; ` +
        `disk said status=running stage=${crashed.stage} progress=${String(crashed.progress?.percent)}%`,
    );
    console.log(
      `[resume-smoke]   phase 2 resumed at "${String(executed[0])}" (never index) and finished ${String(finished.status)}`,
    );
  } finally {
    clearTimeout(watchdog);
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mode = argument('--mode');
  if (mode === 'run' || mode === 'resume') {
    await childMain({
      root: resolve(expect(argument('--root'), '--root is required')),
      listingId: expect(argument('--listing'), '--listing is required'),
      folder: resolve(expect(argument('--folder'), '--folder is required')),
      mode,
      hold: (argument('--hold') ?? 'plan') as Stage,
    });
    return;
  }
  await parentMain();
}

main().catch((error: unknown) => {
  console.error(`[resume-smoke] FAIL ${messageOf(error)}`);
  process.exit(1);
});
