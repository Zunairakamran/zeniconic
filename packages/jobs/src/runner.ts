import {
  STAGES,
  isStage,
  isTerminal,
  nextStage,
  previousStage,
} from './types';
import type { JobRecord, Stage, StageExecutor } from './types';
import { sanitiseJobRecord } from './store';
import type { JobStore } from './store';

/** Codes are for logs and tests; the UI renders `error`, not the code. */
export type JobRunnerErrorCode = 'E_JOB_ARGUMENT' | 'E_JOB_NOT_FOUND' | 'E_JOB_BAD_RESULT';

export class JobRunnerError extends Error {
  readonly code: JobRunnerErrorCode;

  constructor(code: JobRunnerErrorCode, message: string) {
    super(message);
    this.name = 'JobRunnerError';
    this.code = code;
  }
}

export interface JobRunnerOptions {
  executor: StageExecutor;
  /** Injectable clock so ids and timestamps are reproducible in tests. */
  now?: () => string;
  /** Consecutive attempts allowed per stage before the job stops retrying. */
  maxAttempts?: number;
  /**
   * Optional persistence. When supplied, every enqueue and state transition is
   * written through. A store failure never changes in-memory state: it is
   * reported through `onStoreError` (or a console warning) and the job
   * continues.
   */
  store?: JobStore;
  onStoreError?: (error: unknown, job?: JobRecord) => void;
}

function snapshot(job: JobRecord): JobRecord {
  const copy: JobRecord = { ...job };
  if (job.progress) copy.progress = { ...job.progress };
  else delete copy.progress;
  return copy;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function stageRank(stage: Stage): number {
  return STAGES.indexOf(stage);
}

/**
 * Reads cancellation through a function so TypeScript does not narrow the
 * status to `running`: `cancel()` mutates the record from outside this loop.
 */
function isCancelled(job: JobRecord, signal: AbortSignal): boolean {
  return job.status === 'cancelled' || signal.aborted;
}

/**
 * The stage a record should run next.
 *
 * `progress.percent` is the only marker for "this stage started but did not
 * finish": it lets a first-stage failure resume at `index` rather than skipping
 * to `plan`, which `stage` alone cannot express.
 *
 * Exported because the resume point is worth reporting (the job log, the UI and
 * the resume smoke test all need it) and must not be re-derived by hand: two
 * copies of this rule would drift and a resume would silently redo work.
 */
export function resumeStage(job: JobRecord): Stage {
  if (job.status === 'queued') return job.stage;
  const progress = job.progress;
  if (!progress) return nextStage(job.stage) ?? 'done';
  if (progress.percent < 100) return progress.stage;
  return nextStage(progress.stage) ?? 'done';
}

/** The last stage that finished, used to restore the resume point on failure. */
export function lastCompletedStage(job: JobRecord): Stage | undefined {
  if (job.status === 'queued') return undefined;
  const progress = job.progress;
  if (!progress) return job.stage;
  if (progress.percent >= 100) return progress.stage;
  return previousStage(progress.stage);
}

/**
 * Stage runner.
 *
 * The runner owns the state machine, not the work: an injected `StageExecutor`
 * performs one stage at a time and the runner decides what may run next. Jobs
 * live in memory; an optional `JobStore` mirrors every change to disk so a
 * relaunch can adopt them with `load()` and continue with `resumePending()`.
 */
export class JobRunner {
  private readonly executor: StageExecutor;
  private readonly now: () => string;
  private readonly maxAttempts: number;
  private readonly store?: JobStore;
  private readonly onStoreError?: (error: unknown, job?: JobRecord) => void;

  private readonly jobs = new Map<string, JobRecord>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly inFlight = new Map<string, Promise<JobRecord>>();
  private writes: Promise<void> = Promise.resolve();
  private sequence = 0;

  constructor(options: JobRunnerOptions) {
    if (typeof options.executor?.run !== 'function') {
      throw new JobRunnerError('E_JOB_ARGUMENT', 'A JobRunner needs a stage executor.');
    }
    const maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new JobRunnerError('E_JOB_ARGUMENT', 'maxAttempts must be a positive integer.');
    }
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxAttempts = maxAttempts;
    this.store = options.store;
    this.onStoreError = options.onStoreError;
  }

  /**
   * Builds a runner and adopts whatever the store already holds. Nothing is
   * executed: the caller decides what to resume.
   */
  static async hydrate(options: JobRunnerOptions): Promise<JobRunner> {
    const runner = new JobRunner(options);
    await runner.load();
    return runner;
  }

  enqueue(
    listingId: string,
    options: { kind?: 'analysis' | 'export' | 'agent'; checkpoint?: string } = {},
  ): JobRecord {
    const listing = listingId.trim();
    if (listing.length === 0) {
      throw new JobRunnerError('E_JOB_ARGUMENT', 'A job needs a listing id.');
    }

    this.sequence += 1;
    const timestamp = this.now();
    const job: JobRecord = {
      id: `job_${String(this.sequence).padStart(4, '0')}_${listing}`,
      listingId: listing,
      stage: 'index',
      status: 'queued',
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
    };

    this.jobs.set(job.id, job);
    // `enqueue` stays synchronous for existing callers; `flush()` awaits the
    // queued write when the host needs a durability barrier.
    void this.queuePersist(job);
    return snapshot(job);
  }

  /**
   * Drives a job until it is complete, failed or cancelled. A job already in
   * flight returns the same promise instead of starting a second pass.
   */
  run(jobId: string): Promise<JobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return Promise.reject(
        new JobRunnerError('E_JOB_NOT_FOUND', `No job with id "${jobId}".`),
      );
    }

    const pending = this.inFlight.get(jobId);
    if (pending) return pending;

    const promise = this.drive(job).finally(() => {
      this.inFlight.delete(jobId);
    });
    this.inFlight.set(jobId, promise);
    return promise;
  }

  /**
   * Records where a resumable job may find its source (e.g. the analysis
   * folder). Persisted through the job store when one is attached.
   */
  async setCheckpoint(jobId: string, checkpoint: string): Promise<JobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobRunnerError('E_JOB_NOT_FOUND', `No job with id "${jobId}".`);
    job.checkpoint = checkpoint;
    job.updatedAt = this.now();
    await this.persist(job);
    return snapshot(job);
  }

  /** Aborts the running stage and prevents every later stage from starting. */
  cancel(jobId: string): void {    const job = this.jobs.get(jobId);
    if (!job || isTerminal(job.status)) return;

    job.status = 'cancelled';
    job.updatedAt = this.now();
    this.controllers.get(jobId)?.abort();
    void this.queuePersist(job);
  }

  /**
   * Adopts persisted records without running them, then returns the adopted
   * snapshots in the store's order. Jobs already in flight win over the disk
   * copy, so a stale record cannot rewind live work.
   */
  async load(store: JobStore = this.requireStore()): Promise<JobRecord[]> {
    let records: JobRecord[];
    try {
      records = await store.list();
    } catch (error) {
      this.reportStoreError(error);
      records = [];
    }

    const loaded: JobRecord[] = [];
    for (const record of records) {
      this.adopt(record);
      loaded.push(snapshot(this.jobs.get(record.id) ?? record));
    }
    return loaded;
  }

  /**
   * Ids that still have work, in memory order. Complete, cancelled and
   * attempt-capped jobs are excluded.
   */
  async resumePending(): Promise<string[]> {
    const pending: string[] = [];
    for (const job of this.jobs.values()) {
      if (this.needsWork(job)) pending.push(job.id);
    }
    return pending;
  }

  /** Resolves once every store write queued so far has settled. */
  async flush(): Promise<void> {
    await this.writes;
  }

  /**
   * Adopts records (typically reloaded from disk), then resumes each one that
   * still has work left. Complete, cancelled and capped jobs are returned
   * untouched, in the order they were supplied.
   */
  async resumeAll(jobs: JobRecord[]): Promise<JobRecord[]> {
    for (const job of jobs) this.adopt(job);

    const results: JobRecord[] = [];
    for (const supplied of jobs) {
      const job = this.jobs.get(supplied.id);
      if (!job) {
        results.push(snapshot(supplied));
        continue;
      }
      if (!this.needsWork(job)) {
        results.push(snapshot(job));
        continue;
      }
      results.push(await this.run(job.id));
    }
    return results;
  }

  /** Snapshots in enqueue order; callers cannot mutate the runner's state. */
  list(): JobRecord[] {
    return [...this.jobs.values()].map(snapshot);
  }

  private async drive(job: JobRecord): Promise<JobRecord> {
    if (!this.needsWork(job)) return this.settle(job);

    // Read the resume point before the status change: a queued job starts at
    // its stage, everything else continues after the last completed one.
    let target = resumeStage(job);
    let completed = lastCompletedStage(job);
    let completedProgress = job.progress;

    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    try {
      job.status = 'running';
      job.updatedAt = this.now();
      await this.persist(job);

      for (;;) {
        if (isCancelled(job, controller.signal)) return this.settle(job);

        if (target === 'done') {
          job.stage = 'done';
          job.status = 'complete';
          job.progress = { stage: 'done', percent: 100 };
          job.updatedAt = this.now();
          await this.persist(job);
          return this.settle(job);
        }

        job.stage = target;
        job.progress = { stage: target, percent: 0 };
        job.updatedAt = this.now();
        await this.persist(job);

        let result: { stage: Stage; detail?: string };
        try {
          result = await this.executor.run(snapshot(job), controller.signal);
        } catch (error) {
          if (isCancelled(job, controller.signal)) return this.settle(job);
          this.fail(job, target, completed, completedProgress, messageOf(error));
          await this.persist(job);
          return this.settle(job);
        }

        if (isCancelled(job, controller.signal)) return this.settle(job);

        // A result that moves backwards (or names an unknown stage) cannot be
        // advanced from, so it is a deterministic failure rather than a loop.
        if (!isStage(result.stage) || stageRank(result.stage) < stageRank(target)) {
          this.fail(
            job,
            target,
            completed,
            completedProgress,
            `Executor reported "${String(result.stage)}" while running "${target}".`,
          );
          await this.persist(job);
          return this.settle(job);
        }

        completed = result.stage;
        job.stage = result.stage;
        job.attempts = 0;
        delete job.error;
        job.progress = {
          stage: result.stage,
          percent: 100,
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        };
        job.updatedAt = this.now();
        completedProgress = job.progress;
        await this.persist(job);

        target = nextStage(result.stage) ?? 'done';
      }
    } finally {
      this.controllers.delete(job.id);
    }
  }

  /**
   * True when a record still needs a run pass: not terminal and not out of
   * attempts. This is the same rule `resumeAll` has always applied.
   */
  private needsWork(job: JobRecord): boolean {
    if (isTerminal(job.status)) return false;
    return !(job.status === 'failed' && job.attempts >= this.maxAttempts);
  }

  /** Adopts one record, preserving a live in-flight job over the disk copy. */
  private adopt(job: JobRecord): void {
    if (this.inFlight.has(job.id)) return;
    const clean = sanitiseJobRecord(job) ?? job;
    this.jobs.set(clean.id, snapshot(clean));
    this.trackSequence(clean.id);
  }

  /** Keeps generated ids ahead of anything loaded from disk. */
  private trackSequence(id: string): void {
    const match = /^job_(\d+)_/.exec(id);
    const digits = match?.[1];
    if (digits === undefined) return;
    const value = Number.parseInt(digits, 10);
    if (Number.isFinite(value) && value > this.sequence) this.sequence = value;
  }

  private requireStore(): JobStore {
    if (!this.store) {
      throw new JobRunnerError(
        'E_JOB_ARGUMENT',
        'No job store is configured; pass `store` to the JobRunner.',
      );
    }
    return this.store;
  }

  /**
   * Writes a snapshot through the store, serialised with every other write.
   * The store never sees the live record, so it cannot mutate runtime state.
   */
  private queuePersist(job: JobRecord): Promise<void> {
    const store = this.store;
    if (!store) return Promise.resolve();

    const copy = snapshot(job);
    const run = this.writes.then(async () => {
      try {
        await store.put(snapshot(copy));
      } catch (error) {
        this.reportStoreError(error, copy);
      }
    });
    // Writes must never reject the chain: a transient disk failure should not
    // stop later snapshots from landing.
    this.writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persist(job: JobRecord): Promise<void> {
    await this.queuePersist(job);
  }

  /** Flushes queued writes, then hands back a snapshot. */
  private async settle(job: JobRecord): Promise<JobRecord> {
    await this.flush();
    return snapshot(job);
  }

  private reportStoreError(error: unknown, job?: JobRecord): void {
    if (this.onStoreError) {
      try {
        this.onStoreError(error, job ? snapshot(job) : undefined);
      } catch (callbackError) {
        console.warn(`[jobs] onStoreError handler threw: ${messageOf(callbackError)}`);
      }
      return;
    }
    const target = job ? ` for "${job.id}"` : '';
    console.warn(`[jobs] could not persist${target}: ${messageOf(error)}`);
  }

  private fail(
    job: JobRecord,
    failedStage: Stage,
    completed: Stage | undefined,
    completedProgress: JobRecord['progress'],
    message: string,
  ): void {
    job.attempts += 1;
    job.error = message;
    job.status = 'failed';
    // Restore the last completed progress so a resume knows where to restart;
    // before the first stage completes, the 0% marker is the only evidence.
    job.progress = completedProgress ?? { stage: failedStage, percent: 0 };
    job.stage = completed ?? failedStage;
    job.updatedAt = this.now();
  }
}
