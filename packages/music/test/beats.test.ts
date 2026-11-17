import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import { detectBeatsFromFile, detectBeatsFromSamples } from '../src/index';

const SAMPLE_RATE = 22_050;

/** Synthetic click track: one full-scale impulse on every beat. */
function clickTrack(bpm: number, seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const intervalSec = 60 / bpm;

  for (let beat = 0; beat * intervalSec < seconds; beat += 1) {
    const index = Math.round(beat * intervalSec * sampleRate);
    if (index < samples.length) samples[index] = 1;
  }

  return samples;
}

/** Mean absolute distance from each detected beat to the nearest true beat. */
function meanBeatError(beats: readonly number[], bpm: number): number {
  const intervalSec = 60 / bpm;
  let total = 0;
  for (const beat of beats) {
    const nearest = Math.round(beat / intervalSec) * intervalSec;
    total += Math.abs(beat - nearest);
  }
  return total / beats.length;
}

describe('detectBeatsFromSamples', () => {
  it('recovers 120 BPM from impulses and places beats on the grid', () => {
    const result = detectBeatsFromSamples(clickTrack(120, 5), SAMPLE_RATE);

    expect(result.bpm).not.toBeNull();
    expect(result.bpm).toBeCloseTo(120, 1);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.beats.length).toBeGreaterThanOrEqual(9);
    expect(meanBeatError(result.beats, 120)).toBeLessThan(0.02);
    expect(result.beats[0]).toBeGreaterThanOrEqual(0);
    expect(result.beats[result.beats.length - 1]).toBeLessThan(5);
  });

  it('recovers the catalogue calm tempo (96 BPM)', () => {
    const result = detectBeatsFromSamples(clickTrack(96, 6), SAMPLE_RATE);

    expect(result.bpm).toBeCloseTo(96, 0);
    expect(meanBeatError(result.beats, 96)).toBeLessThan(0.02);
  });

  it('is deterministic for identical input', () => {
    const samples = clickTrack(110, 3);

    expect(detectBeatsFromSamples(samples, SAMPLE_RATE)).toEqual(
      detectBeatsFromSamples(samples, SAMPLE_RATE),
    );
  });

  it('returns null tempo and no beats for silence', () => {
    const result = detectBeatsFromSamples(new Float32Array(SAMPLE_RATE * 3), SAMPLE_RATE);

    expect(result).toEqual({ bpm: null, beats: [], confidence: 0 });
  });

  it('returns null tempo for input shorter than minSec', () => {
    const result = detectBeatsFromSamples(clickTrack(120, 0.3), SAMPLE_RATE);

    expect(result.bpm).toBeNull();
    expect(result.beats).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('never reports a tempo outside the search range', () => {
    const tooFast = detectBeatsFromSamples(clickTrack(240, 4), SAMPLE_RATE);
    const tooSlow = detectBeatsFromSamples(clickTrack(40, 6), SAMPLE_RATE);

    for (const result of [tooFast, tooSlow]) {
      if (result.bpm !== null) {
        expect(result.bpm).toBeGreaterThanOrEqual(60);
        expect(result.bpm).toBeLessThanOrEqual(180);
      } else {
        expect(result.beats).toEqual([]);
      }
    }

    // A tempo outside a narrowed window is rejected rather than silently
    // reported: 60 BPM clicks with a 100-180 BPM search window.
    const narrowed = detectBeatsFromSamples(clickTrack(60, 5), SAMPLE_RATE, {
      minBpm: 100,
      maxBpm: 180,
    });
    expect(narrowed.bpm === null || narrowed.bpm >= 100).toBe(true);
  });

  it('honours a custom tempo window', () => {
    const result = detectBeatsFromSamples(clickTrack(90, 6), SAMPLE_RATE, {
      minBpm: 80,
      maxBpm: 100,
    });

    expect(result.bpm).toBeCloseTo(90, 0);
  });

  it('rejects invalid options instead of guessing', () => {
    const samples = clickTrack(120, 2);

    expect(() => detectBeatsFromSamples(samples, 0)).toThrow(RangeError);
    expect(() => detectBeatsFromSamples(samples, SAMPLE_RATE, { minBpm: 140, maxBpm: 100 })).toThrow(
      RangeError,
    );
  });
});

describe('detectBeatsFromFile', () => {
  it('decodes a generated 2 s click track and recovers 120 BPM', () => {
    if (typeof ffmpegStatic !== 'string' || ffmpegStatic.length === 0) {
      throw new Error('ffmpeg-static did not resolve; run "npm install"');
    }

    const directory = mkdtempSync(join(tmpdir(), 'zeniconic-beats-'));
    const file = join(directory, 'click-120.wav');

    try {
      const encoded = spawnSync(
        ffmpegStatic,
        [
          '-hide_banner',
          '-nostdin',
          '-v', 'error',
          '-y',
          '-f', 'lavfi',
          '-i', "aevalsrc='if(lt(mod(t,0.5),0.02),sin(2*PI*1000*t),0)':s=22050:d=2.2",
          '-ac', '1',
          '-c:a', 'pcm_s16le',
          file,
        ],
        { encoding: 'utf8' },
      );
      expect(encoded.status, encoded.stderr).toBe(0);

      const result = detectBeatsFromFile(file);

      expect(result.bpm).not.toBeNull();
      expect(result.bpm).toBeCloseTo(120, 0);
      expect(result.beats.length).toBeGreaterThanOrEqual(3);
      expect(meanBeatError(result.beats, 120)).toBeLessThan(0.05);
      expect(result.confidence).toBeGreaterThan(0.7);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns an empty result for a silent file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zeniconic-beats-silent-'));
    const file = join(directory, 'silence.wav');

    try {
      const encoded = spawnSync(
        ffmpegStatic as string,
        [
          '-hide_banner',
          '-nostdin',
          '-v', 'error',
          '-y',
          '-f', 'lavfi',
          '-i', 'anullsrc=r=22050:cl=mono:d=1.5',
          '-c:a', 'pcm_s16le',
          file,
        ],
        { encoding: 'utf8' },
      );
      expect(encoded.status, encoded.stderr).toBe(0);

      expect(detectBeatsFromFile(file)).toEqual({ bpm: null, beats: [], confidence: 0 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the file cannot be decoded', () => {
    expect(() => detectBeatsFromFile(join(tmpdir(), 'zeniconic-missing-audio.m4a'))).toThrow(
      /could not decode/,
    );
  });
});

/**
 * Tie the detector to the beds that actually ship. `data/` is gitignored, so
 * these skip on a clean clone; run `node scripts/make-music-fixtures.mjs` first.
 */
describe('detectBeatsFromFile on the local bank fixtures', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const fixtures = [
    { name: 'calm-096.m4a', bpm: 96 },
    { name: 'catchy-120.m4a', bpm: 120 },
  ];

  for (const { name, bpm } of fixtures) {
    const file = join(repoRoot, 'data', 'assets', 'music', name);

    it.skipIf(!existsSync(file))(`recovers the catalogue tempo from ${name}`, () => {
      const result = detectBeatsFromFile(file);

      expect(result.bpm).not.toBeNull();
      expect(Math.abs((result.bpm ?? 0) - bpm)).toBeLessThanOrEqual(1);
      expect(result.beats.length).toBeGreaterThan(3);
      expect(result.confidence).toBeGreaterThan(0.4);
      expect(meanBeatError(result.beats, bpm)).toBeLessThan(0.03);
    });
  }
});
