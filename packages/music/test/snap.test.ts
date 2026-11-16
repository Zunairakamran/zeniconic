import { describe, expect, it } from 'vitest';
import { snapCutWithFloor, snapCuts } from '../src/index';

function nearestDistance(cut: number, beats: number[]): number {
  let best = Infinity;
  for (const beat of beats) best = Math.min(best, Math.abs(beat - cut));
  return best;
}

describe('snapCuts', () => {
  it('moves cuts onto nearby beats inside the tolerance', () => {
    const cuts = [1.0, 2.05, 3.4];
    const beats = [1.0, 2.0, 3.5];

    expect(snapCuts(cuts, beats, 0.12)).toEqual([1.0, 2.0, 3.5]);
  });

  it('leaves a cut alone when the nearest beat is outside the tolerance', () => {
    expect(snapCuts([5], [5.2], 0.1)).toEqual([5]);
    expect(snapCuts([5], [5.2], 0.19)).toEqual([5]);
    expect(snapCuts([5], [5.2], 0.2)).toEqual([5.2]);
  });

  it('never moves a cut further than the tolerance', () => {
    const cuts = [0.4, 1.1, 1.9, 2.6, 3.35, 4.7];
    const beats = [0, 0.5, 1, 2, 2.5, 3, 4, 5];
    const tolerance = 0.3;
    const snapped = snapCuts(cuts, beats, tolerance);

    expect(snapped).toHaveLength(cuts.length);

    for (let index = 0; index < cuts.length; index += 1) {
      const source = cuts[index] ?? NaN;
      const value = snapped[index] ?? NaN;
      expect(Math.abs(value - source)).toBeLessThanOrEqual(tolerance);
      if (value !== source) {
        expect(nearestDistance(value, beats)).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('prefers the earlier beat on an exact tie', () => {
    expect(snapCuts([1.5], [1.4, 1.6], 0.2)).toEqual([1.4]);
  });

  it('preserves input order and removes cuts that collapse onto one beat', () => {
    const cuts = [3.4, 1.02, 1.04];
    const beats = [1.0, 3.5];

    expect(snapCuts(cuts, beats, 0.1)).toEqual([3.5, 1]);
  });

  it('returns rounded cuts unchanged when there is no grid', () => {
    expect(snapCuts([1.23456, 2.0004], [], 0.2)).toEqual([1.235, 2]);
  });

  it('rejects a negative or non-finite tolerance', () => {
    expect(() => snapCuts([1], [1], -0.1)).toThrow(RangeError);
    expect(() => snapCuts([1], [1], Number.NaN)).toThrow(RangeError);
  });
});

describe('snapCutWithFloor', () => {
  it('does not snap earlier into a 0.4 second shot', () => {
    const cuts = [1.0, 1.4];
    const beats = [1.0, 1.4];

    const snapped = snapCutWithFloor(cuts, beats, 0.3, 1.2);

    expect(snapped).toEqual([1.0, 2.2]);
    expect((snapped[1] ?? 0) - (snapped[0] ?? 0)).toBeGreaterThanOrEqual(1.2);
  });

  it('skips a close beat that breaks the floor and takes a legal later one', () => {
    const cuts = [2.0, 3.1];
    const beats = [2.0, 3.0, 3.5];

    expect(snapCutWithFloor(cuts, beats, 0.5, 1.2)).toEqual([2, 3.5]);
  });

  it('keeps the original cut when every nearby beat is blocked by the floor', () => {
    const cuts = [2.0, 3.25];
    const beats = [2.0, 3.0];

    expect(snapCutWithFloor(cuts, beats, 0.3, 1.2)).toEqual([2, 3.25]);
  });

  it('always keeps consecutive cuts at least one minimum shot apart', () => {
    const cuts = [0.2, 1.0, 1.7, 2.6, 3.3, 4.4];
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
    const snapped = snapCutWithFloor(cuts, beats, 0.4, 1.2);

    for (let index = 1; index < snapped.length; index += 1) {
      const previous = snapped[index - 1] ?? 0;
      const current = snapped[index] ?? 0;
      expect(current - previous).toBeGreaterThanOrEqual(1.2 - 1e-9);
    }
  });

  it('collapses duplicate landing points to one cut', () => {
    const cuts = [1.0, 1.01, 2.5];
    const beats = [1.0, 2.5];

    expect(snapCutWithFloor(cuts, beats, 0.2, 1.2)).toEqual([1, 2.5]);
  });

  it('rejects a negative or non-finite minimum shot', () => {
    expect(() => snapCutWithFloor([1], [1], 0.1, -1)).toThrow(RangeError);
    expect(() => snapCutWithFloor([1], [1], 0.1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
