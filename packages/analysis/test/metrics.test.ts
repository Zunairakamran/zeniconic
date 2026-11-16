import { describe, expect, it } from 'vitest';
import { analyseFrames, type Frame } from '../src/index';
import {
  boxBlurredFrame,
  checkerboardFrame,
  colourBuffer,
  cyclicShiftFrame,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  gradientFrame,
  itemAt,
  makeFrame,
  mulberry32,
  noiseFrame,
  sequence,
  shiftedFrame,
  solidFrame,
  withTiming,
} from './helpers';

describe('analyseFrames — luma metrics', () => {
  it('sees 20 identical black frames as zero motion, fully flat and fully crushed', () => {
    const metrics = analyseFrames(sequence(20, () => solidFrame(0)));

    expect(metrics).toHaveLength(20);
    expect(metrics.map((metric) => metric.index)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );

    for (const metric of metrics) {
      expect(metric.meanAbsDiff).toBe(0);
      expect(metric.blur).toBe(1);
      expect(metric.motionEnergy).toBe(0);
      expect(metric.shake).toBe(0);
      expect(metric.exposureClipLow).toBe(1);
      expect(metric.exposureClipHigh).toBe(0);
      expect(metric.colourfulness).toBe(0);
    }
  });

  it('puts a full-scale difference on the first frame of a hard cut', () => {
    const frames = sequence(20, (index) => solidFrame(index < 10 ? 0 : 255));
    const metrics = analyseFrames(frames);

    expect(itemAt(metrics, 9).meanAbsDiff).toBe(0);
    expect(itemAt(metrics, 10).meanAbsDiff).toBe(255);
    expect(itemAt(metrics, 10).motionEnergy).toBe(1);
    expect(itemAt(metrics, 11).meanAbsDiff).toBe(0);
  });

  it('reports the exposure tails as fractions of the frame', () => {
    const white = itemAt(analyseFrames([solidFrame(255)]), 0);
    const black = itemAt(analyseFrames([solidFrame(0)]), 0);

    expect(white.exposureClipHigh).toBeGreaterThan(0.9);
    expect(white.exposureClipLow).toBe(0);
    expect(black.exposureClipLow).toBeGreaterThan(0.9);
    expect(black.exposureClipHigh).toBe(0);
  });

  it('honours the clip points it is given', () => {
    const frame = solidFrame(32);

    expect(itemAt(analyseFrames([frame]), 0).exposureClipLow).toBe(0);
    expect(itemAt(analyseFrames([frame], { clipLow: 32 }), 0).exposureClipLow).toBe(1);
    expect(itemAt(analyseFrames([frame], { clipHigh: 32 }), 0).exposureClipHigh).toBe(1);
  });
});

describe('analyseFrames — sharpness', () => {
  it('scores a sharp checkerboard sharper than a box-blurred copy of it', () => {
    const sharp = itemAt(analyseFrames([checkerboardFrame()]), 0);
    // Three 3×3 passes erase the 1 px pattern; a single pass only dims it.
    const blurred = itemAt(analyseFrames([boxBlurredFrame(checkerboardFrame(), 1, 3)]), 0);

    expect(sharp.blur).toBeLessThan(0.05);
    expect(blurred.blur).toBeGreaterThan(0.9);
    expect(blurred.blur).toBeGreaterThan(sharp.blur);
  });

  it('scores per-pixel noise as sharp, not as blur', () => {
    expect(itemAt(analyseFrames([noiseFrame(7)]), 0).blur).toBeLessThan(0.2);
  });

  it('returns blur 1 for frames too small to hold a 3×3 interior', () => {
    const tiny = makeFrame(new Uint8Array([0, 255, 255, 0]), {
      width: 2,
      height: 2,
    });
    expect(itemAt(analyseFrames([tiny]), 0).blur).toBe(1);
  });
});

describe('analyseFrames — shake', () => {
  it('explains a 3 px pan away, leaving a near-zero residual', () => {
    const base = gradientFrame();
    const pan = Array.from({ length: 8 }, (_, index) =>
      withTiming(cyclicShiftFrame(base, index * 3, 0), index),
    );
    const metrics = analyseFrames(pan);

    for (let i = 1; i < metrics.length; i += 1) {
      const metric = itemAt(metrics, i);
      expect(metric.shake).toBeLessThan(0.5);
      expect(metric.meanAbsDiff).toBeGreaterThan(6);
    }
  });

  it('leaves a residual when the jolt is larger than the search radius', () => {
    const base = gradientFrame();
    const smooth = analyseFrames(
      Array.from({ length: 6 }, (_, index) => withTiming(cyclicShiftFrame(base, index * 3, 0), index)),
    );
    const smoothShake = Math.max(...smooth.slice(1).map((metric) => metric.shake));

    const random = mulberry32(2024);
    const jolted: Frame[] = [];
    for (let i = 0; i < 6; i += 1) {
      const dx = 9 + Math.floor(random() * 17);
      jolted.push(withTiming(base, i * 2));
      jolted.push(withTiming(cyclicShiftFrame(base, dx, 0), i * 2 + 1));
    }
    const joltedMetrics = analyseFrames(jolted);
    const joltedShake = Math.min(...joltedMetrics.slice(1).map((metric) => metric.shake));

    expect(smoothShake).toBeLessThan(0.5);
    expect(joltedShake).toBeGreaterThan(smoothShake + 10);
  });

  it('absorbs a 2 px static offset without blurring the motion reading', () => {
    const base = gradientFrame();
    const pair = [withTiming(base, 0), withTiming(shiftedFrame(base, 2, 1), 1)];
    const metrics = analyseFrames(pair);

    expect(itemAt(metrics, 1).shake).toBeLessThan(1);
    expect(itemAt(metrics, 1).meanAbsDiff).toBeGreaterThan(1);
  });

  it('with searchRadius 0 falls back to the raw difference', () => {
    const base = gradientFrame();
    const pair = [withTiming(base, 0), withTiming(shiftedFrame(base, 2, 1), 1)];
    const metrics = analyseFrames(pair, { searchRadius: 0 });

    expect(itemAt(metrics, 1).shake).toBeGreaterThan(1);
    expect(itemAt(metrics, 1).shake).toBe(itemAt(metrics, 1).meanAbsDiff);
  });
});

describe('analyseFrames — colourfulness', () => {
  it('is 0 when the frame carries no colour plane', () => {
    expect(itemAt(analyseFrames([solidFrame(128)]), 0).colourfulness).toBe(0);
  });

  it('is 0 for a neutral colour plane and 1 for saturated complementary colour', () => {
    const grey = solidFrame(128);
    const greyColour = makeFrame(grey.gray, {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      colour: colourBuffer(DEFAULT_WIDTH, DEFAULT_HEIGHT, () => [128, 128, 128]),
    });
    const vividColour = makeFrame(grey.gray, {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      colour: colourBuffer(DEFAULT_WIDTH, DEFAULT_HEIGHT, (x) =>
        x % 2 === 0 ? [255, 0, 0] : [0, 0, 255],
      ),
    });

    expect(itemAt(analyseFrames([greyColour]), 0).colourfulness).toBe(0);
    expect(itemAt(analyseFrames([vividColour]), 0).colourfulness).toBe(1);
  });
});

describe('analyseFrames — contract', () => {
  it('is deterministic: the same frames produce byte-identical metrics JSON', () => {
    const build = (): Frame[] =>
      sequence(
        9,
        (index) => {
          const base =
            index % 3 === 0
              ? gradientFrame()
              : index % 3 === 1
                ? noiseFrame(index + 1)
                : checkerboardFrame();
          return makeFrame(base.gray, {
            width: base.width,
            height: base.height,
            colour: colourBuffer(base.width, base.height, (x, y) => [
              (x * 4) % 256,
              (y * 5) % 256,
              90,
            ]),
          });
        },
        { fps: 12 },
      );

    expect(JSON.stringify(analyseFrames(build()))).toBe(JSON.stringify(analyseFrames(build())));
  });

  it('handles a single frame and no frames', () => {
    const metrics = analyseFrames([solidFrame(10)]);

    expect(analyseFrames([])).toEqual([]);
    expect(metrics).toHaveLength(1);
    expect(itemAt(metrics, 0)).toMatchObject({
      index: 0,
      t: 0,
      meanAbsDiff: 0,
      shake: 0,
      motionEnergy: 0,
    });
  });

  it('throws RangeError when the gray buffer disagrees with the dimensions', () => {
    const frame = makeFrame(new Uint8Array(63), { width: 8, height: 8 });
    expect(() => analyseFrames([frame])).toThrow(RangeError);
  });

  it('throws for a zero-size frame', () => {
    expect(() =>
      analyseFrames([makeFrame(new Uint8Array(0), { width: 0, height: 0 })]),
    ).toThrow(RangeError);
    expect(() => analyseFrames([makeFrame(new Uint8Array(0), { width: 8, height: 0 })])).toThrow();
  });

  it('throws RangeError when the colour buffer disagrees with the dimensions', () => {
    const frame = makeFrame(new Uint8Array(4).fill(10), {
      width: 2,
      height: 2,
      colour: new Uint8Array(4),
    });
    expect(() => analyseFrames([frame])).toThrow(RangeError);
  });

  it('rejects options outside their domain', () => {
    const frames = [solidFrame(0)];
    expect(() => analyseFrames(frames, { searchRadius: -1 })).toThrow(RangeError);
    expect(() => analyseFrames(frames, { searchRadius: 1.5 })).toThrow(RangeError);
    expect(() => analyseFrames(frames, { clipLow: 300 })).toThrow(RangeError);
    expect(() => analyseFrames(frames, { clipHigh: Number.NaN })).toThrow(RangeError);
  });
});
