import { describe, expect, it } from 'vitest';
import { listingId } from '../src/index';

describe('listingId', () => {
  it('builds the documented id for a London address', () => {
    const date = new Date(Date.UTC(2026, 10, 14));
    expect(listingId('14 Oak Avenue, Richmond TW9', date)).toBe(
      '2026-11-14-14-oak-avenue-richmond-tw9',
    );
  });

  it('uses the UTC calendar date, not local time', () => {
    const lateUtc = new Date(Date.UTC(2026, 10, 14, 23, 30));
    const earlyUtc = new Date(Date.UTC(2026, 10, 14, 0, 30));
    expect(listingId('14 Oak Avenue', lateUtc)).toBe('2026-11-14-14-oak-avenue');
    expect(listingId('14 Oak Avenue', earlyUtc)).toBe('2026-11-14-14-oak-avenue');
  });

  it('zero-pads single digit months and days', () => {
    const date = new Date(Date.UTC(2027, 0, 5));
    expect(listingId('14 Oak Avenue', date)).toBe('2027-01-05-14-oak-avenue');
  });

  it('strips accents and punctuation from the address', () => {
    const date = new Date(Date.UTC(2026, 1, 3));
    expect(listingId('12 Rue de l\u2019Église, Paris', date)).toBe(
      '2026-02-03-12-rue-de-l-eglise-paris',
    );
  });

  it('normalises an ampersand to "and"', () => {
    const date = new Date(Date.UTC(2026, 5, 1));
    expect(listingId('The Old Mill & Garden', date)).toBe('2026-06-01-the-old-mill-and-garden');
  });

  it('is deterministic for identical inputs', () => {
    const date = new Date(Date.UTC(2026, 10, 14));
    expect(listingId('14 Oak Avenue, Richmond TW9', date)).toBe(
      listingId('14 Oak Avenue, Richmond TW9', date),
    );
  });

  it('rejects an address with nothing to slugify', () => {
    const date = new Date(Date.UTC(2026, 10, 14));
    expect(() => listingId('!!! ???', date)).toThrow(RangeError);
    expect(() => listingId('', date)).toThrow(RangeError);
  });

  it('rejects an invalid date', () => {
    expect(() => listingId('14 Oak Avenue', new Date('not a date'))).toThrow(RangeError);
  });
});
