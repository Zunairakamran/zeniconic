import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidListingId, listingPaths } from '../src/index';

const VALID_ID = '2026-11-14-14-oak-avenue-richmond-tw9';

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code: unknown = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

describe('isValidListingId', () => {
  it('accepts date-prefixed lowercase slugs', () => {
    expect(isValidListingId(VALID_ID)).toBe(true);
    expect(isValidListingId('2026-01-05-a1')).toBe(true);
    expect(isValidListingId('2026-11-14-a-and-b-ltd')).toBe(true);
  });

  it('rejects traversal, separators, spaces and uppercase', () => {
    const invalid = [
      '',
      '..',
      '../etc',
      '..\\x',
      '2026-11-14-14-oak-avenue/../../etc',
      '2026-11-14-14 oak avenue',
      '2026-11-14-14-Oak-Avenue',
      '2026-11-14-OAK',
      '2026-11-14-',
      '2026-11-14--oak',
      '2026-11-14-oak-',
      '2026-1-14-oak',
      '20261114-oak',
      '2026-11-14-oak\n',
    ];

    for (const id of invalid) {
      expect(isValidListingId(id), id).toBe(false);
    }
  });
});

describe('listingPaths', () => {
  it('builds absolute paths under <root>/listings/<id>', () => {
    const root = resolve('data');
    const paths = listingPaths(root, VALID_ID);

    expect(isAbsolute(paths.dir)).toBe(true);
    expect(paths.dir).toBe(join(root, 'listings', VALID_ID));
    expect(paths.record).toBe(join(root, 'listings', VALID_ID, 'listing.json'));
    expect(paths.media).toBe(join(root, 'listings', VALID_ID, 'media'));
    expect(paths.cache).toBe(join(root, 'listings', VALID_ID, 'cache'));
  });

  it('resolves a relative root against the working directory', () => {
    const paths = listingPaths('data', VALID_ID);
    expect(paths.dir).toBe(join(resolve('data'), 'listings', VALID_ID));
  });

  it('keeps the id as the final path segment', () => {
    const paths = listingPaths('C:\\tmp\\zeniconic', VALID_ID);
    expect(paths.dir.endsWith(VALID_ID)).toBe(true);
  });

  it('throws RangeError with E_INVALID_ID for traversal-shaped ids', () => {
    for (const id of ['../etc', '..\\x', '2026-11-14-14-Oak-Avenue', '..', '']) {
      try {
        listingPaths('data', id);
        expect.unreachable(`expected "${id}" to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
        expect(codeOf(error)).toBe('E_INVALID_ID');
      }
    }
  });

  it('throws RangeError with E_INVALID_ROOT for an empty root', () => {
    try {
      listingPaths('   ', VALID_ID);
      expect.unreachable('expected an empty root to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect(codeOf(error)).toBe('E_INVALID_ROOT');
    }
  });
});
