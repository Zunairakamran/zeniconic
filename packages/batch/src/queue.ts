/**
 * In-memory batch queue.
 *
 * The queue owns scheduling, not work. `startListing` begins a listing and
 * `waitForJob` resolves when its job finishes; everything else — files, jobs,
 * rendering — stays outside this package.
 *
 * Failure isolation is the contract: one listing that fails, throws or is
 * cancelled becomes a failed or cancelled item and the queue moves on. `start`
 * resolves with the final items; it never rejects because of a listing.
 */

import type {
  BatchErrorCode,
  BatchItem,
  BatchOptions,
  BatchRunnerDeps,
  BatchStatus,
  BatchSummary,
} from './types';

const DEFAULT_CONCURRENCY = 2;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 4;

export class BatchError extends Error {
  readonly code: BatchErrorCode;

  constructor(code: BatchErrorCode, message: string) {
    super(message);
    this.name = 'BatchError';
    this.code = code;
  }
}

function snapshot(item: BatchItem): BatchItem {
  return {
    id: item.id,
    listingId: item.listingId,
    folder: item.folder,
    status: item.status,
    ...(item.jobId === undefined ? {} : { jobId: item.jobId }),
    ...(item.error === undefined ? {} : { error: item.error }),
    ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
    ...(item.finishedAt === undefined ? {} : { finishedAt: item.finishedAt }),
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BatchError('E_BATCH_ARGUMENT', `A batch item needs a ${label}.`);
  }
  return value.trim();
}

function isTerminal(status: BatchStatus): boolean {
  return status === 'complete' || status === 'failed' || status === 'cancelled';
}

export class BatchQueue {
  private readonly deps: BatchRunnerDeps;
  private readonly now: () => string;
  private readonly concurrency: number;
  private readonly controller: AbortController;
  private readonly items: BatchItem[] = [];

  private sequence = 0;
  private cancelled = false;
  private active: Promise<BatchItem[]> | null = null;

  constructor(deps: BatchRunnerDeps, options: BatchOptions = {}) {
    if (
      typeof deps?.startListing !== 'function' ||
      typeof deps?.waitForJob !== 'function'
    ) {
      throw new BatchError(
        'E_BATCH_ARGUMENT',
        'A BatchQueue needs startListing and waitForJob.',
      );
    }

    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    if (
      !Number.isInteger(concurrency) ||
      concurrency < MIN_CONCURRENCY ||
      concurrency > MAX_CONCURRENCY
    ) {
      throw new BatchError(
        'E_BATCH_ARGUMENT',
        `Batch concurrency must be a whole number from ${MIN_CONCURRENCY} to ${MAX_CONCURRENCY}, not ${String(concurrency)}.`,
      );
    }

    this.deps = deps;
    this.now = options.now ?? (() => new Date().toISOString());
    this.concurrency = concurrency;
    this.controller = new AbortController();
  }

  add(listingId: string, folder: string): BatchItem {
    if (this.cancelled) {
      throw new BatchError(
        'E_BATCH_CANCELLED',
        'The batch was cancelled; no further listings can be added.',
      );
    }

    const listing = requireText(listingId, 'listing id');
    const path = requireText(folder, 'folder');

    this.sequence += 1;
    const item: BatchItem = {
      id: `batch_${String(this.sequence).padStart(4, '0')}_${listing}`,
      listingId: listing,
      folder: path,
      status: 'queued',
    };

    this.items.push(item);
    return snapshot(item);
  }

  /** Adds every item or none: a malformed entry rejects the whole call. */
  addMany(items: Array<{ listingId: string; folder: string }>): BatchItem[] {
    if (this.cancelled) {
      throw new BatchError(
        'E_BATCH_CANCELLED',
        'The batch was cancelled; no further listings can be added.',
      );
    }

    const prepared = items.map((entry) => ({
      listingId: requireText(entry.listingId, 'listing id'),
      folder: requireText(entry.folder, 'folder'),
    }));

    return prepared.map((entry) => this.add(entry.listingId, entry.folder));
  }

  /**
   * Runs until nothing is queued or running. Calling it again while a pass is
   * in flight returns the same promise; items added later are picked up by the
   * loop. The returned promise always resolves, even after failures or cancel.
   */
  start(): Promise<BatchItem[]> {
    if (this.active) return this.active;

    // Deferred so a progress listener cannot re-enter the scheduler before the
    // in-flight marker is set.
    const run = Promise.resolve().then(() => this.drain());
    this.active = run.finally(() => {
      this.active = null;
    });
    return this.active;
  }

  /**
   * Aborts the one signal every waiter shares, marks queued items cancelled,
   * and lets running items turn cancelled when their wait resolves. No later
   * item starts.
   */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controller.abort();

    for (const item of this.items) {
      if (item.status === 'queued') this.finish(item, 'cancelled');
    }
  }

  /** Snapshot in insertion order; callers cannot mutate the queue. */
  list(): BatchItem[] {
    return this.items.map(snapshot);
  }

  summary(): BatchSummary {
    const counts: BatchSummary = {
      total: this.items.length,
      queued: 0,
      running: 0,
      complete: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const item of this.items) {
      switch (item.status) {
        case 'queued':
          counts.queued += 1;
          break;
        case 'running':
          counts.running += 1;
          break;
        case 'complete':
          counts.complete += 1;
          break;
        case 'failed':
          counts.failed += 1;
          break;
        case 'cancelled':
          counts.cancelled += 1;
          break;
      }
    }

    return counts;
  }

  private async drain(): Promise<BatchItem[]> {
    const active = new Set<Promise<void>>();

    try {
      for (;;) {
        if (this.cancelled) break;

        while (active.size < this.concurrency) {
          const next = this.items.find((item) => item.status === 'queued');
          if (!next) break;

          const work = this.runItem(next).catch(() => {
            // runItem records its own failures; the queue must keep draining.
          });
          const tracked: Promise<void> = work.finally(() => {
            active.delete(tracked);
          });
          active.add(tracked);
        }

        if (active.size === 0) break;
        await Promise.race(active);
      }
    } finally {
      // A cancel stops new work but still waits for running items so the
      // caller receives their final (cancelled) state.
      await Promise.allSettled(active);
    }

    return this.list();
  }

  private async runItem(item: BatchItem): Promise<void> {
    item.status = 'running';
    item.startedAt = this.now();
    this.emit(item);

    try {
      const started = await this.deps.startListing(item.listingId, item.folder);

      // The job began after cancel: do not wait on it, and report the item as
      // cancelled rather than leaving it running forever.
      if (this.cancelled) {
        this.finish(item, 'cancelled');
        return;
      }

      item.jobId = started.jobId;
      this.emit(item);

      const result = await this.deps.waitForJob(started.jobId, this.controller.signal);

      if (this.cancelled) {
        this.finish(item, 'cancelled');
        return;
      }

      if (result.status === 'complete') {
        this.finish(item, 'complete');
      } else {
        this.finish(item, 'failed', result.error);
      }
    } catch (error) {
      if (this.cancelled) {
        this.finish(item, 'cancelled');
        return;
      }
      this.finish(item, 'failed', messageOf(error));
    }
  }

  /** Applies a terminal status once; later resolutions are ignored. */
  private finish(
    item: BatchItem,
    status: 'complete' | 'failed' | 'cancelled',
    error?: string,
  ): void {
    if (isTerminal(item.status)) return;

    item.status = status;
    if (status === 'failed') {
      if (error === undefined) delete item.error;
      else item.error = error;
    } else {
      delete item.error;
    }
    item.finishedAt = this.now();
    this.emit(item);
  }

  /** Listeners get a copy; a throwing listener never stops the batch. */
  private emit(item: BatchItem): void {
    const listener = this.deps.onProgress;
    if (!listener) return;
    try {
      listener(snapshot(item));
    } catch {
      // Progress is advisory. A broken UI callback is not a listing failure.
    }
  }
}
