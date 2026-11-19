/**
 * The caption engine behind the packaged FFmpeg export.
 *
 * Three pure stages, each independently testable:
 *
 *   1. `groupCaptionCues`     word timings → readable cues, bounded by scenes.
 *   2. `resolveCaptionStyle`  an EDL style string + v2 overrides → drawable type.
 *   3. `buildCaptionAss`      cues + type + animation → a real ASS document.
 *
 * The output is burned with libass (`subtitles=…`). Nothing here shells out,
 * reads a font file or measures a glyph: callers inject the canvas, the words
 * and the style. That keeps it usable from a unit test, a QA script and the
 * Electron main process without a render.
 *
 * Honesty about ASS: libass can animate fades, position, scale, blur, tracking
 * and karaoke timing, but it cannot interpolate an easing curve or measure a
 * font. Every animation tag emitted here is listed in `ANIMATION_SUPPORT` with
 * its exact fidelity. Word/character x positions come from a deterministic
 * advance table, not from the TTF, so glyph spacing can differ by a pixel or
 * two from libass's own centring.
 */

import { layoutCueLines } from '../../packages/captions/src/layout';
import type {
  CaptionBox,
  CaptionFont,
  CaptionHighlight,
  CaptionPosition,
  CaptionStyle as EdlCaptionStyle,
  CaptionWord,
  SafeArea,
  TextAnimation,
} from '../../packages/edl/src/types';

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Paper, ink and brass from docs/design/tokens.css. */
export const CAPTION_PAPER = '#F7F4EF';
export const CAPTION_INK = '#14120F';
export const CAPTION_BRASS = '#B08A4A';
export const CAPTION_GOLD = '#D4AF37';
export const CAPTION_CHAMPAGNE = '#F5E7C8';
export const CAPTION_ICE = '#A9E8FF';
export const CAPTION_ACID = '#FFE94A';

/** Type sizes are authored at a 1080-wide canvas and scale with the canvas. */
export const CAPTION_BASE_WIDTH = 1080;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Every caption preset the export path can draw. The last six are new; the
 * first three and the legacy aliases keep old EDLs rendering.
 */
export type CaptionPresetId =
  | 'social_bold'
  | 'clean_reel'
  | 'editorial'
  | 'luxury_gold'
  | 'kinetic_bold'
  | 'minimal_white'
  | 'glass_pill'
  | 'editorial_serif'
  | 'bold_bw';

/** The engine's animation vocabulary; `karaoke` is ASS-only, not an EDL enum. */
export type CaptionEngineAnimation = TextAnimation | 'karaoke';

export type CaptionCase = 'sentence' | 'upper' | 'title';
export type CaptionHorizontalAlign = 'left' | 'center' | 'right';
export type CaptionVerticalAnchor = 'bottom' | 'center' | 'top';
export type CaptionAccent = 'none' | 'first_word' | 'last_word' | 'longest_word';

/** ASS `BorderStyle`: 1 = outline + shadow, 3 = opaque box behind the text. */
export type CaptionBorderStyle = 1 | 3;

export interface CaptionPreset {
  id: CaptionPresetId;
  label: string;
  /**
   * The ASS `Fontname`. This is the family name in the shipped TTF's name
   * table, not an arbitrary CSS stack: libass matches it against `fontsdir`.
   */
  fontFamily: string;
  /** The shipped face's real weight, for documentation and the Bold flag. */
  weight: number;
  /** Type size at 1080 px wide. */
  sizeBase: number;
  case: CaptionCase;
  align: CaptionHorizontalAlign;
  position: CaptionVerticalAnchor;
  colour: string;
  accentColour: string;
  accent: CaptionAccent;
  outlineColour: string;
  shadowColour: string;
  /** Outline width in canvas pixels at 1080 wide (box padding for style 3). */
  outline: number;
  /** Shadow depth in canvas pixels at 1080 wide. */
  shadow: number;
  borderStyle: CaptionBorderStyle;
  boxColour?: string;
  /** 0..1; only used with `borderStyle: 3`. */
  boxOpacity?: number;
  /** Em tracking, like the Remotion layer's `CAPTION_TRACKING_REST_EM`. */
  letterSpacing: number;
  /** Multiplier on the type size. */
  lineHeight: number;
  maxCharsPerLine: number;
  maxLines: number;
  animation: CaptionEngineAnimation;
}

/**
 * Nine presets, deliberately different in family, weight, case, colour,
 * position and motion. No two share all of (font, size, case, alignment,
 * backing, animation):
 *
 * | preset            | face                  | size | case     | layout        | motion        |
 * |-------------------|-----------------------|------|----------|---------------|---------------|
 * | social_bold       | Bricolage Grotesque   | 76   | upper    | bottom centre | pop           |
 * | clean_reel        | Archivo SemiBold      | 64   | sentence | bottom centre | fade          |
 * | editorial         | Space Grotesk Light   | 60   | sentence | bottom left   | fade          |
 * | editorial_serif   | DM Serif Display      | 66   | sentence | bottom left   | tracking_in   |
 * | luxury_gold       | DM Serif Display      | 68   | title    | bottom centre | rise          |
 * | kinetic_bold      | Anton                 | 92   | upper    | bottom centre | word_by_word  |
 * | minimal_white     | Space Grotesk Light   | 56   | sentence | bottom centre | fade          |
 * | glass_pill        | Archivo SemiBold      | 56   | sentence | bottom centre | karaoke       |
 * | bold_bw           | Archivo Black         | 84   | upper    | centre        | pop           |
 */
export const CAPTION_PRESETS: Readonly<Record<CaptionPresetId, CaptionPreset>> = Object.freeze({
  social_bold: Object.freeze({
    id: 'social_bold',
    label: 'Social bold',
    fontFamily: 'Bricolage Grotesque',
    weight: 800,
    sizeBase: 76,
    case: 'upper',
    align: 'center',
    position: 'bottom',
    colour: CAPTION_PAPER,
    accentColour: CAPTION_BRASS,
    accent: 'longest_word',
    outlineColour: CAPTION_INK,
    shadowColour: CAPTION_INK,
    outline: 3,
    shadow: 2,
    borderStyle: 1,
    letterSpacing: 0,
    lineHeight: 1.15,
    maxCharsPerLine: 20,
    maxLines: 2,
    animation: 'pop',
  }),
  clean_reel: Object.freeze({
    id: 'clean_reel',
    label: 'Clean reel',
    fontFamily: 'Archivo SemiBold',
    weight: 600,
    sizeBase: 64,
    case: 'sentence',
    align: 'center',
    position: 'bottom',
    colour: CAPTION_PAPER,
    accentColour: CAPTION_BRASS,
    accent: 'none',
    outlineColour: CAPTION_INK,
    shadowColour: CAPTION_INK,
    outline: 2,
    shadow: 2,
    borderStyle: 1,
    letterSpacing: 0,
    lineHeight: 1.2,
    maxCharsPerLine: 22,
    maxLines: 2,
    animation: 'fade',
  }),
  editorial: Object.freeze({
    id: 'editorial',
    label: 'Editorial',
    fontFamily: 'Space Grotesk Light',
    weight: 300,
    sizeBase: 60,
    case: 'sentence',
    align: 'left',
    position: 'bottom',
    colour: CAPTION_PAPER,
    accentColour: CAPTION_BRASS,
    accent: 'first_word',
    outlineColour: CAPTION_INK,
    shadowColour: CAPTION_INK,
    outline: 0,
    shadow: 3,
    borderStyle: 1,
    letterSpacing: 0.012,
    lineHeight: 1.24,
    maxCharsPerLine: 26,
    maxLines: 2,
    animation: 'fade',
  }),
  editorial_serif: Object.freeze({
    id: 'editorial_serif',
    label: 'Editorial serif',
    fontFamily: 'DM Serif Display',
    weight: 400,
    sizeBase: 66,
    case: 'sentence',
    align: 'left',
    position: 'bottom',
    colour: '#F3EEE3',
    accentColour: CAPTION_BRASS,
    accent: 'longest_word',
    outlineColour: CAPTION_INK,
    shadowColour: CAPTION_INK,
    outline: 0,
    shadow: 2,
    borderStyle: 1,
    letterSpacing: 0.006,
    lineHeight: 1.2,
    maxCharsPerLine: 24,
    maxLines: 2,
    animation: 'tracking_in',
  }),
  luxury_gold: Object.freeze({
    id: 'luxury_gold',
    label: 'Luxury gold',
    fontFamily: 'DM Serif Display',
    weight: 400,
    sizeBase: 68,
    case: 'title',
    align: 'center',
    position: 'bottom',
    colour: CAPTION_CHAMPAGNE,
    accentColour: CAPTION_GOLD,
    accent: 'longest_word',
    outlineColour: '#1A140B',
    shadowColour: '#1A140B',
    outline: 1,
    shadow: 3,
    borderStyle: 1,
    letterSpacing: 0.028,
    lineHeight: 1.22,
    maxCharsPerLine: 22,
    maxLines: 2,
    animation: 'rise',
  }),
  kinetic_bold: Object.freeze({
    id: 'kinetic_bold',
    label: 'Kinetic bold',
    fontFamily: 'Anton',
    weight: 400,
    sizeBase: 92,
    case: 'upper',
    align: 'center',
    position: 'bottom',
    colour: '#FFFFFF',
    accentColour: CAPTION_ACID,
    accent: 'longest_word',
    outlineColour: '#000000',
    shadowColour: '#000000',
    outline: 4,
    shadow: 2,
    borderStyle: 1,
    letterSpacing: 0.008,
    lineHeight: 1.02,
    maxCharsPerLine: 18,
    maxLines: 2,
    animation: 'word_by_word',
  }),
  minimal_white: Object.freeze({
    id: 'minimal_white',
    label: 'Minimal white',
    fontFamily: 'Space Grotesk Light',
    weight: 300,
    sizeBase: 56,
    case: 'sentence',
    align: 'center',
    position: 'bottom',
    colour: '#FFFFFF',
    accentColour: CAPTION_BRASS,
    accent: 'none',
    outlineColour: '#000000',
    shadowColour: '#000000',
    outline: 1,
    shadow: 4,
    borderStyle: 1,
    letterSpacing: 0.006,
    lineHeight: 1.3,
    maxCharsPerLine: 28,
    maxLines: 2,
    animation: 'fade',
  }),
  glass_pill: Object.freeze({
    id: 'glass_pill',
    label: 'Glass pill',
    fontFamily: 'Archivo SemiBold',
    weight: 600,
    sizeBase: 56,
    case: 'sentence',
    align: 'center',
    position: 'bottom',
    colour: '#FFFFFF',
    accentColour: CAPTION_ICE,
    accent: 'none',
    outlineColour: '#0B0F12',
    shadowColour: '#0B0F12',
    outline: 12,
    shadow: 0,
    borderStyle: 3,
    boxColour: '#0B0F12',
    boxOpacity: 0.72,
    letterSpacing: 0.004,
    lineHeight: 1.26,
    maxCharsPerLine: 24,
    maxLines: 2,
    animation: 'karaoke',
  }),
  bold_bw: Object.freeze({
    id: 'bold_bw',
    label: 'Bold black & white',
    fontFamily: 'Archivo Black',
    weight: 900,
    sizeBase: 84,
    case: 'upper',
    align: 'center',
    position: 'center',
    colour: '#FFFFFF',
    accentColour: '#FFFFFF',
    accent: 'none',
    outlineColour: '#000000',
    shadowColour: '#000000',
    outline: 14,
    shadow: 0,
    borderStyle: 3,
    boxColour: '#000000',
    boxOpacity: 1,
    letterSpacing: 0,
    lineHeight: 1.06,
    maxCharsPerLine: 18,
    maxLines: 2,
    animation: 'pop',
  }),
});

/** Old EDL style strings. Every one still resolves to a drawable preset. */
export const LEGACY_CAPTION_STYLES: Readonly<Record<EdlCaptionStyle, CaptionPresetId>> = Object.freeze({
  clean_lower: 'clean_reel',
  bold_center: 'social_bold',
  editorial_serif: 'editorial_serif',
  social_bold: 'social_bold',
  clean_reel: 'clean_reel',
  editorial: 'editorial',
  luxury_gold: 'luxury_gold',
  kinetic_bold: 'kinetic_bold',
  minimal_white: 'minimal_white',
  glass_pill: 'glass_pill',
  bold_bw: 'bold_bw',
});

export const DEFAULT_CAPTION_PRESET: CaptionPresetId = 'social_bold';

export function isCaptionPresetId(value: unknown): value is CaptionPresetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CAPTION_PRESETS, value);
}

/**
 * Everything the renderer needs, after the preset and the EDL's additive v2
 * fields are merged. Numbers are clamped so a hand-edited EDL cannot ask for
 * 400 px type or a negative margin.
 */
export interface ResolvedCaptionStyle extends CaptionPreset {
  /** Horizontal position of the EDL's `caption.position.anchor`, if any. */
  anchor: CaptionVerticalAnchor;
  /** Pixels the block moves away from its anchored edge (down for centre). */
  offsetPx: number;
  /** True when the EDL asked for a backing box. */
  hasBox: boolean;
  /** `#RRGGBB` for the box fill; equal to the preset's when none was given. */
  boxColour: string;
  boxOpacity: number;
  /** The EDL's font family override, when it was drawable. */
  fontFamily: string;
  /** ASS Bold flag source: 700 and up is emboldened. */
  bold: boolean;
}

export interface CaptionStyleOverrides {
  font?: CaptionFont;
  box?: CaptionBox;
  position?: CaptionPosition;
  highlight?: CaptionHighlight;
  animation?: string;
  maxLines?: number;
  maxWordsPerLine?: number;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Resolves an EDL style string (including the six legacy names) plus the v2
 * overrides to one complete, clamped style.
 *
 * Precedence: preset < EDL font/box/position/highlight/animation overrides.
 * A font family the TTF directory does not carry is kept in the ASS (libass
 * does its own fallback), so the document never lies about what was asked for.
 */
export function resolveCaptionStyle(
  style?: string | null,
  overrides: CaptionStyleOverrides = {},
): ResolvedCaptionStyle {
  const presetId: CaptionPresetId =
    typeof style === 'string' && hasOwn(LEGACY_CAPTION_STYLES, style)
      ? LEGACY_CAPTION_STYLES[style as EdlCaptionStyle]
      : typeof style === 'string' && isCaptionPresetId(style)
        ? style
        : DEFAULT_CAPTION_PRESET;
  const preset = CAPTION_PRESETS[presetId];

  const font = overrides.font;
  const position = overrides.position;
  const box = overrides.box;
  const highlight = overrides.highlight;

  const fontFamily =
    typeof font?.family === 'string' && font.family.trim().length > 0
      ? font.family.trim()
      : preset.fontFamily;
  const weight = clamp(font?.weight ?? preset.weight, 100, 900, preset.weight);
  const sizeBase = clamp(font?.sizePx ?? preset.sizeBase, 24, 140, preset.sizeBase);
  const uppercase = font?.uppercase;

  const anchor: CaptionVerticalAnchor =
    position?.anchor === 'top_center'
      ? 'top'
      : position?.anchor === 'center'
        ? 'center'
        : position?.anchor === 'bottom_center'
          ? 'bottom'
          : preset.position;
  const offsetPx = clamp(position?.offsetPx ?? 0, -400, 400, 0);

  const hasBox =
    box !== undefined ||
    (preset.borderStyle === 3 && preset.boxColour !== undefined);
  const boxColour =
    typeof box?.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(box.color)
      ? box.color
      : preset.boxColour ?? '#000000';
  const boxOpacity = clamp(box?.opacity ?? preset.boxOpacity ?? 0.7, 0, 1, 0.7);

  const accentColour =
    typeof highlight?.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(highlight.color)
      ? highlight.color
      : preset.accentColour;

  const animation = normalizeCaptionAnimation(overrides.animation, preset.animation);

  return {
    ...preset,
    fontFamily,
    weight,
    sizeBase,
    case: uppercase === true ? 'upper' : uppercase === false ? 'sentence' : preset.case,
    anchor,
    position: anchor,
    offsetPx,
    hasBox,
    borderStyle: hasBox ? 3 : 1,
    boxColour,
    boxOpacity,
    outline: hasBox ? Math.max(8, preset.outline) : preset.outline,
    shadow: hasBox ? 0 : preset.shadow,
    accentColour,
    animation,
    maxLines: clamp(overrides.maxLines ?? preset.maxLines, 1, 3, preset.maxLines),
    bold: weight >= 700,
  };
}

// ---------------------------------------------------------------------------
// Animation vocabulary
// ---------------------------------------------------------------------------

export const CAPTION_ENGINE_ANIMATIONS: readonly CaptionEngineAnimation[] = Object.freeze([
  'none',
  'fade',
  'rise',
  'slide_in',
  'pop',
  'typewriter',
  'word_by_word',
  'karaoke',
  'tracking_in',
  'blur_in',
  'scale_in',
]);

/** The legacy Remotion alias; it draws exactly like `word_by_word`. */
export const WORD_STAGGER_ALIAS = 'word_stagger';

const ANIMATION_SET: ReadonlySet<string> = new Set<string>([
  ...CAPTION_ENGINE_ANIMATIONS,
  WORD_STAGGER_ALIAS,
]);

/**
 * Normalises any animation string, including one a hand-edited EDL invented.
 * `word_stagger` becomes `word_by_word`; anything unknown falls back.
 */
export function normalizeCaptionAnimation(
  value: unknown,
  fallback: CaptionEngineAnimation = 'fade',
): CaptionEngineAnimation {
  if (typeof value !== 'string' || !ANIMATION_SET.has(value)) return fallback;
  return value === WORD_STAGGER_ALIAS ? 'word_by_word' : (value as CaptionEngineAnimation);
}

/**
 * What each animation actually emits. This table is the contract: if a mode is
 * listed here as "exact", the ASS contains the real tag, not a static pose.
 */
export const ANIMATION_SUPPORT: Readonly<
  Record<CaptionEngineAnimation, { tags: string; fidelity: string }>
> = Object.freeze({
  none: { tags: 'no dialogue events', fidelity: 'exact' },
  fade: { tags: '\\fad', fidelity: 'exact' },
  rise: { tags: '\\move + \\fad', fidelity: 'exact (linear move)' },
  slide_in: { tags: '\\move + \\fad', fidelity: 'exact (linear move)' },
  pop: { tags: '\\t(\\fscx/\\fscy) + \\fad', fidelity: 'approximate (two-step overshoot)' },
  typewriter: { tags: 'one event per character', fidelity: 'approximate (advance estimate)' },
  word_by_word: { tags: 'one event per word with \\t pop', fidelity: 'exact timing, approximate advances' },
  karaoke: { tags: '\\kf per word', fidelity: 'exact (libass karaoke timing)' },
  tracking_in: { tags: '\\fsp + \\t', fidelity: 'approximate (linear per-glyph reflow)' },
  blur_in: { tags: '\\blur + \\t', fidelity: 'approximate (no eased blur)' },
  scale_in: { tags: '\\fscx/\\fscy + \\t', fidelity: 'exact (one linear ramp)' },
});

/** Fade-in for entrance animations, milliseconds. */
export const ASS_FADE_IN_MS = 160;
/** Fade-out shared by the whole-cue modes, milliseconds. */
export const ASS_FADE_OUT_MS = 80;
/** `rise` travel in pixels at 1080 wide. */
export const ASS_RISE_PX = 10;
/** `slide_in` travel in pixels at 1080 wide. */
export const ASS_SLIDE_PX = 42;
/** `tracking_in` extra tracking at the start, in pixels at 1080 wide. */
export const ASS_TRACKING_START_PX = 10;
/** `blur_in` starting blur radius, pixels at 1080 wide. */
export const ASS_BLUR_START_PX = 10;
/** `scale_in` starting scale, percent. */
export const ASS_SCALE_IN_START = 118;
/** `pop` starting scale, percent. */
export const ASS_POP_START = 86;
/** `pop` overshoot, percent. */
export const ASS_POP_OVERSHOOT = 104;
/** `typewriter` reveal rate, characters per second. */
export const ASS_TYPEWRITER_CHARS_PER_SEC = 20;
/** `word_by_word` stagger when true word timings are unavailable. */
export const ASS_WORD_STAGGER_SEC = 0.06;

// ---------------------------------------------------------------------------
// Cue grouping
// ---------------------------------------------------------------------------

export interface CaptionWordTiming {
  text: string;
  startSec: number;
  endSec: number;
}

/** A display cue that keeps the word timings the animation needs. */
export interface CaptionCue {
  startSec: number;
  endSec: number;
  lines: string[];
  words: CaptionWordTiming[];
}

/** A cut boundary passed in by the caller: cues never cross one. */
export interface CaptionSceneBound {
  startSec: number;
  endSec: number;
  /** Optional clip/room id, carried nowhere but useful to callers. */
  id?: string;
}

export interface CaptionCueOptions {
  /** Maximum visible characters on one line. */
  maxCharsPerLine?: number;
  /** Maximum lines shown at once (1..3). */
  maxLines?: number;
  /** Optional per-line word cap from `captions.maxWordsPerLine`. */
  maxWordsPerLine?: number;
  /** Longest cue window in seconds. */
  maxCueSec?: number;
  /** A shorter cue is extended when the next cue leaves room. */
  minCueSec?: number;
  /** A silence at or above this length always breaks the cue. */
  gapSec?: number;
  /** Hard timeline window; words outside it are dropped. */
  bounds?: { startSec: number; endSec: number };
  /** Scene/clip bounds; a cue is split at every cut it would cross. */
  sceneBounds?: readonly CaptionSceneBound[];
  /** `en-GB` keeps the British spelling map off; layout is language-neutral. */
  language?: string;
}

export const DEFAULT_CUE_OPTIONS = Object.freeze({
  maxCharsPerLine: 20,
  maxLines: 2,
  maxCueSec: 4.5,
  minCueSec: 0.9,
  gapSec: 0.35,
});

interface ResolvedCueOptions {
  maxCharsPerLine: number;
  maxLines: number;
  maxWordsPerLine?: number;
  maxCueSec: number;
  minCueSec: number;
  gapSec: number;
  startSec: number;
  endSec: number;
  scenes: readonly CaptionSceneBound[];
}

const SENTENCE_END = /[.!?…؟](?:["'”’)\]]*)$/u;
const CLAUSE_END = /[,;:—–،؛](?:["'”’)\]]*)$/u;
const TIME_EPSILON = 1e-9;
const MIN_CUE_SEC = 0.001;

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function resolveCueOptions(options: CaptionCueOptions): ResolvedCueOptions {
  const boundsStart = options.bounds?.startSec ?? 0;
  const boundsEnd = options.bounds?.endSec ?? Number.POSITIVE_INFINITY;
  const scenes = (options.sceneBounds ?? [])
    .filter(
      (scene) =>
        Number.isFinite(scene.startSec) &&
        Number.isFinite(scene.endSec) &&
        scene.endSec > scene.startSec,
    )
    .map((scene) => ({ ...scene }))
    .sort((a, b) => a.startSec - b.startSec);

  return {
    maxCharsPerLine: Math.max(
      1,
      Math.round(options.maxCharsPerLine ?? DEFAULT_CUE_OPTIONS.maxCharsPerLine),
    ),
    maxLines: clamp(options.maxLines ?? DEFAULT_CUE_OPTIONS.maxLines, 1, 3, 2),
    ...(options.maxWordsPerLine === undefined
      ? {}
      : { maxWordsPerLine: clamp(options.maxWordsPerLine, 1, 8, 6) }),
    maxCueSec: Math.max(0.1, options.maxCueSec ?? DEFAULT_CUE_OPTIONS.maxCueSec),
    minCueSec: Math.max(0, options.minCueSec ?? DEFAULT_CUE_OPTIONS.minCueSec),
    gapSec: Math.max(0, options.gapSec ?? DEFAULT_CUE_OPTIONS.gapSec),
    startSec: boundsStart,
    endSec: boundsEnd,
    scenes,
  };
}

interface NormalisedWord extends CaptionWordTiming {
  index: number;
}

/**
 * Trims, validates and de-overlaps word timings. A word that starts before the
 * previous one ends is pushed forward (never backwards), which guarantees the
 * engine cannot draw two words on top of each other.
 */
export function normaliseWordTimings(words: readonly CaptionWord[]): CaptionWordTiming[] {
  const prepared: NormalisedWord[] = [];

  words.forEach((word, index) => {
    const text = word.text.replace(/\s+/g, ' ').trim();
    if (text.length === 0) return;
    if (!Number.isFinite(word.startSec) || !Number.isFinite(word.endSec)) return;
    if (word.startSec < 0 || word.endSec < word.startSec) return;
    prepared.push({ text, startSec: word.startSec, endSec: word.endSec, index });
  });

  prepared.sort(
    (a, b) =>
      a.startSec - b.startSec || a.endSec - b.endSec || a.index - b.index,
  );

  const result: CaptionWordTiming[] = [];
  let previousEnd = 0;
  for (const word of prepared) {
    const startSec = Math.max(word.startSec, previousEnd);
    const endSec = Math.max(word.endSec, startSec + MIN_CUE_SEC);
    result.push({ text: word.text, startSec: round3(startSec), endSec: round3(endSec) });
    previousEnd = endSec;
  }
  return result;
}

/** Greedy line layout that also honours a per-line word cap, when given. */
export function layoutCaptionLines(
  tokens: readonly string[],
  maxCharsPerLine: number,
  maxLines: number,
  maxWordsPerLine?: number,
): string[] {
  if (maxWordsPerLine === undefined) {
    return layoutCueLines(tokens, maxCharsPerLine, maxLines);
  }

  const lines: string[] = [];
  let line: string[] = [];

  const widthOf = (parts: readonly string[]): number =>
    parts.reduce((sum, part) => sum + Array.from(part).length, 0) + Math.max(0, parts.length - 1);

  for (const token of tokens) {
    const next = [...line, token];
    const fitsChars = widthOf(next) <= maxCharsPerLine;
    const fitsWords = next.length <= maxWordsPerLine;
    if (line.length > 0 && (!fitsChars || !fitsWords)) {
      lines.push(line.join(' '));
      line = [token];
    } else {
      line = next;
    }
  }
  if (line.length > 0) lines.push(line.join(' '));

  // A single word wider than the cap still occupies one line; the caller's
  // feasibility check decides whether the cue needs another split.
  return lines;
}

function fitsCaption(
  tokens: readonly string[],
  options: ResolvedCueOptions,
): boolean {
  if (
    options.maxWordsPerLine !== undefined &&
    tokens.length > options.maxWordsPerLine * options.maxLines
  ) {
    return false;
  }
  return (
    layoutCaptionLines(
      tokens,
      options.maxCharsPerLine,
      options.maxLines,
      options.maxWordsPerLine,
    ).length <= options.maxLines
  );
}

interface RawCue {
  words: CaptionWordTiming[];
  breakReason: 'start' | 'sentence' | 'pause' | 'capacity' | 'clause';
}

function makeRawCue(word: CaptionWordTiming, reason: RawCue['breakReason']): RawCue {
  return { words: [word], breakReason: reason };
}

function rawCueBounds(cue: RawCue): { startSec: number; endSec: number } {
  const first = cue.words[0];
  const last = cue.words[cue.words.length - 1];
  return {
    startSec: first?.startSec ?? 0,
    endSec: Math.max(first?.startSec ?? 0, last?.endSec ?? 0),
  };
}

function preferredClauseSplit(words: readonly CaptionWordTiming[]): number | null {
  for (let index = words.length - 1; index >= 1; index -= 1) {
    const word = words[index];
    if (word !== undefined && CLAUSE_END.test(word.text)) return index + 1;
  }
  return null;
}

/** Packs one scene's words into cues under the layout and timing caps. */
function groupSceneWords(
  words: readonly CaptionWordTiming[],
  options: ResolvedCueOptions,
): RawCue[] {
  const groups: RawCue[] = [];
  let current: RawCue | null = null;

  const flush = (): void => {
    if (current !== null) groups.push(current);
    current = null;
  };

  for (const word of words) {
    if (current === null) {
      current = makeRawCue(word, 'start');
      continue;
    }

    const previous = current.words[current.words.length - 1];
    const first = current.words[0];
    if (previous === undefined || first === undefined) continue;

    const gap = word.startSec - previous.endSec;
    if (SENTENCE_END.test(previous.text)) {
      flush();
      current = makeRawCue(word, 'sentence');
      continue;
    }
    if (gap >= options.gapSec - TIME_EPSILON) {
      flush();
      current = makeRawCue(word, 'pause');
      continue;
    }

    const tokens = current.words.map((entry) => entry.text);
    const candidateEnd = Math.max(previous.endSec, word.endSec);
    const overDuration =
      candidateEnd - first.startSec > options.maxCueSec + TIME_EPSILON;
    const overLayout = !fitsCaption([...tokens, word.text], options);

    if (!overDuration && !overLayout) {
      current.words.push(word);
      continue;
    }

    // On overflow, prefer the latest clause punctuation over an arbitrary cut.
    const split = preferredClauseSplit(current.words);
    if (split !== null && split > 0 && split < current.words.length) {
      const head: RawCue = {
        words: current.words.slice(0, split),
        breakReason: current.breakReason,
      };
      const tailWords = current.words.slice(split);
      groups.push(head);

      const tailTokens = [...tailWords.map((entry) => entry.text), word.text];
      const tailTooLong =
        word.endSec - (tailWords[0]?.startSec ?? word.startSec) >
        options.maxCueSec + TIME_EPSILON;
      if (!tailTooLong && fitsCaption(tailTokens, options)) {
        current = { words: [...tailWords, word], breakReason: 'clause' };
        continue;
      }
      groups.push({ words: tailWords, breakReason: 'capacity' });
      current = makeRawCue(word, 'capacity');
      continue;
    }

    flush();
    current = makeRawCue(word, 'capacity');
  }

  flush();
  return groups;
}

/** Extends a short cue's tail when the next cue leaves room. */
function padShortCues(cues: RawCue[], options: ResolvedCueOptions): void {
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (cue === undefined) continue;
    const { startSec, endSec } = rawCueBounds(cue);
    if (endSec - startSec >= options.minCueSec) continue;

    const next = cues[index + 1];
    const nextStart = next === undefined ? options.endSec : rawCueBounds(next).startSec;
    const limit = Math.min(options.endSec, nextStart);
    const desired = startSec + options.minCueSec;
    if (desired <= limit + TIME_EPSILON) {
      const last = cue.words[cue.words.length - 1];
      if (last !== undefined) last.endSec = round3(desired);
    }
  }
}

function sceneForWord(
  word: CaptionWordTiming,
  scenes: readonly CaptionSceneBound[],
): CaptionSceneBound | null {
  if (scenes.length === 0) return null;
  const first = scenes[0];
  if (first !== undefined && word.startSec < first.startSec) return first;
  for (const scene of scenes) {
    if (word.startSec >= scene.startSec - TIME_EPSILON && word.startSec < scene.endSec) {
      return scene;
    }
  }
  return scenes[scenes.length - 1] ?? null;
}

function firstLetterUpper(text: string): string {
  const chars = Array.from(text);
  const first = chars[0];
  if (first === undefined) return text;
  return first.toLocaleUpperCase() + chars.slice(1).join('');
}

/**
 * Word timings → readable, non-overlapping display cues.
 *
 * Break order: sentence punctuation, a silence at or above `gapSec`, a scene
 * cut, then the duration/character/line budget. On a capacity break the latest
 * clause punctuation wins over a mid-phrase cut. Every returned cue is
 * monotonic (`start >= previous.end`), inside `bounds`, inside one scene, and
 * carries the word spans the animations need.
 */
export function groupCaptionCues(
  words: readonly CaptionWord[],
  options: CaptionCueOptions = {},
): CaptionCue[] {
  const resolved = resolveCueOptions(options);
  const prepared = normaliseWordTimings(words).filter(
    (word) =>
      word.startSec >= resolved.startSec - TIME_EPSILON &&
      word.startSec < resolved.endSec + TIME_EPSILON,
  );
  if (prepared.length === 0) return [];

  // Bucket by scene first, so no cue can cross a cut. Words in a gap between
  // scenes inherit the previous scene when one exists.
  const buckets: Array<{ scene: CaptionSceneBound | null; words: CaptionWordTiming[] }> = [];
  for (const word of prepared) {
    const scene = sceneForWord(word, resolved.scenes);
    const current = buckets[buckets.length - 1];
    if (current !== undefined && current.scene?.startSec === scene?.startSec) {
      current.words.push(word);
    } else {
      buckets.push({ scene, words: [word] });
    }
  }

  const rawCues: RawCue[] = [];
  for (const bucket of buckets) {
    const grouped = groupSceneWords(bucket.words, resolved);
    for (const cue of grouped) rawCues.push(cue);
  }
  padShortCues(rawCues, resolved);

  const cues: CaptionCue[] = [];
  let previousEnd = resolved.startSec;

  for (let index = 0; index < rawCues.length; index += 1) {
    const raw = rawCues[index];
    if (raw === undefined) continue;

    const scene = sceneForWord(raw.words[0] ?? { text: '', startSec: 0, endSec: 0 }, resolved.scenes);
    const sceneStart = scene === null ? resolved.startSec : Math.max(resolved.startSec, scene.startSec);
    const sceneEnd = scene === null ? resolved.endSec : Math.min(resolved.endSec, scene.endSec);

    const rawBounds = rawCueBounds(raw);
    const startSec = round3(Math.max(rawBounds.startSec, previousEnd, sceneStart));
    let endSec = round3(
      Math.min(sceneEnd, Math.max(rawBounds.endSec, startSec + MIN_CUE_SEC)),
    );
    if (endSec <= startSec) continue;

    const words = raw.words
      .map((word) => ({
        text: word.text,
        startSec: round3(Math.min(Math.max(word.startSec, startSec), endSec)),
        endSec: round3(Math.min(Math.max(word.endSec, startSec), endSec)),
      }))
      .filter((word) => word.endSec >= word.startSec);

    const tokens = words.map((word) => word.text);
    if (tokens.length === 0) continue;
    tokens[0] = firstLetterUpper(tokens[0] ?? '');

    const lines = layoutCaptionLines(
      tokens,
      resolved.maxCharsPerLine,
      resolved.maxLines,
      resolved.maxWordsPerLine,
    ).filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    // Never let rounding bleed a cue over the next one.
    const next = rawCues[index + 1];
    if (next !== undefined) {
      const nextStart = rawCueBounds(next).startSec;
      if (nextStart > startSec && endSec > nextStart) endSec = round3(nextStart);
    }

    cues.push({ startSec, endSec, lines, words });
    previousEnd = endSec;
  }

  return cues;
}

/**
 * Distributes a cue's duration across display tokens by character share. Used
 * when a caller supplies hand-built cues with no word timings (a unit test, or
 * an SRT-imported cue list). The result never overlaps and ends at the cue end.
 */
export function distributeWordTimings(
  tokens: readonly string[],
  startSec: number,
  endSec: number,
): CaptionWordTiming[] {
  const clean = tokens.map((token) => token.trim()).filter((token) => token.length > 0);
  if (clean.length === 0) return [];
  const span = Math.max(MIN_CUE_SEC, endSec - startSec);
  const total = clean.reduce((sum, token) => sum + Math.max(1, Array.from(token).length), 0);

  let cursor = startSec;
  return clean.map((text, index) => {
    const share =
      index === clean.length - 1
        ? endSec - cursor
        : (span * Math.max(1, Array.from(text).length)) / total;
    const wordStart = round3(cursor);
    const wordEnd = round3(
      index === clean.length - 1
        ? Math.max(wordStart, endSec)
        : Math.max(wordStart, Math.min(endSec, cursor + share)),
    );
    cursor = Math.max(cursor, wordEnd);
    return { text, startSec: wordStart, endSec: wordEnd };
  });
}

// ---------------------------------------------------------------------------
// Geometry and safe area
// ---------------------------------------------------------------------------

export interface CaptionCanvas {
  width: number;
  height: number;
  safeArea: SafeArea;
}

export interface CaptionFrame {
  width: number;
  height: number;
  fontSize: number;
  lineHeightPx: number;
  outlinePx: number;
  shadowPx: number;
  spacingPx: number;
  marginL: number;
  marginR: number;
  marginV: number;
  /** ASS alignment 1..9 (numpad layout). */
  alignment: number;
  horizontal: CaptionHorizontalAlign;
  vertical: CaptionVerticalAnchor;
  /** Canvas x of the anchor point for `\pos`. */
  baseX: number;
  /** Canvas y of the anchor point for `\pos`. */
  baseY: number;
  /** Usable width between the left and right safe-area margins. */
  maxWidth: number;
}

const ALIGN_X: Readonly<Record<CaptionHorizontalAlign, number>> = Object.freeze({
  left: 0,
  center: 1,
  right: 2,
});
const ALIGN_Y: Readonly<Record<CaptionVerticalAnchor, number>> = Object.freeze({
  bottom: 1,
  center: 4,
  top: 7,
});

/** Canvas pixels of every drawable dimension, derived from the canvas width. */
export function captionFrame(
  canvas: CaptionCanvas,
  style: ResolvedCaptionStyle,
): CaptionFrame {
  const width = Math.max(1, Math.round(canvas.width));
  const height = Math.max(1, Math.round(canvas.height));
  const scale = width / CAPTION_BASE_WIDTH;

  const fontSize = Math.max(12, Math.round(style.sizeBase * scale));
  const lineHeightPx = Math.max(1, Math.round(fontSize * style.lineHeight));
  const outlinePx = Math.max(0, Math.round(style.outline * scale));
  const shadowPx = Math.max(0, Math.round(style.shadow * scale));
  const spacingPx = Math.round(style.letterSpacing * fontSize);

  const marginL = Math.max(0, Math.round(canvas.safeArea.left));
  const marginR = Math.max(0, Math.round(canvas.safeArea.right));

  let marginV = 0;
  let baseY = height / 2;
  if (style.anchor === 'bottom') {
    // Positive offset moves the block further inside; it never moves it out of
    // the safe area, even when a hand-edited EDL asks for a negative value.
    marginV = Math.max(0, Math.round(canvas.safeArea.bottom + Math.max(0, style.offsetPx)));
    baseY = height - marginV;
  } else if (style.anchor === 'top') {
    marginV = Math.max(0, Math.round(canvas.safeArea.top + Math.max(0, style.offsetPx)));
    baseY = marginV;
  } else {
    marginV = 0;
    baseY = Math.min(
      height - Math.max(0, Math.round(canvas.safeArea.bottom)),
      Math.max(
        Math.max(0, Math.round(canvas.safeArea.top)),
        height / 2 + style.offsetPx * scale,
      ),
    );
  }

  const alignment = ALIGN_Y[style.anchor] + ALIGN_X[style.align];
  const baseX =
    style.align === 'left'
      ? marginL
      : style.align === 'right'
        ? width - marginR
        : width / 2;

  return {
    width,
    height,
    fontSize,
    lineHeightPx,
    outlinePx,
    shadowPx,
    spacingPx,
    marginL,
    marginR,
    marginV,
    alignment,
    horizontal: style.align,
    vertical: style.anchor,
    baseX,
    baseY,
    maxWidth: Math.max(1, width - marginL - marginR),
  };
}

/** Canvas y of the bottom edge of one line inside a block. */
export function lineBottom(frame: CaptionFrame, lineIndex: number, lineCount: number): number {
  const blockHeight = lineCount * frame.lineHeightPx;
  const blockBottom =
    frame.vertical === 'bottom'
      ? frame.baseY
      : frame.vertical === 'top'
        ? frame.baseY + blockHeight
        : frame.baseY + blockHeight / 2;
  return blockBottom - (lineCount - 1 - lineIndex) * frame.lineHeightPx;
}

// ---------------------------------------------------------------------------
// Text measurement (deterministic, not font-metric)
// ---------------------------------------------------------------------------

function glyphEm(character: string): number {
  if (character === ' ') return 0.3;
  if (/[.,;:!?'"’”“·-]/.test(character)) return 0.28;
  if (/[0-9]/.test(character)) return 0.58;
  if (/[A-Z]/.test(character)) return 0.66;
  return 0.58;
}

/** Per-face width correction for the coarse advance table. */
const FONT_WIDTH_FACTOR: Readonly<Record<string, number>> = Object.freeze({
  'Bricolage Grotesque': 1,
  'Archivo SemiBold': 0.97,
  'Archivo': 0.97,
  'Archivo Black': 1.04,
  'Anton': 0.88,
  'Bebas Neue': 0.8,
  'DM Serif Display': 0.95,
  'Space Grotesk Light': 0.95,
});

function fontFactor(family: string): number {
  return FONT_WIDTH_FACTOR[family] ?? 0.97;
}

/** Advance width in em, including em tracking. */
export function measureCaptionEm(text: string, style: ResolvedCaptionStyle): number {
  const chars = Array.from(text);
  let em = 0;
  for (const character of chars) em += glyphEm(character);
  em *= fontFactor(style.fontFamily);
  if (chars.length > 1) em += Math.max(0, chars.length - 1) * style.letterSpacing;
  return em;
}

function measureCaptionPx(text: string, style: ResolvedCaptionStyle, frame: CaptionFrame): number {
  return measureCaptionEm(text, style) * frame.fontSize;
}

export interface PlacedWord extends CaptionWordTiming {
  text: string;
  /** Canvas x of the word's centre, for `\an2`. */
  centerX: number;
  /** Canvas x of the word's left edge. */
  leftX: number;
  widthPx: number;
  lineIndex: number;
  wordIndex: number;
  /** True when the accent/highlight should colour this word. */
  highlighted: boolean;
}

export interface PlacedLine {
  text: string;
  leftX: number;
  bottom: number;
  widthPx: number;
  words: PlacedWord[];
}

function applyCase(text: string, mode: CaptionCase): string {
  if (mode === 'upper') return text.toLocaleUpperCase();
  if (mode === 'title') {
    return text.replace(/\S+/g, (word) => firstLetterUpper(word));
  }
  return text;
}

/** Normalised token used to match `captions.highlight.words`. */
export function normaliseCaptionWord(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

const ACCENT_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'our', 'you', 'are', 'was',
  'its', 'has', 'have', 'into', 'over', 'just', 'all', 'new',
]);

/**
 * Which words in a cue get the accent colour. The EDL's explicit
 * `highlight.words` always wins; otherwise the preset's accent rule applies
 * (longest content word, first word, or last word).
 */
export function accentWordsForCue(
  cue: CaptionCue,
  style: ResolvedCaptionStyle,
  highlight?: CaptionHighlight | null,
): ReadonlySet<string> {
  const explicit = (highlight?.words ?? [])
    .map((word) => normaliseCaptionWord(word))
    .filter((word) => word.length > 0);
  if (explicit.length > 0) return new Set(explicit);

  if (style.accent === 'none') return new Set<string>();

  const tokens = cue.words
    .map((word) => normaliseCaptionWord(word.text))
    .filter((word) => word.length > 0);
  if (tokens.length === 0) return new Set<string>();

  if (style.accent === 'first_word') return new Set([tokens[0] ?? '']);
  if (style.accent === 'last_word') return new Set([tokens[tokens.length - 1] ?? '']);

  let best = '';
  for (const token of tokens) {
    if (ACCENT_STOPWORDS.has(token)) continue;
    if (token.length > best.length) best = token;
  }
  return best.length >= 4 ? new Set([best]) : new Set<string>();
}

/**
 * Places every line and word of a cue on the canvas. The same table drives
 * whole-cue text and the per-word events, so a word event lands exactly where
 * the word sits in the static layout.
 */
export function placeCaptionCue(
  cue: CaptionCue,
  style: ResolvedCaptionStyle,
  frame: CaptionFrame,
  highlight?: CaptionHighlight | null,
): PlacedLine[] {
  const accented = accentWordsForCue(cue, style, highlight);
  const displayLines = cue.lines
    .map((line) => applyCase(line, style.case))
    .filter((line) => line.trim().length > 0);
  if (displayLines.length === 0) return [];

  const lineCount = displayLines.length;
  const widths = displayLines.map((line) => measureCaptionPx(line, style, frame));
  const placed: PlacedLine[] = [];

  let wordIndex = 0;
  displayLines.forEach((line, lineIndex) => {
    const widthPx = widths[lineIndex] ?? 0;
    let leftX =
      style.align === 'left'
        ? frame.marginL
        : style.align === 'right'
          ? frame.width - frame.marginR - widthPx
          : (frame.width - widthPx) / 2;
    leftX = Math.min(
      Math.max(frame.marginL, leftX),
      Math.max(frame.marginL, frame.width - frame.marginR - widthPx),
    );

    const words: PlacedWord[] = [];
    const parts = line.split(/\s+/).filter((part) => part.length > 0);
    let cursorEm = 0;

    for (const part of parts) {
      const startEm = cursorEm;
      const partEm = measureCaptionEm(part, style);
      // Advance the cursor by the part plus the space that follows it.
      cursorEm += partEm + (glyphEm(' ') * fontFactor(style.fontFamily)) + style.letterSpacing;

      const wordWidth = partEm * frame.fontSize;
      const startPx = leftX + startEm * frame.fontSize;
      const normalised = normaliseCaptionWord(part);
      words.push({
        text: part,
        startSec: cue.startSec,
        endSec: cue.endSec,
        leftX: startPx,
        centerX: startPx + wordWidth / 2,
        widthPx: wordWidth,
        lineIndex,
        wordIndex,
        highlighted: accented.has(normalised),
      });
      wordIndex += 1;
    }

    placed.push({
      text: line,
      leftX,
      bottom: lineBottom(frame, lineIndex, lineCount),
      widthPx,
      words,
    });
  });

  return placed;
}

// ---------------------------------------------------------------------------
// ASS writing
// ---------------------------------------------------------------------------

/** `#RRGGBB` → ASS `&HAABBGGRR`, with `opacity` 1 = fully opaque. */
export function assColour(hex: string, opacity = 1): string {
  const match = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (match?.[1] === undefined) return '&H00FFFFFF';
  const rgb = match[1];
  const alpha = Math.round((1 - clamp(opacity, 0, 1, 1)) * 255);
  const rr = rgb.slice(0, 2).toUpperCase();
  const gg = rgb.slice(2, 4).toUpperCase();
  const bb = rgb.slice(4, 6).toUpperCase();
  return `&H${alpha.toString(16).toUpperCase().padStart(2, '0')}${bb}${gg}${rr}`;
}

/** Inline `\c` value: `&HBBGGRR&` (no alpha). */
export function assInlineColour(hex: string): string {
  const match = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (match?.[1] === undefined) return '&HFFFFFF&';
  const rgb = match[1];
  return `&H${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`.toUpperCase();
}

/** `SS.cc` → `H:MM:SS.cc`, rounded to centiseconds. */
export function assTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const cs = Math.round(safe * 100);
  const hours = Math.floor(cs / 360_000);
  const minutes = Math.floor((cs % 360_000) / 6_000);
  const whole = Math.floor((cs % 6_000) / 100);
  const cents = cs % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
}

/** Escapes ASS text: braces open overrides, backslashes start escapes. */
export function assText(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\r?\n/g, '\\N');
}

function assPx(value: number): string {
  return String(Math.max(0, Math.round(value)));
}

function roundTag(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export interface CaptionAssInput {
  cues: readonly CaptionCue[];
  canvas: CaptionCanvas;
  style: ResolvedCaptionStyle;
  /** Defaults to the resolved style's animation. */
  animation?: CaptionEngineAnimation | string;
  highlight?: CaptionHighlight | null;
}

export interface CaptionAssResult {
  /** The complete ASS document. */
  text: string;
  animation: CaptionEngineAnimation;
  style: ResolvedCaptionStyle;
  frame: CaptionFrame;
  eventCount: number;
}

interface AssEvent {
  startSec: number;
  endSec: number;
  /** Override block without braces. */
  tags: string;
  /** Escaped text, already cased. */
  text: string;
}

function colourText(text: string, style: ResolvedCaptionStyle, highlighted: boolean): string {
  if (!highlighted) return assText(text);
  return `{\\c${assInlineColour(style.accentColour)}}${assText(text)}{\\c${assInlineColour(style.colour)}}`;
}

/** A whole-cue line, with inline colour runs for accented words. */
function textWithAccents(
  cue: CaptionCue,
  style: ResolvedCaptionStyle,
  highlight?: CaptionHighlight | null,
): string {
  const accented = accentWordsForCue(cue, style, highlight);
  return cue.lines
    .map((line) => applyCase(line, style.case))
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      line
        .split(/\s+/)
        .filter((part) => part.length > 0)
        .map((part) => colourText(part, style, accented.has(normaliseCaptionWord(part))))
        .join(' '),
    )
    .join('\\N');
}

function wholeCueTags(
  animation: CaptionEngineAnimation,
  frame: CaptionFrame,
  cue: CaptionCue,
): string {
  const x = assPx(frame.baseX);
  const y = assPx(frame.baseY);
  const scale = frame.width / CAPTION_BASE_WIDTH;
  const fade = `\\fad(${String(ASS_FADE_IN_MS)},${String(ASS_FADE_OUT_MS)})`;
  const pos = `\\an${String(frame.alignment)}\\pos(${x},${y})`;

  switch (animation) {
    case 'rise': {
      const travel = Math.max(1, Math.round(ASS_RISE_PX * scale));
      return `${pos}\\move(${x},${assPx(frame.baseY + travel)},${x},${y},0,240)${fade}`;
    }
    case 'slide_in': {
      const travel = Math.max(1, Math.round(ASS_SLIDE_PX * scale));
      const startX = Math.max(0, frame.baseX - travel);
      return `${pos}\\move(${assPx(startX)},${y},${x},${y},0,240)${fade}`;
    }
    case 'pop':
      return `${pos}${fade}\\fscx${String(ASS_POP_START)}\\fscy${String(ASS_POP_START)}\\t(0,120,\\fscx${String(ASS_POP_OVERSHOOT)}\\fscy${String(ASS_POP_OVERSHOOT)})\\t(120,230,\\fscx100\\fscy100)`;
    case 'scale_in':
      return `${pos}${fade}\\fscx${String(ASS_SCALE_IN_START)}\\fscy${String(ASS_SCALE_IN_START)}\\t(0,360,\\fscx100\\fscy100)`;
    case 'blur_in': {
      const blur = Math.max(2, Math.round(ASS_BLUR_START_PX * scale));
      return `${pos}${fade}\\blur${String(blur)}\\t(0,320,\\blur0)`;
    }
    case 'tracking_in': {
      const start = frame.spacingPx + Math.max(2, Math.round(ASS_TRACKING_START_PX * scale));
      return `${pos}${fade}\\fsp${String(start)}\\t(0,340,\\fsp${String(frame.spacingPx)})`;
    }
    case 'karaoke':
      // Karaoke is a single event with per-word `\kf`; handled separately.
      return `${pos}${fade}`;
    case 'none':
      return pos;
    default:
      return `${pos}${fade}`;
  }
}

/** One event per word, each holding only its own word at its true time. */
function wordEvents(
  cue: CaptionCue,
  style: ResolvedCaptionStyle,
  frame: CaptionFrame,
  limitSec: number,
  highlight?: CaptionHighlight | null,
): AssEvent[] {
  const placed = placeCaptionCue(cue, style, frame, highlight);
  const words = placed.flatMap((line) => line.words);
  if (words.length === 0) return [];

  const available = limitSec - cue.startSec;
  if (available <= 0) return [];

  const trueTimes =
    cue.words.length === words.length
      ? words.map((word, index) => {
          const timing = cue.words[index];
          return timing === undefined
            ? { startSec: cue.startSec, endSec: cue.endSec }
            : timing;
        })
      : null;
  const step = Math.min(
    ASS_WORD_STAGGER_SEC,
    words.length > 1 ? available / words.length : available,
  );

  return words.map((word, index) => {
    const timing = trueTimes?.[index];
    const rawStart = timing?.startSec ?? cue.startSec + index * step;
    const startSec = Math.min(limitSec - 0.01, Math.max(cue.startSec, rawStart));
    const y = assPx(lineBottom(frame, word.lineIndex, placed.length));
    const colour = word.highlighted
      ? `\\c${assInlineColour(style.accentColour)}`
      : '';
    return {
      startSec,
      endSec: limitSec,
      tags: `\\an2\\pos(${assPx(word.centerX)},${y})${colour}\\fad(80,0)\\fscx${String(ASS_POP_START)}\\fscy${String(ASS_POP_START)}\\t(0,140,\\fscx100\\fscy100)`,
      text: assText(word.text),
    };
  });
}

/** One event per character, revealed at 20 chars/s (tightened to the cue). */
function typewriterEvents(
  cue: CaptionCue,
  style: ResolvedCaptionStyle,
  frame: CaptionFrame,
  limitSec: number,
  highlight?: CaptionHighlight | null,
): AssEvent[] {
  const placed = placeCaptionCue(cue, style, frame, highlight);
  const chars: Array<{ char: string; x: number; y: number }> = [];

  for (const line of placed) {
    const y = line.bottom;
    let cursorX = line.leftX;
    for (const character of Array.from(line.text)) {
      const width = measureCaptionEm(character, style) * frame.fontSize;
      chars.push({ char: character, x: cursorX + width / 2, y });
      cursorX += width;
    }
  }
  if (chars.length === 0) return [];

  const available = limitSec - cue.startSec;
  if (available <= 0) return [];
  const visible = chars.filter((entry) => entry.char !== ' ');
  const step = Math.min(
    1 / ASS_TYPEWRITER_CHARS_PER_SEC,
    visible.length > 1 ? available / visible.length : available,
  );

  return visible.map((entry, index) => ({
    startSec: Math.min(limitSec - 0.01, cue.startSec + index * step),
    endSec: limitSec,
    tags: `\\an2\\pos(${assPx(entry.x)},${assPx(entry.y)})\\fad(40,0)`,
    text: assText(entry.char),
  }));
}

/**
 * Karaoke: one event whose `\kf` chunks follow the real word timings. The
 * style's PrimaryColour is the sung/highlight colour and SecondaryColour the
 * resting colour, which is exactly how libass reads karaoke.
 */
function karaokeEvent(
  cue: CaptionCue,
  style: ResolvedCaptionStyle,
  frame: CaptionFrame,
  highlight?: CaptionHighlight | null,
): AssEvent[] {
  const placed = placeCaptionCue(cue, style, frame, highlight);
  if (placed.length === 0) return [];

  const totalWords = placed.reduce((sum, line) => sum + line.words.length, 0);
  if (totalWords === 0) return [];

  const timingFor = (index: number): CaptionWordTiming => {
    const timing = cue.words[index];
    if (timing !== undefined) return timing;
    const distributed = distributeWordTimings(
      placed.flatMap((line) => line.words.map((word) => word.text)),
      cue.startSec,
      cue.endSec,
    );
    return distributed[index] ?? { text: '', startSec: cue.startSec, endSec: cue.endSec };
  };

  const chunks: string[] = [];
  let wordIndex = 0;

  // A lead-in before the first spoken word keeps the sweep in step with speech.
  const firstStart = Math.max(cue.startSec, timingFor(0).startSec);
  const leadCs = Math.max(0, Math.round((firstStart - cue.startSec) * 100));
  if (leadCs > 0) chunks.push(`{\\k${String(leadCs)}}`);

  placed.forEach((line, lineIndex) => {
    line.words.forEach((word, indexInLine) => {
      const start = Math.max(cue.startSec, timingFor(wordIndex).startSec);
      const next = timingFor(wordIndex + 1);
      const end =
        wordIndex === totalWords - 1
          ? cue.endSec
          : Math.max(start, Math.min(cue.endSec, next.startSec));
      const centis = Math.max(1, Math.round((end - start) * 100));
      chunks.push(`{\\kf${String(centis)}}${assText(word.text)}`);
      if (indexInLine < line.words.length - 1) chunks.push(' ');
      wordIndex += 1;
    });
    if (lineIndex < placed.length - 1) chunks.push('\\N');
  });

  const y = assPx(frame.baseY);
  return [
    {
      startSec: cue.startSec,
      endSec: cue.endSec,
      tags: `\\an${String(frame.alignment)}\\pos(${assPx(frame.baseX)},${y})\\fad(${String(
        ASS_FADE_IN_MS,
      )},${String(ASS_FADE_OUT_MS)})`,
      text: chunks.join(''),
    },
  ];
}

function eventsForCue(
  cue: CaptionCue,
  animation: CaptionEngineAnimation,
  style: ResolvedCaptionStyle,
  frame: CaptionFrame,
  limitSec: number,
  highlight?: CaptionHighlight | null,
): AssEvent[] {
  if (animation === 'none' || limitSec - cue.startSec <= 0.01) return [];
  if (animation === 'word_by_word') {
    return wordEvents(cue, style, frame, limitSec, highlight);
  }
  if (animation === 'typewriter') {
    return typewriterEvents(cue, style, frame, limitSec, highlight);
  }
  if (animation === 'karaoke') {
    return karaokeEvent(cue, style, frame, highlight);
  }

  const text = textWithAccents(cue, style, highlight);
  if (text.trim().length === 0) return [];
  return [
    {
      startSec: cue.startSec,
      endSec: cue.endSec,
      tags: wholeCueTags(animation, frame, cue),
      text,
    },
  ];
}

/**
 * Builds the ASS document libass burns.
 *
 * One `ZenCaption` style carries the preset's family, size, real weight (Bold
 * flag), colours, outline/box, alignment, safe-area margins, spacing and line
 * height. Events carry `\pos`, `\fad`, `\move`, `\t`, `\fsp`, `\blur`, `\kf`
 * and per-word colour runs as the animation requires.
 *
 * `WrapStyle: 2` means libass never invents a third line: the cue builder owns
 * line breaks, so what is measured is what is drawn.
 */
export function buildCaptionAss(input: CaptionAssInput): CaptionAssResult {
  const requested = normalizeCaptionAnimation(input.animation, input.style.animation);
  // An explicit highlight colour wins over the preset accent for every mode,
  // including karaoke's active-word colour.
  const style: ResolvedCaptionStyle =
    typeof input.highlight?.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(input.highlight.color)
      ? { ...input.style, accentColour: input.highlight.color }
      : input.style;
  const animation = requested;
  const frame = captionFrame(input.canvas, style);

  const primary =
    animation === 'karaoke'
      ? assColour(style.accentColour, 1)
      : assColour(style.colour, 1);
  const secondary =
    animation === 'karaoke'
      ? assColour(style.colour, 1)
      : assColour(style.colour, 1);
  const outline = assColour(style.outlineColour, 1);
  const back = assColour(
    style.borderStyle === 3 ? style.boxColour : style.shadowColour,
    style.borderStyle === 3 ? style.boxOpacity : 0.5,
  );
  const bold = style.bold ? -1 : 0;
  const borderStyle = style.borderStyle;

  const header = [
    '[Script Info]',
    '; Zeniconic caption engine',
    `; preset: ${style.id}`,
    `; animation: ${animation} (${ANIMATION_SUPPORT[animation].fidelity})`,
    'ScriptType: v4.00+',
    `PlayResX: ${String(frame.width)}`,
    `PlayResY: ${String(frame.height)}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ZenCaption,${style.fontFamily},${String(frame.fontSize)},${primary},${secondary},${outline},${back},${String(
      bold,
    )},0,0,0,100,100,${String(frame.spacingPx)},0,${String(borderStyle)},${String(
      frame.outlinePx,
    )},${String(frame.shadowPx)},${String(frame.alignment)},${String(frame.marginL)},${String(
      frame.marginR,
    )},${String(frame.marginV)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const lines: string[] = [...header];
  let eventCount = 0;

  for (let index = 0; index < input.cues.length; index += 1) {
    const cue = input.cues[index];
    if (cue === undefined) continue;
    const next = input.cues[index + 1];
    const limitSec = Math.min(cue.endSec, next?.startSec ?? cue.endSec);

    for (const event of eventsForCue(
      cue,
      animation,
      style,
      frame,
      limitSec,
      input.highlight,
    )) {
      if (event.endSec <= event.startSec) continue;
      lines.push(
        `Dialogue: 0,${assTimestamp(event.startSec)},${assTimestamp(event.endSec)},ZenCaption,,0,0,0,,{${event.tags}}${event.text}`,
      );
      eventCount += 1;
    }
  }

  return {
    text: `${lines.join('\n')}\n`,
    animation,
    style,
    frame,
    eventCount,
  };
}
