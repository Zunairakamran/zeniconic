import { describe, expect, it } from 'vitest';
import { BatchError, BatchQueue } from '../src/index';
import type { BatchItem, BatchRunnerDeps } from '../src/index';

const LISTINGS = [
  '2026-11-15-14-oak-avenue',
  '2026-11-15-22-marina-walk',
  '2026-11-15-3-cedar-close',
  '2026-11-15-8-harbour-road',
  '2026-11-15-41-park-lane',
] as const;

const FOLDERS = LISTINGS.map((listingId) => `D:\\footage\\${listingId}`);

/** One second per call: deterministic timestamps without the wall clock. */
function makeClock(): () => string {
  let tick = 0;
  return () => {
    const stamp = new Date(Date.UTC(2026, 10, 15, 22, 0, tick)).toISOString();
    tick += 1;
    return stamp;
  };
}

/** Lets the queue's promise chain reach the next await point. */
async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}

interface Wait {
  jobId: string;
  signal: AbortSignal;
  resolve(result: { status: 'complete' | 'failed'; error?: string }): void;
  reject(error: unknown): void;
}

interface Harness {
  deps: BatchRunnerDeps;
  started: string[];
  waits: Wait[];
  maxActive: number;
  hasPending(jobId: string): boolean;
  isSettled(jobId: string): boolean;
  resolve(jobId: string, result?: { status: 'complete' | 'failed'; error?: string }): void;
  reject(jobId: string, error: unknown): void;
}

/**
 * A controllable stand-in for the pipeline: listing starts immediately, then
 * the test settles each job by hand so concurrency is observable.
 */
function makeHarness(
  options: { onProgress?: (item: BatchItem) => void } = {},
): Harness {
  let jobSeq = 0;
  let active = 0;
  let maxActive = 0;

  const started: string[] = [];
  const waits: Wait[] = [];
  const pending = new Map<string, Wait>();
  const settled = new Set<string>();

  function take(jobId: string): Wait {
    const wait = pending.get(jobId);
    if (!wait) throw new Error(`No job "${jobId}" is waiting for a result.`);
    pending.delete(jobId);
    settled.add(jobId);
    active -= 1;
    return wait;
  }

  const deps: BatchRunnerDeps = {
    startListing: async (listingId) => {
      jobSeq += 1;
      const jobId = `job_${jobSeq}`;
      started.push(listingId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return { jobId };
    },
    waitForJob: (jobId, signal) =>
      new Promise((resolve, reject) => {
        const wait: Wait = {
          jobId,
          signal,
          resolve: (result) => resolve(result),
          reject: (error) => reject(error),
        };
        pending.set(jobId, wait);
        waits.push(wait);
      }),
    onProgress: options.onProgress,
  };

  return {
    deps,
    started,
    waits,
    get maxActive() {
      return maxActive;
    },
    hasPending: (jobId) => pending.has(jobId),
    isSettled: (jobId) => settled.has(jobId),
    resolve: (jobId, result = { status: 'complete' }) => take(jobId).resolve(result),
    reject: (jobId, error) => take(jobId).reject(error),
  };
}

function queueFrom(
  harness: Harness,
  concurrency: number,
  clock = makeClock(),
): BatchQueue {
  return new BatchQueue(harness.deps, { concurrency, now: clock });
}

/** Settles jobs 1..total in start order; named jobs fail instead of completing. */
async function settleAll(
  harness: Harness,
  totalJobs: number,
  failures: Record<string, string> = {},
): Promise<void> {
  for (let index = 1; index <= totalJobs; index += 1) {
    const jobId = `job_${index}`;
    await flush();
    if (!harness.hasPending(jobId)) {
      if (harness.isSettled(jobId)) continue;
      throw new Error(`Job "${jobId}" never started waiting.`);
    }
    const error = failures[jobId];
    harness.resolve(
      jobId,
      error === undefined ? { status: 'complete' } : { status: 'failed', error },
    );
  }
  await flush();
}

describe('BatchQueue', () => {
  it('never runs more listings than the concurrency cap', async () => {
    const harness = makeHarness();
    const queue = queueFrom(harness, 2);
    queue.addMany(LISTINGS.map((listingId, index) => ({
      listingId,
      folder: FOLDERS[index] ?? listingId,
    })));

    const run = queue.start();
    await flush();

    expect(harness.started).toEqual([LISTINGS[0], LISTINGS[1]]);
    expect(harness.maxActive).toBe(2);
    expect(queue.list().filter((item) => item.status === 'running')).toHaveLength(2);
    expect(queue.list().filter((item) => item.status === 'queued')).toHaveLength(3);

    // A slot only reopens when a wait resolves; the third item must wait.
    harness.resolve('job_1');
    await flush();
    expect(harness.started).toEqual([LISTINGS[0], LISTINGS[1], LISTINGS[2]]);
    expect(harness.maxActive).toBe(2);
    expect(queue.summary().running).toBe(2);

    await settleAll(harness, 5);
    const items = await run;
    expect(harness.maxActive).toBe(2);
    expect(items.every((item) => item.status === 'complete')).toBe(true);
  });

  it('keeps going when one listing fails', async () => {
    const harness = makeHarness();
    const queue = queueFrom(harness, 2);
    queue.addMany(LISTINGS.map((listingId, index) => ({
      listingId,
      folder: FOLDERS[index] ?? listingId,
    })));

    const run = queue.start();
    await flush();
    expect(harness.maxActive).toBe(2);

    // Fail the first job, complete the second, then the rest.
    harness.resolve('job_1', { status: 'failed', error: 'No usable kitchen shot.' });
    await flush();
    expect(harness.started).toContain(LISTINGS[2]);
    await settleAll(harness, 5);

    const items = await run; // resolves, it does not reject
    expect(items.map((item) => item.status)).toEqual([
      'failed',
      'complete',
      'complete',
      'complete',
      'complete',
    ]);
    expect(items[0]?.error).toBe('No usable kitchen shot.');
    expect(harness.started).toEqual([...LISTINGS]);
  });

  it('turns a rejected wait into a failed item, not a rejected batch', async () => {
    const harness = makeHarness();
    const queue = queueFrom(harness, 1);
    queue.addMany([
      { listingId: LISTINGS[0], folder: FOLDERS[0] ?? 'a' },
      { listingId: LISTINGS[1], folder: FOLDERS[1] ?? 'b' },
    ]);

    const run = queue.start();
    await flush();
    harness.reject('job_1', new Error('ffmpeg exited with code 1'));
    await settleAll(harness, 2);

    const items = await run;
    expect(items.map((item) => item.status)).toEqual(['failed', 'complete']);
    expect(items[0]?.error).toBe('ffmpeg exited with code 1');
    expect(harness.started).toEqual([LISTINGS[0], LISTINGS[1]]);
  });

  it('cancel stops new work and cancels in-flight waits', async () => {
    const harness = makeHarness();
    const queue = queueFrom(harness, 1);
    queue.addMany([
      { listingId: LISTINGS[0], folder: FOLDERS[0] ?? 'a' },
      { listingId: LISTINGS[1], folder: FOLDERS[1] ?? 'b' },
      { listingId: LISTINGS[2], folder: FOLDERS[2] ?? 'c' },
    ]);

    const run = queue.start();
    await flush();
    expect(harness.started).toEqual([LISTINGS[0]]);
    expect(harness.waits).toHaveLength(1);

    queue.cancel();
    expect(harness.waits[0]?.signal.aborted).toBe(true);

    // Queued work is cancelled at once; the running item waits for its job.
    expect(queue.list().map((item) => item.status)).toEqual([
      'running',
      'cancelled',
      'cancelled',
    ]);
    expect(queue.list().every((item) => item.finishedAt !== undefined)).toBe(false);

    harness.resolve('job_1');
    await flush();

    const items = await run;
    expect(items.map((item) => item.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(items.every((item) => item.finishedAt !== undefined)).toBe(true);
    expect(harness.started).toEqual([LISTINGS[0]]);
    expect(harness.maxActive).toBe(1);
  });

  it('cancelling before start launches nothing', async () => {
    const harness = makeHarness();
    const queue = queueFrom(harness, 2);
    queue.addMany([
      { listingId: LISTINGS[0], folder: FOLDERS[0] ?? 'a' },
      { listingId: LISTINGS[1], folder: FOLDERS[1] ?? 'b' },
    ]);

    queue.cancel();
    const items = await queue.start();

    expect(items.map((item) => item.status)).toEqual(['cancelled', 'cancelled']);
    expect(harness.started).toEqual([]);
    expect(() => queue.add(LISTINGS[2], 'D:\\footage\\new')).toThrow(BatchError);
  });

  it('counts every status in the summary', async () => {
    const harness = makeHarness();
    const queue = queueFrom(harness, 1);
    queue.addMany([
      { listingId: LISTINGS[0], folder: FOLDERS[0] ?? 'a' },
      { listingId: LISTINGS[1], folder: FOLDERS[1] ?? 'b' },
      { listingId: LISTINGS[2], folder: FOLDERS[2] ?? 'c' },
    ]);

    const run = queue.start();
    await flush();
    harness.resolve('job_1', { status: 'failed', error: 'Unreadable clip.' });
    await flush(); // job_2 starts
    harness.resolve('job_2');
    await flush(); // job_3 starts
    queue.cancel();
    harness.resolve('job_3', { status: 'complete' });

    await run;
    expect(queue.summary()).toEqual({
      total: 3,
      queued: 0,
      running: 0,
      complete: 1,
      failed: 1,
      cancelled: 1,
    });
  });

  it('reports progress in state order with snapshot copies', async () => {
    const snapshots: BatchItem[] = [];
    const harness = makeHarness({
      onProgress: (item) => {
        snapshots.push(item);
      },
    });
    const queue = queueFrom(harness, 1);
    const [first, second] = queue.addMany([
      { listingId: LISTINGS[0], folder: FOLDERS[0] ?? 'a' },
      { listingId: LISTINGS[1], folder: FOLDERS[1] ?? 'b' },
    ]);

    const run = queue.start();
    await flush();
    harness.resolve('job_1');
    await flush();
    harness.resolve('job_2');
    await flush();
    await run;

    const sequence = snapshots.map((item) => ({
      id: item.id,
      status: item.status,
      jobId: item.jobId,
    }));
    expect(sequence).toEqual([
      { id: first?.id, status: 'running', jobId: undefined },
      { id: first?.id, status: 'running', jobId: 'job_1' },
      { id: first?.id, status: 'complete', jobId: 'job_1' },
      { id: second?.id, status: 'running', jobId: undefined },
      { id: second?.id, status: 'running', jobId: 'job_2' },
      { id: second?.id, status: 'complete', jobId: 'job_2' },
    ]);

    // The listener received copies, not the queue's own records.
    const live = snapshots[0];
    if (!live) throw new Error('Expected at least one progress event.');
    live.status = 'failed';
    expect(queue.list()[0]?.status).toBe('complete');
  });

  it('rejects an invalid concurrency', () => {
    const harness = makeHarness();
    for (const concurrency of [0, -1, 5, 1.5, Number.NaN]) {
      expect(() => new BatchQueue(harness.deps, { concurrency })).toThrow(BatchError);
    }
    expect(() => new BatchQueue(harness.deps, {})).not.toThrow();
  });

  it('defaults to two concurrent listings', async () => {
    const harness = makeHarness();
    const queue = new BatchQueue(harness.deps, { now: makeClock() });
    queue.addMany([
      { listingId: LISTINGS[0], folder: FOLDERS[0] ?? 'a' },
      { listingId: LISTINGS[1], folder: FOLDERS[1] ?? 'b' },
      { listingId: LISTINGS[2], folder: FOLDERS[2] ?? 'c' },
    ]);

    const run = queue.start();
    await flush();
    expect(harness.maxActive).toBe(2);

    await settleAll(harness, 3);
    await run;
  });

  it('resolves an empty queue with no events', async () => {
    let events = 0;
    const harness = makeHarness({ onProgress: () => { events += 1; } });
    const queue = queueFrom(harness, 2);

    const items = await queue.start();
    expect(items).toEqual([]);
    expect(events).toBe(0);
    expect(queue.summary()).toEqual({
      total: 0,
      queued: 0,
      running: 0,
      complete: 0,
      failed: 0,
      cancelled: 0,
    });
  });

  it('builds deterministic ids and timestamps from the injected clock', async () => {
    const runOnce = async (): Promise<{ added: BatchItem[]; items: BatchItem[] }> => {
      const harness = makeHarness();
      const queue = queueFrom(harness, 2);
      const added = queue.addMany([
        { listingId: LISTINGS[0], folder: FOLDERS[0] ?? 'a' },
        { listingId: LISTINGS[1], folder: FOLDERS[1] ?? 'b' },
        { listingId: LISTINGS[2], folder: FOLDERS[2] ?? 'c' },
      ]);
      const run = queue.start();
      await flush();
      await settleAll(harness, 3);
      return { added, items: await run };
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(first.added.map((item) => item.id)).toEqual([
      `batch_0001_${LISTINGS[0]}`,
      `batch_0002_${LISTINGS[1]}`,
      `batch_0003_${LISTINGS[2]}`,
    ]);
    expect(second).toEqual(first);
    expect(first.items[0]?.startedAt).toBe('2026-11-15T22:00:00.000Z');
  });
});
