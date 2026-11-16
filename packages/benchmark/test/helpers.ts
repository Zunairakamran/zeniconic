/** Deterministic fixtures for the benchmark suite. */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { ffmpegPath } from '@zeniconic/media';

import type { StyleProfile } from '../src/index';

/** A 30 s, 9:16 reference-shaped profile that individual tests vary. */
export function baseProfile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  const rhythm = Array.from({ length: 15 }, () => 2);
  return {
    durationSec: 30,
    width: 1080,
    height: 1920,
    fps: 30,
    orientation: 'portrait',
    shotCount: 15,
    avgShotSec: 2,
    medianShotSec: 2,
    minShotSec: 1.2,
    maxShotSec: 3,
    cutsPerMinute: 28,
    cutRhythm: rhythm,
    brightness: 0.42,
    contrast: 0.18,
    saturation: 0.3,
    motionEnergy: 0.06,
    staticRatio: 0.1,
    ...overrides,
  };
}

/** Rebuilds a profile with one uniform shot length but the same total duration. */
export function pacedProfile(profile: StyleProfile, shotSec: number): StyleProfile {
  const shotCount = Math.max(1, Math.round(profile.durationSec / shotSec));
  const actualShotSec = profile.durationSec / shotCount;
  return {
    ...profile,
    shotCount,
    avgShotSec: actualShotSec,
    medianShotSec: actualShotSec,
    minShotSec: actualShotSec,
    maxShotSec: actualShotSec,
    cutsPerMinute: ((shotCount - 1) / profile.durationSec) * 60,
    cutRhythm: Array.from({ length: shotCount }, () => actualShotSec),
  };
}

export function ffmpegAvailable(): boolean {
  try {
    return existsSync(ffmpegPath());
  } catch {
    return false;
  }
}

/**
 * Writes a landscape clip of hard-cut solid colours. Landscape 16:9 keeps the
 * decoder's 160x90 request exact, which is also what a portal reference uses.
 * Returns the output path; the caller owns the temp directory.
 */
export function makeThreeShotClip(
  file: string,
  colours: readonly [string, string, string] = ['black', 'white', 'gray'],
  secondsPerShot = 2,
  width = 480,
  height = 270,
): string {
  const inputs = colours.flatMap((colour) => [
    '-f',
    'lavfi',
    '-i',
    `color=c=${colour}:s=${width}x${height}:r=30:d=${secondsPerShot}`,
  ]);

  const result = spawnSync(
    ffmpegPath(),
    [
      '-y',
      '-v',
      'error',
      ...inputs,
      '-filter_complex',
      `[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]`,
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      file,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(`Could not generate fixture: ${result.stderr.trim() || 'ffmpeg failed'}`);
  }
  return file;
}
