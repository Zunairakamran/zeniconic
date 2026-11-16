/**
 * Turns Scribe word timings into short, readable caption cues.
 *
 * The cleaner is deliberately conservative: it drops only the named filler
 * words, never invents words or punctuation, and keeps each surviving word's
 * measured start and end. A long word is allowed to exceed the visual budget
 * rather than being split or truncated.
 */

import type { TranscriptWord } from './transcribe';

export const MAX_WORDS_PER_LINE = 6;
export const MAX_LINES_PER_CUE = 2;

/** Only these whole words are removed; `like` is included by product request. */
export const DEFAULT_FILLERS: readonly string[] = Object.freeze([
  'um',
  'umm',
  'uh',
  'uhh',
  'er',
  'erm',
  'like',
]);

export interface CleanedCaptionCue {
  start: number;
  end: number;
  /** One or two display lines, each at most six words. */
  lines: string[];
  /** The surviving words, in order, with their original timings. */
  words: TranscriptWord[];
}

export interface CaptionCleanerOptions {
  /** Clamped to 1..6. Defaults to 6. */
  maxWordsPerLine?: number;
  /** Clamped to 1..2. Defaults to 2. */
  maxLines?: number;
  /** Defaults to {@link DEFAULT_FILLERS}. */
  fillers?: readonly string[];
}

interface CleanWord extends TranscriptWord {
  sentenceEnd: boolean;
}

interface Line {
  words: CleanWord[];
  sentenceEnd: boolean;
}

const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;
const LETTER = /\p{L}/u;

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function coreOf(text: string): string {
  return text
    .replace(/^[^\p{L}\p{N}']+/u, '')
    .replace(/[^\p{L}\p{N}']+$/u, '')
    .toLowerCase();
}

/** Uppercases the first letter while leaving quotes and brackets in place. */
function capitalise(text: string): string {
  const index = [...text].findIndex((char) => LETTER.test(char));
  if (index < 0) return text;

  const chars = [...text];
  const char = chars[index];
  if (char === undefined) return text;
  chars[index] = char.toLocaleUpperCase();
  return chars.join('');
}

/** `i` / `i'm` / `i’ve` are the only words whose internal casing is repaired. */
function capitaliseFirstPerson(text: string): string {
  return text.replace(
    /^i(?=(?:['’](?:m|ve|ll|d|s))?(?:[^\p{L}\p{N}]|$))/iu,
    (match) => match.toLocaleUpperCase(),
  );
}

function displayWord(text: string, startsLine: boolean): string {
  const repaired = capitaliseFirstPerson(text);
  return startsLine ? capitalise(repaired) : repaired;
}

function resolveOptions(options: CaptionCleanerOptions): {
  maxWordsPerLine: number;
  maxLines: number;
  fillers: Set<string>;
} {
  const rawWords = options.maxWordsPerLine ?? MAX_WORDS_PER_LINE;
  const rawLines = options.maxLines ?? MAX_LINES_PER_CUE;

  if (!Number.isInteger(rawWords) || rawWords <= 0) {
    throw new RangeError(`maxWordsPerLine must be a positive integer, received ${rawWords}`);
  }
  if (!Number.isInteger(rawLines) || rawLines <= 0) {
    throw new RangeError(`maxLines must be a positive integer, received ${rawLines}`);
  }

  return {
    maxWordsPerLine: Math.min(MAX_WORDS_PER_LINE, rawWords),
    maxLines: Math.min(MAX_LINES_PER_CUE, rawLines),
    fillers: new Set(
      (options.fillers ?? DEFAULT_FILLERS).map((word) => coreOf(word)).filter(Boolean),
    ),
  };
}

function cleanWords(
  words: readonly TranscriptWord[],
  fillers: ReadonlySet<string>,
): CleanWord[] {
  const cleaned: CleanWord[] = [];

  for (const word of words) {
    const text = word.word.replace(/\s+/g, ' ').trim();
    if (text.length === 0) continue;

    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) {
      throw new RangeError(`Word "${text}" needs finite start and end times`);
    }
    if (word.start < 0) {
      throw new RangeError(`Word "${text}" has a negative start (${word.start})`);
    }
    if (word.end < word.start) {
      throw new RangeError(`Word "${text}" ends (${word.end}) before it starts (${word.start})`);
    }

    if (fillers.has(coreOf(text))) continue;

    cleaned.push({
      word: text,
      start: round3(word.start),
      end: round3(word.end),
      sentenceEnd: SENTENCE_END.test(text),
    });
  }

  return cleaned;
}

function buildLines(words: readonly CleanWord[], maxWordsPerLine: number): Line[] {
  const lines: Line[] = [];
  let current: CleanWord[] = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= maxWordsPerLine || word.sentenceEnd) {
      lines.push({ words: current, sentenceEnd: word.sentenceEnd });
      current = [];
    }
  }

  if (current.length > 0) {
    const last = current[current.length - 1];
    lines.push({ words: current, sentenceEnd: last?.sentenceEnd ?? false });
  }

  return lines;
}

function toCues(lines: readonly Line[], maxLines: number): CleanedCaptionCue[] {
  const cues: CleanedCaptionCue[] = [];
  let pending: Line[] = [];

  const flush = (): void => {
    if (pending.length === 0) return;

    const words: TranscriptWord[] = [];
    const display: string[] = [];

    for (const line of pending) {
      const tokens: string[] = [];
      line.words.forEach((word, index) => {
        const text = displayWord(word.word, index === 0);
        tokens.push(text);
        words.push({ word: text, start: word.start, end: word.end });
      });
      display.push(tokens.join(' '));
    }

    const first = words[0];
    const last = words[words.length - 1];
    if (first && last) {
      cues.push({
        start: first.start,
        end: last.end,
        lines: display,
        words,
      });
    }

    pending = [];
  };

  for (const line of lines) {
    pending.push(line);
    if (line.sentenceEnd || pending.length >= maxLines) flush();
  }
  flush();

  return cues;
}

/**
 * Produces caption cues with at most six words per line and two lines per cue.
 * Sentence-ending punctuation closes the cue; no other text is added.
 */
export function cleanCaptions(
  words: readonly TranscriptWord[],
  options: CaptionCleanerOptions = {},
): CleanedCaptionCue[] {
  const opts = resolveOptions(options);
  const cleaned = cleanWords(words, opts.fillers);
  if (cleaned.length === 0) return [];

  const lines = buildLines(cleaned, opts.maxWordsPerLine);
  return toCues(lines, opts.maxLines);
}
