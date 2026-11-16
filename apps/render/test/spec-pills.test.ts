import { describe, expect, it } from 'vitest';
import { specPills } from '../src/overlays/spec_pill';

describe('specPills', () => {
  it('splits up to three facts', () => {
    expect(specPills('3 bed · 2 bath · 1,240 sq ft')).toEqual(['3 bed', '2 bath', '1,240 sq ft']);
  });

  it('folds a fourth fact into the third pill instead of adding a row', () => {
    const pills = specPills('3 bed · 2 bath · 1,240 sq ft · marina view');
    expect(pills).toHaveLength(3);
    expect(pills[2]).toBe('1,240 sq ft · marina view');
  });

  it('handles a single fact and stray separators', () => {
    expect(specPills('  Studio ')).toEqual(['Studio']);
    expect(specPills('· · ·')).toEqual([]);
  });
});
