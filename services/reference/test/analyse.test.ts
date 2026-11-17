import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ProbeResult, RawFrame } from '@zeniconic/media';
import { ReferenceAnalysisError, analyseReference } from '../src/index';
import type { ReferenceDeps, ReferenceStyleProfile, RgbSample } from '../src/index';

/**
 * Every test below injects all four local ports, so no suite spawns ffmpeg.
 * The path still has to exist because `analyseReference` refuses to guess: that
 * is the behaviour a URL/unreadable input test relies on.
 */

let workDir: string;
let file: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'zeniconic-reference-'));
  file = join(workDir, 'reference.mp4');
  writeFileSync(file, 'not real media — ports are mocked');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function probeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    durationSec: 6,
    width: 540,
    height: 960,
    fps: 30,
    codec: 'h264',
    bitrate: 1_000_000,
    hasAudio: true,
    orientation: 'portrait',
    rotation: 0,
    ...overrides,
  };
}

/** A luma stream at `fps`; scene changes are modelled as a step in value. */
function framesFrom(lumas: readonly number[], fps = 10): AsyncGenerator<RawFrame> {
  async function* generate(): AsyncGenerator<RawFrame> {
    for (let index = 0; index < lumas.length; index += 1) {
      const gray = new Uint8Array(48 * 48);
      gray.fill(lumas[index] ?? 0);
      yield {
        index,
        t: index / fps,
        width: 48,
        height: 48,
        gray,
      };
    }
  }
  return generate();
}

/** `scenes` frames per scene, alternating between two distinct luma levels. */
function stepScenes(scenes: readonly number[], framesPerScene: number, fps = 10): number[] {
  const lumas: number[] = [];
  scenes.forEach((luma, scene) => {
    for (let frame = 0; frame < framesPerScene; frame += 1) {
      lumas.push(scene % 2 === 0 ? luma : 255 - luma);
    }
  });
  return lumas;
}

const PALETTE: RgbSample[] = [
  { r: 176, g: 58, b: 46 },
  { r: 31, g: 111, b: 120 },
  { r: 224, g: 192, b: 104 },
  { r: 42, g: 75, b: 141 },
];

function baseDeps(
  lumas: readonly number[],
  overrides: Partial<ReferenceDeps> = {},
): ReferenceDeps {
  return {
    probe: () => Promise.resolve(probeResult()),
    readFrames: () => framesFrom(lumas),
    measureLoudness: () => Promise.resolve(-14.2),
    samplePalette: () => Promise.resolve(PALETTE),
    ...overrides,
  };
}

describe('analyseReference derivation boundaries', () => {
  it('calls four ~1.5 s shots fast and a single 12 s hold slow', async () => {
    const fast = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160, 40, 160], 15), {
        probe: () => Promise.resolve(probeResult({ durationSec: 6 })),
      }),
    );

    expect(fast.shotCount).toBe(4);
    expect(fast.averageShotSec).toBe(1.5);
    expect(fast.pacing).toBe('fast');
    expect(fast.shotDurationsSec).toHaveLength(4);
    expect(fast.shotDurationsSec.reduce((a, b) => a + b, 0)).toBeCloseTo(6, 3);
    expect(fast.cutDensityPerMin).toBe(30);

    const slow = await analyseReference(
      file,
      baseDeps(new Array<number>(120).fill(60), {
        probe: () =>
          Promise.resolve(
            probeResult({ durationSec: 12, width: 1920, height: 1080, orientation: 'landscape' }),
          ),
      }),
    );

    expect(slow.shotCount).toBe(1);
    expect(slow.averageShotSec).toBe(12);
    expect(slow.pacing).toBe('slow');
    expect(slow.cutDensityPerMin).toBe(0);
  });

  it('sits on either side of the 2 s and 3.5 s pacing boundaries', async () => {
    const medium = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160, 40, 160], 30), {
        probe: () => Promise.resolve(probeResult({ durationSec: 12 })),
      }),
    );
    expect(medium.averageShotSec).toBe(3);
    expect(medium.pacing).toBe('medium');

    const slow = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160, 40, 160], 35), {
        probe: () => Promise.resolve(probeResult({ durationSec: 14 })),
      }),
    );
    expect(slow.averageShotSec).toBe(3.5);
    expect(slow.pacing).toBe('slow');
  });

  it('ignores cut spikes when scoring motion, so a fast cut stays calm', async () => {
    const fastCuts = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160, 40, 160], 15)),
    );
    expect(fastCuts.motionScore).toBe(0);
    expect(fastCuts.motion).toBe('low');

    const handheld = await analyseReference(
      file,
      baseDeps(
        Array.from({ length: 40 }, (_unused, index) => (index % 2 === 0 ? 30 : 230)),
        { probe: () => Promise.resolve(probeResult({ durationSec: 4 })) },
      ),
    );
    expect(handheld.motionScore).toBeGreaterThan(0.05);
    expect(handheld.motion).toBe('high');
  });

  it('derives aspect and palette from the measured values', async () => {
    const profile = await analyseReference(file, baseDeps(stepScenes([40, 160], 15)));

    expect(profile.aspect).toBe('9:16');
    expect(profile.palette).toHaveLength(4);
    expect(new Set(profile.palette).size).toBe(4);
    expect(profile.transitionsGuess).toBe('cuts');
    expect(profile.style.pacing).toBe(profile.pacing);
    expect(profile.style.transition_style).toBe('hard cuts');
  });

  it('measures loudness only when the source has an audio stream', async () => {
    const measureLoudness = vi.fn(() => Promise.resolve(-16.4));
    const withAudio = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160], 15), { measureLoudness }),
    );
    expect(measureLoudness).toHaveBeenCalledTimes(1);
    expect(withAudio.loudnessLufs).toBe(-16.4);
    expect(withAudio.sources.loudnessLufs.method).toBe('ebur128');

    const silent = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160], 15), {
        probe: () => Promise.resolve(probeResult({ hasAudio: false })),
        measureLoudness,
      }),
    );
    expect(measureLoudness).toHaveBeenCalledTimes(1); // not called a second time
    expect(silent.loudnessLufs).toBeUndefined();
    expect(silent.sources.loudnessLufs.method).toBe('unavailable');
  });

  it('omits hasVoice unless a transcript port is supplied', async () => {
    const without = await analyseReference(file, baseDeps(stepScenes([40, 160], 15)));
    expect(without.hasVoice).toBeUndefined();
    expect(without.sources.hasVoice.method).toBe('unavailable');

    const withTranscript = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160], 15), {
        transcript: () => Promise.resolve({ hasVoice: true, text: 'welcome in' }),
      }),
    );
    expect(withTranscript.hasVoice).toBe(true);
    expect(withTranscript.sources.transcript?.method).toBe('transcript');
  });

  it('lets vision enrich soft fields but never a measured number', async () => {
    const vision = vi.fn(() =>
      Promise.resolve({
        style: {
          captions_style: 'ignored',
          caption_style: 'bold centre captions',
          motion_graphics: 'kinetic price card',
        },
        palette: ['#112233', '#445566', '#778899'],
        transitionsGuess: 'mixed' as const,
        // A hostile/over-eager port must not move a measured value.
        pacing: 'slow' as const,
        durationSec: 999,
        shotCount: 99,
      } as unknown as Partial<ReferenceStyleProfile>),
    );

    const profile = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160, 40, 160], 15), { vision }),
    );

    expect(vision).toHaveBeenCalledTimes(1);
    expect(profile.style.caption_style).toBe('bold centre captions');
    expect(profile.style.motion_graphics).toBe('kinetic price card');
    expect(profile.palette).toEqual(['#112233', '#445566', '#778899']);
    expect(profile.transitionsGuess).toBe('mixed');
    expect(profile.sources.vision?.method).toBe('vision');

    // Measured values win.
    expect(profile.durationSec).toBe(6);
    expect(profile.shotCount).toBe(4);
    expect(profile.pacing).toBe('fast');
  });

  it('degrades loudly-but-safely when an enrichment port fails', async () => {
    const profile = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160], 15), {
        measureLoudness: () => Promise.reject(new Error('no decoder')),
        transcript: () => Promise.reject(new Error('offline')),
        vision: () => Promise.reject(new Error('rate limited')),
      }),
    );

    expect(profile.loudnessLufs).toBeUndefined();
    expect(profile.sources.loudnessLufs.method).toBe('unavailable');
    expect(profile.sources.transcript?.method).toBe('unavailable');
    expect(profile.sources.vision?.method).toBe('unavailable');
    expect(profile.hasVoice).toBeUndefined();
  });

  it('scores confidence from the evidence actually present', async () => {
    const plain = await analyseReference(file, baseDeps(stepScenes([40, 160], 15)));
    expect(plain.confidence).toBe(0.9);

    const unmeasured = await analyseReference(
      file,
      baseDeps(stepScenes([40, 160], 15), {
        probe: () => Promise.resolve(probeResult({ hasAudio: false })),
      }),
    );
    expect(unmeasured.confidence).toBe(0.75);
  });
});

describe('analyseReference input validation', () => {
  it('refuses a URL with a typed error and never probes it', async () => {
    const probe = vi.fn(() => Promise.resolve(probeResult()));

    await expect(
      analyseReference('https://example.com/competitor.mp4', { probe }),
    ).rejects.toMatchObject({
      name: 'ReferenceAnalysisError',
      code: 'E_URL_NOT_ALLOWED',
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses other download-style schemes', async () => {
    for (const url of ['http://x/a.mp4', 'ftp://x/a.mp4', 'data:video/mp4;base64,AAAA']) {
      await expect(analyseReference(url, {})).rejects.toBeInstanceOf(
        ReferenceAnalysisError,
      );
      await expect(analyseReference(url, {})).rejects.toMatchObject({
        code: 'E_URL_NOT_ALLOWED',
      });
    }
  });

  it('refuses a missing path and a directory', async () => {
    await expect(
      analyseReference(join(workDir, 'nope.mp4'), {}),
    ).rejects.toMatchObject({ code: 'E_NOT_A_FILE' });

    await expect(analyseReference(workDir, {})).rejects.toMatchObject({
      code: 'E_NOT_A_FILE',
    });

    await expect(analyseReference('', {})).rejects.toMatchObject({
      code: 'E_NOT_A_FILE',
    });
  });

  it('wraps probe failures with a typed error', async () => {
    await expect(
      analyseReference(file, {
        probe: () => Promise.reject(new Error('ffprobe exploded')),
      }),
    ).rejects.toMatchObject({ code: 'E_PROBE_FAILED' });
  });

  it('wraps decode failures with a typed error', async () => {
    await expect(
      analyseReference(file, {
        probe: () => Promise.resolve(probeResult()),
        readFrames: () =>
          (async function* failing(): AsyncGenerator<RawFrame> {
            throw new Error('decode exploded');
            yield* [];
          })(),
      }),
    ).rejects.toMatchObject({ code: 'E_ANALYSIS_FAILED' });
  });
});
