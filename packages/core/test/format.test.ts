import { describe, expect, it } from 'vitest';
import type { Currency } from '../src/index';
import { formatPrice, slugify } from '../src/index';

describe('formatPrice', () => {
  it('renders the example price in all three currencies', () => {
    expect(formatPrice(845_000, 'GBP')).toBe('£845,000');
    expect(formatPrice(845_000, 'USD')).toBe('$845,000');
    expect(formatPrice(845_000, 'EUR')).toBe('€845,000');
  });

  it('groups thousands at every scale', () => {
    expect(formatPrice(1_000, 'GBP')).toBe('£1,000');
    expect(formatPrice(12_500, 'GBP')).toBe('£12,500');
    expect(formatPrice(1_234_567, 'USD')).toBe('$1,234,567');
    expect(formatPrice(999, 'EUR')).toBe('€999');
    expect(formatPrice(0, 'GBP')).toBe('£0');
  });

  it('never prints decimals', () => {
    expect(formatPrice(845_000.4, 'GBP')).toBe('£845,000');
    expect(formatPrice(999.6, 'GBP')).toBe('£1,000');
    expect(formatPrice(845_000.5, 'GBP')).toBe('£845,001');
  });

  it('keeps trailing zeros in the price', () => {
    expect(formatPrice(1_000, 'GBP')).not.toBe('£1');
    expect(formatPrice(10_000, 'GBP')).toBe('£10,000');
  });

  it('rejects negative amounts', () => {
    expect(() => formatPrice(-1, 'GBP')).toThrow(RangeError);
    expect(() => formatPrice(-845_000, 'USD')).toThrow(RangeError);
  });

  it('rejects non-finite amounts', () => {
    expect(() => formatPrice(Number.NaN, 'GBP')).toThrow(RangeError);
    expect(() => formatPrice(Number.POSITIVE_INFINITY, 'EUR')).toThrow(RangeError);
    expect(() => formatPrice(Number.NEGATIVE_INFINITY, 'EUR')).toThrow(RangeError);
  });

  it('rejects a currency it does not know', () => {
    expect(() => formatPrice(1000, 'JPY' as Currency)).toThrow(RangeError);
  });
});

describe('slugify', () => {
  it('slugifies a full UK address', () => {
    expect(slugify('14 Oak Avenue, Richmond TW9')).toBe('14-oak-avenue-richmond-tw9');
  });

  it('lowercases and collapses punctuation and whitespace into single hyphens', () => {
    expect(slugify('  Flat 2/3,   THE  Old  Mill!!  ')).toBe('flat-2-3-the-old-mill');
  });

  it('strips diacritics', () => {
    expect(slugify('Rue de l\u2019Église')).toBe('rue-de-l-eglise');
    expect(slugify('Café Ångström Čapek')).toBe('cafe-angstrom-capek');
  });

  it('expands ampersands to "and"', () => {
    expect(slugify('Smith & Sons')).toBe('smith-and-sons');
    expect(slugify('A&B')).toBe('a-and-b');
  });

  it('expands letters NFKD does not decompose', () => {
    expect(slugify('Østerbrogade 12')).toBe('osterbrogade-12');
    expect(slugify('Straße 4')).toBe('strasse-4');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--14 Oak Avenue--')).toBe('14-oak-avenue');
    expect(slugify('...garden...')).toBe('garden');
  });

  it('returns an empty string when nothing alphanumeric survives', () => {
    expect(slugify('')).toBe('');
    expect(slugify('!!! ??? ---')).toBe('');
  });

  it('is idempotent', () => {
    const once = slugify('14 Oak Avenue, Richmond TW9');
    expect(slugify(once)).toBe(once);
  });
});
