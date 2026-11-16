import { describe, expect, it } from 'vitest';
import {
  canvasDurationSec,
  clipTimelineSec,
  framesFor,
  timelineSegments,
} from '../src/index';
import { clip, edl } from './helpers';

describe('framesFor', () => {
  it('rounds to the nearest frame', () => {
    expect(framesFor(1.5, 30)).toBe(45);
    expect(framesFor(0.5, 30)).toBe(15);
    expect(framesFor(0.016, 30)).toBe(0);
    expect(framesFor(0.017, 30)).toBe(1);
  });

  it('clamps float noise below zero to frame zero', () => {
    expect(framesFor(-0.0001, 30)).toBe(0);
    expect(Object.is(framesFor(-0, 30), -0)).toBe(false);
  });

  it('rejects a non-positive fps', () => {
    expect(() => framesFor(1, 0)).toThrow(RangeError);
    expect(() => framesFor(1, Number.NaN)).toThrow(RangeError);
    expect(() => framesFor(Number.POSITIVE_INFINITY, 30)).toThrow(RangeError);
  });
});

describe('timelineSegments', () => {
  it('applies speed and transition overlap', () => {
    const document = edl({
      durationSec: 9.5,
      clips: [
        clip({ id: 'c1', inSec: 0, outSec: 4 }),
        clip({
          id: 'c2',
          inSec: 1,
          outSec: 5,
          speed: 2,
          transitionIn: { type: 'dissolve', durationSec: 0.5 },
        }),
        clip({ id: 'c3', inSec: 0, outSec: 2, transitionIn: { type: 'cut', durationSec: 0 } }),
      ],
    });

    const segments = timelineSegments(document);
    expect(segments.map((segment) => segment.clipId)).toEqual(['c1', 'c2', 'c3']);
    expect(segments[0]).toMatchObject({ startSec: 0, endSec: 4, durationSec: 4, overlapSec: 0 });
    expect(segments[1]).toMatchObject({ startSec: 3.5, endSec: 5.5, durationSec: 2, overlapSec: 0.5 });
    expect(segments[2]).toMatchObject({ startSec: 5.5, endSec: 7.5, durationSec: 2 });
    expect(clipTimelineSec(document)).toBe(7.5);
  });

  it('never overlaps more than the incoming clip is long', () => {
    const document = edl({
      clips: [clip({ id: 'c1' }), clip({ id: 'c2', inSec: 0, outSec: 0.4, transitionIn: { type: 'slide', durationSec: 1.5 } })],
    });
    const segments = timelineSegments(document);
    expect(segments[1]?.durationSec).toBeCloseTo(0.4);
    expect(segments[1]?.overlapSec).toBeCloseTo(0.4);
    expect(segments[1]?.startSec).toBeCloseTo(3.6);
  });
});

describe('canvasDurationSec', () => {
  it('uses the EDL target when it is positive', () => {
    const document = edl({ durationSec: 30 });
    expect(canvasDurationSec(document)).toBe(30);
  });

  it('falls back to the clip total when the target is missing', () => {
    const document = edl({ clips: [clip({ inSec: 0, outSec: 3 })] });
    document.format = { ...document.format, targetDurationSec: 0 };
    expect(canvasDurationSec(document)).toBe(3);
  });
});
