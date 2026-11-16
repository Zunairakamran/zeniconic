import { describe, expect, it } from 'vitest';
import { assessVoice } from '../src/index';
import type { VoiceMetrics } from '../src/index';
import { metrics } from './helpers';

interface Fixture {
  name: string;
  metrics: VoiceMetrics;
  band: 'keep' | 'clean' | 'replace';
  reason: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'quiet indoor talking head',
    metrics: metrics(),
    band: 'keep',
    reason: 'clean enough',
  },
  {
    name: 'bedroom laptop mic with a fan',
    metrics: metrics({ noiseFloorDb: -44, snrDb: 24, reverbTailSec: 0.31 }),
    band: 'clean',
    reason: 'background noise',
  },
  {
    name: 'kitchen phone recording',
    metrics: metrics({ noiseFloorDb: -31, snrDb: 9, reverbTailSec: 0.38 }),
    band: 'replace',
    reason: 'buried in noise',
  },
  {
    name: 'tiled bathroom',
    metrics: metrics({ reverbTailSec: 0.72, snrDb: 26 }),
    band: 'replace',
    reason: 'room echoes',
  },
  {
    name: 'close mic clipping on the hook',
    metrics: metrics({ clippedSamples: 620 }),
    band: 'replace',
    reason: 'mic clips',
  },
];

describe('assessVoice — bands', () => {
  it.each(FIXTURES)('$name is $band', ({ metrics: input, band, reason }) => {
    const verdict = assessVoice(input);

    expect(verdict.band).toBe(band);
    expect(verdict.reasons.join(' ')).toContain(reason);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.score).toBeGreaterThanOrEqual(0);
    expect(verdict.score).toBeLessThanOrEqual(1);

    if (band === 'replace') {
      expect(verdict.score).toBeLessThan(0.55);
    } else if (band === 'clean') {
      expect(verdict.score).toBeGreaterThanOrEqual(0.55);
      expect(verdict.score).toBeLessThan(0.78);
    } else {
      expect(verdict.score).toBeGreaterThanOrEqual(0.78);
    }
  });

  it('lists every fatal reason when several defects coexist', () => {
    const verdict = assessVoice(
      metrics({
        snrDb: 9,
        reverbTailSec: 0.8,
        clippedSamples: 900,
        speechRatio: 0.1,
      }),
    );

    expect(verdict.band).toBe('replace');
    expect(verdict.reasons).toHaveLength(4);
    expect(verdict.reasons.join(' ')).toContain('buried in noise');
    expect(verdict.reasons.join(' ')).toContain('room echoes');
    expect(verdict.reasons.join(' ')).toContain('mic clips');
    expect(verdict.reasons.join(' ')).toContain('too little speech');
  });

  it('lists every cleanable reason without promoting the band to replace', () => {
    const verdict = assessVoice(
      metrics({
        snrDb: 18,
        noiseFloorDb: -44,
        wordsPerMinute: 196,
        fillerRatio: 0.11,
      }),
    );

    expect(verdict.band).toBe('clean');
    expect(verdict.reasons).toHaveLength(4);
    expect(verdict.reasons.join(' ')).toContain('audible hiss');
    expect(verdict.reasons.join(' ')).toContain('phone speakers');
    expect(verdict.reasons.join(' ')).toContain('rushed');
    expect(verdict.reasons.join(' ')).toContain('filler words');
  });
});

describe('assessVoice — threshold edges', () => {
  it('treats the replace cut-offs as exclusive', () => {
    expect(assessVoice(metrics({ snrDb: 11.999 })).band).toBe('replace');
    expect(assessVoice(metrics({ snrDb: 12 })).band).toBe('clean');

    expect(assessVoice(metrics({ reverbTailSec: 0.601 })).band).toBe('replace');
    expect(assessVoice(metrics({ reverbTailSec: 0.6 })).band).toBe('keep');

    expect(assessVoice(metrics({ clippedSamples: 501 })).band).toBe('replace');
    expect(assessVoice(metrics({ clippedSamples: 500 })).band).toBe('keep');

    expect(assessVoice(metrics({ speechRatio: 0.199 })).band).toBe('replace');
    expect(assessVoice(metrics({ speechRatio: 0.2 })).band).toBe('keep');
  });

  it('treats the clean cut-offs as exclusive', () => {
    expect(assessVoice(metrics({ snrDb: 19.999 })).band).toBe('clean');
    expect(assessVoice(metrics({ snrDb: 20 })).band).toBe('keep');

    expect(assessVoice(metrics({ noiseFloorDb: -44.999 })).band).toBe('clean');
    expect(assessVoice(metrics({ noiseFloorDb: -45 })).band).toBe('keep');

    expect(assessVoice(metrics({ wordsPerMinute: 190.001 })).band).toBe('clean');
    expect(assessVoice(metrics({ wordsPerMinute: 190 })).band).toBe('keep');

    expect(assessVoice(metrics({ fillerRatio: 0.0801 })).band).toBe('clean');
    expect(assessVoice(metrics({ fillerRatio: 0.08 })).band).toBe('keep');
  });

  it('keeps the measured-only score inside the band contract', () => {
    expect(assessVoice(metrics()).score).toBeGreaterThanOrEqual(0.78);
    expect(assessVoice(metrics({ reverbTailSec: 5 })).score).toBeLessThan(0.55);
    expect(assessVoice(metrics({ noiseFloorDb: -44 })).score).toBeLessThan(0.78);
  });

  it('rejects non-finite metrics instead of silently banding them', () => {
    expect(() => assessVoice(metrics({ snrDb: Number.NaN }))).toThrow(RangeError);
    expect(() => assessVoice(metrics({ speechRatio: Number.POSITIVE_INFINITY }))).toThrow(
      RangeError,
    );
  });
});
