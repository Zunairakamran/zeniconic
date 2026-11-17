/**
 * Job contracts for the stage runner.
 *
 * A job walks `index → plan → render → review → done` exactly once. The
 * `stage` field is the job's resume point: the next stage to run while it is
 * queued, and the last stage that completed while it is running, failed or
 * complete. A failed job therefore never redoes finished work.
 */

export type Stage = 'index' | 'plan' | 'render' | 'review' | 'done';

export type JobStatus = 'queued' | 'running' | 'failed' | 'cancelled' | 'complete';

/** Which kind of work a job performs. Unset means the legacy analysis pipeline. */
export type JobKind = 'analysis' | 'export' | 'agent';

export const JOB_KINDS: readonly JobKind[] = ['analysis', 'export', 'agent'];

export const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'running',
  'failed',
  'cancelled',
  'complete',
];

/** Ordered stages. `done` is terminal, not a unit of work. */
export const STAGES: readonly Stage[] = ['index', 'plan', 'render', 'review', 'done'];

export interface JobProgress {
  stage: Stage;
  /** 0..100. 100 means the stage completed. */
  percent: number;
  detail?: string;
}

export interface JobRecord {
  id: string;
  listingId: string;
  stage: Stage;
  status: JobStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  progress?: JobProgress;
  /**
   * Additive, optional fields. Old records without them stay valid; a reader
   * must never assume they are present.
   */
  kind?: JobKind;
  /** Opaque resume token for the executor (e.g. an artifact path). */
  checkpoint?: string;
  /** Stable failure code for logs; the UI still renders `error`. */
  errorCode?: string;
}

/**
 * One stage of work. The runner calls `run` once per stage with a snapshot of
 * the job whose `stage` names the work to do, and advances to the next stage
 * when the returned stage has completed. Implementations must honour `signal`:
 * a cancelled job must stop promptly.
 */
export interface StageExecutor {
  run(job: JobRecord, signal: AbortSignal): Promise<{ stage: Stage; detail?: string }>;
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'complete' || status === 'cancelled';
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

export function isJobKind(value: unknown): value is JobKind {
  return typeof value === 'string' && (JOB_KINDS as readonly string[]).includes(value);
}

/** The stage after `stage`, or `undefined` once `done` is reached. */
export function nextStage(stage: Stage): Stage | undefined {
  const index = STAGES.indexOf(stage);
  if (index < 0 || index === STAGES.length - 1) return undefined;
  return STAGES[index + 1];
}

/** The stage before `stage`, or `undefined` for the first stage. */
export function previousStage(stage: Stage): Stage | undefined {
  const index = STAGES.indexOf(stage);
  if (index <= 0) return undefined;
  return STAGES[index - 1];
}
