import { describe, expect, it } from 'vitest';
import { JobRunner, JobRunnerError } from '../src/index';
import type { JobRecord, Stage, StageExecutor } from '../src/index';

const LISTING = '2026-11-15-14-oak-avenue';

/** A clock that advances one second per call, so every record is reproducible. */
function makeClock(): () => string {
  let tick = 0;
  return () => {
    const stamp = new Date(Date.UTC(2026, 10, 15, 10, 0, tick)).toISOString();
    tick += 1;
    return stamp;
  };
}

interface Recorder extends StageExecutor {
  calls: Stage[];
}

/** Records every stage it is asked to run and succeeds immediately. */
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

describe('JobRunner', () => {
  it('walks every stage in order on the happy path', async () => {
    const executor = recordingExecutor();
    const runner = new JobRunner({ executor, now: makeClock() });

    const queued = runner.enqueue(LISTING);
    expect(queued).toMatchObject({
      listingId: LISTING,
      stage: 'index',
      status: 'queued',
      attempts: 0,
    });
    expect(queued.createdAt).toBe(queued.updatedAt);

    const done = await runner.run(queued.id);

    expect(executor.calls).toEqual(['index', 'plan', 'render', 'review']);
    expect(done.status).toBe('complete');
    expect(done.stage).toBe('done');
    expect(done.attempts).toBe(0);
    expect(done.error).toBeUndefined();
    expect(done.progress).toEqual({ stage: 'done', percent: 100 });
    expect(runner.list().find((job) => job.id === queued.id)).toEqual(done);
  });

  it('records a failure and resumes at the next stage, not from the start', async () => {
    const calls: Stage[] = [];
    let failRender = true;
    const runner = new JobRunner({
      now: makeClock(),
      executor: {
        run: async (job) => {
          calls.push(job.stage);
          if (job.stage === 'render' && failRender) throw new Error('encoder exploded');
          return { stage: job.stage };
        },
      },
    });

    const { id } = runner.enqueue(LISTING);
    const failed = await runner.run(id);

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('encoder exploded');
    expect(failed.attempts).toBe(1);
    // `plan` is the last completed stage; `render` is the one to retry.
    expect(failed.stage).toBe('plan');
    expect(failed.progress).toEqual({ stage: 'plan', percent: 100 });

    failRender = false;
    const resumed = (await runner.resumeAll([failed]))[0]!;

    expect(calls).toEqual(['index', 'plan', 'render', 'render', 'review']);
    expect(resumed.status).toBe('complete');
    expect(resumed.stage).toBe('done');
    expect(resumed.attempts).toBe(0);
    expect(resumed.error).toBeUndefined();
  });

  it('resumes a first-stage failure at index instead of skipping it', async () => {
    const calls: Stage[] = [];
    let fail = true;
    const runner = new JobRunner({
      now: makeClock(),
      executor: {
        run: async (job) => {
          calls.push(job.stage);
          if (fail) throw new Error('folder disappeared');
          return { stage: job.stage };
        },
      },
    });

    const { id } = runner.enqueue(LISTING);
    const failed = await runner.run(id);
    expect(failed.stage).toBe('index');
    expect(failed.progress).toEqual({ stage: 'index', percent: 0 });

    fail = false;
    const resumed = (await runner.resumeAll([failed]))[0]!;
    expect(calls).toEqual(['index', 'index', 'plan', 'render', 'review']);
    expect(resumed.status).toBe('complete');
  });

  it('caps consecutive attempts at three per stage', async () => {
    const calls: Stage[] = [];
    const runner = new JobRunner({
      now: makeClock(),
      executor: {
        run: async (job) => {
          calls.push(job.stage);
          throw new Error('still broken');
        },
      },
    });

    const { id } = runner.enqueue(LISTING);
    const first = await runner.run(id);
    expect(first.attempts).toBe(1);

    const second = (await runner.resumeAll([first]))[0]!;
    expect(second.attempts).toBe(2);

    const third = (await runner.resumeAll([second]))[0]!;
    expect(third.attempts).toBe(3);

    const capped = (await runner.resumeAll([third]))[0]!;
    expect(capped.attempts).toBe(3);
    expect(capped.status).toBe('failed');
    expect(calls).toEqual(['index', 'index', 'index']);
  });

  it('cancelling mid-run aborts the signal and never starts the next stage', async () => {
    const calls: Stage[] = [];
    let running: AbortSignal | undefined;
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
      executor: {
        run: async (job, signal) => {
          calls.push(job.stage);
          if (job.stage === 'render') {
            running = signal;
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

    expect(running?.aborted).toBe(false);
    runner.cancel(id);
    expect(running?.aborted).toBe(true);

    release();
    const cancelled = await pending;

    expect(cancelled.status).toBe('cancelled');
    expect(calls).toEqual(['index', 'plan', 'render']);
    expect(runner.list()).toHaveLength(1);
    expect(runner.list()[0]?.status).toBe('cancelled');
  });

  it('cancelling before a run means no stage ever executes', async () => {
    const executor = recordingExecutor();
    const runner = new JobRunner({ executor, now: makeClock() });

    const { id } = runner.enqueue(LISTING);
    runner.cancel(id);
    const result = await runner.run(id);

    expect(result.status).toBe('cancelled');
    expect(executor.calls).toEqual([]);
  });

  it('resumeAll ignores complete and cancelled jobs', async () => {
    const calls: Stage[] = [];
    const runner = new JobRunner({
      now: makeClock(),
      executor: {
        run: async (job) => {
          calls.push(job.stage);
          return { stage: job.stage };
        },
      },
    });

    const complete = runner.enqueue('listing-complete');
    const cancelled = runner.enqueue('listing-cancelled');
    const queued = runner.enqueue('listing-queued');

    await runner.run(complete.id);
    runner.cancel(cancelled.id);
    calls.length = 0;

    // Supply stale snapshots: resumeAll adopts the list it is given.
    const stale = [
      { ...runner.list().find((job) => job.id === complete.id)! },
      { ...runner.list().find((job) => job.id === cancelled.id)! },
      { ...runner.list().find((job) => job.id === queued.id)! },
    ];
    const results = await runner.resumeAll(stale);

    expect(results.map((job) => job.status)).toEqual(['complete', 'cancelled', 'complete']);
    expect(calls).toEqual(['index', 'plan', 'render', 'review']);
  });

  it('resumes a crashed running job at the stage it was working on', async () => {
    const calls: Stage[] = [];
    const runner = new JobRunner({
      now: makeClock(),
      executor: {
        run: async (job) => {
          calls.push(job.stage);
          return { stage: job.stage };
        },
      },
    });

    // The shape a store would hand back after a hard kill during render.
    const crashed: JobRecord = {
      id: 'job_0001_2026-11-15-oak',
      listingId: '2026-11-15-oak',
      stage: 'render',
      status: 'running',
      attempts: 1,
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:04.000Z',
      progress: { stage: 'render', percent: 0 },
    };

    const resumed = (await runner.resumeAll([crashed]))[0]!;

    expect(calls).toEqual(['render', 'review']);
    expect(resumed.status).toBe('complete');
    expect(resumed.stage).toBe('done');
  });

  it('does not leak internal state through list()', async () => {
    const runner = new JobRunner({ executor: recordingExecutor(), now: makeClock() });
    const { id } = runner.enqueue(LISTING);

    const listed = runner.list()[0]!;
    listed.status = 'failed';
    listed.stage = 'done';

    expect(runner.list()[0]).toMatchObject({ id, status: 'queued', stage: 'index' });
  });

  it('produces identical ids and timestamps for identical runs', async () => {
    const runOnce = async (): Promise<JobRecord[]> => {
      const runner = new JobRunner({ executor: recordingExecutor(), now: makeClock() });
      const first = runner.enqueue(LISTING);
      const second = runner.enqueue('2026-11-15-8-harbour-walk');
      await runner.run(first.id);
      await runner.run(second.id);
      return runner.list();
    };

    const left = await runOnce();
    const right = await runOnce();

    expect(left).toEqual(right);
    expect(left.map((job) => job.id)).toEqual([
      `job_0001_${LISTING}`,
      'job_0002_2026-11-15-8-harbour-walk',
    ]);
    expect(left[0]?.createdAt).toBe('2026-11-15T10:00:00.000Z');
  });

  it('rejects unknown job ids with a typed error', async () => {
    const runner = new JobRunner({ executor: recordingExecutor(), now: makeClock() });
    await expect(runner.run('job_9999_missing')).rejects.toBeInstanceOf(JobRunnerError);
    await expect(runner.run('job_9999_missing')).rejects.toMatchObject({
      code: 'E_JOB_NOT_FOUND',
    });
    expect(() => runner.enqueue('   ')).toThrow(JobRunnerError);
  });

  it('stops retrying once the attempt cap is reached on run()', async () => {
    let calls = 0;
    const runner = new JobRunner({
      now: makeClock(),
      maxAttempts: 1,
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

    const again = (await runner.resumeAll([{ ...failed, status: 'failed' }]))[0]!;
    expect(again.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});
