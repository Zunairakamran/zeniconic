import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ffmpegPath, probe } from '../src/index';
import { nodeRunner } from '../src/runner';

function hasFfmpeg(): boolean {
  try {
    return existsSync(ffmpegPath());
  } catch {
    return false;
  }
}

const ffmpegAvailable = hasFfmpeg();

// Every temp directory created by this suite, so cleanup survives a failed assertion.
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  for (const dir of tempDirs) {
    expect(existsSync(dir)).toBe(false);
  }
});

describe('probe integration', () => {
  it.skipIf(!ffmpegAvailable)(
    'probes a generated 1 second 320x240 clip',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'zeniconic-media-'));
      tempDirs.push(dir);

      const file = join(dir, 'testsrc.mp4');

      const generated = await nodeRunner.run(ffmpegPath(), [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=30',
        '-t',
        '1',
        '-pix_fmt',
        'yuv420p',
        file,
      ]);

      expect(generated.stderr).toBe('');
      expect(generated.code).toBe(0);
      expect(existsSync(file)).toBe(true);

      const result = await probe(file);

      expect(result.durationSec).toBeGreaterThanOrEqual(0.8);
      expect(result.durationSec).toBeLessThanOrEqual(1.2);
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.orientation).toBe('landscape');
      expect(result.hasAudio).toBe(false);
      expect(result.fps).toBeCloseTo(30, 2);
      expect(result.codec).toBe('h264');
    },
  );
});
