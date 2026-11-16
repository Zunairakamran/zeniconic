import { describe, expect, it } from 'vitest';
import { formatPrice } from '../src/format';

describe('formatPrice — AED', () => {
  it('uses the ISO code, not a symbol', () => {
    expect(formatPrice(1_850_000, 'AED')).toBe('AED 1,850,000');
    expect(formatPrice(950_000, 'AED')).toBe('AED 950,000');
  });

  it('groups thousands and drops fils', () => {
    expect(formatPrice(1_234_567.89, 'AED')).toBe('AED 1,234,568');
  });

  it('handles zero', () => {
    expect(formatPrice(0, 'AED')).toBe('AED 0');
  });

  it('rejects negative and non-finite amounts', () => {
    expect(() => formatPrice(-1, 'AED')).toThrow(RangeError);
    expect(() => formatPrice(Number.POSITIVE_INFINITY, 'AED')).toThrow(RangeError);
  });
});
