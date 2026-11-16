import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  SceneSplitError,
  detectSceneCuts,
  detectScenes,
  fallbackShots,
  parseFfmpegDuration,
  parseShowinfo,
  shotsFromCuts,
  splitScenes,
} from '../src/index';
import type { Runner } from '@zeniconic/media';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/showinfo.txt', import.meta.url)),
  'utf8',
);

const CUTS = [1.5, 4.233, 4.266, 4.566, 9, 12.5, 12.7, 18];

function fakeRunner(
  output: { code?: number; stdout?: string; stderr?: string },
  calls: { bin: string; args: string[] }[] = [],
): Runner {
  return {
    run(bin, args) {
      calls.push({ bin, args });
      return Promise.resolve({
        code: output.code ?? 0,
        stdout: output.stdout ?? '',
        stderr: output.stderr ?? '',
      });
    },
  };
}

describe('parseShowinfo', () => {
  it('reads every cut from a recorded showinfo fixture, once and in order', () => {
    expect(parseShowinfo(FIXTURE)).toEqual(CUTS);
  });

  it('ignores showinfo config lines and duplicate frames', () => {
    const output = [
      '[Parsed_showinfo_1 @ 1] config in time_base: 1/15360, frame_rate: 30/1',
      '[Parsed_showinfo_1 @ 1] n:  45 pts: 1 pts_time:1.5 pos:1',
      '[Parsed_showinfo_1 @ 1] n:  45 pts: 1 pts_time:1.5 pos:1',
      '[Parsed_showinfo_1 @ 1] n:  60 pts: 2 pts_time:N/A pos:2',
    ].join('\n');

    expect(parseShowinfo(output)).toEqual([1.5]);
  });

  it('returns an empty list when the detector found nothing', () => {
    expect(parseShowinfo('frame=  720 fps=96 q=-0.0 Lsize=N/A time=00:00:24.00')).toEqual([]);
  });
});

describe('parseFfmpegDuration', () => {
  it('parses the input banner', () => {
    expect(parseFfmpegDuration('  Duration: 00:00:24.00, start: 0.000000, bitrate: 4218 kb/s')).toBe(24);
    expect(parseFfmpegDuration('  Duration: 00:01:02.50, start: 0.000000')).toBe(62.5);
  });

  it('rejects a missing or N/A duration', () => {
    expect(parseFfmpegDuration('  Duration: N/A, bitrate: N/A')).toBeUndefined();
    expect(parseFfmpegDuration('no banner')).toBeUndefined();
  });
});

describe('shotsFromCuts', () => {
  it('splits a fixture into shots and merges short fragments into a neighbour', () => {
    const shots = shotsFromCuts(CUTS, 24, { handleFrames: 0 });

    expect(shots).toEqual([
      { index: 0, startSec: 0, endSec: 1.5, durationSec: 1.5 },
      { index: 1, startSec: 1.5, endSec: 4.566, durationSec: 3.066 },
      { index: 2, startSec: 4.566, endSec: 9, durationSec: 4.434 },
      { index: 3, startSec: 9, endSec: 12.7, durationSec: 3.7 },
      { index: 4, startSec: 12.7, endSec: 18, durationSec: 5.3 },
      { index: 5, startSec: 18, endSec: 24, durationSec: 6 },
    ]);
    expect(shots.every((shot) => shot.durationSec >= 0.8)).toBe(true);
  });

  it('folds a short first shot forward, not out of the timeline', () => {
    const shots = shotsFromCuts([0.4, 3], 6, { handleFrames: 0 });

    expect(shots[0]?.startSec).toBe(0);
    expect(shots[0]?.endSec).toBe(3);
    expect(shots.reduce((sum, shot) => sum + shot.durationSec, 0)).toBeCloseTo(6, 6);
  });

  it('keeps a two-frame handle on each internal edge without overlapping', () => {
    const shots = shotsFromCuts(CUTS, 24, { handleFrames: 2, fps: 30 });

    expect(shots[0]?.startSec).toBe(0);
    expect(shots[shots.length - 1]?.endSec).toBe(24);
    expect(shots[1]?.startSec).toBeCloseTo(1.5 + 2 / 30, 2);
    expect(shots[1]?.endSec).toBeCloseTo(4.566 - 2 / 30, 2);

    for (let index = 1; index < shots.length; index += 1) {
      const previous = shots[index - 1];
      const current = shots[index];
      if (!previous || !current) continue;
      expect(current.startSec).toBeGreaterThan(previous.endSec);
    }
  });

  it('enforces the minimum rather than trimming a shot below it', () => {
    const shots = shotsFromCuts([1.0, 2.0], 4, { handleFrames: 10, fps: 30 });

    expect(shots.every((shot) => shot.durationSec >= 0.8)).toBe(true);
  });

  it('is deterministic and rejects non-positive durations', () => {
    expect(shotsFromCuts(CUTS, 24)).toEqual(shotsFromCuts(CUTS, 24));
    expect(() => shotsFromCuts(CUTS, 0)).toThrow(RangeError);
  });
});

describe('fallbackShots', () => {
  it('cuts fixed four-second chunks', () => {
    expect(fallbackShots(10)).toEqual([
      { index: 0, startSec: 0, endSec: 4, durationSec: 4 },
      { index: 1, startSec: 4, endSec: 8, durationSec: 4 },
      { index: 2, startSec: 8, endSec: 10, durationSec: 2 },
    ]);
  });

  it('merges a short tail into the previous chunk', () => {
    const shots = fallbackShots(8.4);

    expect(shots).toHaveLength(2);
    expect(shots[1]).toEqual({ index: 1, startSec: 4, endSec: 8.4, durationSec: 4.4 });
  });
});

describe('detectScenes / detectSceneCuts', () => {
  it('runs ffmpeg with the requested scene threshold and parses cuts + duration', async () => {
    const calls: { bin: string; args: string[] }[] = [];
    const runner = fakeRunner({ stderr: FIXTURE }, calls);

    const detection = await detectScenes('imports/14-oak-avenue.mp4', {
      runner,
      ffmpegBin: 'ffmpeg',
      threshold: 0.35,
    });

    expect(detection.cuts).toEqual(CUTS);
    expect(detection.durationSec).toBe(24);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("select='gt(scene,0.35)',showinfo");
    expect(calls[0]?.args).toContain('imports/14-oak-avenue.mp4');
  });

  it('throws a typed E_NO_SCENES from the strict accessor', async () => {
    const runner = fakeRunner({
      stderr: '  Duration: 00:00:10.00, start: 0.000000\nframe= 300 fps=90 q=-0.0',
    });

    await expect(
      detectSceneCuts('flat.mp4', { runner, ffmpegBin: 'ffmpeg' }),
    ).rejects.toMatchObject({ name: 'SceneSplitError', code: 'E_NO_SCENES' });
  });

  it('throws a typed E_FFMPEG when the process fails', async () => {
    const runner = fakeRunner({ code: 1, stderr: 'Invalid data found when processing input' });

    await expect(
      splitScenes('broken.mp4', { runner, ffmpegBin: 'ffmpeg', durationSec: 24 }),
    ).rejects.toBeInstanceOf(SceneSplitError);
    await expect(
      splitScenes('broken.mp4', { runner, ffmpegBin: 'ffmpeg', durationSec: 24 }),
    ).rejects.toMatchObject({ code: 'E_FFMPEG' });
  });
});

describe('splitScenes', () => {
  it('returns detected shots and no warnings', async () => {
    const runner = fakeRunner({ stderr: FIXTURE });
    const result = await splitScenes('imports/14-oak-avenue.mp4', {
      runner,
      ffmpegBin: 'ffmpeg',
    });

    expect(result.method).toBe('scene');
    expect(result.warnings).toEqual([]);
    expect(result.shots).toHaveLength(6);
    expect(result.threshold).toBe(0.3);
  });

  it('falls back to four-second chunks with a warning when no scene changes exist', async () => {
    const runner = fakeRunner({
      stderr: 'Input #0\n  Duration: 00:00:10.00, start: 0.000000\nframe= 300 fps=90 q=-0.0',
    });
    const result = await splitScenes('flat.mp4', { runner, ffmpegBin: 'ffmpeg' });

    expect(result.method).toBe('fallback');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('W_NO_SCENES');
    expect(result.shots).toEqual([
      { index: 0, startSec: 0, endSec: 4, durationSec: 4 },
      { index: 1, startSec: 4, endSec: 8, durationSec: 4 },
      { index: 2, startSec: 8, endSec: 10, durationSec: 2 },
    ]);
  });

  it('probes the duration when the banner has none', async () => {
    const calls: { bin: string; args: string[] }[] = [];
    const runner: Runner = {
      run(bin, args) {
        calls.push({ bin, args });
        if (args.includes('format=duration')) {
          return Promise.resolve({ code: 0, stdout: '12.5\n', stderr: '' });
        }
        return Promise.resolve({
          code: 0,
          stdout: '',
          stderr: 'Input #0\nframe= 300 fps=90 q=-0.0',
        });
      },
    };

    const result = await splitScenes('flat.mp4', { runner, ffmpegBin: 'ffmpeg' });

    expect(calls).toHaveLength(2);
    expect(result.method).toBe('fallback');
    expect(result.shots[result.shots.length - 1]?.endSec).toBe(12.5);
  });
});
