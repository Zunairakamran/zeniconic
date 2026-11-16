import { dirname, join, resolve } from 'node:path';
import type { ListingPaths } from './types';

/**
 * A listing id is `YYYY-MM-DD-<slug>`, where the slug is lowercase ASCII words
 * joined by single hyphens. The pattern is anchored, so `..`, `/`, `\`, spaces
 * and uppercase can never reach the filesystem.
 */
const LISTING_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Non-ASCII letters that NFKD does not decompose into ASCII. Kept identical to
 * `packages/core/src/format.ts`; the two implementations are compared by tests,
 * not by an import that would cross the layer boundary.
 */
const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/** Thrown by `listingPaths` / `dirFor`. Extends `RangeError` on purpose. */
export class InvalidListingIdError extends RangeError {
  readonly code = 'E_INVALID_ID';

  constructor(id: string) {
    super(`Invalid listing id "${id}": expected YYYY-MM-DD-<lowercase-slug>`);
    this.name = 'InvalidListingIdError';
  }
}

/** Thrown when an address cannot produce a non-empty slug. */
export class InvalidAddressError extends RangeError {
  readonly code = 'E_INVALID_ADDRESS';

  constructor(address: string) {
    super(`Cannot build a listing id from address "${address}": it has no letters or digits`);
    this.name = 'InvalidAddressError';
  }
}

/** Thrown when a root directory or timestamp argument is unusable. */
export class InvalidRootError extends RangeError {
  readonly code = 'E_INVALID_ROOT';

  constructor(rootDir: string) {
    super(`Store root must be a non-empty path, received "${rootDir}"`);
    this.name = 'InvalidRootError';
  }
}

/** Thrown when a `now` / `confirmedAt` value is not a parseable ISO timestamp. */
export class InvalidTimestampError extends RangeError {
  readonly code = 'E_INVALID_TIMESTAMP';

  constructor(value: string) {
    super(`Expected an ISO timestamp, received "${value}"`);
    this.name = 'InvalidTimestampError';
  }
}

/** The same slug rules as `packages/core`: lowercase ASCII, `&` → `and`. */
export function slugify(value: string): string {
  const expanded = Array.from(value.toLowerCase())
    .map((char) => SPECIAL_LETTERS[char] ?? char)
    .join('');

  return expanded
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Normalises any parseable timestamp to `toISOString()` form. */
export function normaliseTimestamp(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidTimestampError(String(value));
  }

  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new InvalidTimestampError(value);
  }

  return new Date(ms).toISOString();
}

/** `YYYY-MM-DD-<slug>` for a timestamp and address. */
export function listingIdFor(address: string, timestamp: string): string {
  const iso = normaliseTimestamp(timestamp);
  const day = iso.slice(0, 10);
  const slug = slugify(address);

  if (slug.length === 0) {
    throw new InvalidAddressError(address);
  }

  return `${day}-${slug}`;
}

export function isValidListingId(id: string): boolean {
  return LISTING_ID_PATTERN.test(id);
}

/** Absolute `<root>/listings` path. Internal; not part of the public entry. */
export function resolveRootDir(rootDir: string): string {
  if (typeof rootDir !== 'string' || rootDir.trim().length === 0) {
    throw new InvalidRootError(String(rootDir));
  }
  return resolve(rootDir);
}

/** Absolute `<root>/listings` path. Internal; not part of the public entry. */
export function listingsDirectory(rootDir: string): string {
  return join(resolveRootDir(rootDir), 'listings');
}

/**
 * Absolute paths for one listing workspace. Throws `RangeError` (with
 * `code: 'E_INVALID_ID'`) for anything that is not a valid id — this is the
 * path-traversal guard.
 */
export function listingPaths(rootDir: string, id: string): ListingPaths {
  if (!isValidListingId(id)) {
    throw new InvalidListingIdError(id);
  }

  const listings = listingsDirectory(rootDir);
  const dir = join(listings, id);

  // Belt and braces: the regex already forbids separators, but a future change
  // to the pattern must not be able to escape `<root>/listings`.
  if (dirname(dir) !== listings) {
    throw new InvalidListingIdError(id);
  }

  return {
    dir,
    record: join(dir, 'listing.json'),
    media: join(dir, 'media'),
    cache: join(dir, 'cache'),
  };
}
