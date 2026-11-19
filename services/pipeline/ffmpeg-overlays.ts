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
import { dirname, join } from 'node:path';
import { toSrt } from '../../packages/captions/src/index';
import type { Cue } from '../../packages/captions/src/index';
import type { CaptionWord, Edl } from '../../packages/edl/src/index';
import { ffmpegPath, probe } from '../../packages/media/src/index';
import { PROFILES } from '../../packages/render/src/index';
import type { ProfileId, Quality } from '../../packages/render/src/index';
import {
  ASS_BLUR_START_PX,
  ASS_FADE_IN_MS,
  ASS_POP_OVERSHOOT,
  ASS_POP_START,
  ASS_RISE_PX,
  ASS_SCALE_IN_START,
  ASS_SLIDE_PX,
  ASS_TRACKING_START_PX,
  ASS_TYPEWRITER_CHARS_PER_SEC,
  ASS_WORD_STAGGER_SEC,
  buildCaptionAss,
  distributeWordTimings,
  groupCaptionCues,
  normalizeCaptionAnimation,
  resolveCaptionStyle,
} from './caption-engine';
import type {
  CaptionCue,
  CaptionEngineAnimation,
  CaptionPresetId,
  CaptionSceneBound,
  ResolvedCaptionStyle,
} from './caption-engine';
import { defaultCanvas } from './service';

export {
  ASS_BLUR_START_PX,
  ASS_FADE_IN_MS,
  ASS_POP_OVERSHOOT,
  ASS_POP_START,
  ASS_RISE_PX,
  ASS_SCALE_IN_START,
  ASS_SLIDE_PX,
  ASS_TRACKING_START_PX,
  ASS_TYPEWRITER_CHARS_PER_SEC,
  ASS_WORD_STAGGER_SEC,
};
export type {
  CaptionCue,
  CaptionEngineAnimation,
  CaptionPresetId,
  CaptionSceneBound,
};


/** Paper, ink and brass from docs/design/tokens.css, as drawtext colours. */
const PAPER = '0xF7F4EF';
const BRASS = '0xC8A96B';
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
  /** The caption animation actually baked into the ASS. */
  animation?: CaptionEngineAnimation;
  /** The preset actually baked into the ASS style. */
  preset?: CaptionPresetId;
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
  return captionEngineCuesForExport(edl, limitSec).map((cue) => ({
    startSec: cue.startSec,
    endSec: cue.endSec,
    lines: cue.lines,
  }));
}

/**
 * Clip boundaries on the timeline: the scene bounds the cue builder uses so no
 * caption is ever drawn across a cut. `speedRamp` clips integrate their ramp;
 * a plain clip is `(out - in) / speed`, the same rule the renderer uses.
 */
export function captionSceneBounds(edl: Edl, limitSec?: number): CaptionSceneBound[] {
  const total = Math.max(0, limitSec ?? edl.format.targetDurationSec);
  const bounds: CaptionSceneBound[] = [];
  let cursor = 0;

  for (const clip of edl.clips) {
    const span = Math.max(0, clip.outSec - clip.inSec);
    if (span <= 0) continue;

    let duration: number;
    if (clip.speedRamp !== undefined && clip.speedRamp.length >= 2) {
      duration = 0;
      for (let index = 1; index < clip.speedRamp.length; index += 1) {
        const previous = clip.speedRamp[index - 1];
        const point = clip.speedRamp[index];
        if (previous === undefined || point === undefined) continue;
        const dt = Math.max(0, point.t - previous.t);
        const speed = Math.max(0.01, (previous.speed + point.speed) / 2);
        duration += (dt * span) / speed;
      }
    } else {
      duration = span / Math.max(0.01, clip.speed);
    }
    if (!Number.isFinite(duration) || duration <= 0) continue;

    const startSec = round3(Math.max(0, Math.min(total, cursor)));
    const endSec = round3(Math.max(0, Math.min(total, cursor + duration)));
    if (endSec > startSec) bounds.push({ startSec, endSec, id: clip.id });
    cursor += duration;
  }

  if (bounds.length === 0) return [{ startSec: 0, endSec: total }];

  // Caption words can outlive the last cut (a voiceover tail); the last scene
  // keeps them rather than dropping the closing line.
  const last = bounds[bounds.length - 1];
  if (last !== undefined && last.endSec < total) last.endSec = total;
  return bounds;
}

/**
 * Lays the EDL's word timings out with the caption engine: preset-specific
 * line budgets, gap and scene rules, and true word spans retained for karaoke.
 */
export function captionEngineCuesForExport(edl: Edl, limitSec?: number): CaptionCue[] {
  const words: CaptionWord[] = edl.captions.words ?? [];
  if (words.length === 0) return [];

  const style = captionStyleForEdl(edl);
  const total = Math.max(0, limitSec ?? edl.format.targetDurationSec);

  return groupCaptionCues(words, {
    maxCharsPerLine: style.maxCharsPerLine,
    maxLines: style.maxLines,
    ...(edl.captions.maxWordsPerLine === undefined
      ? {}
      : { maxWordsPerLine: edl.captions.maxWordsPerLine }),
    language: edl.captions.language ?? 'en-GB',
    bounds: { startSec: 0, endSec: total },
    sceneBounds: captionSceneBounds(edl, total),
  }).filter(
    (cue) =>
      cue.endSec > cue.startSec && cue.lines.some((line) => line.trim().length > 0),
  );
}

/** The EDL's style string plus every additive v2 caption override. */
export function captionStyleForEdl(edl: Edl): ResolvedCaptionStyle {
  return resolveCaptionStyle(edl.captions.style, {
    ...(edl.captions.font === undefined ? {} : { font: edl.captions.font }),
    ...(edl.captions.box === undefined ? {} : { box: edl.captions.box }),
    ...(edl.captions.position === undefined ? {} : { position: edl.captions.position }),
    ...(edl.captions.highlight === undefined ? {} : { highlight: edl.captions.highlight }),
    ...(edl.captions.animation === undefined ? {} : { animation: edl.captions.animation }),
    ...(edl.captions.maxLines === undefined ? {} : { maxLines: edl.captions.maxLines }),
    ...(edl.captions.maxWordsPerLine === undefined
      ? {}
      : { maxWordsPerLine: edl.captions.maxWordsPerLine }),
  });
}

/**
 * The animation actually drawn. An explicit EDL value wins; otherwise the
 * chosen preset's motion applies, so `luxury_gold` really does rise and
 * `kinetic_bold` really does reveal word by word even without an explicit
 * `captions.animation`.
 */
export function captionAnimationFor(edl: Edl): CaptionEngineAnimation {
  return normalizeCaptionAnimation(
    edl.captions.animation,
    captionStyleForEdl(edl).animation,
  );
}


// ASS generation lives in services/pipeline/caption-engine.ts.
// The helpers below keep the old call sites and the QA scripts working.

/**
 * Attaches word spans to hand-built cues. When the cue's tokens line up with
 * the EDL words inside its window, their real timings are used; otherwise the
 * cue duration is shared across tokens by character length. This is what lets
 * `buildAssDocument(edl, cues, profile)` stay source-compatible while still
 * drawing real karaoke.
 */
export function attachCaptionWordTimings(
  cues: readonly Cue[],
  words: readonly CaptionWord[],
): CaptionCue[] {
  return cues.map((cue) => {
    const tokens = cue.lines
      .join(' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      return { startSec: cue.startSec, endSec: cue.endSec, lines: cue.lines, words: [] };
    }

    const inside = words.filter(
      (word) =>
        word.startSec >= cue.startSec - 0.001 && word.startSec < cue.endSec + 0.001,
    );

    if (inside.length === tokens.length) {
      return {
        startSec: cue.startSec,
        endSec: cue.endSec,
        lines: cue.lines,
        words: inside.map((word, index) => ({
          text: tokens[index] ?? word.text,
          startSec: Math.min(Math.max(word.startSec, cue.startSec), cue.endSec),
          endSec: Math.min(Math.max(word.endSec, cue.startSec), cue.endSec),
        })),
      };
    }

    return {
      startSec: cue.startSec,
      endSec: cue.endSec,
      lines: cue.lines,
      words: distributeWordTimings(tokens, cue.startSec, cue.endSec),
    };
  });
}

/**
 * The full ASS build for an EDL, exposed for tests and QA harnesses. `cues`
 * may be the legacy display cues; `engineCues` avoids re-attaching timings
 * when the caller already has them.
 */
export function captionAssForEdl(
  edl: Edl,
  cues: readonly Cue[],
  profile: ProfileId,
  engineCues?: readonly CaptionCue[],
) {
  const style = captionStyleForEdl(edl);
  const attached =
    engineCues ?? attachCaptionWordTimings(cues, edl.captions.words ?? []);
  return buildCaptionAss({
    cues: attached,
    canvas: defaultCanvas(profile),
    style,
    animation: captionAnimationFor(edl),
    highlight: edl.captions.highlight ?? null,
  });
}

/**
 * Builds the ASS document libass burns.
 *
 * The style, size, weight, colour, backing, alignment, safe-area margins,
 * spacing and line height all come from the EDL's preset and additive v2
 * overrides; the animation comes from `captions.animation` or the preset's
 * motion when that is absent. There is no hardcoded single style any more.
 */
export function buildAssDocument(
  edl: Edl,
  cues: readonly Cue[],
  profile: ProfileId,
  engineCues?: readonly CaptionCue[],
): string {
  return captionAssForEdl(edl, cues, profile, engineCues).text;
}

export interface WriteAssOptions {
  /** Pre-grouped cues, when the caller already ran `groupCaptionCues`. */
  cues?: readonly CaptionCue[];
  limitSec?: number;
}

/**
 * Writes the ASS sidecar for an EDL. This is the file the `burn`/`both` paths
 * feed to libass, and the artifact a QA run can inspect without rendering.
 */
export async function writeAssFile(
  edl: Edl,
  path: string,
  profile: ProfileId,
  options: WriteAssOptions = {},
): Promise<{
  path: string;
  cueCount: number;
  eventCount: number;
  animation: CaptionEngineAnimation;
  preset: CaptionPresetId;
}> {
  const cues =
    options.cues ?? captionEngineCuesForExport(edl, options.limitSec);
  const result = captionAssForEdl(edl, cues, profile, cues);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, result.text, 'utf8');
  return {
    path,
    cueCount: cues.length,
    eventCount: result.eventCount,
    animation: result.animation,
    preset: result.style.id,
  };
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

  // The reserved caption block follows the chosen preset, not the old fixed
  // 76 px / two-line assumption: a 92 px kinetic cue needs more room and a
  // centre-anchored preset reserves none at the bottom.
  const captionStyle = captionStyleForEdl(input.edl);
  const captionSize = Math.max(12, Math.round(captionStyle.sizeBase * scale));
  const captionAtBottom = captionStyle.anchor === 'bottom';
  const captionBlock = captionAtBottom
    ? Math.round(captionStyle.maxLines * captionSize * captionStyle.lineHeight + 8 * scale)
    : 0;

  const addressOverlay = input.edl.overlays.find((overlay) => overlay.kind === 'address');
  const priceOverlay = input.edl.overlays.find((overlay) => overlay.kind === 'price');
  const lowerThirdOverlay = input.edl.overlays.find((overlay) => overlay.kind === 'lower_third');

  const addressText = (addressOverlay?.text ?? input.facts?.address ?? '').trim();
  const captionText = input.cues
    .map((cue) => cue.lines.join(' '))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const addressWords = addressText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 2);
  const captionsSayAddress =
    input.edl.format.id === 'marketing_38' &&
    addressWords.length === 2 &&
    addressWords.every((word) => captionText.includes(word));
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

  if (addressText.length > 0 && !captionsSayAddress && addressWindow.outSec > addressWindow.inSec) {
    specs.push({
      id: 'address',
      text: fitText(addressText.toUpperCase(), addressSize, maxColumn),
      ...addressWindow,
      fontSize: addressSize,
      colour: BRASS,
      opacity: 0.98,
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
    const overlapsCaptions =
      captionAtBottom &&
      input.cues.some(
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

  const ctaOverlay = input.edl.overlays.find((overlay) => overlay.kind === 'cta');
  const ctaText = (ctaOverlay?.text ?? '').trim();
  if (ctaText.length > 0) {
    const ctaWindow = windowOf(ctaOverlay, total - 4.5, total, total);
    if (ctaWindow.outSec > ctaWindow.inSec) {
      const ctaSize = Math.max(20, Math.round(54 * scale));
      specs.push({
        id: 'cta',
        text: fitText(ctaText.toUpperCase(), ctaSize, maxColumn),
        ...ctaWindow,
        fontSize: ctaSize,
        colour: PAPER,
        opacity: 1,
        align: 'center',
        x: Math.round(width / 2),
        y: Math.max(safeArea.top, height - safeArea.bottom - Math.round(96 * scale) - ctaSize),
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
  const engineCues: CaptionCue[] =
    options.burnCaptions && animation !== 'none'
      ? captionEngineCuesForExport(options.edl)
      : [];
  const cues: Cue[] = engineCues.map((cue) => ({
    startSec: cue.startSec,
    endSec: cue.endSec,
    lines: cue.lines,
  }));
  let assPath: string | undefined;

  if (engineCues.length > 0) {
    assPath = join(overlayDir, `captions-${options.profile}.ass`);
    const ass = captionAssForEdl(options.edl, cues, options.profile, engineCues);
    await writeFile(assPath, ass.text, 'utf8');
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
    animation,
    preset: captionStyleForEdl(options.edl).id,
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
