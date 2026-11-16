import { describe, expect, it } from 'vitest';
import type { Word } from '../src/index';
import {
  applyBritishSpelling,
  isRtl,
  normaliseLanguage,
  toCues,
  uppercaseFirstLetter,
} from '../src/index';

function timed(texts: readonly string[]): Word[] {
  return texts.map((text, index) => ({
    text,
    startSec: index * 0.3,
    endSec: index * 0.3 + 0.26,
  }));
}

function firstCueText(words: readonly Word[], language: string): string {
  return toCues(words, { language }).flatMap((cue) => cue.lines).join(' ');
}

describe('isRtl', () => {
  it('is true for Arabic, Hebrew, Persian and Urdu', () => {
    for (const language of ['ar', 'ar-AE', 'he', 'he-IL', 'fa', 'fa-IR', 'ur', 'ur-PK']) {
      expect(isRtl(language), language).toBe(true);
    }
  });

  it('is false for English and French', () => {
    for (const language of ['en', 'en-GB', 'en-US', 'fr', 'fr-FR']) {
      expect(isRtl(language), language).toBe(false);
    }
  });
});

describe('normaliseLanguage', () => {
  it('resolves product defaults and canonical casing', () => {
    expect(normaliseLanguage('en')).toBe('en-GB');
    expect(normaliseLanguage('EN_gb')).toBe('en-GB');
    expect(normaliseLanguage('en-US')).toBe('en-US');
    expect(normaliseLanguage('ar')).toBe('ar-AE');
    expect(normaliseLanguage('ar_ae')).toBe('ar-AE');
    expect(normaliseLanguage('fr')).toBe('fr');
    expect(normaliseLanguage('fr-FR')).toBe('fr-FR');
  });

  it('rejects an empty or malformed code', () => {
    expect(() => normaliseLanguage('')).toThrow(RangeError);
    expect(() => normaliseLanguage('english')).toThrow(RangeError);
  });
});

describe('British spelling', () => {
  it('applies the small map for en-GB only', () => {
    const words = timed(['Organize', 'the', 'color', 'palette', 'at', 'Center', 'Point.']);

    expect(firstCueText(words, 'en-GB')).toBe('Organise the colour palette at Center Point.');
    expect(firstCueText(words, 'en-US')).toBe('Organize the color palette at Center Point.');
  });

  it('does not alter a multi-word proper noun', () => {
    expect(applyBritishSpelling('Center Point is not center point')).toBe(
      'Center Point is not centre point',
    );
    expect(applyBritishSpelling('Organize the Color Theory program')).toBe(
      'Organise the Color Theory programme',
    );
  });

  it('leaves all-caps styling alone', () => {
    expect(applyBritishSpelling('COLOR')).toBe('COLOR');
    expect(applyBritishSpelling('COLOR palette')).toBe('COLOR palette');
  });

  it('uppercases the first letter without touching the rest', () => {
    expect(uppercaseFirstLetter('marina view')).toBe('Marina view');
    expect(uppercaseFirstLetter('مرسى دبي')).toBe('مرسى دبي');
    expect(uppercaseFirstLetter('"marina view')).toBe('"Marina view');
  });
});
