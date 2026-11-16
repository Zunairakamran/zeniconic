import { applyBritishSpellingToWords, normaliseLanguage, uppercaseFirstLetter } from './language';
import { canLayout, layoutCueLines } from './layout';
import type { Cue, CueOptions, Word } from './types';

/** Seconds of on-screen text per second of speech for 17 chars/sec. */
export const READING_CHARS_PER_SEC = 17;

/** Product defaults, mirrored from docs/AUDIO-VOICE.md and CONVENTIONS.md. */
export const DEFAULT_CUE_OPTIONS = Object.freeze({
  maxCharsPerLine: 32,
  maxLines: 2,
  maxCueSec: 4.5,
  minCueSec: 1,
  gapSec: 0.08,
});

/** A silence this long is a natural caption boundary even mid-sentence. */
export const PAUSE_SPLIT_SEC = 0.35;

const TIME_EPSILON = 1e-9;
const MIN_CUE_DURATION_SEC = 0.001;

const SENTENCE_END = /[.!?…؟](?:["'”’)\]]*)$/u;
const CLAUSE_END = /[,;:—–،؛](?:["'”’)\]]*)$/u;

interface ResolvedCueOptions {
  maxCharsPerLine: number;
  maxLines: number;
  maxCueSec: number;
  minCueSec: number;
  gapSec: number;
  language: string;
}

type GroupBreak = 'start' | 'sentence' | 'pause' | 'clause' | 'capacity';

interface RawCue {
  words: Word[];
  startSec: number;
  endSec: number;
  /** Why this cue starts where it does; structural breaks are not merged. */
  breakReason: GroupBreak;
}

function resolveOptions(options: CueOptions): ResolvedCueOptions {
  const maxCharsPerLine = options.maxCharsPerLine ?? DEFAULT_CUE_OPTIONS.maxCharsPerLine;
  const maxLines = options.maxLines ?? DEFAULT_CUE_OPTIONS.maxLines;
  const maxCueSec = options.maxCueSec ?? DEFAULT_CUE_OPTIONS.maxCueSec;
  const minCueSec = options.minCueSec ?? DEFAULT_CUE_OPTIONS.minCueSec;
  const gapSec = options.gapSec ?? DEFAULT_CUE_OPTIONS.gapSec;

  if (!Number.isInteger(maxCharsPerLine) || maxCharsPerLine <= 0) {
    throw new RangeError(`maxCharsPerLine must be a positive integer, received ${maxCharsPerLine}`);
  }
  if (!Number.isInteger(maxLines) || maxLines <= 0) {
    throw new RangeError(`maxLines must be a positive integer, received ${maxLines}`);
  }
  if (!Number.isFinite(maxCueSec) || maxCueSec <= 0) {
    throw new RangeError(`maxCueSec must be a positive finite number, received ${maxCueSec}`);
  }
  if (!Number.isFinite(minCueSec) || minCueSec < 0) {
    throw new RangeError(`minCueSec must be a non-negative finite number, received ${minCueSec}`);
  }
  if (!Number.isFinite(gapSec) || gapSec < 0) {
    throw new RangeError(`gapSec must be a non-negative finite number, received ${gapSec}`);
  }
  if (minCueSec > maxCueSec) {
    throw new RangeError(`minCueSec (${minCueSec}) must not exceed maxCueSec (${maxCueSec})`);
  }

  return {
    maxCharsPerLine,
    maxLines,
    maxCueSec,
    minCueSec,
    gapSec,
    language: normaliseLanguage(options.language ?? 'en-GB'),
  };
}

function normaliseWords(words: readonly Word[]): Word[] {
  const indexed: { word: Word; index: number }[] = [];

  words.forEach((word, index) => {
    const text = word.text.replace(/\s+/g, ' ').trim();
    if (text.length === 0) return;

    if (!Number.isFinite(word.startSec) || !Number.isFinite(word.endSec)) {
      throw new RangeError(`Word "${text}" needs finite startSec and endSec`);
    }
    if (word.startSec < 0) {
      throw new RangeError(`Word "${text}" has a negative startSec (${word.startSec})`);
    }
    if (word.endSec < word.startSec) {
      throw new RangeError(
        `Word "${text}" ends (${word.endSec}) before it starts (${word.startSec})`,
      );
    }

    indexed.push({ word: { ...word, text }, index });
  });

  indexed.sort(
    (a, b) =>
      a.word.startSec - b.word.startSec ||
      a.word.endSec - b.word.endSec ||
      a.index - b.index,
  );

  return indexed.map(({ word }) => word);
}

function localise(words: readonly Word[], language: string): Word[] {
  if (language !== 'en-GB') return [...words];

  const corrected = applyBritishSpellingToWords(words.map((word) => word.text));
  return words.map((word, index) => ({ ...word, text: corrected[index] ?? word.text }));
}

function makeCue(words: readonly Word[], breakReason: GroupBreak): RawCue {
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) throw new Error('Cannot build a cue from zero words');

  return {
    words: [...words],
    startSec: first.startSec,
    endSec: Math.max(first.startSec, last.endSec),
    breakReason,
  };
}

function fitsWith(group: readonly Word[], next: Word, opts: ResolvedCueOptions): boolean {
  const first = group[0];
  if (!first) return true;
  if (next.endSec - first.startSec > opts.maxCueSec + TIME_EPSILON) return false;

  const tokens = group.map((word) => word.text);
  tokens.push(next.text);
  return canLayout(tokens, opts.maxCharsPerLine, opts.maxLines);
}

interface SplitPoint {
  index: number;
  breakReason: 'sentence' | 'clause';
}

/** The latest sentence boundary, then the latest clause boundary, in a run. */
function preferredSplit(words: readonly Word[]): SplitPoint | null {
  for (let i = words.length - 1; i >= 1; i -= 1) {
    const word = words[i];
    if (word && SENTENCE_END.test(word.text)) return { index: i + 1, breakReason: 'sentence' };
  }
  for (let i = words.length - 1; i >= 1; i -= 1) {
    const word = words[i];
    if (word && CLAUSE_END.test(word.text)) return { index: i + 1, breakReason: 'clause' };
  }
  return null;
}

/**
 * Packs words into maximal cues, breaking at sentence punctuation, long
 * pauses, and the character/duration caps. On overflow it prefers the latest
 * clause punctuation over an arbitrary word boundary.
 */
function groupWords(words: readonly Word[], opts: ResolvedCueOptions): RawCue[] {
  const groups: RawCue[] = [];
  let current: RawCue | null = null;

  for (const word of words) {
    if (current === null) {
      current = makeCue([word], 'start');
      continue;
    }

    const previousWord = current.words[current.words.length - 1];
    if (!previousWord) continue;

    if (SENTENCE_END.test(previousWord.text)) {
      groups.push(current);
      current = makeCue([word], 'sentence');
      continue;
    }

    if (word.startSec - previousWord.endSec >= PAUSE_SPLIT_SEC) {
      groups.push(current);
      current = makeCue([word], 'pause');
      continue;
    }

    if (fitsWith(current.words, word, opts)) {
      current.words.push(word);
      current.endSec = Math.max(current.endSec, word.endSec);
      continue;
    }

    const split = preferredSplit(current.words);
    if (split !== null && split.index > 0 && split.index < current.words.length) {
      const head = current.words.slice(0, split.index);
      const carry = current.words.slice(split.index);

      groups.push(makeCue(head, current.breakReason));
      const carryCue = makeCue(carry, split.breakReason);

      if (fitsWith(carryCue.words, word, opts)) {
        carryCue.words.push(word);
        carryCue.endSec = Math.max(carryCue.endSec, word.endSec);
        current = carryCue;
      } else {
        groups.push(carryCue);
        current = makeCue([word], 'capacity');
      }
      continue;
    }

    groups.push(current);
    current = makeCue([word], 'capacity');
  }

  if (current !== null) groups.push(current);
  return groups;
}

function canMerge(
  previous: RawCue,
  next: RawCue,
  opts: ResolvedCueOptions,
  allowClause: boolean,
): boolean {
  if (next.breakReason === 'sentence' || next.breakReason === 'pause') return false;
  if (next.breakReason === 'clause' && !allowClause) return false;

  // Only gaps smaller than gapSec are worth merging; a gap at or above it is a
  // deliberate pause and stays a boundary.
  if (next.startSec - previous.endSec >= opts.gapSec) return false;

  const last = previous.words[previous.words.length - 1];
  if (last && SENTENCE_END.test(last.text)) return false;

  const endSec = Math.max(previous.endSec, next.endSec);
  if (endSec - previous.startSec > opts.maxCueSec + TIME_EPSILON) return false;

  const tokens = [...previous.words, ...next.words].map((word) => word.text);
  return canLayout(tokens, opts.maxCharsPerLine, opts.maxLines);
}

function absorb(target: RawCue, source: RawCue): void {
  target.words = [...target.words, ...source.words];
  target.endSec = Math.max(target.endSec, source.endSec);
}

/** Merges adjacent cues whose gap is below gapSec when the result still fits. */
function mergeSmallGaps(cues: readonly RawCue[], opts: ResolvedCueOptions): RawCue[] {
  const merged: RawCue[] = [];

  for (const cue of cues) {
    const previous = merged[merged.length - 1];
    if (previous && canMerge(previous, cue, opts, false)) {
      absorb(previous, cue);
    } else {
      merged.push(makeCue(cue.words, cue.breakReason));
    }
  }

  return merged;
}

/** A cue shorter than minCueSec may swallow the next one across a soft break. */
function mergeShortCues(cues: readonly RawCue[], opts: ResolvedCueOptions): RawCue[] {
  const merged: RawCue[] = [];

  for (const cue of cues) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.endSec - previous.startSec < opts.minCueSec &&
      canMerge(previous, cue, opts, true)
    ) {
      absorb(previous, cue);
      continue;
    }
    merged.push(makeCue(cue.words, cue.breakReason));
  }

  return merged;
}

/**
 * A capacity overflow can strand one word in its own cue. If the preceding cue
 * has words to spare, move its last word into the short cue so both remain
 * readable. Sentence and pause breaks are left alone: a one-word "Yes." after
 * a full stop is a legitimate beat, not an orphan.
 */
function rebalanceSingleWordCues(
  cues: readonly RawCue[],
  opts: ResolvedCueOptions,
): RawCue[] {
  const balanced = cues.map((cue) => makeCue(cue.words, cue.breakReason));

  for (let i = 1; i < balanced.length; i += 1) {
    const cue = balanced[i];
    const previous = balanced[i - 1];
    if (!cue || !previous) continue;
    if (cue.words.length !== 1) continue;
    if (cue.breakReason === 'sentence' || cue.breakReason === 'pause') continue;
    if (previous.words.length < 3) continue;

    const moved = previous.words[previous.words.length - 1];
    if (!moved) continue;

    const previousWords = previous.words.slice(0, -1);
    const cueWords = [moved, ...cue.words];

    if (!canLayout(previousWords.map((word) => word.text), opts.maxCharsPerLine, opts.maxLines)) {
      continue;
    }
    if (!canLayout(cueWords.map((word) => word.text), opts.maxCharsPerLine, opts.maxLines)) {
      continue;
    }

    const newPreviousEnd = previousWords[previousWords.length - 1];
    if (!newPreviousEnd) continue;
    if (newPreviousEnd.endSec - previous.startSec > opts.maxCueSec + TIME_EPSILON) continue;
    if (cue.endSec - moved.startSec > opts.maxCueSec + TIME_EPSILON) continue;

    previous.words = previousWords;
    previous.endSec = Math.max(previous.startSec, newPreviousEnd.endSec);
    cue.words = cueWords;
    cue.startSec = moved.startSec;
  }

  return balanced;
}

/**
 * Extends a short cue's tail to minCueSec when there is room before the next
 * cue. It never overlaps, and it never stretches a cue past the following
 * word's start.
 */
function padShortCues(cues: readonly RawCue[], opts: ResolvedCueOptions): void {
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (!cue) continue;
    if (cue.endSec - cue.startSec >= opts.minCueSec) continue;

    const desiredEnd = cue.startSec + opts.minCueSec;
    const next = cues[i + 1];
    if (next === undefined || desiredEnd <= next.startSec + TIME_EPSILON) {
      cue.endSec = desiredEnd;
    }
  }
}

function roundSeconds(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finalise(rawCues: readonly RawCue[], opts: ResolvedCueOptions): Cue[] {
  const cues: Cue[] = [];
  let previousEnd = 0;

  for (const raw of rawCues) {
    const start = roundSeconds(Math.max(raw.startSec, previousEnd));
    let end = roundSeconds(Math.max(raw.endSec, start));
    if (end <= start) end = roundSeconds(start + MIN_CUE_DURATION_SEC);

    const tokens = raw.words.map((word) => word.text);
    const firstToken = tokens[0];
    if (firstToken !== undefined) tokens[0] = uppercaseFirstLetter(firstToken);

    cues.push({
      startSec: start,
      endSec: end,
      lines: layoutCueLines(tokens, opts.maxCharsPerLine, opts.maxLines),
    });
    previousEnd = end;
  }

  return cues;
}

/**
 * Lays word-level timings out into display cues.
 *
 * The returned cues are ascending and non-overlapping. Sentence punctuation
 * and pauses outrank the gap-merge rule, so a full stop always starts a new
 * cue even when the silence after it is tiny.
 */
export function toCues(words: readonly Word[], options: CueOptions = {}): Cue[] {
  const opts = resolveOptions(options);
  const prepared = localise(normaliseWords(words), opts.language);
  if (prepared.length === 0) return [];

  const grouped = groupWords(prepared, opts);
  const gapMerged = mergeSmallGaps(grouped, opts);
  const shortMerged = mergeShortCues(gapMerged, opts);
  const balanced = rebalanceSingleWordCues(shortMerged, opts);
  padShortCues(balanced, opts);

  return finalise(balanced, opts);
}

/**
 * Seconds needed to read a cue at 17 characters per second.
 *
 * This is a measurement, not a correction: compare it with
 * `cue.endSec - cue.startSec` to flag an over-dense cue. Captions are never
 * silently stretched to make the reading time fit.
 */
export function estimateReadingTime(cue: Cue): number {
  const text = cue.lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
  return Array.from(text).length / READING_CHARS_PER_SEC;
}
