/**
 * The packaged overlay path: captions and text burned by FFmpeg alone.
 *
 * Remotion owns the picture and the text in development, but a packaged app
 * cannot ship `tsx`, Chromium and the renderer sources. When the Remotion CLI
 * is missing (or fails, or exceeds its deadline) this module draws the same
 * information with `subtitles` (libass) plus `drawtext`, using the two TTFs
 * that live beside the Electron entry point.
 *
 * Everything here is pure apart from `renderFfmpegOverlays`, which writes its
 * ASS/text inputs into the caller's work directory and runs one FFmpeg job.
 * The layout mirrors the Remotion overlays: address top-left, price and spec
 * bottom-centre, agent top-right, permit above the price, captions at the
 * bottom safe-area margin.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toCues, toSrt } from '../../packages/captions/src/index';
import type { Cue } from '../../packages/captions/src/index';
import type { CaptionWord, Edl, TextAnimation } from '../../packages/edl/src/index';
import { ffmpegPath, probe } from '../../packages/media/src/index';
import { PROFILES } from '../../packages/render/src/index';
import type { ProfileId, Quality } from '../../packages/render/src/index';
import { defaultCanvas } from './service';

/** Paper, ink and brass from docs/design/tokens.css, as drawtext colours. */
const PAPER = '0xF7F4EF';
const INK = '0x14120F';

/** The caption contract: Social Bold at 1080 wide. */
export const CAPTION_SIZE_BASE = 76;
export const CAPTION_OUTLINE_BASE = 3;
export const CAPTION_SHADOW_BASE = 2;
export const CAPTION_LINE_HEIGHT = 1.15;
export const CAPTION_MAX_CHARS = 20;
export const CAPTION_MAX_LINES = 2;

export interface OverlayFacts {
  address: string;
  price?: string;
  currency?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
}

export interface OverlayBrand {
  agentName?: string;
  agency?: string;
  /** Dubai broker registration number; the permit line is off without it. */
  orn?: string;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface DrawTextSpec {
  id: string;
  text: string;
  /** Seconds; both ends are clamped to the timeline. */
  inSec: number;
  outSec: number;
  fontSize: number;
  colour: string;
  opacity: number;
  align: TextAlign;
  /** Canvas y of the text box top. */
  y: number;
  /** Canvas x for `left`/`right` alignment. */
  x: number;
  shadow: boolean;
}

export interface OverlayRenderOptions {
  edl: Edl;
  profile: ProfileId;
  quality: Quality;
  /** The silent picture produced by the FFmpeg timeline pass. */
  picture: string;
  /** Absolute MP4 path to write. */
  output: string;
  /** Scratch directory owned by the caller; always removed by the caller. */
  workDir: string;
  /** Burn the EDL's caption words with libass. */
  burnCaptions: boolean;
  facts?: OverlayFacts;
  brand?: OverlayBrand;
  /** Directory holding Archivo.ttf and BricolageGrotesque.ttf. */
  fontsDir: string;
  /**
   * Hard ceiling for the ffmpeg pass. The export passes what is left of its
   * budget so a slow machine cannot start a pass it has no time to finish.
   */
  timeoutMs?: number;
}

export interface OverlayRenderResult {
  output: string;
  /** The generated ASS file, when captions were burned. */
  assPath?: string;
  /** Captions that were burned, one entry per cue. */
  cueCount: number;
  /** The drawtext layers that were drawn, in paint order. */
  textLayers: string[];
}

// ---------------------------------------------------------------------------
// Paths and fonts
// ---------------------------------------------------------------------------

/**
 * The fonts that ship next to the Electron entry point.
 *
 * In development `appRoot` is the repository. In a packaged app `__dirname` is
 * inside `app.asar`, which FFmpeg cannot read, so the assets are listed in
 * electron-builder's `asarUnpack` and resolved from `app.asar.unpacked`.
 */
export function resolveFontsDirectory(appRoot: string): string {
  const unpacked = /app\.asar([\\/]|$)/.test(appRoot)
    ? appRoot.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked')
    : appRoot;
  return join(unpacked, 'apps', 'desktop', 'electron', 'assets', 'fonts');
}

export function archivoFontPath(fontsDir: string): string {
  return join(fontsDir, 'Archivo.ttf');
}

/**
 * Escapes a filesystem path for an FFmpeg filter option.
 *
 * FFmpeg's filter parser treats `:` as the option separator, `'` as a quote and
 * `\` as an escape; Windows drive letters therefore need `C\:/...`. Forward
 * slashes are accepted everywhere and keep the string readable.
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function filterValue(path: string): string {
  return `'${escapeFilterPath(path)}'`;
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Collects the exported caption words from the EDL, in seconds. */
export function captionCuesForExport(edl: Edl, limitSec?: number): Cue[] {
  const words: CaptionWord[] = edl.captions.words ?? [];
  if (words.length === 0) return [];

  const cues = toCues(words, {
    maxCharsPerLine: CAPTION_MAX_CHARS,
    maxLines: CAPTION_MAX_LINES,
    language: edl.captions.language ?? 'en-GB',
  });

  const total = limitSec ?? edl.format.targetDurationSec;
  return cues
    .map((cue) => ({
      ...cue,
      startSec: round3(Math.max(0, cue.startSec)),
      endSec: round3(Math.min(total, cue.endSec)),
    }))
    .filter((cue) => cue.endSec > cue.startSec && cue.lines.some((line) => line.trim().length > 0));
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(cs / 360000);
  const minutes = Math.floor((cs % 360000) / 6000);
  const secs = Math.floor((cs % 6000) / 100);
  const centis = cs % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function assText(text: string): string {
  // Braces open override tags; backslashes start escapes. Caption copy never
  // needs either, so strip them rather than let one word restyle a cue.
  return text.replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\r?\n/g, '\\N');
}

// ---------------------------------------------------------------------------
// Caption animation (the EDL's `captions.animation`, drawn with ASS overrides)
// ---------------------------------------------------------------------------

/**
 * The caption animations this path draws. `word_stagger` is not an EDL value;
 * anything outside this set (a hand-edited typo, `undefined`) becomes `fade`.
 *
 * Which modes are exact, and which are approximations:
 *
 * | animation      | ASS tags                                     | fidelity |
 * |----------------|----------------------------------------------|----------|
 * | `none`         | no dialogue at all                           | exact |
 * | `fade`         | `\blur2` (the pre-animation look)            | exact |
 * | `pop`          | `\fad` + two `\t` scale steps                 | close: two-step overshoot, not an eased arc |
 * | `rise`         | `\move` up 6 px + `\fad`                      | exact (linear move; no ease-out curve) |
 * | `slide_in`     | `\move` in 32 px from the left + `\fad`       | exact (linear move) |
 * | `tracking_in`  | `\fsp 8` → `\t(0,300,\fsp-1)` + `\fad`        | approximation: libass interpolates spacing linearly per glyph, so the text reflows |
 * | `blur_in`      | `\blur8` → `\t(0,300,\blur0)` + `\fad`        | approximation: libass has no eased blur, only the `\t` ramp |
 * | `scale_in`     | `\fscx118\fscy118` → `\t(0,360,…100)` + `\fad` | exact (one linear scale ramp) |
 * | `word_by_word` | one dialogue per word, `\an1\pos` + `\fad`    | approximation: glyph advances are estimated, so word spacing is uniform rather than Bricolage's true metrics |
 * | `typewriter`   | one dialogue per character at 20 chars/s      | approximation: same advance estimate; characters appear rather than the line growing from a fixed layout |
 *
 * ASS cannot measure a font, so the per-word/per-character x positions come
 * from `glyphEm`, a deterministic advance table. All words of a cue share the
 * table, so they never overlap; only the line's overall width differs slightly
 * from libass's own centring.
 */
const ASS_CAPTION_ANIMATIONS: ReadonlySet<string> = new Set<string>([
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
]);

/** Fade-in for the animated entrances; libass `\fad` takes milliseconds. */
export const ASS_FADE_IN_MS = 120;
/** Gap between `word_by_word` events inside one cue. */
export const ASS_WORD_STAGGER_SEC = 0.05;
/** `typewriter` reveal rate, characters per second. */
export const ASS_TYPEWRITER_CHARS_PER_SEC = 20;
/** Pixels `rise` travels up into place. */
export const ASS_RISE_PX = 6;
/** Pixels `slide_in` travels in from the safe edge. */
export const ASS_SLIDE_PX = 32;
/** `\fsp` the tracking entrance starts at, settling on `\fsp-1`. */
export const ASS_TRACKING_START = 8;
export const ASS_TRACKING_REST = -1;
/** `\blur` the blur entrance starts at. */
export const ASS_BLUR_START = 8;
/** `\fscx`/`\fscy` percentage the scale entrance starts at. */
export const ASS_SCALE_IN_START = 118;

/**
 * The EDL's caption animation, normalised: unknown or absent is `fade`, which
 * is what the ASS path drew before animations existed.
 */
export function captionAnimationFor(edl: Edl): TextAnimation {
  const value: unknown = edl.captions.animation;
  return typeof value === 'string' && ASS_CAPTION_ANIMATIONS.has(value)
    ? (value as TextAnimation)
    : 'fade';
}

/** The ASS script geometry the cue builder draws with, in canvas pixels. */
interface AssFrame {
  width: number;
  height: number;
  fontSize: number;
  marginV: number;
  marginL: number;
  marginR: number;
}

interface AssEvent {
  startSec: number;
  endSec: number;
  /** Override block without braces. */
  tags: string;
  /** Escaped, uppercase text as drawn. */
  text: string;
}

interface PlacedWord {
  text: string;
  /** Canvas x of the word's left edge. */
  x: number;
}

interface PlacedChar {
  text: string;
  x: number;
}

interface PlacedLine {
  /** Canvas y of the line's bottom edge. */
  bottom: number;
  words: PlacedWord[];
  chars: PlacedChar[];
}

/** Advance widths in em, for the placement estimate only. */
function glyphEm(character: string): number {
  if (character === ' ') return 0.3;
  if (/[.,;:!?'"’”“-]/.test(character)) return 0.28;
  if (/[0-9]/.test(character)) return 0.58;
  if (/[A-Z]/.test(character)) return 0.66;
  return 0.58;
}

function measureEm(text: string): number {
  let total = 0;
  for (const character of text) total += glyphEm(character);
  return total;
}

/**
 * Places one laid-out line. Words and characters are positioned from the same
 * advance table, so a per-word event lands where the word sits in the whole
 * line and the line never jumps when the animation settles.
 */
function placeLine(
  text: string,
  lineIndex: number,
  lineCount: number,
  frame: AssFrame,
): PlacedLine {
  const width = measureEm(text) * frame.fontSize;
  const centred = (frame.width - width) / 2;
  const left = Math.min(
    Math.max(frame.marginL, centred),
    Math.max(frame.marginL, frame.width - frame.marginR - width),
  );
  const bottom =
    frame.height -
    frame.marginV -
    (lineCount - 1 - lineIndex) * Math.round(frame.fontSize * CAPTION_LINE_HEIGHT);

  const words: PlacedWord[] = [];
  const chars: PlacedChar[] = [];
  let cursorEm = 0;
  let wordEm = 0;
  let wordText = '';

  const flushWord = (): void => {
    if (wordText.length > 0) {
      words.push({ text: wordText, x: left + wordEm * frame.fontSize });
      wordText = '';
    }
  };

  for (const character of text) {
    if (character === ' ') {
      flushWord();
      cursorEm += glyphEm(character);
      wordEm = cursorEm;
      continue;
    }
    if (wordText.length === 0) wordEm = cursorEm;
    wordText += character;
    chars.push({ text: character, x: left + cursorEm * frame.fontSize });
    cursorEm += glyphEm(character);
  }
  flushWord();

  return { bottom, words, chars };
}

function assPx(value: number): string {
  return String(Math.max(0, Math.round(value)));
}

/**
 * The override block for a whole-cue entrance. `fade` is deliberately the
 * exact string the path drew before animations existed, so a default EDL
 * renders byte-identically.
 */
function entranceTags(animation: TextAnimation, frame: AssFrame): string {
  const centreX = frame.width / 2;
  const baseY = frame.height - frame.marginV;

  switch (animation) {
    case 'pop':
      return `\\blur2\\fad(${String(ASS_FADE_IN_MS)},0)\\t(0,160,\\fscx112\\fscy112)\\t(160,260,\\fscx100\\fscy100)`;
    case 'rise':
      return `\\blur2\\fad(220,0)\\move(${assPx(centreX)},${assPx(baseY + ASS_RISE_PX)},${assPx(centreX)},${assPx(baseY)},0,220)`;
    case 'slide_in':
      return `\\blur2\\fad(220,0)\\move(${assPx(centreX - ASS_SLIDE_PX)},${assPx(baseY)},${assPx(centreX)},${assPx(baseY)},0,220)`;
    case 'tracking_in':
      return `\\blur2\\fad(300,0)\\fsp${String(ASS_TRACKING_START)}\\t(0,300,\\fsp${String(ASS_TRACKING_REST)})`;
    case 'blur_in':
      return `\\fad(300,0)\\blur${String(ASS_BLUR_START)}\\t(0,300,\\blur0)`;
    case 'scale_in':
      return `\\blur2\\fad(360,0)\\fscx${String(ASS_SCALE_IN_START)}\\fscy${String(ASS_SCALE_IN_START)}\\t(0,360,\\fscx100\\fscy100)`;
    default:
      // `fade` (and any unknown the caller let through) draws the original look.
      return '\\blur2';
  }
}

/**
 * `word_by_word`: one event per word, each holding only its own word, on the
 * line's baseline. The stagger is 50 ms a word unless the cue is too short,
 * in which case it tightens so every word still appears before the cue ends
 * and before the next cue starts.
 */
function wordEvents(cue: Cue, frame: AssFrame, limitSec: number): AssEvent[] {
  const lines = cue.lines
    .map((line) => assText(line.toUpperCase()))
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const placed = lines.map((line, index) => placeLine(line, index, lines.length, frame));
  const words = placed.flatMap((line) =>
    line.words.map((word) => ({ ...word, bottom: line.bottom })),
  );
  if (words.length === 0) return [];

  const available = limitSec - cue.startSec;
  if (available <= 0) return [];
  const step = Math.min(ASS_WORD_STAGGER_SEC, words.length > 1 ? available / words.length : 0);

  return words.map((word, index) => ({
    startSec: cue.startSec + index * step,
    endSec: limitSec,
    tags: `\\an1\\pos(${assPx(word.x)},${assPx(word.bottom)})\\blur2\\fad(${String(ASS_FADE_IN_MS)},0)`,
    text: word.text,
  }));
}

/**
 * `typewriter`: one event per character at 20 chars/s, each character on its
 * line's baseline. Spaces need no event; they only advance the layout. The
 * rate tightens for a short cue so no character is dropped and nothing is
 * drawn past the cue end or over the next cue.
 */
function typewriterEvents(cue: Cue, frame: AssFrame, limitSec: number): AssEvent[] {
  const lines = cue.lines
    .map((line) => assText(line.toUpperCase()))
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const placed = lines.map((line, index) => placeLine(line, index, lines.length, frame));
  const chars = placed.flatMap((line) =>
    line.chars.map((char) => ({ ...char, bottom: line.bottom })),
  );
  if (chars.length === 0) return [];

  const available = limitSec - cue.startSec;
  if (available <= 0) return [];
  const step = Math.min(
    1 / ASS_TYPEWRITER_CHARS_PER_SEC,
    chars.length > 1 ? available / chars.length : 0,
  );

  return chars.map((char, index) => ({
    startSec: cue.startSec + index * step,
    endSec: limitSec,
    tags: `\\an1\\pos(${assPx(char.x)},${assPx(char.bottom)})\\blur2`,
    text: char.text,
  }));
}

/** Every dialogue event for one cue, in paint order. */
function assEventsForCue(
  cue: Cue,
  animation: TextAnimation,
  frame: AssFrame,
  limitSec: number,
): AssEvent[] {
  if (animation === 'none') return [];

  const text = assText(cue.lines.join('\n').toUpperCase());
  if (text.trim().length === 0) return [];

  if (animation === 'word_by_word') return wordEvents(cue, frame, limitSec);
  if (animation === 'typewriter') return typewriterEvents(cue, frame, limitSec);

  return [
    {
      startSec: cue.startSec,
      endSec: cue.endSec,
      tags: entranceTags(animation, frame),
      text,
    },
  ];
}

/**
 * Builds the ASS document libass burns.
 *
 * Style: Bricolage Grotesque 800, uppercase, centred, 76 px at 1080 wide,
 * 3 px outline, 2 px soft shadow, no plate, bottom margin = safeArea.bottom.
 * The entrance comes from `edl.captions.animation` and is drawn with override
 * tags; `fade` (the default) and hand-edited unknowns keep the original
 * static output. `none` draws no captions at all.
 */
export function buildAssDocument(
  edl: Edl,
  cues: readonly Cue[],
  profile: ProfileId,
): string {
  const canvas = defaultCanvas(profile);
  const scale = canvas.width / 1080;
  const size = Math.max(12, Math.round(CAPTION_SIZE_BASE * scale));
  const marginV = Math.max(0, Math.round(canvas.safeArea.bottom));
  const marginL = Math.max(0, Math.round(canvas.safeArea.left));
  const marginR = Math.max(0, Math.round(canvas.safeArea.right));

  const lines = [
    '[Script Info]',
    '; Zeniconic export captions',
    'ScriptType: v4.00+',
    `PlayResX: ${String(canvas.width)}`,
    `PlayResY: ${String(canvas.height)}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // &HAABBGGRR: paper text, ink outline/shadow, 50% shadow alpha, BorderStyle 1
    // is outline + shadow (no opaque background plate).
    `Style: ZenCaption,Bricolage Grotesque,${String(size)},&H00EFF4F7,&H00EFF4F7,&H0014120F,&H8014120F,-1,0,0,0,100,100,0,0,1,${String(
      Math.max(1, Math.round(CAPTION_OUTLINE_BASE * scale)),
    )},${String(Math.max(0, Math.round(CAPTION_SHADOW_BASE * scale)))},2,${String(marginL)},${String(marginR)},${String(marginV)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const animation = captionAnimationFor(edl);
  const frame: AssFrame = {
    width: canvas.width,
    height: canvas.height,
    fontSize: size,
    marginV,
    marginL,
    marginR,
  };

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (cue === undefined) continue;
    const next = cues[index + 1];
    // Word and character events stop at the cue end, which is already the next
    // cue's start; clamp anyway so a hand-built cue list cannot overlap.
    const limitSec = Math.min(cue.endSec, next?.startSec ?? cue.endSec);

    for (const event of assEventsForCue(cue, animation, frame, limitSec)) {
      lines.push(
        `Dialogue: 0,${assTime(event.startSec)},${assTime(event.endSec)},ZenCaption,,0,0,0,,{${event.tags}}${event.text}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Drawtext plan
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function windowOf(
  overlay: { inSec: number; outSec: number } | undefined,
  fallbackIn: number,
  fallbackOut: number,
  totalSec: number,
): { inSec: number; outSec: number } {
  const rawIn = overlay?.inSec ?? fallbackIn;
  const rawOut = overlay?.outSec ?? fallbackOut;
  const inSec = clamp(rawIn, 0, totalSec);
  const outSec = clamp(rawOut, inSec, totalSec);
  return { inSec: round3(inSec), outSec: round3(outSec) };
}

/** Rough advance for Archivo at a given size; used only to keep text inside. */
function fitText(text: string, fontSize: number, maxWidth: number): string {
  const advance = Math.max(1, fontSize * 0.58);
  const maxChars = Math.max(1, Math.floor(maxWidth / advance));
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, 1);
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function displayPrice(facts: OverlayFacts | undefined): string {
  const raw = (facts?.price ?? '').trim();
  if (raw.length === 0) return '';

  const digits = raw.replace(/[^0-9.]/g, '');
  const amount = Number(digits);
  if (digits.length === 0 || !Number.isFinite(amount) || amount <= 0) return raw;

  const formatted = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount);
  const currency = (facts?.currency ?? '').trim().toUpperCase();
  return currency.length > 0 ? `${currency} ${formatted}` : formatted;
}

function specRow(facts: OverlayFacts | undefined): string {
  const parts: string[] = [];
  if (facts?.beds !== undefined) parts.push(`${String(facts.beds)} bed`);
  if (facts?.baths !== undefined) parts.push(`${String(facts.baths)} bath`);
  if (facts?.sqft !== undefined) parts.push(`${String(facts.sqft)} sqft`);
  return parts.join(' · ');
}

/**
 * Plans the four drawtext layers: address, price + spec row, agent name and the
 * optional permit line. Windows come from the EDL overlays when they exist, so
 * the fallback stays in step with the edit; otherwise they follow the same
 * opening and end-card beats the planner uses.
 */
export function planDrawTexts(input: {
  edl: Edl;
  profile: ProfileId;
  cues: readonly Cue[];
  facts?: OverlayFacts;
  brand?: OverlayBrand;
}): DrawTextSpec[] {
  const canvas = defaultCanvas(input.profile);
  const { width, height, safeArea } = canvas;
  const scale = width / 1080;
  const total = input.edl.format.targetDurationSec;
  const maxColumn = Math.max(1, width - safeArea.left - safeArea.right);

  const addressOverlay = input.edl.overlays.find((overlay) => overlay.kind === 'address');
  const priceOverlay = input.edl.overlays.find((overlay) => overlay.kind === 'price');
  const lowerThirdOverlay = input.edl.overlays.find((overlay) => overlay.kind === 'lower_third');

  const addressText = (addressOverlay?.text ?? input.facts?.address ?? '').trim();
  const priceText = (priceOverlay?.text ?? displayPrice(input.facts)).trim();
  const specText = (priceOverlay?.subtext ?? specRow(input.facts)).trim();
  const entranceText = (lowerThirdOverlay?.text ?? '').trim();
  const agentText = (input.brand?.agentName ?? '').trim();
  const permitText = input.brand?.orn?.trim()
    ? `ORN ${input.brand.orn.trim()}`
    : '';

  const addressSize = Math.max(12, Math.round(32 * scale));
  const priceSize = Math.max(18, Math.round(96 * scale));
  const specSize = Math.max(12, Math.round(34 * scale));
  const agentSize = Math.max(12, Math.round(26 * scale));
  const permitSize = Math.max(11, Math.round(22 * scale));
  const gap = Math.max(4, Math.round(14 * scale));

  const addressWindow = windowOf(addressOverlay, 0.4, Math.min(4.4, total), total);
  const endWindow = windowOf(priceOverlay, Math.max(0, total - 5.2), total, total);

  const specs: DrawTextSpec[] = [];

  if (addressText.length > 0 && addressWindow.outSec > addressWindow.inSec) {
    specs.push({
      id: 'address',
      text: fitText(addressText.toUpperCase(), addressSize, maxColumn),
      ...addressWindow,
      fontSize: addressSize,
      colour: PAPER,
      opacity: 0.95,
      align: 'left',
      x: safeArea.left,
      y: safeArea.top + Math.round(8 * scale),
      shadow: true,
    });
  }

  const priceBlockHeight =
    (priceText.length > 0 ? priceSize : 0) +
    (priceText.length > 0 && specText.length > 0 ? gap : 0) +
    (specText.length > 0 ? specSize : 0);

  if (priceBlockHeight > 0 && endWindow.outSec > endWindow.inSec) {
    const captionSize = Math.max(12, Math.round(CAPTION_SIZE_BASE * scale));
    const captionBlock = Math.round(
      CAPTION_MAX_LINES * captionSize * CAPTION_LINE_HEIGHT + 8 * scale,
    );
    const overlapsCaptions = input.cues.some(
      (cue) => cue.startSec < endWindow.outSec && endWindow.inSec < cue.endSec,
    );

    const bottomEdge = height - safeArea.bottom;
    let priceY = bottomEdge - priceBlockHeight;
    if (overlapsCaptions) {
      priceY = Math.min(priceY, bottomEdge - captionBlock - gap - priceBlockHeight);
    }
    priceY = clamp(priceY, safeArea.top, bottomEdge - priceBlockHeight);

    if (priceText.length > 0) {
      specs.push({
        id: 'price',
        text: fitText(priceText, priceSize, maxColumn),
        ...endWindow,
        fontSize: priceSize,
        colour: PAPER,
        opacity: 1,
        align: 'center',
        x: 0,
        y: priceY,
        shadow: true,
      });
    }

    if (specText.length > 0) {
      specs.push({
        id: 'spec',
        text: fitText(specText, specSize, maxColumn),
        ...endWindow,
        fontSize: specSize,
        colour: PAPER,
        opacity: 0.82,
        align: 'center',
        x: 0,
        y: priceY + (priceText.length > 0 ? priceSize + gap : 0),
        shadow: true,
      });
    }

    if (permitText.length > 0) {
      const permitY = clamp(
        priceBlockHeight > 0
          ? priceY - permitSize - Math.round(24 * scale)
          : bottomEdge - permitSize,
        safeArea.top,
        bottomEdge - permitSize,
      );
      specs.push({
        id: 'permit',
        text: fitText(permitText.toUpperCase(), permitSize, maxColumn),
        ...endWindow,
        fontSize: permitSize,
        colour: PAPER,
        opacity: 0.55,
        align: 'center',
        x: 0,
        y: permitY,
        shadow: true,
      });
    }
  }

  if (agentText.length > 0) {
    specs.push({
      id: 'agent',
      // The agency is only an attribute; the name is what the agent checks.
      text: fitText(agentText.toUpperCase(), agentSize, maxColumn),
      ...endWindow,
      fontSize: agentSize,
      colour: PAPER,
      opacity: 0.9,
      align: 'right',
      x: safeArea.right,
      y: safeArea.top + Math.round(8 * scale),
      shadow: true,
    });
  }

  // The marketing entrance claim sits in the lower third, above the caption
  // line and inside the safe area. It is the one text layer the campaign sheet
  // adds beyond the fact cards.
  if (entranceText.length > 0 && lowerThirdOverlay !== undefined) {
    const entranceSize = Math.max(16, Math.round(54 * scale));
    const entranceWindow = windowOf(lowerThirdOverlay, 0.4, Math.min(4.4, total), total);
    if (entranceWindow.outSec > entranceWindow.inSec) {
      const bottomEdge = height - safeArea.bottom;
      const captionSize = Math.max(12, Math.round(CAPTION_SIZE_BASE * scale));
      const captionBlock = Math.round(
        CAPTION_MAX_LINES * captionSize * CAPTION_LINE_HEIGHT + 8 * scale,
      );
      const preferred = Math.round(height * 0.52);
      const entranceY = clamp(
        preferred,
        safeArea.top,
        Math.max(safeArea.top, bottomEdge - captionBlock - entranceSize),
      );
      specs.push({
        id: 'entrance',
        text: fitText(entranceText.toUpperCase(), entranceSize, maxColumn),
        ...entranceWindow,
        fontSize: entranceSize,
        colour: PAPER,
        opacity: 0.96,
        align: 'left',
        x: safeArea.left,
        y: entranceY,
        shadow: true,
      });
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Filter graph
// ---------------------------------------------------------------------------

/**
 * Assembles the one video filter chain: libass captions first, then the text
 * layers in paint order, so a card is never hidden by a caption.
 */
export function buildFilterGraph(input: {
  assPath?: string;
  fontsDir: string;
  specs: readonly DrawTextSpec[];
  canvasWidth: number;
  textFiles: ReadonlyMap<string, string>;
}): string {
  const filters: string[] = [];

  if (input.assPath !== undefined) {
    filters.push(
      `subtitles=filename=${filterValue(input.assPath)}:fontsdir=${filterValue(input.fontsDir)}`,
    );
  }

  for (const spec of input.specs) {
    const textFile = input.textFiles.get(spec.id);
    if (textFile === undefined) continue;

    const x =
      spec.align === 'center'
        ? '(w-text_w)/2'
        : spec.align === 'right'
          ? `w-text_w-${String(Math.max(0, Math.round(spec.x)))}`
          : String(Math.max(0, Math.round(spec.x)));

    const shadow = spec.shadow
      ? `:shadowcolor=${INK}@0.65:shadowx=0:shadowy=${String(Math.max(1, Math.round(input.canvasWidth / 540)))}`
      : '';

    filters.push(
      [
        `drawtext=fontfile=${filterValue(archivoFontPath(input.fontsDir))}`,
        `textfile=${filterValue(textFile)}`,
        `fontsize=${String(Math.max(1, Math.round(spec.fontSize)))}`,
        `fontcolor=${spec.colour}@${spec.opacity}`,
        `x=${x}`,
        `y=${String(Math.max(0, Math.round(spec.y)))}`,
        `enable='between(t,${spec.inSec.toFixed(3)},${spec.outSec.toFixed(3)})'`,
      ].join(':') + shadow,
    );
  }

  return filters.length === 0 ? 'null' : filters.join(',');
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

interface FfmpegResult {
  code: number;
  stderr: string[];
}

function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<FfmpegResult> {
  return new Promise<FfmpegResult>((resolvePromise, reject) => {
    const child = spawn(ffmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const lines: string[] = [];
    let partial = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stderr.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim().length > 0) lines.push(line);
      }
      if (lines.length > 120) lines.splice(0, lines.length - 120);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (partial.trim().length > 0) lines.push(partial.trim());
      if (timedOut) {
        lines.push(`FFmpeg timed out after ${String(Math.round(timeoutMs / 1000))} s.`);
      }
      resolvePromise({ code: timedOut ? -2 : (code ?? -1), stderr: lines.slice(-20) });
    });
  });
}

function doubleBitrate(bitrate: string): string {
  const match = /^([0-9]+(?:\.[0-9]+)?)([kKmM])$/.exec(bitrate);
  const amount = match?.[1];
  const unit = match?.[2];
  if (amount === undefined || unit === undefined) return bitrate;
  const doubled = Number(amount) * 2;
  return `${Number.isInteger(doubled) ? doubled : doubled.toFixed(1)}${unit}`;
}

function encodeArgs(profile: ProfileId, quality: Quality): string[] {
  const spec = PROFILES[profile];
  if (quality === 'draft') {
    return [
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
    ];
  }
  return [
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    spec.videoBitrate,
    '-maxrate',
    spec.maxBitrate,
    '-bufsize',
    doubleBitrate(spec.maxBitrate),
  ];
}

/**
 * Burns captions and text onto an already-cut silent picture.
 *
 * The caller always removes `workDir`; this function only adds files inside it.
 * Any FFmpeg failure throws with the last stderr lines attached.
 */
export async function renderFfmpegOverlays(
  options: OverlayRenderOptions,
): Promise<OverlayRenderResult> {
  const spec = PROFILES[options.profile];
  if (spec === undefined) {
    throw new RangeError(`Unknown render profile "${options.profile}".`);
  }

  const overlayDir = join(options.workDir, 'overlays');
  await mkdir(overlayDir, { recursive: true });

  const animation = captionAnimationFor(options.edl);
  const cues: Cue[] =
    options.burnCaptions && animation !== 'none' ? captionCuesForExport(options.edl) : [];
  let assPath: string | undefined;

  if (cues.length > 0) {
    assPath = join(overlayDir, `captions-${options.profile}.ass`);
    await writeFile(assPath, buildAssDocument(options.edl, cues, options.profile), 'utf8');
  }

  const specs = planDrawTexts({
    edl: options.edl,
    profile: options.profile,
    cues,
    ...(options.facts === undefined ? {} : { facts: options.facts }),
    ...(options.brand === undefined ? {} : { brand: options.brand }),
  });

  // Draft exports encode at half size. ASS scales itself to the video, but
  // drawtext coordinates are video pixels, so the plan is scaled to the real
  // picture instead of the nominal profile canvas.
  const pictureInfo = await probe(options.picture);
  const scale = Math.min(
    pictureInfo.width > 0 ? pictureInfo.width / spec.width : 1,
    pictureInfo.height > 0 ? pictureInfo.height / spec.height : 1,
  );
  const scaledSpecs =
    Math.abs(scale - 1) < 1e-6
      ? specs
      : specs.map((entry) => ({
          ...entry,
          fontSize: Math.max(8, Math.round(entry.fontSize * scale)),
          x: Math.round(entry.x * scale),
          y: Math.round(entry.y * scale),
        }));

  const textFiles = new Map<string, string>();
  for (const entry of scaledSpecs) {
    const file = join(overlayDir, `${entry.id}.txt`);
    await writeFile(file, entry.text, { encoding: 'utf8' });
    textFiles.set(entry.id, file);
  }

  const graph = buildFilterGraph({
    ...(assPath === undefined ? {} : { assPath }),
    fontsDir: options.fontsDir,
    specs: scaledSpecs,
    canvasWidth: pictureInfo.width,
    textFiles,
  });

  const duration = options.edl.format.targetDurationSec;
  const result = await runFfmpeg([
    '-y',
    '-v',
    'error',
    '-i',
    options.picture,
    '-vf',
    graph,
    '-an',
    ...encodeArgs(options.profile, options.quality),
    '-r',
    String(spec.fps),
    '-t',
    duration.toFixed(3),
    '-movflags',
    '+faststart',
    options.output,
  ], options.timeoutMs);

  if (result.code !== 0) {
    throw new Error(
      `The FFmpeg text pass failed: ${result.stderr[result.stderr.length - 1] ?? `exit ${String(result.code)}`}`,
    );
  }

  return {
    output: options.output,
    ...(assPath === undefined ? {} : { assPath }),
    cueCount: cues.length,
    textLayers: specs.map((entry) => entry.id),
  };
}

/** Writes the sidecar SRT the `srt`/`both` caption modes promise. */
export async function writeSrtFile(
  edl: Edl,
  path: string,
): Promise<{ path: string; cueCount: number }> {
  const cues = captionCuesForExport(edl);
  const body = toSrt(cues);
  await writeFile(path, body, 'utf8');
  return { path, cueCount: cues.length };
}
