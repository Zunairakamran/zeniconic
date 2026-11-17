import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { analyseReference } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'media');

/** Fixtures are generated on demand; the generator refuses nothing silently. */
function ensureFixture(name: string): string {
  const file = join(fixtureDir, `${name}.mp4`);
  if (existsSync(file)) return file;

  const script = join(repoRoot, 'scripts', 'make-media-fixtures.mjs');
  const result = spawnSync(process.execPath, [script, name], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0 || !existsSync(file)) {
    throw new Error(
      `Could not generate fixture "${name}". Run "node scripts/make-media-fixtures.mjs".\n` +
        `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return file;
}

describe('analyseReference — real ffmpeg on generated fixtures', () => {
  it(
    'reads the fast-cut 9:16 fixture as four fast shots with a 3-5 colour palette',
    async () => {
      const file = ensureFixture('fast-cut-9x16');
      const profile = await analyseReference(file);

      expect(profile.shotCount).toBeGreaterThan(3);
      expect(profile.pacing).toBe('fast');
      expect(profile.aspect).toBe('9:16');
      expect(profile.width).toBe(540);
      expect(profile.height).toBe(960);
      expect(profile.palette.length).toBeGreaterThanOrEqual(3);
      expect(profile.palette.length).toBeLessThanOrEqual(5);
      for (const colour of profile.palette) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      }

      expect(profile.transitionsGuess).toBe('cuts');
      expect(profile.motion).toBe('low');
      expect(profile.motionScore).toBeLessThan(0.015);
      expect(profile.shotDurationsSec.reduce((a, b) => a + b, 0)).toBeCloseTo(
        profile.durationSec,
        2,
      );
      expect(profile.loudnessLufs).toBeTypeOf('number');
      expect(profile.hasVoice).toBeUndefined();
      expect(profile.confidence).toBeGreaterThanOrEqual(0.8);
      expect(profile.style.pacing).toBe('fast');
      expect(profile.sources.shotCount.method).toBe('frame-diff');
    },
    60_000,
  );

  it(
    'skips loudness for a silent fixture instead of inventing a number',
    async () => {
      const file = ensureFixture('no-audio');
      const profile = await analyseReference(file);

      expect(profile.aspect).toBe('16:9');
      expect(profile.loudnessLufs).toBeUndefined();
      expect(profile.sources.loudnessLufs.method).toBe('unavailable');
    },
    60_000,
  );
});
