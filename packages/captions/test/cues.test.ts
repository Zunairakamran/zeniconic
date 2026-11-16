import { describe, expect, it } from 'vitest';
import type { Cue, Word } from '../src/index';
import { estimateReadingTime, isRtl, toCues } from '../src/index';

function timed(texts: readonly string[], stepSec = 0.3, wordSec = 0.26): Word[] {
  return texts.map((text, index) => ({
    text,
    startSec: index * stepSec,
    endSec: index * stepSec + wordSec,
  }));
}

function joined(cue: Cue | undefined): string {
  return cue ? cue.lines.join(' ') : '';
}

function expectWellFormed(cues: readonly Cue[], maxCharsPerLine = 32, maxLines = 2): void {
  let previousEnd = 0;

  for (const cue of cues) {
    expect(cue.startSec).toBeGreaterThanOrEqual(previousEnd);
    expect(cue.endSec).toBeGreaterThan(cue.startSec);
    expect(cue.lines.length).toBeGreaterThan(0);
    expect(cue.lines.length).toBeLessThanOrEqual(maxLines);

    for (const line of cue.lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(maxCharsPerLine);
    }

    if (cue.lines.length > 1) {
      const finalLine = cue.lines[cue.lines.length - 1] ?? '';
      expect(finalLine.trim().split(/\s+/).length).toBeGreaterThan(1);
    }

    previousEnd = cue.endSec;
  }
}

describe('toCues', () => {
  it('lays a 20-word sentence into short lines with no orphan final line', () => {
    const words = timed(
      [
        'Bright',
        'marina',
        'apartment',
        'with',
        'three',
        'bedrooms',
        'two',
        'bathrooms',
        'and',
        'a',
        'large',
        'balcony',
        'that',
        'overlooks',
        'the',
        'yachts',
        'in',
        'Dubai',
        'Marina',
        'today.',
      ],
      0.27,
      0.24,
    );

    const cues = toCues(words);

    expect(words).toHaveLength(20);
    expect(cues.length).toBeGreaterThan(1);
    expectWellFormed(cues);

    const flattened = cues.flatMap((cue) => cue.lines).join(' ');
    expect(flattened.toLowerCase()).toBe(
      'bright marina apartment with three bedrooms two bathrooms and a large balcony that overlooks the yachts in dubai marina today.',
    );
    expect(flattened).toContain('Dubai Marina');

    for (const cue of cues) {
      expect(cue.endSec - cue.startSec).toBeLessThanOrEqual(4.5 + 1e-9);
      for (const line of cue.lines) {
        expect(line.trim().split(/\s+/).length).toBeGreaterThan(1);
      }
    }
  });

  it('prefers sentence punctuation over a word boundary', () => {
    const words = timed([
      'Marina',
      'Gate',
      '1.',
      'Three',
      'bedrooms',
      'and',
      'two',
      'baths',
      'with',
      'a',
      'marina',
      'view',
      'from',
      'the',
      'balcony.',
    ]);

    const cues = toCues(words);

    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(joined(cues[0])).toBe('Marina Gate 1.');
    expect(joined(cues[1])?.startsWith('Three')).toBe(true);
    expect(cues[0]?.endSec).toBeCloseTo(0.86, 6);
    expect(cues[1]?.startSec).toBeCloseTo(0.9, 6);
    expectWellFormed(cues);
  });

  it('keeps short clips together and splits at a long pause without overlapping', () => {
    const short = toCues([
      { text: 'Yes', startSec: 0, endSec: 0.3 },
      { text: 'definitely', startSec: 0.35, endSec: 0.65 },
    ]);

    expect(short).toHaveLength(1);
    expect(joined(short[0])).toBe('Yes definitely');
    expect(short[0]?.startSec).toBe(0);
    expect(short[0]?.endSec).toBe(1);

    const separated = toCues([
      { text: 'Yes', startSec: 0, endSec: 0.4 },
      { text: 'no', startSec: 1.5, endSec: 1.9 },
    ]);

    expect(separated).toHaveLength(2);
    expect(separated[0]?.endSec).toBe(1);
    expect(separated[1]?.startSec).toBe(1.5);
    expect(separated[1]?.endSec).toBe(2.5);
    expect(joined(separated[1])).toBe('No');

    for (const set of [short, separated]) {
      let previousEnd = 0;
      for (const cue of set) {
        expect(cue.startSec).toBeGreaterThanOrEqual(previousEnd);
        expect(cue.endSec).toBeGreaterThan(cue.startSec);
        previousEnd = cue.endSec;
      }
    }
  });

  it('flags an over-dense cue without stretching its duration', () => {
    const words = timed(
      [
        'This',
        'caption',
        'is',
        'deliberately',
        'too',
        'dense',
        'to',
        'read',
        'in',
        'three',
        'seconds',
        'flat.',
      ],
      0.25,
      0.2,
    );

    const cues = toCues(words, { maxCharsPerLine: 120, maxCueSec: 10 });
    expect(cues).toHaveLength(1);

    const cue = cues[0];
    expect(cue).toBeDefined();
    if (!cue) return;

    expect(cue.endSec).toBeCloseTo(2.95, 6);
    expect(cue.endSec - cue.startSec).toBeCloseTo(2.95, 6);

    expect(estimateReadingTime(cue)).toBeGreaterThan(cue.endSec - cue.startSec);
    expect(estimateReadingTime({ startSec: 0, endSec: 3, lines: ['Marina view'] })).toBeCloseTo(
      11 / 17,
      10,
    );
  });

  it('lays Arabic words in logical order without reversing them', () => {
    const arabicWords = timed(['شقة', 'ثلاث', 'غرف', 'نوم', 'في', 'مرسى', 'دبي.'], 0.4, 0.32);
    const englishWords = timed(['Flat', 'with', 'three', 'beds', 'in', 'Dubai', 'Marina.'], 0.4, 0.32);

    const arabic = toCues(arabicWords, { language: 'ar-AE' });
    const english = toCues(englishWords, { language: 'en-GB' });

    expect(isRtl('ar-AE')).toBe(true);
    expect(arabic).toHaveLength(english.length);
    expect(arabic.map((cue) => [cue.startSec, cue.endSec])).toEqual(
      english.map((cue) => [cue.startSec, cue.endSec]),
    );

    const text = joined(arabic[0]);
    expect(text).toBe('شقة ثلاث غرف نوم في مرسى دبي.');
    expect(Array.from(text)[0]).toBe('ش');
    expect(text.endsWith('دبي.')).toBe(true);
    expect(text.split(' ')[1]).toBe('ثلاث');
  });
});
