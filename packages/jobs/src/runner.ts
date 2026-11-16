import {
  STAGES,
  isStage,
  isTerminal,
  nextStage,
  previousStage,
} from './types';
import type { JobRecord, Stage, StageExecutor } from './types';

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
 */
function nextStageToRun(job: JobRecord): Stage {
  if (job.status === 'queued') return job.stage;
  const progress = job.progress;
  if (!progress) return nextStage(job.stage) ?? 'done';
  if (progress.percent < 100) return progress.stage;
  return nextStage(progress.stage) ?? 'done';
}

/** The last stage that finished, used to restore the resume point on failure. */
function completedStage(job: JobRecord): Stage | undefined {
  if (job.status === 'queued') return undefined;
  const progress = job.progress;
  if (!progress) return job.stage;
  if (progress.percent >= 100) return progress.stage;
  return previousStage(progress.stage);
}

/**
 * In-memory stage runner.
 *
 * The runner owns the state machine, not the work: an injected `StageExecutor`
 * performs one stage at a time and the runner decides what may run next. Jobs
 * are stored in memory here; persisting them is the store layer's job.
 */
export class JobRunner {
  private readonly executor: StageExecutor;
  private readonly now: () => string;
  private readonly maxAttempts: number;

  private readonly jobs = new Map<string, JobRecord>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly inFlight = new Map<string, Promise<JobRecord>>();
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
  }

  enqueue(listingId: string): JobRecord {
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
    };

    this.jobs.set(job.id, job);
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

  /** Aborts the running stage and prevents every later stage from starting. */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || isTerminal(job.status)) return;

    job.status = 'cancelled';
    job.updatedAt = this.now();
    this.controllers.get(jobId)?.abort();
  }

  /**
   * Adopts records (typically reloaded from disk), then resumes each one that
   * still has work left. Complete, cancelled and capped jobs are returned
   * untouched, in the order they were supplied.
   */
  async resumeAll(jobs: JobRecord[]): Promise<JobRecord[]> {
    for (const job of jobs) {
      if (!this.inFlight.has(job.id)) this.jobs.set(job.id, snapshot(job));
    }

    const results: JobRecord[] = [];
    for (const supplied of jobs) {
      const job = this.jobs.get(supplied.id);
      if (!job) {
        results.push(snapshot(supplied));
        continue;
      }
      const capped = job.status === 'failed' && job.attempts >= this.maxAttempts;
      if (isTerminal(job.status) || capped) {
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
    if (isTerminal(job.status)) return snapshot(job);
    if (job.status === 'failed' && job.attempts >= this.maxAttempts) return snapshot(job);

    // Read the resume point before the status change: a queued job starts at
    // its stage, everything else continues after the last completed one.
    let target = nextStageToRun(job);
    let completed = completedStage(job);
    let completedProgress = job.progress;

    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    job.status = 'running';
    job.updatedAt = this.now();

    try {
      for (;;) {
        if (isCancelled(job, controller.signal)) return snapshot(job);

        if (target === 'done') {
          job.stage = 'done';
          job.status = 'complete';
          job.progress = { stage: 'done', percent: 100 };
          job.updatedAt = this.now();
          return snapshot(job);
        }

        job.stage = target;
        job.progress = { stage: target, percent: 0 };
        job.updatedAt = this.now();

        let result: { stage: Stage; detail?: string };
        try {
          result = await this.executor.run(snapshot(job), controller.signal);
        } catch (error) {
          if (isCancelled(job, controller.signal)) return snapshot(job);
          this.fail(job, target, completed, completedProgress, messageOf(error));
          return snapshot(job);
        }

        if (isCancelled(job, controller.signal)) return snapshot(job);

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
          return snapshot(job);
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

        target = nextStage(result.stage) ?? 'done';
      }
    } finally {
      this.controllers.delete(job.id);
    }
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
