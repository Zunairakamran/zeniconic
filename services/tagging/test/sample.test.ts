import { describe, expect, it } from 'vitest';
import { SAMPLE_COUNT, frameGridStep, probedSheetTimes, sampleTimes, sheetTimes } from '../src/index';

describe('sampleTimes', () => {
  it('returns six distinct ascending times inside the shot', () => {
    const times = sampleTimes(4, 10);

    expect(times).toHaveLength(SAMPLE_COUNT);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThan(times[index - 1] ?? 0);
    }
    expect(new Set(times).size).toBe(SAMPLE_COUNT);
  });

  it('skips the first and last 5% at both ends', () => {
    const times = sampleTimes(0, 10);

    expect(times[0]).toBeCloseTo(0.5, 10);
    expect(times[times.length - 1]).toBeCloseTo(9.5, 10);
    expect(times[0]).toBeGreaterThanOrEqual(0.5);
    expect(times[times.length - 1]).toBeLessThanOrEqual(9.5);
  });

  it('uses the shot’s own times, not the source clip’s', () => {
    const early = sampleTimes(0, 2);
    const late = sampleTimes(58, 60);

    expect(late[0]).toBeCloseTo(58.1, 10);
    expect(late[late.length - 1]).toBeCloseTo(59.9, 10);
    expect(early).not.toEqual(late);
  });

  it('stays inside a very short window', () => {
    const times = sampleTimes(2, 2.2);

    expect(times).toHaveLength(SAMPLE_COUNT);
    expect(times[0]).toBeGreaterThanOrEqual(2);
    expect(times[times.length - 1]).toBeLessThanOrEqual(2.2);
    expect(new Set(times).size).toBe(SAMPLE_COUNT);
  });

  it('is pure and deterministic', () => {
    const first = sampleTimes(12.5, 18.25);
    const second = sampleTimes(12.5, 18.25);
    expect(second).toEqual(first);
    // A caller mutating the result must not affect the next call.
    first[0] = 0;
    expect(sampleTimes(12.5, 18.25)[0]).toBeCloseTo(12.7875, 10);
  });

  it('honours an explicit count', () => {
    const times = sampleTimes(0, 4, 3);
    expect(times).toHaveLength(3);
    expect(times[0]).toBeCloseTo(0.2, 10);
    expect(times[1]).toBeCloseTo(2, 10);
    expect(times[2]).toBeCloseTo(3.8, 10);
  });

  it('rejects a window with no duration', () => {
    expect(() => sampleTimes(5, 5)).toThrow(RangeError);
    expect(() => sampleTimes(5, 4)).toThrow(RangeError);
    expect(() => sampleTimes(Number.NaN, 4)).toThrow(RangeError);
  });

  it('rejects a non-positive count', () => {
    expect(() => sampleTimes(0, 4, 0)).toThrow(RangeError);
    expect(() => sampleTimes(0, 4, 2.5)).toThrow(RangeError);
  });
});

describe('sheetTimes', () => {
  it('snaps to the 30 fps three-decimal grid so ffmpeg’s exact match hits', () => {
    const times = sheetTimes(0, 2, 30);

    expect(times).toHaveLength(SAMPLE_COUNT);
    expect(new Set(times).size).toBe(SAMPLE_COUNT);
    for (const time of times) {
      expect(time).toBeGreaterThan(0);
      expect(time).toBeLessThan(2);
      // Every value is a whole tenth, which is exactly 3 frames at 30 fps.
      expect(Math.abs(time * 10 - Math.round(time * 10))).toBeLessThan(1e-9);
    }
  });

  it('uses the frame grid for 24, 25 and 60 fps', () => {
    expect(frameGridStep(24)).toBeCloseTo(0.125, 10);
    expect(frameGridStep(25)).toBeCloseTo(0.04, 10);
    expect(frameGridStep(30)).toBeCloseTo(0.1, 10);
    expect(frameGridStep(60)).toBeCloseTo(0.05, 10);

    const at24 = sheetTimes(0, 4, 24);
    for (const time of at24) {
      expect(Math.abs(time * 8 - Math.round(time * 8))).toBeLessThan(1e-9);
    }
  });

  it('keeps the shot’s own offset when it is late in the clip', () => {
    const times = sheetTimes(58, 60, 30);

    expect(times[0]).toBeCloseTo(58.1, 10);
    expect(times[times.length - 1]).toBeCloseTo(59.9, 10);
  });

  it('falls back to raw samples on a rate with no three-decimal grid', () => {
    expect(frameGridStep(29.97)).toBeUndefined();
    expect(sheetTimes(0, 6, 29.97)).toEqual(sampleTimes(0, 6));
  });

  it('still returns six times for a window shorter than six grid steps', () => {
    const times = sheetTimes(0, 0.3, 30);

    expect(times).toHaveLength(SAMPLE_COUNT);
    for (const time of times) {
      expect(time).toBeGreaterThan(0);
      expect(time).toBeLessThan(0.3);
    }
  });
});

describe('probedSheetTimes', () => {
  const frames = Array.from({ length: 300 }, (_, index) => Math.round((index + 1) * 0.1 * 1000) / 1000);

  it('picks six distinct real timestamps inside the shot', () => {
    const times = probedSheetTimes(10, 20, frames);

    expect(times).toBeDefined();
    expect(times).toHaveLength(SAMPLE_COUNT);
    expect(new Set(times).size).toBe(SAMPLE_COUNT);
    for (const time of times ?? []) {
      expect(frames).toContain(time);
      expect(time).toBeGreaterThan(10);
      expect(time).toBeLessThan(20);
    }
    expect(times?.[0]).toBeLessThan(11);
    expect(times?.[5]).toBeGreaterThan(19);
  });

  it('keeps the 5% interior when there are enough frames for it', () => {
    for (const time of probedSheetTimes(0, 10, frames) ?? []) {
      expect(time).toBeGreaterThanOrEqual(0.5);
      expect(time).toBeLessThanOrEqual(9.5);
    }
  });

  it('widens to the whole shot when the interior holds fewer than six frames', () => {
    const times = probedSheetTimes(0, 0.3, frames);
    expect(times).toEqual([0.1, 0.1, 0.1, 0.2, 0.2, 0.2]);
  });

  it('returns undefined when no frame lands inside the shot', () => {
    expect(probedSheetTimes(30, 40, frames)).toBeUndefined();
    expect(probedSheetTimes(0, 10, [])).toBeUndefined();
  });

  it('rejects a non-positive count', () => {
    expect(() => probedSheetTimes(0, 10, frames, 0)).toThrow(RangeError);
  });
});
