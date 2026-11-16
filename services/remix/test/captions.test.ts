import { describe, expect, it } from 'vitest';

import { MAX_LINES_PER_CUE, MAX_WORDS_PER_LINE, cleanCaptions } from '../src/index';
import type { TranscriptWord } from '../src/index';

function words(tokens: readonly string[], step = 0.4): TranscriptWord[] {
  return tokens.map((token, index) => ({
    word: token,
    start: Math.round(index * step * 1000) / 1000,
    end: Math.round((index * step + step * 0.8) * 1000) / 1000,
  }));
}

describe('cleanCaptions', () => {
  it('strips fillers, capitalises and keeps surviving word timings', () => {
    const cues = cleanCaptions(words(['um', 'like', 'hello,', 'world.']));

    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({
      start: 0.8,
      end: 1.52,
      lines: ['Hello, world.'],
      words: [
        { word: 'Hello,', start: 0.8, end: 1.12 },
        { word: 'world.', start: 1.2, end: 1.52 },
      ],
    });
  });

  it('never puts more than six words on a line or two lines in a cue', () => {
    const tokens = Array.from({ length: 15 }, (_, index) => `word${index + 1}`);
    const cues = cleanCaptions(words(tokens));

    expect(cues).toHaveLength(2);
    expect(cues[0]?.lines).toHaveLength(MAX_LINES_PER_CUE);
    expect(cues[1]?.lines).toHaveLength(1);

    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(MAX_LINES_PER_CUE);
      for (const line of cue.lines) {
        expect(line.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS_PER_LINE);
      }
    }
  });

  it('closes a cue at sentence punctuation instead of packing the next sentence in', () => {
    const cues = cleanCaptions(words(['hello.', 'next', 'sentence.']));

    expect(cues).toHaveLength(2);
    expect(cues[0]?.lines).toEqual(['Hello.']);
    expect(cues[1]?.lines).toEqual(['Next sentence.']);
  });

  it('keeps punctuation attached and capitalises after opening quotes', () => {
    const cues = cleanCaptions(words(['"hello,', 'world!"', 'again?']));

    expect(cues[0]?.lines).toEqual(['"Hello, world!"']);
    expect(cues[1]?.lines).toEqual(['Again?']);
  });

  it('preserves a long word whole rather than splitting or truncating it', () => {
    const long = 'supercalifragilisticexpialidociousandthensomemoreletters';
    const cues = cleanCaptions(words([long]));

    expect(cues).toHaveLength(1);
    expect(cues[0]?.lines).toEqual([`S${long.slice(1)}`]);
    expect(cues[0]?.words[0]?.word).toBe(`S${long.slice(1)}`);
  });

  it('returns no cues for empty input or a transcript of only fillers', () => {
    expect(cleanCaptions([])).toEqual([]);
    expect(cleanCaptions(words(['um', 'uh', 'like']))).toEqual([]);
  });

  it('clamps options to the six-word / two-line ceiling', () => {
    const tokens = Array.from({ length: 14 }, (_, index) => `w${index + 1}`);
    const cues = cleanCaptions(words(tokens), { maxWordsPerLine: 20, maxLines: 9 });

    expect(cues[0]?.lines.length).toBeLessThanOrEqual(2);
    for (const cue of cues) {
      for (const line of cue.lines) {
        expect(line.split(/\s+/).length).toBeLessThanOrEqual(6);
      }
    }
  });

  it('rejects malformed timings rather than guessing them', () => {
    expect(() =>
      cleanCaptions([{ word: 'hello', start: 2, end: 1 }]),
    ).toThrow(RangeError);
    expect(() =>
      cleanCaptions([{ word: 'hello', start: Number.NaN, end: 1 }]),
    ).toThrow(RangeError);
  });
});
