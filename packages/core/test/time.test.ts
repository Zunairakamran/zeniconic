import { describe, expect, it } from 'vitest';
import {
  framesFor,
  roundTime,
  secondsFor,
  snapToBeat,
  totalDuration,
} from '../src/index';

describe('roundTime', () => {
  it('collapses binary floating point noise to the 3 dp value a human wrote', () => {
    expect(roundTime(0.1 + 0.2)).toBe(0.3);
    expect(roundTime(0.1 + 0.2)).toBe(0.3);
  });

  it('rounds 29.9995 up to 30', () => {
    expect(roundTime(29.9995)).toBe(30);
  });

  it('normalises negative zero to positive zero', () => {
    expect(roundTime(-0.0004)).toBe(0);
    expect(Object.is(roundTime(-0.0004), 0)).toBe(true);
  });

  it('keeps a negative value that survives rounding negative', () => {
    expect(roundTime(-0.0014)).toBe(-0.001);
  });

  it('leaves every already-3dp value in 0..10 seconds unchanged', () => {
    for (let i = 0; i <= 10_000; i += 1) {
      const value = i / 1000;
      expect(roundTime(value)).toBe(value);
    }
  });

  it('is idempotent across repeated rounding', () => {
    const once = roundTime(12.3456789);
    expect(roundTime(once)).toBe(once);
  });
});

describe('framesFor', () => {
  it('converts a whole second at 30 fps', () => {
    expect(framesFor(1, 30)).toBe(30);
  });

  it('rounds a fractional frame count to the nearest frame', () => {
    expect(framesFor(10, 29.97)).toBe(300);
    expect(framesFor(0.5, 24)).toBe(12);
  });

  it('handles zero and negative time', () => {
    expect(framesFor(0, 30)).toBe(0);
    expect(framesFor(-1, 30)).toBe(-30);
  });
});

describe('secondsFor', () => {
  it('divides exactly without rounding', () => {
    expect(secondsFor(1, 24)).toBe(1 / 24);
    expect(secondsFor(300, 30)).toBe(10);
  });

  it('round-trips a frame count through a non-integer frame rate within half a frame', () => {
    const back = framesFor(secondsFor(1234, 29.97), 29.97);
    expect(back).toBe(1234);
  });
});

describe('snapToBeat', () => {
  it('moves a time to the nearest beat when inside tolerance', () => {
    expect(snapToBeat(10.12, [9.8, 10.2, 10.6], 0.25)).toBe(10.2);
  });

  it('leaves a time untouched when every beat is outside tolerance', () => {
    expect(snapToBeat(10, [9.7, 10.4], 0.2)).toBe(10);
  });

  it('treats the tolerance boundary as inside', () => {
    expect(snapToBeat(1.5, [1.75], 0.25)).toBe(1.75);
  });

  it('picks the earlier beat on an exact tie', () => {
    expect(snapToBeat(1.5, [2, 1], 0.6)).toBe(1);
  });

  it('returns the input rounded to 3 dp when nothing snaps', () => {
    expect(snapToBeat(1.23456, [5], 0.1)).toBe(1.235);
  });

  it('rounds the snapped beat to 3 dp', () => {
    expect(snapToBeat(1.2, [1.23456], 0.1)).toBe(1.235);
  });

  it('returns the input for an empty beat grid', () => {
    expect(snapToBeat(4.25, [], 1)).toBe(4.25);
  });

  it('keeps the nearer of two beats on either side', () => {
    expect(snapToBeat(2.1, [2, 2.25], 0.5)).toBe(2);
    expect(snapToBeat(2.2, [2, 2.25], 0.5)).toBe(2.25);
  });
});

describe('totalDuration', () => {
  it('sums the trimmed source windows at the clip speed', () => {
    expect(totalDuration([{ inSec: 0, outSec: 10, speed: 1 }])).toBe(10);
    expect(totalDuration([{ inSec: 0, outSec: 10, speed: 2 }])).toBe(5);
  });

  it('sums several clips with mixed speeds', () => {
    expect(
      totalDuration([
        { inSec: 0, outSec: 4, speed: 1 },
        { inSec: 10, outSec: 13, speed: 2 },
      ]),
    ).toBe(5.5);
  });

  it('reports a repeating duration at 3 dp', () => {
    expect(totalDuration([{ inSec: 0, outSec: 10, speed: 3 }])).toBe(3.333);
  });

  it('returns 0 for no clips', () => {
    expect(totalDuration([])).toBe(0);
  });

  it('rejects a zero or negative speed', () => {
    expect(() => totalDuration([{ inSec: 0, outSec: 4, speed: 0 }])).toThrow(RangeError);
    expect(() => totalDuration([{ inSec: 0, outSec: 4, speed: -1 }])).toThrow(RangeError);
  });

  it('rejects a clip whose out point is before its in point', () => {
    expect(() => totalDuration([{ inSec: 4, outSec: 2, speed: 1 }])).toThrow(RangeError);
  });

  it('rejects non-finite clip bounds', () => {
    expect(() => totalDuration([{ inSec: 0, outSec: Number.NaN, speed: 1 }])).toThrow(RangeError);
  });
});
