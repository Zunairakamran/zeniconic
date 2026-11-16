import { describe, expect, it } from 'vitest';
import { beatGridFromBpm, downbeats } from '../src/index';

function isThreeDecimalPlaces(value: number): boolean {
  return Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;
}

describe('beatGridFromBpm', () => {
  it('builds 48 beats for 96 BPM over 30 seconds', () => {
    const grid = beatGridFromBpm(96, 30);

    expect(grid).toHaveLength(48);
    expect(grid[0]).toBe(0);
    expect(grid[1]).toBe(0.625);
    expect(grid[47]).toBe(29.375);
  });

  it('rounds every beat to 3 dp and keeps them ascending', () => {
    const grid = beatGridFromBpm(96, 30);

    for (let index = 0; index < grid.length; index += 1) {
      const beat = grid[index] ?? NaN;
      expect(isThreeDecimalPlaces(beat)).toBe(true);
      if (index > 0) {
        const previous = grid[index - 1] ?? NaN;
        expect(beat).toBeGreaterThan(previous);
        expect(beat - previous).toBeCloseTo(0.625, 9);
      }
    }
  });

  it('honours an offset and stops before the track end', () => {
    const grid = beatGridFromBpm(96, 10, 0.25);

    expect(grid).toHaveLength(16);
    expect(grid[0]).toBe(0.25);
    expect(grid[15]).toBe(9.625);
    expect((grid[grid.length - 1] ?? 0)).toBeLessThan(10);
  });

  it('excludes a beat that lands exactly on the track end', () => {
    const grid = beatGridFromBpm(120, 4);
    expect(grid).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it('matches the reference count for a 124 BPM, 40 second bed', () => {
    const grid = beatGridFromBpm(124, 40);
    expect(grid).toHaveLength(83);
    expect((grid[grid.length - 1] ?? 0)).toBeCloseTo(39.677, 3);
  });

  it('returns no beats for an empty or fully offset track', () => {
    expect(beatGridFromBpm(96, 0)).toEqual([]);
    expect(beatGridFromBpm(96, 10, 10)).toEqual([]);
    expect(beatGridFromBpm(96, 10, 12)).toEqual([]);
  });

  it('rejects impossible tempo, duration and offset values', () => {
    expect(() => beatGridFromBpm(0, 30)).toThrow(RangeError);
    expect(() => beatGridFromBpm(-96, 30)).toThrow(RangeError);
    expect(() => beatGridFromBpm(Number.NaN, 30)).toThrow(RangeError);
    expect(() => beatGridFromBpm(96, -1)).toThrow(RangeError);
    expect(() => beatGridFromBpm(96, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => beatGridFromBpm(96, 30, -0.1)).toThrow(RangeError);
  });

  it('exposes downbeats only through a separate helper', () => {
    const grid = beatGridFromBpm(96, 10);
    expect(downbeats(grid)).toEqual([0, 2.5, 5, 7.5]);
    expect(downbeats([])).toEqual([]);
  });
});
