/**
 * Persistent, append-only cost ledger.
 *
 * One JSON envelope holds every entry: `<root>/cost-ledger.json`. Writes are
 * atomic (temp file beside the target, fsync, rename), so a crash leaves either
 * the previous snapshot or the new one, never a half-written file. Reads are
 * deliberately forgiving: a missing, unreadable, corrupt or wrong-version file
 * yields an empty ledger, and a single invalid row is dropped rather than
 * failing the load. A relaunch must never be blocked by a bad byte on disk.
 *
 * Caps are never guessed here. The host reads `budgets` from
 * `services/pipeline/models.json` and passes that object to `evaluate`.
 */
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  BudgetCaps,
  CapCheckInput,
  CapEvaluation,
  CapReason,
  CostLedgerErrorCode,
  CostLedgerOptions,
  CostSummary,
  LedgerEntry,
  LedgerFile,
  RecordEntryInput,
} from './types';

/** Bumped only for an incompatible envelope change; readers reject the rest. */
export const COST_LEDGER_VERSION = 1;

export const COST_LEDGER_FILE = 'cost-ledger.json';

/** Money is compared with this slack, so 4.99 + 0.01 is not "over" a $5 cap. */
const CAP_EPSILON_USD = 1e-9;

const RENAME_RETRY_MS = 20;

export class CostLedgerError extends Error {
  readonly code: CostLedgerErrorCode;

  constructor(code: CostLedgerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CostLedgerError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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

/** Rounds to 8 dp, matching the price table's precision. */
export function roundUsd(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * Parses one entry row. Returns `undefined` for anything that cannot be
 * trusted, so a caller can drop the row instead of crashing.
 *
 * Unknown keys are discarded: the sanitised entry is what reaches the UI, so a
 * hand-edited `cost-ledger.json` cannot smuggle extra fields in.
 */
export function sanitiseLedgerEntry(value: unknown): LedgerEntry | undefined {
  if (!isRecord(value)) return undefined;

  const { id, role, model, at } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(role) || !isNonEmptyString(model)) {
    return undefined;
  }
  if (!isTimestamp(at)) return undefined;
  if (!isTokenCount(value.promptTokens) || !isTokenCount(value.completionTokens)) {
    return undefined;
  }
  if (!isMoney(value.costUsd)) return undefined;

  const entry: LedgerEntry = {
    id,
    at,
    role,
    model,
    promptTokens: value.promptTokens,
    completionTokens: value.completionTokens,
    costUsd: roundUsd(value.costUsd),
  };

  if (value.listingId !== undefined) {
    if (!isNonEmptyString(value.listingId)) return undefined;
    entry.listingId = value.listingId;
  }

  if (value.runId !== undefined) {
    if (!isNonEmptyString(value.runId)) return undefined;
    entry.runId = value.runId;
  }

  return entry;
}

function copy(entry: LedgerEntry): LedgerEntry {
  return { ...entry };
}

function buildEnvelope(entries: LedgerEntry[], updatedAt: string, nextSequence: number): LedgerFile {
  return { version: COST_LEDGER_VERSION, updatedAt, nextSequence, entries };
}

/** Reads the envelope, dropping rows that fail validation. Never throws. */
function parseEnvelope(raw: string): { entries: LedgerEntry[]; nextSequence: number } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isRecord(value) || value.version !== COST_LEDGER_VERSION || !Array.isArray(value.entries)) {
    return undefined;
  }

  const entries: LedgerEntry[] = [];
  const seen = new Set<string>();

  for (const row of value.entries) {
    const entry = sanitiseLedgerEntry(row);
    if (!entry) continue;
    // A duplicated id means the file was edited by hand or merged by accident.
    // The first row wins; the entry is append-only, so a later copy is not real.
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }

  const storedSequence = value.nextSequence;
  const nextSequence =
    isTokenCount(storedSequence) && storedSequence >= entries.length ? storedSequence : entries.length;

  return { entries, nextSequence };
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
    throw new CostLedgerError(
      'E_WRITE_FAILED',
      `Could not create ${dirname(file)}: ${errorMessage(error)}`,
      { cause: error },
    );
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
    throw new CostLedgerError('E_WRITE_FAILED', `Could not write ${file}: ${errorMessage(error)}`, {
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
        throw new CostLedgerError(
          'E_WRITE_FAILED',
          `Could not replace ${file}: ${errorMessage(retryError)}`,
          { cause: retryError },
        );
      }
    }

    await rm(tmp, { force: true }).catch(() => undefined);
    throw new CostLedgerError('E_WRITE_FAILED', `Could not replace ${file}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function resolveDate(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CostLedgerError('E_INVALID_ENTRY', `${name} is not a valid date: ${String(value)}`);
  }
  return date;
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function sameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/**
 * Deterministic id from the entry timestamp and the persisted sequence:
 * `led_20261115100000000_000004`. Two records taken in the same millisecond
 * still differ, and a byte-for-byte replay of a test produces the same ids.
 */
export function makeEntryId(at: Date, sequence: number): string {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, '');
  return `led_${stamp}_${Math.trunc(sequence).toString().padStart(6, '0')}`;
}

function assertCaps(caps: BudgetCaps): void {
  const names: Array<keyof BudgetCaps> = [
    'monthlyCapUsd',
    'dailyCapUsd',
    'perListingDefaultUsd',
    'perListingAbsoluteUsd',
  ];
  for (const name of names) {
    const value = caps[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new CostLedgerError(
        'E_BUDGET_CONFIG',
        `BudgetCaps.${name} must be a finite, non-negative number`,
      );
    }
  }
  if (caps.perListingDefaultUsd > caps.perListingAbsoluteUsd) {
    throw new CostLedgerError(
      'E_BUDGET_CONFIG',
      'BudgetCaps.perListingDefaultUsd cannot exceed perListingAbsoluteUsd',
    );
  }
}

function assertRecordInput(input: RecordEntryInput): void {
  if (!isNonEmptyString(input?.role)) {
    throw new CostLedgerError('E_INVALID_ENTRY', 'role must be a non-empty string');
  }
  if (!isNonEmptyString(input.model)) {
    throw new CostLedgerError('E_INVALID_ENTRY', 'model must be a non-empty string');
  }
  if (!isMoney(input.costUsd)) {
    throw new CostLedgerError('E_INVALID_ENTRY', 'costUsd must be a finite, non-negative number');
  }
  for (const name of ['promptTokens', 'completionTokens'] as const) {
    const value = input[name];
    if (value !== undefined && !isTokenCount(value)) {
      throw new CostLedgerError('E_INVALID_ENTRY', `${name} must be a non-negative integer`);
    }
  }
  for (const name of ['listingId', 'runId'] as const) {
    const value = input[name];
    if (value !== undefined && !isNonEmptyString(value)) {
      throw new CostLedgerError('E_INVALID_ENTRY', `${name} must be a non-empty string`);
    }
  }
}

/**
 * JSON-file cost ledger.
 *
 * The whole set lives in one file, so a record is an append to an in-memory
 * cache followed by a snapshot flush. Writes are serialised through a promise
 * chain: concurrent `record` calls queue up and every row reaches the disk, and
 * the sequence used for ids is allocated inside the same queue.
 */
export class CostLedger {
  readonly rootDir: string;
  readonly file: string;

  private readonly caps: BudgetCaps | undefined;
  private readonly clock: () => Date | string;
  private readonly warn: (message: string) => void;

  private entries: LedgerEntry[] = [];
  private nextSequence = 0;
  private initialising: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(rootDir: string, options: CostLedgerOptions = {}) {
    this.rootDir = resolve(rootDir);
    this.file = join(this.rootDir, COST_LEDGER_FILE);
    this.caps = options.caps;
    this.clock = options.clock ?? (() => new Date());
    this.warn = options.warn ?? ((message: string) => console.warn(message));
  }

  /**
   * Creates the directory and loads the file once. Safe to call repeatedly and
   * concurrently: every caller waits on the same load, so a second call can
   * never clear a cache that another record is already writing into.
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
      throw new CostLedgerError(
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
        this.warn(`[ledger] could not read ${this.file}: ${errorMessage(error)}`);
      }
      raw = undefined;
    }

    const parsed = raw === undefined ? undefined : parseEnvelope(raw);
    if (raw !== undefined && parsed === undefined) {
      this.warn(`[ledger] ignoring unreadable ${this.file}; starting with an empty ledger`);
    }

    this.entries = parsed?.entries ?? [];
    this.nextSequence = parsed?.nextSequence ?? 0;
  }

  /** Every entry in append order. Never throws: an unreadable ledger is empty. */
  async list(): Promise<LedgerEntry[]> {
    try {
      await this.init();
    } catch (error) {
      this.warn(`[ledger] could not open ${this.file}: ${errorMessage(error)}`);
      return [];
    }
    return this.entries.map(copy);
  }

  /**
   * Appends one entry and flushes the file before resolving, so a caller that
   * awaits `record` can trust the spend survived a crash. The returned entry is
   * a copy: mutating it cannot corrupt the ledger.
   */
  async record(input: RecordEntryInput): Promise<LedgerEntry> {
    assertRecordInput(input);
    await this.init();

    return this.enqueue(async () => {
      const at = resolveDate(input.at ?? this.clock(), 'at');
      const entry: LedgerEntry = {
        id: makeEntryId(at, this.nextSequence),
        at: at.toISOString(),
        role: input.role,
        model: input.model,
        promptTokens: input.promptTokens ?? 0,
        completionTokens: input.completionTokens ?? 0,
        costUsd: roundUsd(input.costUsd),
      };
      if (input.listingId !== undefined) entry.listingId = input.listingId;
      if (input.runId !== undefined) entry.runId = input.runId;

      this.entries.push(entry);
      this.nextSequence += 1;

      try {
        await this.writeSnapshot();
      } catch (error) {
        // Do not advertise a row that never reached the disk.
        this.entries.pop();
        this.nextSequence -= 1;
        throw error;
      }

      return copy(entry);
    });
  }

  /**
   * Totals for the UTC day and month containing `now`, plus the lifetime sum.
   * `entries` is the full append-ordered list so a caller can render a spend
   * table without a second read.
   */
  async summary(now: Date | string = this.clock()): Promise<CostSummary> {
    const at = resolveDate(now, 'now');
    const entries = await this.list();

    let todayUsd = 0;
    let monthUsd = 0;
    let allUsd = 0;
    let lastAt: string | undefined;

    for (const entry of entries) {
      const entryAt = new Date(entry.at);
      allUsd += entry.costUsd;
      if (sameUtcDay(entryAt, at)) todayUsd += entry.costUsd;
      if (sameUtcMonth(entryAt, at)) monthUsd += entry.costUsd;
      if (lastAt === undefined || entryAt.getTime() >= Date.parse(lastAt)) lastAt = entry.at;
    }

    const summary: CostSummary = {
      todayUsd: roundUsd(todayUsd),
      monthUsd: roundUsd(monthUsd),
      allUsd: roundUsd(allUsd),
      entries: entries.map(copy),
    };
    if (lastAt !== undefined) summary.lastAt = lastAt;
    return summary;
  }

  /**
   * Pre-flight cap check. `allowed` is true when `amountUsd` fits every cap;
   * spending exactly the remaining headroom is allowed, a cent more is not.
   *
   * The listing check only counts entries for `listingId`, and is skipped when
   * no listing is named. `listingCapUsd` raises the per-listing budget for an
   * approved listing but is always clamped to `perListingAbsoluteUsd`.
   */
  async evaluate(input: CapCheckInput): Promise<CapEvaluation> {
    const caps = input.caps ?? this.caps;
    if (!caps) {
      throw new CostLedgerError(
        'E_BUDGET_CONFIG',
        'No BudgetCaps available: pass caps to the CostLedger constructor or to evaluate().',
      );
    }
    assertCaps(caps);

    if (!isMoney(input.amountUsd)) {
      throw new CostLedgerError('E_INVALID_ENTRY', 'amountUsd must be a finite, non-negative number');
    }
    if (input.listingCapUsd !== undefined && !isMoney(input.listingCapUsd)) {
      throw new CostLedgerError(
        'E_INVALID_ENTRY',
        'listingCapUsd must be a finite, non-negative number',
      );
    }

    const at = resolveDate(input.now ?? this.clock(), 'now');
    const entries = await this.list();

    let todayUsd = 0;
    let monthUsd = 0;
    let listingUsd = 0;
    for (const entry of entries) {
      const entryAt = new Date(entry.at);
      if (sameUtcDay(entryAt, at)) todayUsd += entry.costUsd;
      if (sameUtcMonth(entryAt, at)) monthUsd += entry.costUsd;
      if (input.listingId !== undefined && entry.listingId === input.listingId) {
        listingUsd += entry.costUsd;
      }
    }

    const listingCapUsd = Math.min(
      input.listingCapUsd ?? caps.perListingDefaultUsd,
      caps.perListingAbsoluteUsd,
    );

    const remaining = {
      dailyUsd: roundUsd(Math.max(0, caps.dailyCapUsd - todayUsd)),
      monthlyUsd: roundUsd(Math.max(0, caps.monthlyCapUsd - monthUsd)),
      listingUsd: roundUsd(Math.max(0, listingCapUsd - listingUsd)),
    };

    const amountUsd = roundUsd(input.amountUsd);
    let reason: CapReason | undefined;
    if (amountUsd > remaining.monthlyUsd + CAP_EPSILON_USD) reason = 'monthly';
    else if (amountUsd > remaining.dailyUsd + CAP_EPSILON_USD) reason = 'daily';
    else if (input.listingId !== undefined && amountUsd > remaining.listingUsd + CAP_EPSILON_USD) {
      reason = 'listing';
    }

    return reason === undefined ? { allowed: true, remaining } : { allowed: false, reason, remaining };
  }

  /** Resolves once every queued write has settled. */
  async flush(): Promise<void> {
    await this.writes;
  }

  /**
   * Clears the ledger and deletes the file. For tests and QA only: there is no
   * user-facing path to erase real spend history.
   */
  async reset(): Promise<void> {
    await this.init();
    await this.enqueue(async () => {
      await rm(this.file, { force: true }).catch((error: unknown) => {
        throw new CostLedgerError(
          'E_WRITE_FAILED',
          `Could not delete ${this.file}: ${errorMessage(error)}`,
          { cause: error },
        );
      });
      await rm(`${this.file}.tmp`, { force: true }).catch(() => undefined);
      this.entries = [];
      this.nextSequence = 0;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
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
      this.entries.map(copy),
      resolveDate(this.clock(), 'updatedAt').toISOString(),
      this.nextSequence,
    );
    const data = `${JSON.stringify(envelope, null, 2)}\n`;
    await writeFileAtomic(this.file, data);
  }
}
