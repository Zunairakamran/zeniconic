import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import type {
  CreateListingInput,
  Facts,
  ListingRecord,
  ListingStatus,
  Store,
} from './types';
import {
  InvalidAddressError,
  isValidListingId,
  listingIdFor,
  listingPaths,
  listingsDirectory,
  normaliseTimestamp,
  resolveRootDir,
} from './paths';
import type { ListingPaths } from './types';

export type StoreErrorCode =
  | 'E_NOT_FOUND'
  | 'E_CORRUPT_RECORD'
  | 'E_INVALID_INPUT'
  | 'E_INVALID_PATCH'
  | 'E_WRITE_FAILED'
  | 'E_DELETE_FAILED'
  | 'E_ID_EXHAUSTED';

/** Every store failure carries a stable, greppable `code`. */
export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
    this.code = code;
  }
}

const LISTING_STATUSES: readonly ListingStatus[] = [
  'draft',
  'analysing',
  'ready',
  'exported',
  'failed',
];

const CURRENCIES: readonly Facts['currency'][] = ['AED', 'GBP', 'USD', 'EUR'];

/**
 * A listing bought in Dubai is priced in dirhams. The store never invents a
 * currency when the patch names one, but an intake that leaves it blank must
 * not silently relabel an AED listing as GBP.
 */
const AED_ADDRESS = /\b(dubai|uae|united arab emirates|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/i;

export function currencyForAddress(address: string): Facts['currency'] {
  return AED_ADDRESS.test(address) ? 'AED' : 'GBP';
}

const RECORD_FILE = 'listing.json';
const RENAME_RETRY_MS = 20;
const MAX_ID_ATTEMPTS = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isListingStatus(value: unknown): value is ListingStatus {
  return typeof value === 'string' && (LISTING_STATUSES as readonly string[]).includes(value);
}

function isCurrency(value: unknown): value is Facts['currency'] {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code: unknown = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function corrupt(id: string, reason: string): StoreError {
  return new StoreError('E_CORRUPT_RECORD', `Listing "${id}" is unreadable: ${reason}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFacts(value: unknown, id: string): Facts {
  if (!isRecord(value)) {
    throw corrupt(id, 'facts is not an object');
  }

  const address = value.address;
  if (typeof address !== 'string' || address.trim().length === 0) {
    throw corrupt(id, 'facts.address is missing');
  }

  const currency = value.currency;
  if (!isCurrency(currency)) {
    throw corrupt(id, 'facts.currency is not AED, GBP, USD or EUR');
  }

  const facts: Facts = { address, currency };

  const price = value.price;
  if (price !== undefined) {
    if (typeof price !== 'string') throw corrupt(id, 'facts.price is not a string');
    facts.price = price;
  }

  for (const key of ['beds', 'baths', 'sqft'] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw corrupt(id, `facts.${key} is not a finite number`);
    }
    facts[key] = raw;
  }

  const confirmedAt = value.confirmedAt;
  if (confirmedAt !== undefined) {
    if (!isTimestamp(confirmedAt)) throw corrupt(id, 'facts.confirmedAt is not an ISO timestamp');
    facts.confirmedAt = confirmedAt;
  }

  return facts;
}

/** Parses one record, validating every field a consumer relies on. */
function parseRecord(raw: string, id: string): ListingRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw corrupt(id, 'file is not valid JSON');
  }

  if (!isRecord(value)) throw corrupt(id, 'root value is not an object');
  if (value.version !== 1) throw corrupt(id, `unsupported version ${String(value.version)}`);
  if (value.id !== id) throw corrupt(id, 'id does not match its folder');

  const address = value.address;
  if (typeof address !== 'string' || address.trim().length === 0) {
    throw corrupt(id, 'address is missing');
  }

  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  if (!isTimestamp(createdAt)) throw corrupt(id, 'createdAt is not an ISO timestamp');
  if (!isTimestamp(updatedAt)) throw corrupt(id, 'updatedAt is not an ISO timestamp');

  const status = value.status;
  if (!isListingStatus(status)) throw corrupt(id, `unknown status ${String(status)}`);

  const clipCount = value.clipCount;
  if (typeof clipCount !== 'number' || !Number.isInteger(clipCount) || clipCount < 0) {
    throw corrupt(id, 'clipCount is not a non-negative integer');
  }

  const record: ListingRecord = {
    version: 1,
    id,
    address,
    createdAt,
    updatedAt,
    status,
    facts: parseFacts(value.facts, id),
    clipCount,
  };

  const notes = value.notes;
  if (notes !== undefined) {
    if (typeof notes !== 'string') throw corrupt(id, 'notes is not a string');
    record.notes = notes;
  }

  const lastError = value.lastError;
  if (lastError !== undefined) {
    if (typeof lastError !== 'string') throw corrupt(id, 'lastError is not a string');
    record.lastError = lastError;
  }

  return record;
}

async function readRecordFile(
  paths: ListingPaths,
  id: string,
): Promise<ListingRecord | undefined> {
  let raw: string;
  try {
    raw = await readFile(paths.record, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  return parseRecord(raw, id);
}

/**
 * Writes `listing.json` atomically: temp file in the same directory, fsync,
 * then rename over the target. A failed write never leaves the temp behind.
 */
async function writeRecord(paths: ListingPaths, record: ListingRecord): Promise<void> {
  const tmp = `${paths.record}.tmp`;
  const data = `${JSON.stringify(record, null, 2)}\n`;

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
    throw new StoreError('E_WRITE_FAILED', `Could not write ${paths.record}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  try {
    await rename(tmp, paths.record);
  } catch (error) {
    // Windows can briefly lock the destination (antivirus, indexer, another
    // handle). One short retry covers the common case; a second failure is real.
    if (errorCode(error) === 'EPERM') {
      await delay(RENAME_RETRY_MS);
      try {
        await rename(tmp, paths.record);
        return;
      } catch (retryError) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw new StoreError(
          'E_WRITE_FAILED',
          `Could not replace ${paths.record}: ${errorMessage(retryError)}`,
          { cause: retryError },
        );
      }
    }

    await rm(tmp, { force: true }).catch(() => undefined);
    throw new StoreError('E_WRITE_FAILED', `Could not replace ${paths.record}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/** Returns false when the directory already exists (the collision signal). */
async function reserveDirectory(dir: string): Promise<boolean> {
  try {
    await mkdir(dir);
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false;
    throw new StoreError('E_WRITE_FAILED', `Could not create ${dir}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function buildFacts(address: string, patch: Partial<Facts> | undefined): Facts {
  if (patch !== undefined && !isRecord(patch)) {
    throw new StoreError('E_INVALID_INPUT', 'facts must be an object');
  }

  // The listing address is canonical; `facts.address` mirrors it.
  const facts: Facts = { address, currency: currencyForAddress(address) };
  if (patch === undefined) return facts;

  if (patch.address !== undefined && typeof patch.address !== 'string') {
    throw new StoreError('E_INVALID_INPUT', 'facts.address must be a string');
  }
  if (patch.price !== undefined) {
    if (typeof patch.price !== 'string') {
      throw new StoreError('E_INVALID_INPUT', 'facts.price must be a string');
    }
    facts.price = patch.price;
  }
  for (const key of ['beds', 'baths', 'sqft'] as const) {
    const raw = patch[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new StoreError('E_INVALID_INPUT', `facts.${key} must be a finite number`);
    }
    facts[key] = raw;
  }
  if (patch.currency !== undefined) {
    if (!isCurrency(patch.currency)) {
      throw new StoreError('E_INVALID_INPUT', 'facts.currency must be AED, GBP, USD or EUR');
    }
    facts.currency = patch.currency;
  }
  if (patch.confirmedAt !== undefined) {
    if (typeof patch.confirmedAt !== 'string') {
      throw new StoreError('E_INVALID_INPUT', 'facts.confirmedAt must be an ISO timestamp');
    }
    facts.confirmedAt = normaliseTimestamp(patch.confirmedAt);
  }

  return facts;
}

function mergeFacts(current: Facts, patch: Partial<Facts> | undefined, address: string): Facts {
  if (patch !== undefined && !isRecord(patch)) {
    throw new StoreError('E_INVALID_PATCH', 'facts must be an object');
  }

  const next: Facts = { ...current, address };
  if (patch === undefined) return next;

  if (patch.address !== undefined && typeof patch.address !== 'string') {
    throw new StoreError('E_INVALID_PATCH', 'facts.address must be a string');
  }
  if (patch.price !== undefined) {
    if (typeof patch.price !== 'string') {
      throw new StoreError('E_INVALID_PATCH', 'facts.price must be a string');
    }
    next.price = patch.price;
  }
  for (const key of ['beds', 'baths', 'sqft'] as const) {
    const raw = patch[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new StoreError('E_INVALID_PATCH', `facts.${key} must be a finite number`);
    }
    next[key] = raw;
  }
  if (patch.currency !== undefined) {
    if (!isCurrency(patch.currency)) {
      throw new StoreError('E_INVALID_PATCH', 'facts.currency must be AED, GBP, USD or EUR');
    }
    next.currency = patch.currency;
  }
  if (patch.confirmedAt !== undefined) {
    if (typeof patch.confirmedAt !== 'string') {
      throw new StoreError('E_INVALID_PATCH', 'facts.confirmedAt must be an ISO timestamp');
    }
    next.confirmedAt = normaliseTimestamp(patch.confirmedAt);
  }

  return next;
}

/**
 * JSON-file store. One directory per listing; atomic writes; no process-wide
 * state, so two instances on different roots never see each other.
 */
export class JsonStore implements Store {
  readonly rootDir: string;
  private readonly clock: () => string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(rootDir: string, clock: () => string = () => new Date().toISOString()) {
    this.rootDir = resolveRootDir(rootDir);
    this.clock = clock;
  }

  async init(): Promise<void> {
    await mkdir(listingsDirectory(this.rootDir), { recursive: true });
  }

  async list(): Promise<ListingRecord[]> {
    await this.init();
    const entries = await readdir(listingsDirectory(this.rootDir), { withFileTypes: true });
    const records: ListingRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidListingId(entry.name)) continue;

      const paths = listingPaths(this.rootDir, entry.name);
      try {
        const record = await readRecordFile(paths, entry.name);
        if (record !== undefined) records.push(record);
      } catch (error) {
        if (error instanceof StoreError && error.code === 'E_CORRUPT_RECORD') {
          console.warn(`[store] skipping ${RECORD_FILE} for "${entry.name}": ${error.message}`);
          continue;
        }
        throw error;
      }
    }

    records.sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id.localeCompare(a.id),
    );
    return records;
  }

  async get(id: string): Promise<ListingRecord | undefined> {
    const paths = listingPaths(this.rootDir, id);
    return readRecordFile(paths, id);
  }

  async create(input: CreateListingInput): Promise<ListingRecord> {
    if (typeof input.address !== 'string' || input.address.trim().length === 0) {
      throw new InvalidAddressError(String(input.address));
    }

    const now = normaliseTimestamp(input.now ?? this.clock());
    const baseId = listingIdFor(input.address, now);
    const facts = buildFacts(input.address, input.facts);

    await this.init();

    for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt += 1) {
      const id = attempt === 1 ? baseId : `${baseId}-${attempt}`;
      const paths = listingPaths(this.rootDir, id);

      // mkdir without `recursive` is the collision test: the winner of a race
      // gets the base id, every other caller gets the next suffix.
      if (!(await reserveDirectory(paths.dir))) continue;

      const record: ListingRecord = {
        version: 1,
        id,
        address: input.address,
        createdAt: now,
        updatedAt: now,
        status: 'draft',
        facts,
        clipCount: 0,
      };

      try {
        await mkdir(paths.media, { recursive: true });
        await mkdir(paths.cache, { recursive: true });
        await writeRecord(paths, record);
      } catch (error) {
        await rm(paths.dir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }

      return record;
    }

    throw new StoreError(
      'E_ID_EXHAUSTED',
      `Could not allocate a listing id for "${input.address}" after ${MAX_ID_ATTEMPTS} attempts`,
    );
  }

  async update(
    id: string,
    patch: Partial<Omit<ListingRecord, 'id' | 'version' | 'createdAt'>>,
  ): Promise<ListingRecord> {
    // Validate the id before touching the lock map, so a bad id is always a
    // RangeError and never an unhandled rejection inside a queued task.
    const paths = listingPaths(this.rootDir, id);

    return this.withLock(id, async () => {
      const current = await readRecordFile(paths, id);
      if (current === undefined) {
        throw new StoreError('E_NOT_FOUND', `Listing "${id}" was not found`);
      }

      const safe: Partial<ListingRecord> = { ...patch };
      // Types forbid these, but runtime callers (JS, IPC payloads) are not typed.
      delete safe.id;
      delete safe.version;
      delete safe.createdAt;

      if (safe.status !== undefined && !isListingStatus(safe.status)) {
        throw new StoreError('E_INVALID_PATCH', `Unknown status ${String(safe.status)}`);
      }
      if (
        safe.clipCount !== undefined &&
        (typeof safe.clipCount !== 'number' ||
          !Number.isInteger(safe.clipCount) ||
          safe.clipCount < 0)
      ) {
        throw new StoreError('E_INVALID_PATCH', 'clipCount must be a non-negative integer');
      }
      if (safe.notes !== undefined && typeof safe.notes !== 'string') {
        throw new StoreError('E_INVALID_PATCH', 'notes must be a string');
      }
      if (safe.lastError !== undefined && typeof safe.lastError !== 'string') {
        throw new StoreError('E_INVALID_PATCH', 'lastError must be a string');
      }

      const address =
        typeof safe.address === 'string' && safe.address.trim().length > 0
          ? safe.address
          : current.address;

      const merged: ListingRecord = {
        ...current,
        ...safe,
        id: current.id,
        version: 1,
        createdAt: current.createdAt,
        address,
        facts: mergeFacts(current.facts, safe.facts, address),
        updatedAt: normaliseTimestamp(this.clock()),
      };

      await writeRecord(paths, merged);
      return merged;
    });
  }

  async remove(id: string): Promise<void> {
    const paths = listingPaths(this.rootDir, id);

    await this.withLock(id, async () => {
      try {
        // Idempotent: removing a listing that is already gone is not an error.
        await rm(paths.dir, { recursive: true, force: true });
      } catch (error) {
        throw new StoreError(
          'E_DELETE_FAILED',
          `Could not remove listing "${id}": ${errorMessage(error)}`,
          { cause: error },
        );
      }
    });
  }

  dirFor(id: string): string {
    return listingPaths(this.rootDir, id).dir;
  }

  /**
   * Serialises read-modify-write cycles per listing. Without this, 20 parallel
   * updates would all write the same temp file and lose merges.
   */
  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, settled);

    try {
      return await run;
    } finally {
      if (this.locks.get(key) === settled) {
        this.locks.delete(key);
      }
    }
  }
}

