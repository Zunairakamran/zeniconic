import { describe, expect, it } from 'vitest';

import {
  aspectFromDimensions,
  clusterPalette,
  colourWordsFor,
  confidenceFor,
  cutThresholdFor,
  deriveStyleWords,
  guessTransitions,
  motionLevelFor,
  pacingFor,
} from '../src/index';
import type { FrameMetrics } from '@zeniconic/analysis';
import type { RgbSample } from '../src/index';

function sample(r: number, g: number, b: number): RgbSample {
  return { r, g, b };
}

function metric(meanAbsDiff: number): FrameMetrics {
  return {
    index: 0,
    t: 0,
    meanAbsDiff,
    blur: 0,
    shake: 0,
    exposureClipLow: 0,
    exposureClipHigh: 0,
    motionEnergy: 0,
    colourfulness: 0,
  };
}

describe('aspectFromDimensions', () => {
  it('maps the product aspects and tolerates codec rounding', () => {
    expect(aspectFromDimensions(1080, 1920)).toBe('9:16');
    expect(aspectFromDimensions(540, 960)).toBe('9:16');
    expect(aspectFromDimensions(608, 1080)).toBe('9:16');
    expect(aspectFromDimensions(1920, 1080)).toBe('16:9');
    expect(aspectFromDimensions(1280, 720)).toBe('16:9');
    expect(aspectFromDimensions(1080, 1080)).toBe('1:1');
    expect(aspectFromDimensions(1080, 1350)).toBe('4:5');
  });

  it('calls anything else "other" instead of forcing the nearest profile', () => {
    expect(aspectFromDimensions(1000, 1500)).toBe('other'); // Pinterest 2:3
    expect(aspectFromDimensions(640, 480)).toBe('other'); // 4:3
    expect(aspectFromDimensions(0, 1080)).toBe('other');
  });
});

describe('pacingFor', () => {
  it('uses the documented strict boundaries', () => {
    expect(pacingFor(0.9)).toBe('fast');
    expect(pacingFor(1.999)).toBe('fast');
    expect(pacingFor(2)).toBe('medium');
    expect(pacingFor(3.0)).toBe('medium');
    expect(pacingFor(3.499)).toBe('medium');
    expect(pacingFor(3.5)).toBe('slow');
    expect(pacingFor(12)).toBe('slow');
    expect(pacingFor(0)).toBe('slow');
  });
});

describe('motionLevelFor', () => {
  it('buckets the mean frame difference', () => {
    expect(motionLevelFor(0)).toBe('low');
    expect(motionLevelFor(0.0149)).toBe('low');
    expect(motionLevelFor(0.015)).toBe('medium');
    expect(motionLevelFor(0.0499)).toBe('medium');
    expect(motionLevelFor(0.05)).toBe('high');
    expect(motionLevelFor(0.9)).toBe('high');
  });
});

describe('cutThresholdFor', () => {
  it('never drops below the absolute floor', () => {
    expect(cutThresholdFor([metric(0), metric(0.5)])).toBe(6);
  });

  it('rises above the clip median for handheld footage', () => {
    expect(cutThresholdFor([metric(20), metric(20), metric(20)])).toBe(60);
  });
});

describe('guessTransitions', () => {
  it('calls a single frame spike a hard cut', () => {
    expect(guessTransitions([0, 0, 200, 0, 0], [2])).toBe('cuts');
  });

  it('returns cuts when no boundary was detected', () => {
    expect(guessTransitions([0, 2, 1], [])).toBe('cuts');
  });

  it('calls a broad hump a blend', () => {
    // Peak at index 3, with six neighbouring samples above half-peak.
    expect(guessTransitions([0, 14, 22, 28, 26, 22, 14, 0], [3])).toBe('mixed');
  });

  it('calls a too-small spike a blend', () => {
    expect(guessTransitions([0, 0, 10, 0], [2])).toBe('mixed');
  });
});

describe('clusterPalette', () => {
  it('caps at five buckets and keeps them stable', () => {
    const samples = [
      sample(176, 58, 46),
      sample(176, 58, 46),
      sample(31, 111, 120),
      sample(224, 192, 104),
      sample(42, 75, 141),
      sample(10, 200, 10),
      sample(200, 10, 200),
    ];

    const palette = clusterPalette(samples, 5);
    expect(palette).toHaveLength(5);
    for (const colour of palette) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(clusterPalette(samples, 5)).toEqual(palette);
  });

  it('returns three luma groups when the picture has too few buckets', () => {
    const palette = clusterPalette([
      sample(20, 20, 20),
      sample(120, 120, 120),
      sample(240, 240, 240),
    ]);
    expect(palette).toHaveLength(3);
  });

  it('returns what it can for a monochrome source and nothing for no samples', () => {
    expect(clusterPalette([sample(90, 90, 90), sample(90, 90, 90)])).toEqual(['#5a5a5a']);
    expect(clusterPalette([])).toEqual([]);
  });
});

describe('colourWordsFor', () => {
  it('reads warm and cool palettes', () => {
    expect(colourWordsFor(['#ff8800', '#ffaa33']).temperature).toBe('warm');
    expect(colourWordsFor(['#0033ff', '#2255ee']).temperature).toBe('cool');
  });

  it('separates low-contrast from high-contrast palettes', () => {
    expect(colourWordsFor(['#808080']).color_style).toBe('neutral low-contrast');
    expect(colourWordsFor(['#111111', '#eeeeee']).color_style).toBe(
      'neutral high-contrast',
    );
  });

  it('falls back to neutral without a palette', () => {
    expect(colourWordsFor([]).color_style).toBe('neutral');
  });
});

describe('confidenceFor', () => {
  it('adds only the evidence that exists', () => {
    expect(
      confidenceFor({
        shotCount: 1,
        paletteSize: 2,
        hasLoudness: false,
        hasTranscript: false,
        hasVision: false,
      }),
    ).toBe(0.4);

    expect(
      confidenceFor({
        shotCount: 4,
        paletteSize: 4,
        hasLoudness: true,
        hasTranscript: false,
        hasVision: false,
      }),
    ).toBe(0.9);
  });

  it('caps at 0.95', () => {
    expect(
      confidenceFor({
        shotCount: 8,
        paletteSize: 5,
        hasLoudness: true,
        hasTranscript: true,
        hasVision: true,
      }),
    ).toBe(0.95);
  });
});

describe('deriveStyleWords', () => {
  it('composes the assignment keys from measured values', () => {
    const style = deriveStyleWords({
      pacing: 'fast',
      aspect: '9:16',
      transitionsGuess: 'cuts',
      motion: 'low',
      palette: ['#b03a2e', '#e0c068'],
    });

    expect(style.style).toBe('fast-paced 9:16 warm edit');
    expect(style.pacing).toBe('fast');
    expect(style.transition_style).toBe('hard cuts');
    expect(style.camera_style).toBe('locked-off or tripod');
    expect(style.color_style).toContain('warm');
    expect(style.caption_style).toBe('unknown');
    expect(style.motion_graphics).toBe('none-detected');
  });
});
