import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobRunner, JobRunnerError } from '../src/index';
import type { JobRecord, JobStore, Stage, StageExecutor } from '../src/index';

const LISTING = '2026-11-15-14-oak-avenue';

const CREATED = '2026-11-15T10:00:00.000Z';
const UPDATED = '2026-11-15T10:00:04.000Z';

function makeClock(): () => string {
  let tick = 0;
  return () => {
    const stamp = new Date(Date.UTC(2026, 10, 15, 10, 0, tick)).toISOString();
    tick += 1;
    return stamp;
  };
}

function copy(job: JobRecord): JobRecord {
  const next: JobRecord = { ...job };
  if (job.progress) next.progress = { ...job.progress };
  else delete next.progress;
  return next;
}

function record(overrides: Partial<JobRecord> & { id: string }): JobRecord {
  return {
    listingId: overrides.id,
    stage: 'index',
    status: 'queued',
    attempts: 0,
    createdAt: CREATED,
    updatedAt: UPDATED,
    progress: { stage: 'index', percent: 0 },
    ...overrides,
  };
}

/** An in-memory store that records every put, in order. */
class FakeStore implements JobStore {
  readonly puts: JobRecord[] = [];
  seed: JobRecord[] = [];
  failPuts = false;

  async list(): Promise<JobRecord[]> {
    return this.seed.map(copy);
  }

  async put(job: JobRecord): Promise<void> {
    if (this.failPuts) throw new Error('disk full');
    this.puts.push(copy(job));
  }

  /** `status:stage:percent` per write — the easiest thing to assert on. */
  timeline(): string[] {
    return this.puts.map(
      (job) => `${job.status}:${job.stage}:${job.progress?.percent ?? '-'}`,
    );
  }
}

interface Recorder extends StageExecutor {
  calls: Stage[];
}

function recordingExecutor(): Recorder {
  const calls: Stage[] = [];
  return {
    calls,
    run: async (job) => {
      calls.push(job.stage);
      return { stage: job.stage, detail: `${job.stage} done` };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JobRunner persistence', () => {
  it('persists every stage and status transition in order', async () => {
    const store = new FakeStore();
    const runner = new JobRunner({ executor: recordingExecutor(), now: makeClock(), store });

    const queued = runner.enqueue(LISTING);
    await runner.flush();
    expect(store.puts).toEqual([queued]);

    const done = await runner.run(queued.id);

    expect(store.timeline()).toEqual([
      'queued:index:-',
      'running:index:-',
      'running:index:0',
      'running:index:100',
      'running:plan:0',
      'running:plan:100',
      'running:render:0',
      'running:render:100',
      'running:review:0',
      'running:review:100',
      'complete:done:100',
    ]);
    expect(store.puts.at(-1)).toEqual(done);
  });

  it('persists a failure with its error, attempts and resume point', async () => {
    const store = new FakeStore();
    const runner = new JobRunner({
      now: makeClock(),
      store,
      executor: {
        run: async (job) => {
          if (job.stage === 'render') throw new Error('encoder exploded');
          return { stage: job.stage };
        },
      },
    });

    const { id } = runner.enqueue(LISTING);
    await runner.run(id);

    const last = store.puts.at(-1)!;
    expect(last).toMatchObject({
      id,
      status: 'failed',
      stage: 'plan',
      attempts: 1,
      error: 'encoder exploded',
      progress: { stage: 'plan', percent: 100 },
    });
  });

  it('persists a cancellation', async () => {
    const store = new FakeStore();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const runner = new JobRunner({
      now: makeClock(),
      store,
      executor: {
        run: async (job) => {
          if (job.stage === 'render') {
            entered();
            await gate;
          }
          return { stage: job.stage };
        },
      },
    });

    const { id } = runner.enqueue(LISTING);
    const pending = runner.run(id);
    await started;

    runner.cancel(id);
    release();
    await pending;

    expect(store.puts.at(-1)).toMatchObject({ id, status: 'cancelled', stage: 'render' });
  });

  it('keeps running when the store fails, and reports each failure', async () => {
    const store = new FakeStore();
    store.failPuts = true;
    const errors: { error: unknown; job?: JobRecord }[] = [];

    const runner = new JobRunner({
      executor: recordingExecutor(),
      now: makeClock(),
      store,
      onStoreError: (error, job) => errors.push({ error, job }),
    });

    const { id } = runner.enqueue(LISTING);
    const result = await runner.run(id);

    expect(result.status).toBe('complete');
    expect(runner.list()[0]).toMatchObject({ id, status: 'complete', stage: 'done' });
    expect(store.puts).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(errors[0]?.job?.id).toBe(id);
  });

  it('falls back to a console warning when no onStoreError handler is given', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new FakeStore();
    store.failPuts = true;

    const runner = new JobRunner({ executor: recordingExecutor(), now: makeClock(), store });
    const { id } = runner.enqueue(LISTING);
    const result = await runner.run(id);

    expect(result.status).toBe('complete');
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain(id);
  });

  it('hydrates persisted jobs without running them, and reports what still needs work', async () => {
    const seed: JobRecord[] = [
      record({
        id: 'job_0001_complete',
        listingId: 'complete',
        stage: 'done',
        status: 'complete',
        progress: { stage: 'done', percent: 100 },
      }),
      record({
        id: 'job_0002_crashed',
        listingId: 'crashed',
        stage: 'render',
        status: 'running',
        attempts: 1,
        progress: { stage: 'render', percent: 0 },
      }),
      record({ id: 'job_0003_queued', listingId: 'queued' }),
      record({
        id: 'job_0004_cancelled',
        listingId: 'cancelled',
        status: 'cancelled',
        progress: { stage: 'review', percent: 100 },
      }),
      record({
        id: 'job_0005_capped',
        listingId: 'capped',
        stage: 'render',
        status: 'failed',
        attempts: 3,
        error: 'still broken',
        progress: { stage: 'plan', percent: 100 },
      }),
    ];

    const store = new FakeStore();
    store.seed = seed;
    const executor = recordingExecutor();
    const runner = new JobRunner({ executor, now: makeClock(), store });

    const loaded = await runner.load();

    expect(loaded.map((job) => job.id)).toEqual(seed.map((job) => job.id));
    expect(runner.list().map((job) => job.id)).toEqual(seed.map((job) => job.id));
    expect(executor.calls).toEqual([]);
    // Hydration is read-only: nothing is rewritten just by loading.
    expect(store.puts).toEqual([]);

    await expect(runner.resumePending()).resolves.toEqual([
      'job_0002_crashed',
      'job_0003_queued',
    ]);

    // Resuming continues at the stage the crash interrupted, not the start.
    const resumed = await runner.run('job_0002_crashed');
    expect(executor.calls).toEqual(['render', 'review']);
    expect(resumed.status).toBe('complete');
    expect(store.puts.at(-1)).toMatchObject({ id: 'job_0002_crashed', status: 'complete' });
  });

  it('hydrates through the static helper and keeps new ids unique', async () => {
    const store = new FakeStore();
    store.seed = [record({ id: 'job_0007_existing', listingId: 'existing' })];

    const runner = await JobRunner.hydrate({ executor: recordingExecutor(), now: makeClock(), store });

    expect(runner.list().map((job) => job.id)).toEqual(['job_0007_existing']);
    // The sequence continues after the persisted ids instead of restarting.
    expect(runner.enqueue('fresh').id).toBe('job_0008_fresh');
  });

  it('requires a store for load()', async () => {
    const runner = new JobRunner({ executor: recordingExecutor(), now: makeClock() });
    await expect(runner.load()).rejects.toBeInstanceOf(JobRunnerError);
    await expect(runner.load()).rejects.toMatchObject({ code: 'E_JOB_ARGUMENT' });
  });

  it('resumeAll keeps its attempt-cap semantics when a store is attached', async () => {
    const store = new FakeStore();
    let calls = 0;
    const runner = new JobRunner({
      now: makeClock(),
      maxAttempts: 1,
      store,
      executor: {
        run: async () => {
          calls += 1;
          throw new Error('deterministic');
        },
      },
    });

    const { id } = runner.enqueue(LISTING);
    const failed = await runner.run(id);
    expect(failed.attempts).toBe(1);

    const again = (await runner.resumeAll([failed]))[0]!;
    expect(again.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});
