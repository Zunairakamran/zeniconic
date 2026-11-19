/**
 * Captions for the composition.
 *
 * Cues come from `packages/captions` (`toCues`) so the burned captions, the
 * sidecar SRT and the validator all wrap the same words. This module adds the
 * frame timings, the RTL flag and the style contract from docs/CAPTIONS.md.
 *
 * The style contract is data: a preset plus overrides, resolved here so the
 * renderer never hardcodes a font, size, colour or animation again. Legacy
 * string styles (`bold_center`, `clean_lower`, `editorial_serif`) map onto the
 * shipped presets, so old EDLs keep rendering.
 */

import { toCues } from '../../captions/src/cues';
import { isRtl } from '../../captions/src/language';
import { layoutCueLines } from '../../captions/src/layout';
import type { Cue } from '../../captions/src/types';
import type {
  CaptionStyle as LegacyCaptionStyle,
  Edl,
  TextAnimation,
} from '../../edl/src/types';
import { canvasDurationSec, framesFor } from './timeline';
import type { CaptionCueFrames } from './types';

// ---------------------------------------------------------------------------
// Style contract (docs/CAPTIONS.md, schema 1.1)
// ---------------------------------------------------------------------------

export type CaptionPresetId =
  | 'social_bold'
  | 'clean_reel'
  | 'editorial'
  | 'luxury_gold'
  | 'kinetic_bold'
  | 'minimal_white'
  | 'glass_pill'
  | 'bold_bw';

export type CaptionFont = 'bricolage' | 'archivo' | 'instrument_serif';

export type CaptionCase = 'sentence' | 'upper' | 'title';

export type CaptionAlign = 'left' | 'center' | 'right';

export type CaptionPosition = 'bottom' | 'center' | 'top';

export type CaptionColourToken = 'paper' | 'ink' | 'brass';

export type CaptionAccent = 'none' | 'first_word' | 'last_word' | 'longest_word';

export type CaptionBacking = 'none' | 'soft_shadow' | 'gradient_scrim' | 'solid_plate';

/**
 * The EDL's `captions.animation` union, plus the legacy `word_stagger` alias
 * that shipped before the EDL gained `word_by_word`. `word_stagger` renders
 * exactly like `word_by_word`, so old EDLs and old style objects keep working.
 */
export type CaptionAnimation = TextAnimation | 'word_stagger';

/** Every animation the caption layer knows how to draw. */
export const CAPTION_ANIMATIONS: readonly CaptionAnimation[] = Object.freeze([
  'none',
  'fade',
  'rise',
  'slide_in',
  'pop',
  'typewriter',
  'word_by_word',
  'tracking_in',
  'blur_in',
  'scale_in',
  'word_stagger',
]);

/**
 * The full caption style object. Defaults are Social Bold, which is what the
 * renderer drew before the object existed.
 */
export interface CaptionStyle {
  preset: CaptionPresetId;
  font: CaptionFont;
  weight: number;
  /** Type size at a 1080-wide canvas; the renderer scales it per canvas. */
  sizeBase: number;
  case: CaptionCase;
  align: CaptionAlign;
  position: CaptionPosition;
  colour: CaptionColourToken;
  accentColour: CaptionColourToken;
  accent: CaptionAccent;
  backing: CaptionBacking;
  animation: CaptionAnimation;
  maxLines: number;
  maxCharsPerLine: number;
}

/** A preset id, a legacy EDL string, or a partial style object. */
export type CaptionStyleInput =
  | CaptionPresetId
  | LegacyCaptionStyle
  | Partial<CaptionStyle>
  | null
  | undefined;

/**
 * The line budget at 76 px. Social Bold is wide: at an average 0.66 em per
 * uppercase glyph, 20 characters is the longest line that stays inside the
 * 900 px safe column, so the cue splitter uses it for every preset instead of
 * letting the browser make a third line.
 */
export const CAPTION_MAX_CHARS = 20;
export const CAPTION_MAX_LINES = 2;

export const DEFAULT_CAPTION_PRESET: CaptionPresetId = 'social_bold';

export const CAPTION_PRESETS: Readonly<Record<CaptionPresetId, CaptionStyle>> = Object.freeze({
  social_bold: Object.freeze({
    preset: 'social_bold',
    font: 'bricolage',
    weight: 800,
    sizeBase: 76,
    case: 'upper',
    align: 'center',
    position: 'bottom',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'longest_word',
    backing: 'none',
    animation: 'pop',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: CAPTION_MAX_CHARS,
  }),
  clean_reel: Object.freeze({
    preset: 'clean_reel',
    font: 'archivo',
    weight: 600,
    sizeBase: 64,
    case: 'sentence',
    align: 'center',
    position: 'bottom',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'none',
    backing: 'soft_shadow',
    animation: 'fade',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: CAPTION_MAX_CHARS,
  }),
  editorial: Object.freeze({
    preset: 'editorial',
    font: 'instrument_serif',
    weight: 400,
    sizeBase: 60,
    case: 'sentence',
    align: 'left',
    position: 'bottom',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'none',
    backing: 'none',
    animation: 'fade',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: CAPTION_MAX_CHARS,
  }),
  luxury_gold: Object.freeze({
    preset: 'luxury_gold',
    font: 'instrument_serif',
    weight: 400,
    sizeBase: 68,
    case: 'title',
    align: 'center',
    position: 'bottom',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'longest_word',
    backing: 'none',
    animation: 'rise',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: 22,
  }),
  kinetic_bold: Object.freeze({
    preset: 'kinetic_bold',
    font: 'bricolage',
    weight: 400,
    sizeBase: 92,
    case: 'upper',
    align: 'center',
    position: 'bottom',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'longest_word',
    backing: 'none',
    animation: 'word_by_word',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: 18,
  }),
  minimal_white: Object.freeze({
    preset: 'minimal_white',
    font: 'archivo',
    weight: 300,
    sizeBase: 56,
    case: 'sentence',
    align: 'center',
    position: 'bottom',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'none',
    backing: 'soft_shadow',
    animation: 'fade',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: 28,
  }),
  glass_pill: Object.freeze({
    preset: 'glass_pill',
    font: 'archivo',
    weight: 600,
    sizeBase: 56,
    case: 'sentence',
    align: 'center',
    position: 'bottom',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'none',
    backing: 'solid_plate',
    animation: 'word_by_word',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: 24,
  }),
  bold_bw: Object.freeze({
    preset: 'bold_bw',
    font: 'bricolage',
    weight: 900,
    sizeBase: 84,
    case: 'upper',
    align: 'center',
    position: 'center',
    colour: 'paper',
    accentColour: 'brass',
    accent: 'none',
    backing: 'solid_plate',
    animation: 'pop',
    maxLines: CAPTION_MAX_LINES,
    maxCharsPerLine: 18,
  }),
});

/** Old EDL string styles keep rendering: each maps to a shipped preset. */
export const LEGACY_CAPTION_PRESETS: Readonly<Record<LegacyCaptionStyle, CaptionPresetId>> =
  Object.freeze({
    bold_center: 'social_bold',
    clean_lower: 'clean_reel',
    editorial_serif: 'editorial',
    social_bold: 'social_bold',
    clean_reel: 'clean_reel',
    editorial: 'editorial',
    luxury_gold: 'luxury_gold',
    kinetic_bold: 'kinetic_bold',
    minimal_white: 'minimal_white',
    glass_pill: 'glass_pill',
    bold_bw: 'bold_bw',
  });

export function isCaptionPreset(value: string): value is CaptionPresetId {
  return Object.prototype.hasOwnProperty.call(CAPTION_PRESETS, value);
}

const CAPTION_ANIMATION_SET: ReadonlySet<string> = new Set<string>(CAPTION_ANIMATIONS);

export function isCaptionAnimation(value: unknown): value is CaptionAnimation {
  return typeof value === 'string' && CAPTION_ANIMATION_SET.has(value);
}

/**
 * Normalises any animation string, including one a hand-edited EDL invented.
 *
 * `word_stagger` is the pre-EDL alias for `word_by_word` and stays valid as an
 * identity; anything unknown falls back (default `fade`, the least surprising
 * entrance, so a typo never produces a cut with no caption at all).
 */
export function normalizeCaptionAnimation(
  value: unknown,
  fallback: CaptionAnimation = 'fade',
): CaptionAnimation {
  return isCaptionAnimation(value) ? value : fallback;
}

function isLegacyStyle(value: string): value is LegacyCaptionStyle {
  return Object.prototype.hasOwnProperty.call(LEGACY_CAPTION_PRESETS, value);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolves any accepted style input to a complete style object.
 *
 * Preset fields win over nothing; a partial object wins over its preset
 * fields. Numbers are clamped to the contract ranges so a hand-edited EDL
 * cannot ask for 400 px type or four lines.
 */
export function resolveCaptionStyle(input?: CaptionStyleInput): CaptionStyle {
  const presetId = ((): CaptionPresetId => {
    if (typeof input === 'string') {
      if (isCaptionPreset(input)) return input;
      if (isLegacyStyle(input)) return LEGACY_CAPTION_PRESETS[input];
      return DEFAULT_CAPTION_PRESET;
    }
    if (input && isCaptionPreset(input.preset ?? '')) return input.preset as CaptionPresetId;
    return DEFAULT_CAPTION_PRESET;
  })();
  const base = CAPTION_PRESETS[presetId];
  if (!input || typeof input === 'string') return { ...base };

  return {
    preset: presetId,
    font: input.font ?? base.font,
    weight: clamp(input.weight ?? base.weight, 400, 900, base.weight),
    sizeBase: clamp(input.sizeBase ?? base.sizeBase, 48, 96, base.sizeBase),
    case: input.case ?? base.case,
    align: input.align ?? base.align,
    position: input.position ?? base.position,
    colour: input.colour ?? base.colour,
    accentColour: input.accentColour ?? base.accentColour,
    accent: input.accent ?? base.accent,
    backing: input.backing ?? base.backing,
    animation: normalizeCaptionAnimation(input.animation, base.animation),
    maxLines: clamp(input.maxLines ?? base.maxLines, 1, 3, base.maxLines),
    maxCharsPerLine: clamp(
      input.maxCharsPerLine ?? base.maxCharsPerLine,
      12,
      40,
      base.maxCharsPerLine,
    ),
  };
}

// ---------------------------------------------------------------------------
// Entrance motion (the values the Remotion caption layer draws)
// ---------------------------------------------------------------------------

/**
 * Entrance lengths, in seconds so a 60 fps take is not twice as slow as the
 * same cut at 30 fps. At 30 fps the fade/rise/pop/slide entrance is 8 frames,
 * which is what the renderer drew before this table existed.
 */
export const CAPTION_ENTRANCE_SEC = 8 / 30;
/** `tracking_in` settles over 10 frames at 30 fps. */
export const CAPTION_TRACKING_SEC = 10 / 30;
/** `blur_in` clears over 10 frames at 30 fps. */
export const CAPTION_BLUR_SEC = 10 / 30;
/** `scale_in` settles over 12 frames at 30 fps. */
export const CAPTION_SCALE_IN_SEC = 12 / 30;
/** `typewriter` reveals about 20 characters per second. */
export const CAPTION_TYPEWRITER_CHARS_PER_SEC = 20;
/** The last word of `word_by_word` starts no later than 1.5 frames at 30 fps. */
export const CAPTION_WORD_STAGGER_MAX_SEC = 1.5 / 30;

/** Resting tracking, matching the renderer's `CAPTION_TRACKING` token. */
export const CAPTION_TRACKING_REST_EM = -0.02;
const TRACKING_START_EM = 0.32;
const BLUR_START_PX = 12;
const SCALE_IN_START = 1.18;
const POP_START_SCALE = 0.88;
const POP_RISE_PX = 4;
const RISE_PX = 6;
/**
 * `slide_in` pushes in horizontally from the safe edge: 32 px at a 1080-wide
 * canvas, further than `rise` travels vertically. The value is a magnitude;
 * the caption layer applies the sign because only it knows the reading edge
 * (left first for LTR, right first for RTL).
 */
const SLIDE_X_PX = 32;

/** Pixels the motion is authored at; `options.scale` rescales it per canvas. */
export const CAPTION_MOTION_BASE_WIDTH = 1080;

/** The numbers the caption layer draws for one cue at one frame. */
export interface CaptionEntranceState {
  /** 0..1 */
  opacity: number;
  /**
   * How far the type starts off its resting position horizontally, in canvas
   * pixels; 0 once settled, and 0 for every animation except `slide_in`. The
   * value is unsigned — the caption layer pushes in from the script's leading
   * edge (left for LTR, right for RTL).
   */
  translateX: number;
  /** Pixels *down* from the resting position; 0 once settled. */
  translateY: number;
  /** 1 at rest. */
  scale: number;
  /** Em tracking for the type; the rest value is `CAPTION_TRACKING_REST_EM`. */
  letterSpacingEm: number;
  /** CSS blur radius in pixels, already scaled to the canvas; 0 when sharp. */
  blurPx: number;
  /** `typewriter` only: how many characters of the cue are drawn (0..charCount). */
  visibleChars?: number;
  /** `word_by_word`/`word_stagger` only: how many words are drawn (0..wordCount). */
  visibleWords?: number;
}

export interface CaptionEntranceOptions {
  /** Canvas width / 1080. Defaults to 1. */
  scale?: number;
  /** Words in the cue, for the `word_by_word` stagger. Defaults to 4. */
  wordCount?: number;
  /** Characters in the cue, for the `typewriter` reveal. Defaults to 24. */
  charCount?: number;
  /**
   * Honour a reduced-motion preference. Remotion has no media query, so the
   * composition passes this once it knows the user's setting; default false.
   * Reduced motion keeps the opacity ramp and the progressive reveals (text
   * appearing is not vestibular motion) and drops every spatial move: no rise,
   * slide, scale, blur or tracking.
   */
  reduceMotion?: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Ease-out cubic: 0 at 0, exactly 1 at 1. */
function easeOutCubic(progress: number): number {
  const p = clamp01(progress);
  return 1 - (1 - p) ** 3;
}

/** Ease-out back, for the pop overshoot. Exactly 1 at 1. */
function easeOutBack(progress: number): number {
  const p = clamp01(progress);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** A positive integer count, with a fallback for a missing or broken option. */
function countOr(value: number | undefined, fallback: number): number {
  const count = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.max(1, count);
}

function makeMotionState(
  fields: Partial<CaptionEntranceState> & Pick<CaptionEntranceState, 'opacity'>,
): CaptionEntranceState {
  return {
    opacity: round4(clamp01(fields.opacity)),
    translateX: round4(Math.max(0, fields.translateX ?? 0)),
    translateY: round4(Math.max(0, fields.translateY ?? 0)),
    scale: round4(fields.scale ?? 1),
    letterSpacingEm: round4(fields.letterSpacingEm ?? CAPTION_TRACKING_REST_EM),
    blurPx: round4(Math.max(0, fields.blurPx ?? 0)),
    ...(fields.visibleChars === undefined ? {} : { visibleChars: fields.visibleChars }),
    ...(fields.visibleWords === undefined ? {} : { visibleWords: fields.visibleWords }),
  };
}

/**
 * The entrance for one cue, as data.
 *
 * `frame` is **cue-relative** (composition frame minus the cue's start frame).
 * Every mode is defined before the cue (`frame < 0` returns its starting pose,
 * and 0 visible characters/words) and after its window (the settled pose).
 * Output is deterministic, clamped and rounded so snapshots do not drift.
 *
 * Timing, all seconds converted with `fps` (so motion length is frame-rate
 * independent; at 30 fps the numbers below are the frame counts in brackets):
 *
 * | animation              | window                 | what moves                                  |
 * |------------------------|------------------------|---------------------------------------------|
 * | `none`                 | instant                | nothing: opacity 1 at frame 0               |
 * | `fade`                 | 0.267 s [8f]           | opacity only                                |
 * | `rise`                 | 0.267 s [8f]           | opacity + 6 px vertical rise from the safe edge |
 * | `slide_in`             | 0.267 s [8f]           | opacity + 32 px horizontal push from the safe edge |
 * | `pop`                  | 0.267 s [8f]           | opacity + 0.88→1 scale with a small overshoot |
 * | `typewriter`           | chars / 20 per second  | one character per ~1.5 frames, no reflow    |
 * | `word_by_word`         | words × stagger        | one word per min(1.5f, 8f/words)            |
 * | `tracking_in`          | 0.333 s [10f]          | 0.32em → -0.02em tracking + opacity         |
 * | `blur_in`              | 0.333 s [10f]          | 12 px → 0 blur + opacity                    |
 * | `scale_in`             | 0.4 s [12f]            | 1.18 → 1 scale + opacity                    |
 *
 * `word_stagger` is accepted as an alias of `word_by_word`. An unknown value
 * falls back to `fade`; see `normalizeCaptionAnimation`.
 */
export function captionEntrance(
  animation: CaptionAnimation | string | null | undefined,
  frame: number,
  fps: number,
  options: CaptionEntranceOptions = {},
): CaptionEntranceState {
  // `word_stagger` is the pre-EDL alias: it draws exactly as `word_by_word`.
  const normalized = normalizeCaptionAnimation(animation);
  const resolved: TextAnimation = normalized === 'word_stagger' ? 'word_by_word' : normalized;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const scale =
    Number.isFinite(options.scale) && (options.scale ?? 0) > 0 ? (options.scale as number) : 1;
  const words = countOr(options.wordCount, 4);
  const chars = countOr(options.charCount, 24);
  const beforeCue = Number.isFinite(frame) && frame < 0;
  const seconds = (Number.isFinite(frame) ? frame : 0) / safeFps;
  const entrance = easeOutCubic(seconds / CAPTION_ENTRANCE_SEC);

  const built = ((): CaptionEntranceState => {
    switch (resolved) {
      case 'none':
        return makeMotionState({ opacity: 1 });

      case 'fade':
        return makeMotionState({ opacity: entrance });

      case 'rise':
        return makeMotionState({
          opacity: entrance,
          translateY: (1 - entrance) * RISE_PX * scale,
        });

      case 'slide_in':
        return makeMotionState({
          opacity: entrance,
          translateX: (1 - entrance) * SLIDE_X_PX * scale,
        });

      case 'pop': {
        const popped = easeOutBack(clamp01(seconds / CAPTION_ENTRANCE_SEC));
        return makeMotionState({
          opacity: entrance,
          translateY: (1 - entrance) * POP_RISE_PX * scale,
          scale: Math.min(1.02, POP_START_SCALE + (1 - POP_START_SCALE) * popped),
        });
      }

      case 'typewriter': {
        if (beforeCue) return makeMotionState({ opacity: 1, visibleChars: 0 });
        const revealed = Math.floor(seconds * CAPTION_TYPEWRITER_CHARS_PER_SEC) + 1;
        return makeMotionState({
          opacity: 1,
          visibleChars: Math.min(chars, Math.max(1, revealed)),
        });
      }

      case 'word_by_word': {
        if (beforeCue) return makeMotionState({ opacity: 1, visibleWords: 0 });
        const stagger = Math.min(CAPTION_WORD_STAGGER_MAX_SEC, CAPTION_ENTRANCE_SEC / words);
        const perSecond = stagger > 0 ? 1 / stagger : safeFps;
        const revealed = Math.floor(seconds * perSecond) + 1;
        return makeMotionState({
          opacity: 1,
          visibleWords: Math.min(words, Math.max(1, revealed)),
        });
      }

      case 'tracking_in': {
        const settled = easeOutCubic(seconds / CAPTION_TRACKING_SEC);
        return makeMotionState({
          opacity: entrance,
          letterSpacingEm:
            TRACKING_START_EM + (CAPTION_TRACKING_REST_EM - TRACKING_START_EM) * settled,
        });
      }

      case 'blur_in':
        return makeMotionState({
          opacity: entrance,
          blurPx: (1 - easeOutCubic(seconds / CAPTION_BLUR_SEC)) * BLUR_START_PX * scale,
        });

      case 'scale_in': {
        const settled = easeOutCubic(seconds / CAPTION_SCALE_IN_SEC);
        return makeMotionState({
          opacity: entrance,
          scale: 1 + (SCALE_IN_START - 1) * (1 - settled),
        });
      }

      default:
        return makeMotionState({ opacity: entrance });
    }
  })();

  return withReducedMotion(built, options.reduceMotion);
}

/** Applies `reduceMotion` to a computed state, keeping the text reveals. */
export function withReducedMotion(
  state: CaptionEntranceState,
  reduceMotion: boolean | undefined,
): CaptionEntranceState {
  if (!reduceMotion) return state;
  return {
    ...state,
    translateX: 0,
    translateY: 0,
    scale: 1,
    letterSpacingEm: CAPTION_TRACKING_REST_EM,
    blurPx: 0,
  };
}

// ---------------------------------------------------------------------------
// Cue splitting: never three lines
// ---------------------------------------------------------------------------

const PUNCTUATION_END = /[.!?…؟,;:—–،؛]["'”’)\]]*$/u;
const MIN_CUE_SEC = 0.001;

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function tokensFit(tokens: readonly string[], maxChars: number, maxLines: number): boolean {
  return layoutCueLines(tokens, maxChars, maxLines).length <= maxLines;
}

/**
 * Cuts a token run into the fewest chunks that each lay out inside the line
 * budget. A cut prefers the last punctuation boundary that still fits, then
 * falls back to the nearest word. Words are never split; a single word wider
 * than the cap keeps its own line.
 */
function splitTokens(
  tokens: readonly string[],
  maxCharsPerLine: number,
  maxLines: number,
): string[][] {
  const chunks: string[][] = [];
  let start = 0;

  while (start < tokens.length) {
    let fit = start + 1;
    while (
      fit < tokens.length &&
      tokensFit(tokens.slice(start, fit + 1), maxCharsPerLine, maxLines)
    ) {
      fit += 1;
    }

    let cut = fit;
    if (fit < tokens.length) {
      for (let index = fit - 1; index > start; index -= 1) {
        const token = tokens[index];
        if (token !== undefined && PUNCTUATION_END.test(token)) {
          cut = index + 1;
          break;
        }
      }
    }

    chunks.push(tokens.slice(start, cut));
    start = cut;
  }

  return chunks;
}

/**
 * Re-wraps one cue and, when it still cannot be laid out in `maxLines`, splits
 * it into several cues. Time follows the characters: a longer half stays on
 * screen longer, and the last chunk keeps the cue's original end.
 */
function fitCue(cue: Cue, maxCharsPerLine: number, maxLines: number): Cue[] {
  const tokens = cue.lines
    .join(' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return [{ ...cue, lines: [] }];

  if (tokensFit(tokens, maxCharsPerLine, maxLines)) {
    return [
      {
        startSec: cue.startSec,
        endSec: cue.endSec,
        lines: layoutCueLines(tokens, maxCharsPerLine, maxLines),
      },
    ];
  }

  const chunks = splitTokens(tokens, maxCharsPerLine, maxLines);
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.join(' ').length, 0);
  const span = cue.endSec - cue.startSec;

  let cursor = cue.startSec;
  return chunks.map((chunk, index) => {
    const chars = chunk.join(' ').length;
    const share = totalChars > 0 ? (span * chars) / totalChars : span / chunks.length;
    const end =
      index === chunks.length - 1 ? cue.endSec : Math.min(cue.endSec, cursor + share);
    const startSec = round3(cursor);
    const endSec = round3(Math.max(startSec, end));
    cursor = Math.max(cursor, endSec);

    return {
      startSec,
      endSec: endSec > startSec ? endSec : round3(startSec + MIN_CUE_SEC),
      lines: layoutCueLines(chunk, maxCharsPerLine, maxLines),
    };
  });
}

/**
 * The layout guard used by `captionCues`: every returned cue is at most
 * `maxLines` lines, and every line is at most `maxCharsPerLine` characters
 * unless it is a single unsplittable word.
 */
export function splitLongCues(
  cues: readonly Cue[],
  maxCharsPerLine: number = CAPTION_MAX_CHARS,
  maxLines: number = CAPTION_MAX_LINES,
): Cue[] {
  return cues.flatMap((cue) => fitCue(cue, maxCharsPerLine, maxLines));
}

// ---------------------------------------------------------------------------
// Cues to frames
// ---------------------------------------------------------------------------

/**
 * Lays the EDL's word timings into at most two lines per cue and converts them
 * to frames. Cues that start after the composition ends are dropped, and a cue
 * that runs past the end is trimmed: the caption layer never outlives the cut.
 *
 * `style` may be a preset id, a legacy EDL string or a style object. When it is
 * omitted the EDL's own `captions.style` is used, defaulting to Social Bold.
 */
export function captionCues(
  edl: Edl,
  fps: number,
  style?: CaptionStyleInput,
): CaptionCueFrames[] {
  if (edl.captions.mode === 'none') return [];
  const words = edl.captions.words;
  if (!words || words.length === 0) return [];

  const language = edl.captions.language ?? 'en-GB';
  const rtl = isRtl(language);
  const resolved = resolveCaptionStyle(style ?? edl.captions.style);
  const cues = splitLongCues(
    toCues(words, {
      maxCharsPerLine: resolved.maxCharsPerLine,
      maxLines: resolved.maxLines,
      language,
    }),
    resolved.maxCharsPerLine,
    resolved.maxLines,
  );

  const totalFrames = framesFor(canvasDurationSec(edl), fps);
  if (totalFrames <= 0) return [];

  const result: CaptionCueFrames[] = [];
  for (const cue of cues) {
    const startFrame = framesFor(cue.startSec, fps);
    if (startFrame >= totalFrames) continue;

    const rawEnd = framesFor(cue.endSec, fps);
    const endFrame = Math.min(Math.max(startFrame + 1, rawEnd), totalFrames);
    if (endFrame <= startFrame) continue;

    const lines = cue.lines.filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    result.push({
      startFrame,
      endFrame,
      lines,
      rtl,
    });
  }

  // Defensive: rounding can make two cues touch; the renderer expects
  // ascending, non-overlapping windows.
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (previous && current && current.startFrame < previous.endFrame) {
      current.startFrame = previous.endFrame;
      if (current.endFrame <= current.startFrame) {
        current.endFrame = Math.min(totalFrames, current.startFrame + 1);
      }
    }
  }

  return result.filter((cue) => cue.endFrame > cue.startFrame);
}
