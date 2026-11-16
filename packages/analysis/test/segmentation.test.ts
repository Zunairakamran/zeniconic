import { describe, expect, it } from 'vitest';
import { analyseFrames, segmentShots, type Shot } from '../src/index';
import { itemAt, metricSeries, sequence, solidFrame } from './helpers';

describe('segmentShots — cuts', () => {
  it('returns no shots for an empty metric stream', () => {
    expect(segmentShots([])).toEqual([]);
  });

  it('treats 20 identical black frames as a single shot', () => {
    const metrics = analyseFrames(sequence(20, () => solidFrame(0)));
    const shots = segmentShots(metrics);

    expect(shots).toHaveLength(1);
    expect(itemAt(shots, 0)).toEqual({
      id: 'sh_001',
      startIndex: 0,
      endIndex: 19,
      startSec: 0,
      endSec: 1.9,
      representativeFrames: [0, 10, 19],
    });
  });

  it('cuts black then white at frame 10 into two shots', () => {
    const metrics = analyseFrames(sequence(20, (index) => solidFrame(index < 10 ? 0 : 255)));
    const shots = segmentShots(metrics);

    expect(itemAt(metrics, 10).meanAbsDiff).toBe(255);
    expect(shots.map((shot) => [shot.id, shot.startIndex, shot.endIndex])).toEqual([
      ['sh_001', 0, 9],
      ['sh_002', 10, 19],
    ]);
    expect(itemAt(shots, 0).endSec).toBe(0.9);
    expect(itemAt(shots, 1).startSec).toBe(1);
    expect(itemAt(shots, 1).endSec).toBe(1.9);
  });

  it('numbers three shots in order', () => {
    const metrics = analyseFrames(
      sequence(30, (index) => solidFrame(index >= 10 && index < 20 ? 255 : 0)),
    );
    const shots = segmentShots(metrics);

    expect(shots.map((shot) => shot.id)).toEqual(['sh_001', 'sh_002', 'sh_003']);
    expect(shots.map((shot) => [shot.startIndex, shot.endIndex])).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it('raises the boundary bar to the clip median so ordinary motion stays inside one shot', () => {
    const diffs = Array.from({ length: 21 }, (_, index) => (index === 10 ? 100 : 20));
    const shots = segmentShots(metricSeries(diffs));

    // median 20 × 3 = 60, so the 20s never qualify and only the 100 splits.
    expect(shots).toHaveLength(2);
    expect(itemAt(shots, 0).endIndex).toBe(9);
    expect(itemAt(shots, 1).startIndex).toBe(10);
  });

  it('lets absThreshold suppress a cut the median would allow', () => {
    const shots = segmentShots(metricSeries([0, 0, 40, 0, 0]), { absThreshold: 100 });
    expect(shots).toHaveLength(1);
  });
});

describe('segmentShots — minimum shot length', () => {
  it('merges two 0.1 s shots into one when the minimum is 0.6 s', () => {
    const metrics = metricSeries([0, 0, 0, 255, 0, 0], 0.05);
    const shots = segmentShots(metrics);

    expect(shots).toHaveLength(1);
    expect(itemAt(shots, 0)).toMatchObject({
      id: 'sh_001',
      startIndex: 0,
      endIndex: 5,
      startSec: 0,
      endSec: 0.25,
    });
  });

  it('keeps those two shots when the minimum allows them', () => {
    const metrics = metricSeries([0, 0, 0, 255, 0, 0], 0.05);
    const shots = segmentShots(metrics, { minShotSec: 0.05 });

    expect(shots.map((shot) => [shot.startIndex, shot.endIndex])).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it('merges a short shot into its shorter neighbour', () => {
    const diffs = Array.from({ length: 19 }, () => 0);
    diffs[11] = 255;
    diffs[13] = 255;
    // A: 0.0–1.0 s, B: 1.1–1.2 s, C: 1.3–1.8 s at 0.1 s per frame.
    const shots = segmentShots(metricSeries(diffs));

    expect(shots.map((shot) => [shot.startIndex, shot.endIndex])).toEqual([
      [0, 10],
      [11, 18],
    ]);
  });

  it('collapses a jittery clip down to a single shot rather than emit tiny ones', () => {
    const diffs = [0, 255, 255, 255, 255, 255];
    const shots = segmentShots(metricSeries(diffs, 0.1));

    expect(shots).toHaveLength(1);
    expect(itemAt(shots, 0)).toMatchObject({ startIndex: 0, endIndex: 5 });
  });

  it('never emits an empty shot and always covers every frame exactly once', () => {
    const diffs = Array.from({ length: 12 }, (_, index) => (index % 3 === 0 ? 200 : 0));
    const shots = segmentShots(metricSeries(diffs, 0.05));

    expect(itemAt(shots, 0).startIndex).toBe(0);
    expect(itemAt(shots, shots.length - 1).endIndex).toBe(11);
    for (let i = 0; i < shots.length; i += 1) {
      const shot = itemAt(shots, i);
      expect(shot.endIndex).toBeGreaterThanOrEqual(shot.startIndex);
      expect(shot.representativeFrames.length).toBeGreaterThan(0);
      if (i > 0) expect(shot.startIndex).toBe(itemAt(shots, i - 1).endIndex + 1);
    }
  });
});

describe('segmentShots — representatives', () => {
  it('spaces representatives evenly and includes the first and last frame', () => {
    const metrics = analyseFrames(sequence(20, (index) => solidFrame(index < 10 ? 0 : 255)));
    const shots = segmentShots(metrics, { representativeCount: 5 });

    expect(itemAt(shots, 0).representativeFrames).toEqual([0, 2, 5, 7, 9]);
    expect(itemAt(shots, 1).representativeFrames).toEqual([10, 12, 15, 17, 19]);
  });

  it('returns the only frame for a one-frame shot and a single pick for count 1', () => {
    const single = segmentShots(analyseFrames([solidFrame(0)]));
    expect(itemAt(single, 0).representativeFrames).toEqual([0]);

    const metrics = analyseFrames(sequence(20, () => solidFrame(0)));
    const one = segmentShots(metrics, { representativeCount: 1 });
    expect(itemAt(one, 0).representativeFrames).toEqual([0]);
  });

  it('returns every frame when the shot is shorter than the request', () => {
    const metrics = analyseFrames(sequence(4, () => solidFrame(0)));
    const shots = segmentShots(metrics, { representativeCount: 10 });

    expect(itemAt(shots, 0).representativeFrames).toEqual([0, 1, 2, 3]);
  });
});

describe('segmentShots — contract', () => {
  it('is deterministic for the same metrics', () => {
    const build = (): Shot[] =>
      segmentShots(
        analyseFrames(
          sequence(24, (index) => solidFrame(index % 8 === 0 ? 255 : 0), { fps: 12 }),
        ),
      );

    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('rejects options outside their domain', () => {
    const metrics = metricSeries([0, 0, 0]);

    expect(() => segmentShots(metrics, { absThreshold: -1 })).toThrow(RangeError);
    expect(() => segmentShots(metrics, { medianMultiplier: Number.NaN })).toThrow(RangeError);
    expect(() => segmentShots(metrics, { minShotSec: -0.1 })).toThrow(RangeError);
    expect(() => segmentShots(metrics, { representativeCount: 0 })).toThrow(RangeError);
    expect(() => segmentShots(metrics, { representativeCount: 2.5 })).toThrow(RangeError);
  });
});
