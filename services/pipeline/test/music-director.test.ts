import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAX_MUSIC_CANDIDATES,
  analyzeMusicFile,
  analyzeMusicSamples,
  beatsWithin,
  buildMusicBrief,
  editShapeFor,
  musicPromptVariants,
  scoreMusicProfile,
  selectMusicCandidate,
} from '../music-director';
import type {
  EnergyPoint,
  MusicBriefFacts,
  MusicCandidate,
  MusicEnergy,
  MusicProfile,
  MusicSection,
} from '../music-director';

const SAMPLE_RATE = 22_050;
const TEMP_DIR = mkdtempSync(join(tmpdir(), 'zeniconic-music-director-'));

afterAll(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

/* --------------------------------------------------------------- fixtures */

interface Segment {
  seconds: number;
  /** Tone amplitude, 0..1. */
  amplitude: number;
}

/**
 * A deterministic music-like fixture: a 220 Hz tone whose amplitude follows
 * `segments`, plus a short 1 kHz click on every beat. The tone carries the RMS
 * envelope the section detector reads; the clicks give the beat detector a
 * clean onset. No provider, no file, no randomness.
 */
function toneWithClicks(
  bpm: number,
  segments: readonly Segment[],
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const totalSec = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const samples = new Float32Array(Math.round(totalSec * sampleRate));

  const amplitudeAt = (timeSec: number): number => {
    let cursor = 0;
    for (const segment of segments) {
      if (timeSec < cursor + segment.seconds) return segment.amplitude;
      cursor += segment.seconds;
    }
    return 0;
  };

  for (let index = 0; index < samples.length; index += 1) {
    const timeSec = index / sampleRate;
    samples[index] = amplitudeAt(timeSec) * Math.sin(2 * Math.PI * 220 * timeSec);
  }

  const intervalSec = 60 / bpm;
  const clickSamples = Math.round(0.008 * sampleRate);
  for (let beat = 0; beat * intervalSec < totalSec; beat += 1) {
    const start = Math.round(beat * intervalSec * sampleRate);
    for (let offset = 0; offset < clickSamples; offset += 1) {
      const index = start + offset;
      if (index >= samples.length) break;
      const decay = 1 - offset / clickSamples;
      samples[index] = (samples[index] ?? 0) + 0.6 * decay * Math.sin(2 * Math.PI * 1000 * offset / sampleRate);
    }
  }

  return samples;
}

/** Minimal 16-bit PCM WAV, enough for ffmpeg to decode. */
function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  writeFileSync(path, buffer);
}

function facts(overrides: Partial<MusicBriefFacts> = {}): MusicBriefFacts {
  return {
    luxuryLevel: 5,
    propertyType: 'penthouse',
    audience: 'investor',
    editPace: 'medium',
    emotionalTone: 'aspirational',
    durationSec: 30,
    hasVoiceover: false,
    ...overrides,
  };
}

function energyPoints(values: readonly number[]): EnergyPoint[] {
  return values.map((value, index) => ({
    atSec: Math.round((index / Math.max(1, values.length - 1)) * 300) / 10,
    rms: value,
    norm: value,
  }));
}

function energyFrom(values: readonly number[]): MusicEnergy {
  const peak = Math.max(...values);
  return {
    meanNorm: values.reduce((sum, value) => sum + value, 0) / values.length,
    peakRms: peak,
    dynamics: 1 - Math.min(...values) / Math.max(1e-9, peak),
    points: energyPoints(values),
  };
}

/** Plain profile factory for component-scoring tests. */
function profile(overrides: Partial<MusicProfile> = {}): MusicProfile {
  const values = Array.from({ length: 31 }, (_, index) => {
    const at = index / 30;
    return at < 0.1 ? 0.2 : at < 0.72 ? 0.2 + (at - 0.1) * 0.6 : 1 - (at - 0.72) * 0.8;
  });
  const sections: MusicSection[] = [
    { kind: 'intro', startSec: 0, endSec: 3, meanEnergy: 0.2 },
    { kind: 'body', startSec: 3, endSec: 21.6, meanEnergy: 0.5 },
    { kind: 'climax', startSec: 21.6, endSec: 27, meanEnergy: 0.9 },
    { kind: 'outro', startSec: 27, endSec: 30, meanEnergy: 0.3 },
  ];
  return {
    durationSec: 30,
    bpm: 112,
    beatConfidence: 0.9,
    beats: Array.from({ length: 56 }, (_, index) => Math.round(index * (60 / 112) * 1000) / 1000),
    energy: energyFrom(values),
    sections,
    introSec: 3,
    outroSec: 3,
    climaxSec: 5.4,
    ...overrides,
  };
}

/* ------------------------------------------------------------ brief mapping */

describe('buildMusicBrief', () => {
  it('maps a luxury penthouse investor reel to deep house at 112 BPM', () => {
    const brief = buildMusicBrief(facts({ setting: 'Dubai Marina waterfront' }));

    expect(brief.style).toBe('deep_house');
    expect(brief.bpmTarget).toBe(112);
    expect(brief.bpmRange).toEqual([104, 118]);
    expect(brief.requiredDurationSec).toBe(32);
    expect(brief.prompt).toContain('deep house');
    expect(brief.prompt).toContain('for an ultra-luxury penthouse');
    expect(brief.prompt).toContain('112 BPM');
    expect(brief.prompt).toContain('Dubai Marina waterfront');
    expect(brief.prompt).toContain('No vocals');
    expect(brief.reasons.join(' ')).toContain('Style scores');
  });

  it('maps a serene villa with voiceover to cinematic ambient', () => {
    const brief = buildMusicBrief(
      facts({
        propertyType: 'villa',
        audience: 'buyer',
        editPace: 'slow',
        emotionalTone: 'serene',
        hasVoiceover: true,
      }),
    );

    expect(brief.style).toBe('cinematic_ambient');
    expect(brief.bpmTarget).toBeGreaterThanOrEqual(78);
    expect(brief.bpmTarget).toBeLessThanOrEqual(96);
    expect(brief.prompt).toContain('clear space for a voiceover');
    expect(brief.energyTargets.find((target) => target.label === 'lift')?.target).toBe(0.9);
  });

  it('maps an energetic apartment listing for an agent to sophisticated electronic', () => {
    const brief = buildMusicBrief(
      facts({
        luxuryLevel: 3,
        propertyType: 'apartment',
        audience: 'agent',
        editPace: 'fast',
        emotionalTone: 'energetic',
      }),
    );

    expect(brief.style).toBe('sophisticated_electronic');
    expect(brief.bpmTarget).toBeGreaterThanOrEqual(110);
    expect(brief.bpmTarget).toBeLessThanOrEqual(122);
  });

  it('maps an intimate townhouse rental to luxury lounge', () => {
    const brief = buildMusicBrief(
      facts({
        luxuryLevel: 2,
        propertyType: 'townhouse',
        audience: 'tenant',
        editPace: 'slow',
        emotionalTone: 'intimate',
        hasVoiceover: true,
      }),
    );

    expect(brief.style).toBe('luxury_lounge');
    expect(brief.bpmTarget).toBeGreaterThanOrEqual(92);
    expect(brief.bpmTarget).toBeLessThanOrEqual(106);
  });

  it('does not invent a location when no setting is supplied', () => {
    const brief = buildMusicBrief(facts());

    expect(brief.prompt).not.toMatch(/dubai|marina|london|new york/i);
  });

  it('keeps energy targets ordered and expresses the edit pace', () => {
    const brief = buildMusicBrief(facts());
    const positions = brief.energyTargets.map((target) => target.at);

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(brief.energyTargets.map((target) => target.label)).toEqual([
      'open',
      'build',
      'lift',
      'close',
      'tail',
    ]);
    expect(editShapeFor(brief)).toEqual({ buildAt: 0.32, liftAt: 0.72, closeAt: 0.88 });
  });

  it('rejects facts it cannot use', () => {
    expect(() => buildMusicBrief(facts({ durationSec: 0 }))).toThrow(/durationSec/);
    expect(() => buildMusicBrief(facts({ setting: '   ' }))).toThrow(/setting/);
    expect(() =>
      buildMusicBrief(facts({ luxuryLevel: 7 as unknown as 1 })),
    ).toThrow(/luxuryLevel/);
  });
});

describe('musicPromptVariants', () => {
  it('returns deterministic, distinct prompts within the candidate ceiling', () => {
    const brief = buildMusicBrief(facts());
    const first = musicPromptVariants(brief, MAX_MUSIC_CANDIDATES);
    const second = musicPromptVariants(brief, MAX_MUSIC_CANDIDATES);

    expect(first).toHaveLength(MAX_MUSIC_CANDIDATES);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(MAX_MUSIC_CANDIDATES);
    expect(first[0]).toBe(brief.prompt);
  });

  it('refuses more than three candidates per run', () => {
    const brief = buildMusicBrief(facts());
    expect(() => musicPromptVariants(brief, 4)).toThrow(/1\.\.3/);
    expect(() => musicPromptVariants(brief, 0)).toThrow(/1\.\.3/);
    expect(() => musicPromptVariants(brief, 1.5)).toThrow(/1\.\.3/);
  });
});

/* --------------------------------------------------------------- analysis */

describe('analyzeMusicSamples', () => {
  it('detects tempo, energy sections and intro/outro on a shaped fixture', () => {
    const samples = toneWithClicks(104, [
      { seconds: 2, amplitude: 0.05 },
      { seconds: 8, amplitude: 0.3 },
      { seconds: 4, amplitude: 0.9 },
      { seconds: 4, amplitude: 0.15 },
    ]);
    const result = analyzeMusicSamples(samples, SAMPLE_RATE);

    expect(result.durationSec).toBeCloseTo(18, 2);
    expect(result.bpm).not.toBeNull();
    expect(result.bpm).toBeCloseTo(104, 0);
    expect(result.energy.dynamics).toBeGreaterThan(0.6);

    const kinds = result.sections.map((section) => section.kind);
    expect(kinds).toEqual(['intro', 'body', 'climax', 'outro']);

    const intro = result.sections.find((section) => section.kind === 'intro');
    const climax = result.sections.find((section) => section.kind === 'climax');
    const outro = result.sections.find((section) => section.kind === 'outro');
    expect(intro?.endSec).toBeGreaterThan(1.5);
    expect(intro?.endSec).toBeLessThan(3.5);
    expect(climax?.startSec).toBeGreaterThan(9);
    expect(climax?.startSec).toBeLessThan(11.5);
    expect(outro?.startSec).toBeGreaterThan(13.5);
    expect(outro?.startSec).toBeLessThan(15.5);
    expect(result.outroSec).toBeGreaterThan(2);
    expect(result.climaxSec).toBeGreaterThan(2);
    expect(result.introSec).toBeGreaterThan(1.5);
  });

  it('does not invent sections for a flat pad', () => {
    const seconds = 6;
    const samples = new Float32Array(seconds * SAMPLE_RATE);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = 0.2 * Math.sin((2 * Math.PI * 250 * index) / SAMPLE_RATE);
    }

    const result = analyzeMusicSamples(samples, SAMPLE_RATE);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.kind).toBe('body');
    expect(result.energy.dynamics).toBeLessThan(0.06);
    expect(result.introSec).toBe(0);
    expect(result.outroSec).toBe(0);
  });

  it('handles silence without throwing', () => {
    const result = analyzeMusicSamples(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE);

    expect(result.bpm).toBeNull();
    expect(result.energy.peakRms).toBe(0);
    expect(result.sections[0]?.kind).toBe('body');
  });

  it('analyses a real file through ffmpeg', () => {
    const samples = toneWithClicks(104, [
      { seconds: 2, amplitude: 0.05 },
      { seconds: 8, amplitude: 0.3 },
      { seconds: 4, amplitude: 0.9 },
      { seconds: 4, amplitude: 0.15 },
    ]);
    const path = join(TEMP_DIR, 'fixture-104.wav');
    writeWav(path, samples, SAMPLE_RATE);

    const result = analyzeMusicFile(path);

    expect(result.sourceFile).toBe(path);
    expect(result.bpm).toBeCloseTo(104, 0);
    expect(result.sections.map((section) => section.kind)).toEqual([
      'intro',
      'body',
      'climax',
      'outro',
    ]);
  });
});

/* ---------------------------------------------------------------- scoring */

describe('scoreMusicProfile', () => {
  const brief = buildMusicBrief(facts());

  it('prefers a BPM close to the target', () => {
    const close = scoreMusicProfile(profile({ bpm: 112 }), brief);
    const far = scoreMusicProfile(profile({ bpm: 78 }), brief);

    expect(close.bpm).toBe(1);
    expect(far.bpm).toBeLessThan(0.2);
    expect(close.total).toBeGreaterThan(far.total);
  });

  it('prefers an energy curve that peaks at the edit lift', () => {
    const values = Array.from({ length: 31 }, (_, index) => {
      const at = index / 30;
      if (at < 0.72) return 0.15 + (at / 0.72) * 0.85;
      return 1 - ((at - 0.72) / 0.28) * 0.85;
    });
    const lifted = profile({ energy: energyFrom(values) });

    const earlyValues = Array.from({ length: 31 }, (_, index) => {
      const at = index / 30;
      return at < 0.1 ? 1 : Math.max(0.1, 1 - (at - 0.1) * 1.1);
    });
    const early = profile({ energy: energyFrom(earlyValues) });

    const liftedScore = scoreMusicProfile(lifted, brief);
    const earlyScore = scoreMusicProfile(early, brief);

    expect(liftedScore.energy).toBeGreaterThan(earlyScore.energy + 0.15);
    expect(liftedScore.total).toBeGreaterThan(earlyScore.total);
  });

  it('rewards duration coverage up to picture plus tail', () => {
    const short = scoreMusicProfile(profile({ durationSec: 12 }), brief);
    const covered = scoreMusicProfile(profile({ durationSec: 32 }), brief);
    const extra = scoreMusicProfile(profile({ durationSec: 120 }), brief);

    expect(short.duration).toBeLessThan(0.5);
    expect(covered.duration).toBe(1);
    expect(extra.duration).toBe(1);
    expect(covered.total).toBeGreaterThan(short.total);
  });

  it('rewards a real intro and outro', () => {
    const withEdges = scoreMusicProfile(profile(), brief);
    const flatEdges = scoreMusicProfile(
      profile({
        introSec: 0,
        outroSec: 0,
        sections: [{ kind: 'body', startSec: 0, endSec: 30, meanEnergy: 0.6 }],
      }),
      brief,
    );

    expect(withEdges.introOutro).toBeGreaterThan(flatEdges.introOutro);
    expect(withEdges.total).toBeGreaterThan(flatEdges.total);
  });

  it('scores an undetected tempo at zero', () => {
    const result = scoreMusicProfile(profile({ bpm: null }), brief);

    expect(result.bpm).toBe(0);
    expect(result.notes[0]).toMatch(/No credible tempo/);
  });
});

/* --------------------------------------------------------------- selection */

describe('selectMusicCandidate', () => {
  const brief = buildMusicBrief(facts({ durationSec: 18 }));
  const targetSamples = toneWithClicks(112, [
    { seconds: 3, amplitude: 0.05 },
    { seconds: 7, amplitude: 0.3 },
    { seconds: 4, amplitude: 0.9 },
    { seconds: 4, amplitude: 0.15 },
  ]);
  const slowSamples = toneWithClicks(84, [
    { seconds: 3, amplitude: 0.05 },
    { seconds: 7, amplitude: 0.3 },
    { seconds: 4, amplitude: 0.9 },
    { seconds: 4, amplitude: 0.15 },
  ]);
  const targetProfile = analyzeMusicSamples(targetSamples, SAMPLE_RATE);
  const slowProfile = analyzeMusicSamples(slowSamples, SAMPLE_RATE);

  function candidate(id: string, bpm: number): MusicCandidate {
    return {
      id,
      file: `data/tmp/${id}.wav`,
      profile: profile({ bpm }),
    };
  }

  it('selects the analysed candidate whose tempo matches the brief', () => {
    const selection = selectMusicCandidate(
      [
        { id: 'slow-84', file: 'data/tmp/slow-84.mp3', profile: slowProfile },
        { id: 'target-112', file: 'data/tmp/target-112.mp3', profile: targetProfile },
      ],
      brief,
    );

    expect(selection.chosen.candidate.id).toBe('target-112');
    expect(selection.ranked).toHaveLength(2);
    expect(selection.ranked[0]?.score.total).toBeGreaterThanOrEqual(
      selection.ranked[1]?.score.total ?? 0,
    );
  });

  it('is order-independent and deterministic', () => {
    const candidates = [
      { id: 'a', file: 'a.mp3', profile: profile({ bpm: 108 }) },
      { id: 'b', file: 'b.mp3', profile: profile({ bpm: 112 }) },
      { id: 'c', file: 'c.mp3', profile: profile({ bpm: 108 }) },
    ];

    const forward = selectMusicCandidate(candidates, brief);
    const reversed = selectMusicCandidate([...candidates].reverse(), brief);

    expect(forward.chosen.candidate.id).toBe(reversed.chosen.candidate.id);
    expect(forward.ranked.map((entry) => entry.score.total)).toEqual(
      reversed.ranked.map((entry) => entry.score.total),
    );
  });

  it('enforces the candidate ceiling', () => {
    const four = [
      candidate('a', 112),
      candidate('b', 110),
      candidate('c', 108),
      candidate('d', 106),
    ];
    expect(() => selectMusicCandidate(four, brief)).toThrow(/at most 3/);
    expect(() => selectMusicCandidate([], brief)).toThrow(/at least one/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      selectMusicCandidate([candidate('same', 112), candidate('same', 110)], brief),
    ).toThrow(/duplicate/);
  });
});

/* ------------------------------------------------------------ beat lookup */

describe('beatsWithin', () => {
  const beats = [0.5, 1, 1.5, 2];

  it('includes both boundaries', () => {
    expect(beatsWithin(beats, 1, 2)).toEqual([1, 1.5, 2]);
    expect(beatsWithin(beats, 0.5, 0.5)).toEqual([0.5]);
  });

  it('widens by the tolerance on both sides', () => {
    expect(beatsWithin(beats, 0.6, 1.4, 0.1)).toEqual([0.5, 1, 1.5]);
    expect(beatsWithin(beats, 0.6, 1.4, 0)).toEqual([1]);
  });

  it('returns an empty list for a reversed range', () => {
    expect(beatsWithin(beats, 2, 1)).toEqual([]);
  });

  it('rejects invalid input', () => {
    expect(() => beatsWithin(beats, 0, 1, -0.1)).toThrow(/toleranceSec/);
    expect(() => beatsWithin(beats, Number.NaN, 1)).toThrow(/startSec/);
    expect(() => beatsWithin(beats, 0, Number.POSITIVE_INFINITY)).toThrow(/endSec/);
  });

  it('ignores non-finite beats and deduplicates', () => {
    expect(beatsWithin([0.5, 0.5, Number.NaN, 1.5], 0, 2)).toEqual([0.5, 1.5]);
  });
});
