import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareProfiles, profileVideo, targetsFromReference } from '../src/index';
import type { StyleProfile } from '../src/index';
import {
  baseProfile,
  ffmpegAvailable,
  makeThreeShotClip,
  pacedProfile,
} from './helpers';

const ffmpegReady = ffmpegAvailable();

// One generated clip is reused by the integration assertions; the directory is
// removed even when an assertion fails.
const tempDirs: string[] = [];
let clipFile = '';
let clipProfile: StyleProfile | undefined;

beforeAll(() => {
  if (!ffmpegReady) return;
  const dir = mkdtempSync(join(tmpdir(), 'zeniconic-benchmark-'));
  tempDirs.push(dir);
  clipFile = makeThreeShotClip(join(dir, 'three-shots.mp4'));
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  for (const dir of tempDirs) {
    expect(existsSync(dir)).toBe(false);
  }
});

describe('profileVideo', () => {
  it.skipIf(!ffmpegReady)(
    'profiles a three-shot six-second clip',
    async () => {
      const profile = await profileVideo(clipFile);
      clipProfile = profile;

      expect(profile.orientation).toBe('landscape');
      expect(profile.width).toBe(480);
      expect(profile.height).toBe(270);
      expect(profile.durationSec).toBeGreaterThan(5.5);
      expect(profile.durationSec).toBeLessThan(6.5);

      expect(profile.shotCount).toBe(3);
      expect(profile.cutRhythm).toHaveLength(3);

      // Two seconds per shot, so two cuts in six seconds is 20 per minute.
      expect(profile.avgShotSec).toBeGreaterThan(1.7);
      expect(profile.avgShotSec).toBeLessThan(2.3);
      expect(profile.minShotSec).toBeGreaterThan(1.7);
      expect(profile.maxShotSec).toBeLessThan(2.3);
      expect(profile.cutsPerMinute).toBeCloseTo(20, 0);

      // Solid colours hold still: every shot is static.
      expect(profile.staticRatio).toBeGreaterThan(0.9);
      expect(profile.motionEnergy).toBeLessThan(0.05);

      // The decoder emits luma only, so saturation is reported as zero.
      expect(profile.saturation).toBe(0);
    },
  );

  it.skipIf(!ffmpegReady)(
    'produces byte-identical profiles on repeated runs',
    async () => {
      const first = await profileVideo(clipFile);
      const second = await profileVideo(clipFile);
      expect(second).toEqual(first);
      if (clipProfile !== undefined) expect(second).toEqual(clipProfile);
    },
  );
});

describe('compareProfiles', () => {
  it('scores two identical profiles at 100 with no advice', () => {
    const profile = baseProfile();
    const comparison = compareProfiles(profile, profile);

    expect(comparison.score).toBe(100);
    expect(Object.values(comparison.deltas).every((value) => value === 0)).toBe(true);
    expect(comparison.strengths).toEqual([]);
    expect(comparison.weaknesses).toEqual([]);
    expect(comparison.advice).toEqual([]);
  });

  it('scores a one-shot profile against itself at 100 (no divide by zero)', () => {
    const single = baseProfile({
      shotCount: 1,
      avgShotSec: 30,
      medianShotSec: 30,
      minShotSec: 30,
      maxShotSec: 30,
      cutsPerMinute: 0,
      cutRhythm: [30],
    });
    expect(compareProfiles(single, single).score).toBe(100);
  });

  it('scores a slower candidate lower, and slower again lower still', () => {
    const reference = baseProfile();
    // Both sit inside the 35% slow-pace ramp; past it the penalty is capped, so
    // 50% and 100% slower intentionally score the same on pace.
    const slightlySlower = pacedProfile(reference, 2.5);
    const muchSlower = pacedProfile(reference, 2.7);

    const three = compareProfiles(slightlySlower, reference);
    const four = compareProfiles(muchSlower, reference);

    expect(three.deltas.cutsPerMinute).toBeLessThan(0);
    expect(three.score).toBeLessThan(100);
    expect(four.score).toBeLessThan(three.score);
    expect(three.weaknesses.join(' ')).toMatch(/Slower cuts/);
  });

  it('reports normalised deltas as candidate minus reference', () => {
    const reference = baseProfile();
    const candidate = baseProfile({ cutsPerMinute: 42, avgShotSec: 1.5 });
    const { deltas } = compareProfiles(candidate, reference);

    expect(deltas.cutsPerMinute).toBeCloseTo(0.5, 3);
    expect(deltas.avgShotSec).toBeCloseTo(-0.25, 3);
    expect(deltas.durationSec).toBe(0);
    expect(deltas.shotCount).toBe(0);
    expect(deltas.brightness).toBe(0);
    expect(deltas.rhythm).toBe(0);
  });

  it('returns at most four concrete advice lines, ordered by lost points', () => {
    const reference = baseProfile();
    const weak = baseProfile({
      shotCount: 6,
      avgShotSec: 5,
      medianShotSec: 5,
      minShotSec: 5,
      maxShotSec: 5,
      cutsPerMinute: 10,
      cutRhythm: Array.from({ length: 6 }, () => 5),
      brightness: 0.1,
      contrast: 0.5,
      saturation: 0.9,
      motionEnergy: 0.01,
      staticRatio: 0.9,
    });

    const comparison = compareProfiles(weak, reference);

    expect(comparison.score).toBeLessThan(60);
    expect(comparison.advice.length).toBeGreaterThan(0);
    expect(comparison.advice.length).toBeLessThanOrEqual(4);
    expect(comparison.advice.join(' ')).toMatch(/Target 2\.0 s per shot/);
    expect(comparison.advice.every((line) => line.trim().length > 0)).toBe(true);
  });
});

describe('targetsFromReference', () => {
  it('scales shot lengths with the target duration', () => {
    const reference = baseProfile({
      durationSec: 40,
      shotCount: 16,
      avgShotSec: 2.5,
      medianShotSec: 2.5,
      minShotSec: 1.5,
      maxShotSec: 4,
      cutsPerMinute: 22.5,
      cutRhythm: Array.from({ length: 16 }, () => 2.5),
    });

    const targets = targetsFromReference(reference, 30);

    expect(targets.shotCount).toBe(16);
    expect(targets.avgShotSec).toBe(1.875);
    expect(targets.minShotSec).toBe(1.2);
    expect(targets.maxShotSec).toBe(3);
    expect(targets.cutsPerMinute).toBeCloseTo(30, 3);
  });

  it('clamps the average to 1.2-4.5 s and keeps the count consistent', () => {
    const halfLength = baseProfile({
      durationSec: 60,
      shotCount: 30,
      avgShotSec: 2,
      medianShotSec: 2,
      minShotSec: 1,
      maxShotSec: 3.2,
      cutsPerMinute: 29,
      cutRhythm: Array.from({ length: 30 }, () => 2),
    });
    const half = targetsFromReference(halfLength, 30);

    expect(half.avgShotSec).toBe(1.2);
    expect(half.shotCount).toBe(25);
    expect(half.minShotSec).toBe(1.2);
    expect(half.maxShotSec).toBe(1.6);
    expect(half.cutsPerMinute).toBeCloseTo(48, 3);

    const longShots = baseProfile({
      durationSec: 30,
      shotCount: 3,
      avgShotSec: 12,
      medianShotSec: 12,
      minShotSec: 8,
      maxShotSec: 20,
      cutsPerMinute: 4,
      cutRhythm: [10, 10, 10],
    });
    const capped = targetsFromReference(longShots, 30);

    expect(capped.avgShotSec).toBeLessThanOrEqual(4.5);
    expect(capped.avgShotSec).toBeGreaterThanOrEqual(1.2);
    expect(capped.shotCount).toBe(7);
    expect(capped.maxShotSec).toBe(4.5);
    expect(capped.minShotSec).toBeLessThanOrEqual(capped.avgShotSec);
    expect(capped.maxShotSec).toBeGreaterThanOrEqual(capped.avgShotSec);
  });

  it('is deterministic', () => {
    const reference = baseProfile({ durationSec: 67.4, avgShotSec: 2.3 });
    expect(targetsFromReference(reference, 30)).toEqual(targetsFromReference(reference, 30));
  });

  it('rejects a non-positive target duration', () => {
    expect(() => targetsFromReference(baseProfile(), 0)).toThrow(RangeError);
  });
});
