import type { Facts } from '@zeniconic/planner';
import { describe, expect, it } from 'vitest';
import {
  buildScript,
  countWords,
  defaultVoice,
  ENGINES,
  estimateDurationSec,
  previewKey,
  VOICES,
  voicesFor,
  type Language,
  type PreviewCache,
} from '../src/index';

const LANGUAGES: Language[] = ['en-GB', 'en-US', 'ar-AE'];

const FACTS: Facts = {
  address: 'Marina Gate 1, Dubai Marina',
  price: 'AED 1,850,000',
  beds: 3,
  baths: 2,
  currency: 'AED',
};

const ROOMS = ['living', 'kitchen', 'balcony'];

describe('voice catalogue', () => {
  it('has 14 voices with stable unique ids, 10 English and 4 Arabic', () => {
    expect(VOICES).toHaveLength(14);

    const ids = VOICES.map((voice) => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }

    const english = VOICES.filter(
      (voice) => voice.language === 'en-GB' || voice.language === 'en-US',
    );
    expect(english).toHaveLength(10);
    expect(VOICES.filter((voice) => voice.language === 'ar-AE')).toHaveLength(4);

    expect(VOICES.filter((voice) => voice.engine === 'kokoro')).toHaveLength(9);
    expect(VOICES.filter((voice) => voice.engine === 'silma')).toHaveLength(2);
    expect(VOICES.filter((voice) => voice.engine === 'qwen3')).toHaveLength(2);
    expect(VOICES.filter((voice) => voice.engine === 'elevenlabs')).toHaveLength(1);
  });

  it('has both genders in every language', () => {
    for (const language of LANGUAGES) {
      const genders = new Set(voicesFor(language).map((voice) => voice.gender));
      expect([...genders].sort()).toEqual(['female', 'male']);
    }
  });

  it('marks only the ElevenLabs voice as needing a paid licence', () => {
    for (const voice of VOICES) {
      if (voice.engine === 'elevenlabs') {
        expect(voice.commercialUse).toBe(false);
        expect(voice.tone).toContain('paid licence');
      } else {
        expect(voice.commercialUse).toBe(true);
      }
    }
  });

  it('defaults Arabic to a commercial-use Arabic voice', () => {
    const voice = defaultVoice('ar-AE');
    expect(voice.language).toBe('ar-AE');
    expect(voice.commercialUse).toBe(true);
    expect(voice.engine).not.toBe('elevenlabs');
  });

  it('keeps every engine reachable through the exported list', () => {
    expect([...ENGINES].sort()).toEqual([
      'elevenlabs',
      'kokoro',
      'qwen3',
      'silma',
    ]);
  });
});

describe('buildScript', () => {
  it('writes a 30-second English spot of 55–70 words with no digits', () => {
    const script = buildScript({
      facts: FACTS,
      rooms: ROOMS,
      durationSec: 30,
      language: 'en-GB',
      agentName: 'Sara',
    });

    const words = countWords(script);
    expect(words).toBeGreaterThanOrEqual(55);
    expect(words).toBeLessThanOrEqual(70);

    expect(script).not.toMatch(/\d/);
    expect(script).toContain('Marina Gate one');
    expect(script).toContain('Dubai Marina');
    expect(script).toContain('three bedrooms');
    expect(script).toContain('two bathrooms');
    expect(script).toContain('one point eight five million');
    expect(script).not.toContain('!');
  });

  it('writes Arabic with Arabic characters, no transliteration and matching length', () => {
    const english = buildScript({
      facts: FACTS,
      rooms: ROOMS,
      durationSec: 30,
      language: 'en-GB',
      agentName: 'Sara',
    });
    const arabic = buildScript({
      facts: FACTS,
      rooms: ROOMS,
      durationSec: 30,
      language: 'ar-AE',
      agentName: 'Sara',
    });

    expect(arabic).toMatch(/[\u0600-\u06FF]/);
    expect(arabic).not.toMatch(/\d/);
    expect(arabic).not.toContain('!');

    // The community name is the only permitted Latin text.
    const withoutCommunity = arabic.replace(/Dubai Marina/g, '');
    expect(withoutCommunity).not.toMatch(/[A-Za-z]/);

    const ratio = countWords(arabic) / countWords(english);
    expect(ratio).toBeGreaterThanOrEqual(0.85);
    expect(ratio).toBeLessThanOrEqual(1.15);

    const charRatio = arabic.length / english.length;
    expect(charRatio).toBeGreaterThanOrEqual(0.85);
    expect(charRatio).toBeLessThanOrEqual(1.15);
  });

  it('speaks the currency when the price is below a million', () => {
    const script = buildScript({
      facts: { ...FACTS, price: 'AED 850,000' },
      rooms: ROOMS,
      durationSec: 30,
      language: 'en-GB',
    });

    expect(script).toContain('eight hundred and fifty thousand dirhams');
    expect(script).not.toMatch(/\d/);
  });

  it('falls back to the on-screen price when no price is supplied', () => {
    const script = buildScript({
      facts: { ...FACTS, price: undefined },
      rooms: ROOMS,
      durationSec: 30,
      language: 'en-GB',
    });

    expect(script).toContain('The price is shown on screen.');
    expect(script).not.toMatch(/\d/);
  });
});

describe('duration estimate', () => {
  it('treats 66 words as 30 seconds at 2.2 words per second', () => {
    const script = 'word '.repeat(66).trim();
    expect(estimateDurationSec(script)).toBe(30);
    expect(estimateDurationSec(script, 2.2)).toBe(30);
  });

  it('returns zero for an empty script and guards a zero rate', () => {
    expect(estimateDurationSec('')).toBe(0);
    expect(estimateDurationSec('   ')).toBe(0);
    expect(estimateDurationSec('one two three', 0)).toBe(0);
    expect(countWords('')).toBe(0);
  });

  it('rounds to one decimal place', () => {
    expect(estimateDurationSec('one two three')).toBe(1.4);
    expect(estimateDurationSec('one two three', 3)).toBe(1);
  });
});

describe('preview key', () => {
  const base = {
    voiceId: 'emma-gb',
    engineVersion: '1.0.0',
    text: 'Marina Gate one. Three bedrooms, two baths.',
  } as const;

  it('is a stable sha256 hex for identical input', () => {
    const key = previewKey(base);
    expect(key).toBe(
      '68636cc260a351df86d77c8476e3185167d501d251c961c65c7448f5212dd644',
    );
    expect(previewKey({ ...base })).toBe(key);
  });

  it('changes when the engine version, voice or text changes', () => {
    const key = previewKey(base);
    expect(previewKey({ ...base, engineVersion: '1.1.0' })).not.toBe(key);
    expect(previewKey({ ...base, voiceId: 'george-gb' })).not.toBe(key);
    expect(previewKey({ ...base, text: 'A different line.' })).not.toBe(key);
  });
});

describe('preview cache contract', () => {
  class MemoryPreviewCache implements PreviewCache {
    private readonly entries = new Map<string, string>();

    get(key: string): string | undefined {
      return this.entries.get(key);
    }

    put(key: string, path: string): void {
      this.entries.set(key, path);
    }
  }

  it('returns the stored path and misses cleanly', () => {
    const cache: PreviewCache = new MemoryPreviewCache();
    const key = previewKey({
      voiceId: 'layla-ar',
      engineVersion: 'silma-1.0.0',
      text: 'Marina Gate one.',
    });

    expect(cache.get(key)).toBeUndefined();

    cache.put(key, 'previews/layla-ar/marina-gate.wav');
    expect(cache.get(key)).toBe('previews/layla-ar/marina-gate.wav');

    cache.put(key, 'previews/layla-ar/marina-gate-v2.wav');
    expect(cache.get(key)).toBe('previews/layla-ar/marina-gate-v2.wav');
  });
});
