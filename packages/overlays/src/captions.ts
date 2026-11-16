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
import type { CaptionStyle as LegacyCaptionStyle, Edl } from '../../edl/src/types';
import { canvasDurationSec, framesFor } from './timeline';
import type { CaptionCueFrames } from './types';

// ---------------------------------------------------------------------------
// Style contract (docs/CAPTIONS.md, schema 1.1)
// ---------------------------------------------------------------------------

export type CaptionPresetId = 'social_bold' | 'clean_reel' | 'editorial';

export type CaptionFont = 'bricolage' | 'archivo' | 'instrument_serif';

export type CaptionCase = 'sentence' | 'upper' | 'title';

export type CaptionAlign = 'left' | 'center' | 'right';

export type CaptionPosition = 'bottom' | 'center' | 'top';

export type CaptionColourToken = 'paper' | 'ink' | 'brass';

export type CaptionAccent = 'none' | 'first_word' | 'last_word' | 'longest_word';

export type CaptionBacking = 'none' | 'soft_shadow' | 'gradient_scrim' | 'solid_plate';

export type CaptionAnimation = 'pop' | 'fade' | 'word_stagger';

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
  });

export function isCaptionPreset(value: string): value is CaptionPresetId {
  return Object.prototype.hasOwnProperty.call(CAPTION_PRESETS, value);
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
    weight: clamp(input.weight ?? base.weight, 400, 800, base.weight),
    sizeBase: clamp(input.sizeBase ?? base.sizeBase, 48, 96, base.sizeBase),
    case: input.case ?? base.case,
    align: input.align ?? base.align,
    position: input.position ?? base.position,
    colour: input.colour ?? base.colour,
    accentColour: input.accentColour ?? base.accentColour,
    accent: input.accent ?? base.accent,
    backing: input.backing ?? base.backing,
    animation: input.animation ?? base.animation,
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
