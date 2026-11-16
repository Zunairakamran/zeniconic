import { describe, expect, it } from 'vitest';
import { buildDuckEnvelope } from '../src/index';
import type { DuckPoint } from '../src/index';
import { gainAt } from './helpers';

function timestamps(points: DuckPoint[]): number[] {
  return points.map((point) => point.t);
}

function expectSortedAndUnique(points: DuckPoint[]): void {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    expect(current.t).toBeGreaterThan(previous.t);
  }
  expect(new Set(timestamps(points)).size).toBe(points.length);
}

describe('buildDuckEnvelope — default shape', () => {
  it('starts at 0 s / 0 dB with a pre-roll before the first word', () => {
    const envelope = buildDuckEnvelope([{ startSec: 1, endSec: 2 }]);

    expect(envelope).toEqual([
      { t: 0, gainDb: 0 },
      { t: 0.8, gainDb: 0 },
      { t: 0.92, gainDb: -18 },
      { t: 2, gainDb: -18 },
      { t: 2.4, gainDb: 0 },
    ]);
    expectSortedAndUnique(envelope);
  });

  it('is fully ducked under speech and silent outside it', () => {
    const envelope = buildDuckEnvelope([{ startSec: 1, endSec: 2 }]);

    expect(gainAt(envelope, 0)).toBe(0);
    expect(gainAt(envelope, 0.7)).toBe(0);
    expect(gainAt(envelope, 1)).toBe(-18);
    expect(gainAt(envelope, 1.5)).toBe(-18);
    expect(gainAt(envelope, 2)).toBe(-18);
    expect(gainAt(envelope, 2.4)).toBe(0);
    expect(gainAt(envelope, 5)).toBe(0);
  });

  it('clamps a speech range that starts at zero rather than emitting negative time', () => {
    const envelope = buildDuckEnvelope([{ startSec: 0, endSec: 1 }]);

    expect(envelope[0]).toEqual({ t: 0, gainDb: 0 });
    expect(envelope[1]).toEqual({ t: 0.12, gainDb: -18 });
    expect(timestamps(envelope).every((t) => t >= 0)).toBe(true);
    expectSortedAndUnique(envelope);
  });
});

describe('buildDuckEnvelope — merging', () => {
  it('merges two adjacent ranges into one clean plateau', () => {
    const envelope = buildDuckEnvelope([
      { startSec: 1, endSec: 2 },
      { startSec: 2.1, endSec: 3 },
    ]);

    expect(envelope).toEqual([
      { t: 0, gainDb: 0 },
      { t: 0.8, gainDb: 0 },
      { t: 0.92, gainDb: -18 },
      { t: 3, gainDb: -18 },
      { t: 3.4, gainDb: 0 },
    ]);
    expect(gainAt(envelope, 2.05)).toBe(-18);
    expectSortedAndUnique(envelope);
  });

  it('merges overlapping and unsorted ranges deterministically', () => {
    const envelope = buildDuckEnvelope([
      { startSec: 2.5, endSec: 3.5 },
      { startSec: 1, endSec: 2 },
    ]);

    expect(envelope).toEqual([
      { t: 0, gainDb: 0 },
      { t: 0.8, gainDb: 0 },
      { t: 0.92, gainDb: -18 },
      { t: 3.5, gainDb: -18 },
      { t: 3.9, gainDb: 0 },
    ]);
  });

  it('keeps ranges separated by more than the release plus pre-roll apart', () => {
    const envelope = buildDuckEnvelope([
      { startSec: 1, endSec: 2 },
      { startSec: 2.8, endSec: 3.8 },
    ]);

    expect(envelope).toEqual([
      { t: 0, gainDb: 0 },
      { t: 0.8, gainDb: 0 },
      { t: 0.92, gainDb: -18 },
      { t: 2, gainDb: -18 },
      { t: 2.4, gainDb: 0 },
      { t: 2.6, gainDb: 0 },
      { t: 2.72, gainDb: -18 },
      { t: 3.8, gainDb: -18 },
      { t: 4.2, gainDb: 0 },
    ]);
    expect(gainAt(envelope, 2.5)).toBe(0);
    expectSortedAndUnique(envelope);
  });
});

describe('buildDuckEnvelope — options and contract', () => {
  it('honours a custom pre-roll, attack, release and depth', () => {
    const envelope = buildDuckEnvelope([{ startSec: 1, endSec: 2 }], {
      preRollMs: 100,
      attackMs: 50,
      releaseMs: 200,
      duckDb: -12,
    });

    expect(envelope).toEqual([
      { t: 0, gainDb: 0 },
      { t: 0.9, gainDb: 0 },
      { t: 0.95, gainDb: -12 },
      { t: 2, gainDb: -12 },
      { t: 2.2, gainDb: 0 },
    ]);
  });

  it('turns a zero-length attack into a step, not a duplicate timestamp', () => {
    const envelope = buildDuckEnvelope([{ startSec: 1, endSec: 2 }], {
      preRollMs: 0,
      attackMs: 0,
      releaseMs: 0,
      duckDb: -12,
    });

    expect(envelope).toEqual([
      { t: 0, gainDb: 0 },
      { t: 1, gainDb: -12 },
      { t: 2, gainDb: -12 },
    ]);
    expectSortedAndUnique(envelope);
  });

  it('returns only the silent origin for no speech', () => {
    expect(buildDuckEnvelope([])).toEqual([{ t: 0, gainDb: 0 }]);
  });

  it('rejects invalid ranges and options', () => {
    expect(() => buildDuckEnvelope([{ startSec: 2, endSec: 2 }])).toThrow(RangeError);
    expect(() => buildDuckEnvelope([{ startSec: 3, endSec: 2 }])).toThrow(RangeError);
    expect(() => buildDuckEnvelope([{ startSec: -1, endSec: 2 }])).toThrow(RangeError);
    expect(() => buildDuckEnvelope([], { preRollMs: -1 })).toThrow(RangeError);
    expect(() => buildDuckEnvelope([], { duckDb: 3 })).toThrow(RangeError);
  });
});
