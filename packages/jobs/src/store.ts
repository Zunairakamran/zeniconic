/**
 * Persistent job storage.
 *
 * One JSON envelope holds every job: `<root>/jobs.json`. The file is written
 * atomically (temp file in the same directory, fsync, rename over the target),
 * so a crash either leaves the previous snapshot or the new one — never a
 * half-written file. Reads are deliberately forgiving: a missing, unreadable
 * or corrupt file yields an empty list, and a single invalid row is dropped
 * rather than failing the whole load. A relaunch must never be blocked by a
 * bad byte on disk.
 */
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isJobKind, isJobStatus, isStage } from './types';
import type { JobRecord } from './types';

/** Bumped only for an incompatible envelope change; readers reject the rest. */
export const JOB_STORE_VERSION = 1;

export const JOB_STORE_FILE = 'jobs.json';

/** The on-disk shape. `jobs` preserves insertion order. */
export interface JobStoreFile {
  version: 1;
  updatedAt: string;
  jobs: JobRecord[];
}

export interface JobStore {
  list(): Promise<JobRecord[]>;
  put(job: JobRecord): Promise<void>;
  /** Optional: not every backend supports deletion. */
  remove?(id: string): Promise<void>;
}

export type JobStoreErrorCode = 'E_WRITE_FAILED' | 'E_INVALID_JOB';

export class JobStoreError extends Error {
  readonly code: JobStoreErrorCode;

  constructor(code: JobStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'JobStoreError';
    this.code = code;
  }
}

const RENAME_RETRY_MS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code: unknown = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Parses one job row. Returns `undefined` for anything that cannot be trusted,
 * so a caller can drop the row instead of crashing.
 *
 * Unknown keys are discarded: the sanitised record is what gets handed to the
 * runner, so a hand-edited `jobs.json` cannot smuggle extra fields in.
 */
export function sanitiseJobRecord(value: unknown): JobRecord | undefined {
  if (!isRecord(value)) return undefined;

  const { id, listingId } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(listingId)) return undefined;

  const stage = value.stage;
  if (typeof stage !== 'string' || !isStage(stage)) return undefined;
  if (!isJobStatus(value.status)) return undefined;

  const attempts = value.attempts;
  if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) {
    return undefined;
  }

  const { createdAt, updatedAt } = value;
  if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) return undefined;

  const record: JobRecord = {
    id,
    listingId,
    stage,
    status: value.status,
    attempts,
    createdAt,
    updatedAt,
  };

  if (value.error !== undefined) {
    if (typeof value.error !== 'string') return undefined;
    record.error = value.error;
  }

  if (value.progress !== undefined) {
    const progress = value.progress;
    if (!isRecord(progress)) return undefined;
    const progressStage = progress.stage;
    if (typeof progressStage !== 'string' || !isStage(progressStage)) return undefined;
    const percent = progress.percent;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      return undefined;
    }
    record.progress = { stage: progressStage, percent };
    if (progress.detail !== undefined) {
      if (typeof progress.detail !== 'string') return undefined;
      record.progress.detail = progress.detail;
    }
  }

  if (value.kind !== undefined) {
    if (!isJobKind(value.kind)) return undefined;
    record.kind = value.kind;
  }

  if (value.checkpoint !== undefined) {
    if (typeof value.checkpoint !== 'string') return undefined;
    record.checkpoint = value.checkpoint;
  }

  if (value.errorCode !== undefined) {
    if (typeof value.errorCode !== 'string') return undefined;
    record.errorCode = value.errorCode;
  }

  return record;
}

function copy(job: JobRecord): JobRecord {
  const next: JobRecord = { ...job };
  if (job.progress) next.progress = { ...job.progress };
  else delete next.progress;
  return next;
}

function buildEnvelope(jobs: JobRecord[], updatedAt: string): JobStoreFile {
  return { version: JOB_STORE_VERSION, updatedAt, jobs };
}

/** Reads the envelope, dropping rows that fail validation. Never throws. */
function parseEnvelope(raw: string): JobRecord[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isRecord(value) || value.version !== JOB_STORE_VERSION || !Array.isArray(value.jobs)) {
    return undefined;
  }

  const jobs: JobRecord[] = [];
  const seen = new Set<string>();

  for (const row of value.jobs) {
    const job = sanitiseJobRecord(row);
    if (!job) continue;
    // A duplicated id is untrustworthy; the first row wins.
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    jobs.push(job);
  }

  return jobs;
}

/**
 * Atomic write: temp file beside the target, fsync, rename. A failure cleans
 * up the temp file and leaves any previous snapshot untouched.
 */
async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp`;

  try {
    await mkdir(dirname(file), { recursive: true });
  } catch (error) {
    throw new JobStoreError('E_WRITE_FAILED', `Could not create ${dirname(file)}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new JobStoreError('E_WRITE_FAILED', `Could not write ${file}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  try {
    await rename(tmp, file);
  } catch (error) {
    // Windows can hold the destination briefly (antivirus, indexer, another
    // handle). One short retry covers the common case; a second failure is real.
    if (errorCode(error) === 'EPERM' || errorCode(error) === 'EBUSY') {
      await delay(RENAME_RETRY_MS);
      try {
        await rename(tmp, file);
        return;
      } catch (retryError) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw new JobStoreError(
          'E_WRITE_FAILED',
          `Could not replace ${file}: ${errorMessage(retryError)}`,
          { cause: retryError },
        );
      }
    }

    await rm(tmp, { force: true }).catch(() => undefined);
    throw new JobStoreError('E_WRITE_FAILED', `Could not replace ${file}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * JSON-file job store.
 *
 * The whole set lives in one file, so `put` is a read-modify-write of an
 * in-memory cache: the first operation loads the file once, then every write
 * flushes the cache. Writes are serialised through a promise chain, which
 * keeps concurrent stage updates from overwriting each other.
 */
export class JsonJobStore implements JobStore {
  readonly rootDir: string;
  readonly file: string;

  private readonly clock: () => string;
  private readonly jobs = new Map<string, JobRecord>();
  private initialising: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(rootDir: string, clock: () => string = () => new Date().toISOString()) {
    this.rootDir = resolve(rootDir);
    this.file = join(this.rootDir, JOB_STORE_FILE);
    this.clock = clock;
  }

  /**
   * Creates the directory and loads the file once. Safe to call repeatedly and
   * concurrently: every caller waits on the same load, so a second call can
   * never clear a cache that another put is already writing into.
   */
  async init(): Promise<void> {
    if (!this.initialising) {
      const run = this.load();
      this.initialising = run;
      run.catch(() => {
        // A failed load may be transient (a locked directory); let the next
        // call try again instead of pinning the rejection forever.
        if (this.initialising === run) this.initialising = null;
      });
    }
    await this.initialising;
  }

  private async load(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true }).catch((error: unknown) => {
      throw new JobStoreError(
        'E_WRITE_FAILED',
        `Could not create ${this.rootDir}: ${errorMessage(error)}`,
        { cause: error },
      );
    });

    let raw: string | undefined;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        console.warn(`[jobs] could not read ${this.file}: ${errorMessage(error)}`);
      }
      raw = undefined;
    }

    const parsed = raw === undefined ? [] : parseEnvelope(raw);
    if (parsed === undefined) {
      console.warn(`[jobs] ignoring unreadable ${this.file}; starting with no persisted jobs`);
    }

    this.jobs.clear();
    for (const job of parsed ?? []) this.jobs.set(job.id, job);
  }

  /** Persisted jobs in insertion order. Never throws: an unreadable store is empty. */
  async list(): Promise<JobRecord[]> {
    try {
      await this.init();
    } catch (error) {
      console.warn(`[jobs] could not open ${this.file}: ${errorMessage(error)}`);
      return [];
    }
    return [...this.jobs.values()].map(copy);
  }

  async put(job: JobRecord): Promise<void> {
    const sanitised = sanitiseJobRecord(job);
    if (!sanitised) {
      throw new JobStoreError('E_INVALID_JOB', `Job "${String(job?.id)}" is not a valid record.`);
    }

    await this.init();

    await this.enqueue(async () => {
      const previous = this.jobs.get(sanitised.id);
      // Updating an existing id keeps its position: job order is stable across
      // restarts, so the UI list does not reshuffle after every stage.
      this.jobs.set(sanitised.id, sanitised);
      try {
        await this.writeSnapshot();
      } catch (error) {
        // Do not advertise a record that never reached the disk.
        if (previous) this.jobs.set(sanitised.id, previous);
        else this.jobs.delete(sanitised.id);
        throw error;
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.init();

    await this.enqueue(async () => {
      const previous = this.jobs.get(id);
      if (!previous) return;
      this.jobs.delete(id);
      try {
        await this.writeSnapshot();
      } catch (error) {
        this.jobs.set(id, previous);
        throw error;
      }
    });
  }

  /** Resolves once every queued write has settled. */
  async flush(): Promise<void> {
    await this.writes;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.writes.then(task);
    // A failed write must not poison later ones: keep the chain resolved.
    this.writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async writeSnapshot(): Promise<void> {
    const envelope = buildEnvelope(
      [...this.jobs.values()].map(copy),
      this.clock(),
    );
    const data = `${JSON.stringify(envelope, null, 2)}\n`;
    await writeFileAtomic(this.file, data);
  }
}
