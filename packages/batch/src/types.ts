/**
 * Batch contracts.
 *
 * A batch is a queue of listings, not a folder of jobs (`docs/SPEC.md` §4.9):
 * each item names one listing and one footage folder, and the queue owns only
 * the scheduling state — the workspace, the job and the render belong to the
 * caller's injected functions.
 */

export type BatchStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface BatchItem {
  id: string;
  listingId: string;
  folder: string;
  status: BatchStatus;
  jobId?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface BatchOptions {
  /** Simultaneous listings. Default 2, clamped by validation to 1..4. */
  concurrency?: number;
  /** Injectable clock so ids and timestamps are reproducible in tests. */
  now?: () => string;
}

export interface BatchRunnerDeps {
  startListing(listingId: string, folder: string): Promise<{ jobId: string }>;
  waitForJob(
    jobId: string,
    signal: AbortSignal,
  ): Promise<{ status: 'complete' | 'failed'; error?: string }>;
  /** Called with a snapshot after every observable change to an item. */
  onProgress?: (item: BatchItem) => void;
}

export interface BatchSummary {
  total: number;
  queued: number;
  running: number;
  complete: number;
  failed: number;
  cancelled: number;
}

/** Codes are for logs and tests; the UI renders `error` and `status`. */
export type BatchErrorCode = 'E_BATCH_ARGUMENT' | 'E_BATCH_CANCELLED';
