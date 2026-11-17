/**
 * Burned captions.
 *
 * Cues come from the pure `captionCues` layout, already at most two lines and
 * never three. The style object from docs/CAPTIONS.md drives the type: font,
 * weight, size, case, alignment, position, colour, accent word, backing and
 * animation. Social Bold is the default, so an EDL with no style renders
 * exactly as it did before the style object existed.
 *
 * Every EDL `TextAnimation` (`none`, `fade`, `rise`, `slide_in`, `pop`,
 * `typewriter`, `word_by_word`, `tracking_in`, `blur_in`, `scale_in`, plus the
 * legacy `word_stagger`) is drawn here from `captionEntrance` in
 * `packages/overlays/src/captions` — one pure, tested timing table, cue-relative
 * and fps-aware. Word-by-word and typewriter reveal inside a fixed box, so the
 * line never reflows as the text appears. `reduceMotion` drops the spatial
 * moves and keeps the reveals; Remotion has no media query, so the composition
 * passes it.
 *
 * This is the Remotion path only. The FFmpeg/ASS marketing renderer draws
 * static captions and animates none of this.
 *
 * Arabic sets `direction: rtl`, uses an Arabic-capable fallback face and
 * mirrors alignment and padding; the line order is never reversed by hand.
 *
 * The style helpers are exported so the caption tests can assert the tokens
 * without a DOM.
 */

import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { RTL_FALLBACK_STACK } from '../../../packages/overlays/src/index';
import {
  CAPTION_MOTION_BASE_WIDTH,
  CAPTION_PRESETS,
  captionEntrance as captionEntranceState,
  resolveCaptionStyle,
} from '../../../packages/overlays/src/captions';
import type {
  CaptionAccent,
  CaptionAlign,
  CaptionAnimation,
  CaptionEntranceState,
  CaptionStyle,
  CaptionStyleInput,
} from '../../../packages/overlays/src/captions';
import type { CaptionCueFrames, CanvasSpec } from '../../../packages/overlays/src/types';
import { DISPLAY_FONT, UI_FONT, legibilityShadow, px } from './theme';
import type { ResolvedColours } from '../../../packages/overlays/src/index';

/** Type size at a 1080-wide canvas, scaled with `px`. */
export const CAPTION_SIZE_BASE = CAPTION_PRESETS.social_bold.sizeBase;
export const CAPTION_WEIGHT = CAPTION_PRESETS.social_bold.weight;
export const CAPTION_LINE_HEIGHT = 0.98;
/** Latin only; Arabic runs at zero tracking per docs/OVERLAYS.md. */
export const CAPTION_TRACKING = '-0.02em';

/** Scrim behind the type, warm near-black from the stage token. */
export const CAPTION_PLATE_COLOUR = 'rgba(14,13,11,0.62)';
export const CAPTION_PLATE_PADDING_Y_BASE = 18;
export const CAPTION_PLATE_PADDING_X_BASE = 24;
export const CAPTION_PLATE_RADIUS_BASE = 8;

/**
 * Legacy cue entrance used by the four-argument `captionEntrance` below:
 * fade in while rising this many pixels over this many frames. The drawn
 * captions use the fps-aware table in the overlay package instead.
 */
export const CAPTION_ENTRANCE_FRAMES = 8;
export const CAPTION_RISE_BASE = 6;
/** Word stagger: the last word starts no later than this fraction of 8 frames. */
const WORD_STAGGER_FRAMES = 8;
const WORD_ENTRANCE_FRAMES = 5;
const WORD_STAGGER_RISE_BASE = 4;

/**
 * Instrument Serif is the editorial face in the contract. It is not in the
 * bundled woff2 set yet, so the stack falls back to a system serif instead of
 * failing the render; the token is still the single place to change.
 */
export const CAPTION_FONT_STACKS: Readonly<Record<CaptionStyle['font'], string>> = Object.freeze({
  bricolage: DISPLAY_FONT,
  archivo: UI_FONT,
  instrument_serif: "'Instrument Serif', 'Iowan Old Style', 'Times New Roman', Georgia, serif",
});

/**
 * Legacy block entrance, kept for the helpers the caption tests pin.
 *
 * The composition itself now draws `captionEntrance` from
 * `packages/overlays/src/captions`, which covers every EDL `TextAnimation`
 * (blur, tracking, typewriter, word-by-word, slide, scale) and takes an fps.
 * This older four-argument form only knows pop / fade / word_stagger and stays
 * exported so an existing import cannot break.
 */
export interface CaptionEntrance {
  opacity: number;
  /** Pixels to push the block down from its resting position; 0 once settled. */
  offsetY: number;
  /** Scale for the pop animation; 1 for fade and word stagger. */
  scale: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Fade + rise + pop at the start of a cue, clamped after the entrance frames. */
export function captionEntrance(
  frame: number,
  startFrame: number,
  canvas: CanvasSpec,
  animation: CaptionAnimation = 'pop',
): CaptionEntrance {
  const progress = clamp01((frame - startFrame) / CAPTION_ENTRANCE_FRAMES);
  // Ease out so the cue settles rather than snapping into place.
  const eased = 1 - (1 - progress) ** 3;

  if (animation === 'word_stagger') {
    // The block is present; individual words carry the entrance.
    return { opacity: 1, offsetY: 0, scale: 1 };
  }
  if (animation === 'fade') {
    return { opacity: eased, offsetY: 0, scale: 1 };
  }
  return {
    opacity: eased,
    offsetY: (1 - eased) * px(CAPTION_RISE_BASE, canvas),
    scale: 0.94 + 0.06 * eased,
  };
}

export interface CaptionWordEntrance {
  opacity: number;
  offsetY: number;
}

/**
 * Per-word entrance for the pre-EDL `word_stagger` helper. The composition
 * itself now reveals words through `word_by_word` / `visibleWords` from the
 * overlay package; this stays exported because the caption tests (and any
 * outside import) pin its four-argument form. Every other animation leaves the
 * word fully visible, so the block animation owns the motion.
 */
export function captionWordEntrance(
  frame: number,
  startFrame: number,
  wordIndex: number,
  wordCount: number,
  canvas: CanvasSpec,
  animation: CaptionAnimation = 'pop',
): CaptionWordEntrance {
  if (animation !== 'word_stagger') return { opacity: 1, offsetY: 0 };

  const stagger = Math.min(1.5, WORD_STAGGER_FRAMES / Math.max(1, wordCount));
  const progress = clamp01(
    (frame - startFrame - wordIndex * stagger) / WORD_ENTRANCE_FRAMES,
  );
  const eased = 1 - (1 - progress) ** 3;
  return {
    opacity: eased,
    offsetY: (1 - eased) * px(WORD_STAGGER_RISE_BASE, canvas),
  };
}

/** Usable caption width between the left and right safe-area insets. */
export function captionWidth(canvas: CanvasSpec): number {
  return canvas.width - canvas.safeArea.left - canvas.safeArea.right;
}

/**
 * Resting bottom inset. It reserves the rise height so the animation travels
 * up from the safe-area line to 6 px inside it, never through the inset.
 */
export function captionBottomInset(canvas: CanvasSpec): number {
  return canvas.safeArea.bottom + px(CAPTION_RISE_BASE, canvas);
}

function flipAlign(align: CaptionAlign): CaptionAlign {
  if (align === 'left') return 'right';
  if (align === 'right') return 'left';
  return 'center';
}

function resolvedAlign(style: CaptionStyle, rtl: boolean): CaptionAlign {
  return rtl ? flipAlign(style.align) : style.align;
}

function justifyContent(align: CaptionAlign): CSSProperties['justifyContent'] {
  if (align === 'left') return 'flex-start';
  if (align === 'right') return 'flex-end';
  return 'center';
}

/**
 * Absolute anchor. Bottom hugs the safe-area line, top hugs `safeArea.top`,
 * centre sits on the middle of the canvas. RTL mirrors the horizontal edge.
 */
export function captionAnchorStyle(
  cue: Pick<CaptionCueFrames, 'rtl'>,
  canvas: CanvasSpec,
  styleInput?: CaptionStyleInput,
): CSSProperties {
  const style = resolveCaptionStyle(styleInput);
  const align = resolvedAlign(style, cue.rtl);

  return {
    position: 'absolute',
    ...(cue.rtl ? { right: canvas.safeArea.right } : { left: canvas.safeArea.left }),
    width: captionWidth(canvas),
    display: 'flex',
    justifyContent: justifyContent(align),
    ...(style.position === 'top'
      ? { top: canvas.safeArea.top + px(CAPTION_RISE_BASE, canvas) }
      : style.position === 'center'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: captionBottomInset(canvas) }),
  };
}

/**
 * The plate/backing. `none` and `soft_shadow` draw no rectangle: the type
 * carries itself with its shadow, which is the shipped default.
 */
export function captionPlateStyle(canvas: CanvasSpec, styleInput?: CaptionStyleInput): CSSProperties {
  const style = resolveCaptionStyle(styleInput);
  const base: CSSProperties = {
    boxSizing: 'border-box',
    maxWidth: '100%',
    textAlign: resolvedAlign(style, false),
    display: 'flex',
    flexDirection: 'column',
  };

  if (style.backing === 'solid_plate') {
    return {
      ...base,
      background: CAPTION_PLATE_COLOUR,
      padding: `${px(CAPTION_PLATE_PADDING_Y_BASE, canvas)}px ${px(CAPTION_PLATE_PADDING_X_BASE, canvas)}px`,
      borderRadius: px(CAPTION_PLATE_RADIUS_BASE, canvas),
    };
  }

  if (style.backing === 'gradient_scrim') {
    return {
      ...base,
      background: 'linear-gradient(to top, rgba(20,18,15,0.78), rgba(20,18,15,0.12) 70%, rgba(20,18,15,0))',
      padding: `${px(CAPTION_PLATE_PADDING_Y_BASE, canvas)}px ${px(CAPTION_PLATE_PADDING_X_BASE, canvas)}px`,
    };
  }

  return base;
}

/** Editorial's thin brass rule above the type; null for the other presets. */
export function captionRuleStyle(
  canvas: CanvasSpec,
  colours: ResolvedColours,
  cue: Pick<CaptionCueFrames, 'rtl'>,
  styleInput?: CaptionStyleInput,
): CSSProperties | null {
  const style = resolveCaptionStyle(styleInput);
  if (style.preset !== 'editorial') return null;

  return {
    width: px(64, canvas),
    height: Math.max(1, px(2, canvas)),
    background: colours.brass,
    marginBottom: px(14, canvas),
    alignSelf: cue.rtl ? 'flex-end' : 'flex-start',
    flexShrink: 0,
  };
}

/**
 * Text style. RTL keeps its own direction, alignment, face and zero tracking.
 * `letterSpacingEm` lets `tracking_in` start wide and settle; it defaults to
 * the resting `CAPTION_TRACKING` token.
 */
export function captionTextStyle(
  cue: Pick<CaptionCueFrames, 'rtl'>,
  canvas: CanvasSpec,
  colours: ResolvedColours,
  styleInput?: CaptionStyleInput,
  letterSpacingEm?: number,
): CSSProperties {
  const style = resolveCaptionStyle(styleInput);
  const align = resolvedAlign(style, cue.rtl);

  return {
    direction: cue.rtl ? 'rtl' : 'ltr',
    display: 'flex',
    flexDirection: 'column',
    textAlign: align,
    alignItems: justifyContent(align),
    fontFamily: cue.rtl ? RTL_FALLBACK_STACK : CAPTION_FONT_STACKS[style.font],
    fontSize: px(style.sizeBase, canvas),
    fontWeight: style.weight,
    lineHeight: CAPTION_LINE_HEIGHT,
    letterSpacing: cue.rtl
      ? 0
      : letterSpacingEm === undefined
        ? CAPTION_TRACKING
        : `${letterSpacingEm}em`,
    textTransform: cue.rtl
      ? 'none'
      : style.case === 'upper'
        ? 'uppercase'
        : style.case === 'title'
          ? 'capitalize'
          : 'none',
    color: colours[style.colour],
    textShadow: legibilityShadow(style.backing === 'soft_shadow' ? 'strong' : 'normal'),
  };
}

/**
 * Which token gets the accent colour. `longest_word` highlights the most
 * substantial word, so a preposition such as "to" never becomes the accent.
 */
export function captionAccentTarget(
  lines: readonly string[],
  accent: CaptionAccent,
): { line: number; word: number } | null {
  if (accent === 'none' || lines.length === 0) return null;

  if (accent === 'longest_word') {
    let best = { line: 0, word: 0, length: -1 };
    lines.forEach((line, lineIndex) => {
      line
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token, word) => {
          const length = token.replace(/[^\p{L}\p{N}]/gu, '').length;
          if (length > best.length) best = { line: lineIndex, word, length };
        });
    });
    return best.length < 0 ? null : { line: best.line, word: best.word };
  }

  const lineIndex = accent === 'last_word' ? lines.length - 1 : 0;
  const tokens = (lines[lineIndex] ?? '').split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return { line: lineIndex, word: accent === 'last_word' ? tokens.length - 1 : 0 };
}

export interface CaptionLayerProps {
  cues: CaptionCueFrames[];
  canvas: CanvasSpec;
  colours: ResolvedColours;
  style?: CaptionStyleInput;
  /**
   * Reduced motion. Remotion has no media query, so the composition passes
   * the user's preference here; default false. When true the entrance keeps
   * its opacity ramp and its character/word reveal but loses every spatial
   * move (rise, horizontal slide, scale, blur, tracking).
   */
  reduceMotion?: boolean;
}

function tokensOf(lines: readonly string[]): string[][] {
  return lines.map((line) => line.split(/\s+/).filter((token) => token.length > 0));
}

/**
 * The transform for the caption block at one frame.
 *
 * `slide_in` pushes in from the script's leading edge, so LTR starts 32 px to
 * the left of rest and RTL 32 px to the right; `translateX` in the entrance
 * state is the unsigned distance. At rest this is
 * `translate3d(0px, 0px, 0) scale(1.000)` for every animation, which is the
 * pose the renderer drew before this helper existed.
 */
export function captionMotionTransform(
  motion: Pick<CaptionEntranceState, 'translateX' | 'translateY' | 'scale'>,
  rtl: boolean,
): string {
  const translateX = rtl ? motion.translateX : -motion.translateX;
  return `translate3d(${translateX}px, ${motion.translateY}px, 0) scale(${motion.scale.toFixed(3)})`;
}

export function CaptionLayer({
  cues,
  canvas,
  colours,
  style: styleInput,
  reduceMotion = false,
}: CaptionLayerProps) {
  const frame = useCurrentFrame();
  const style = resolveCaptionStyle(styleInput);
  const cue = cues.find((item) => frame >= item.startFrame && frame < item.endFrame);
  if (!cue || cue.lines.length === 0) return null;

  const lineTokens = tokensOf(cue.lines);
  const totalWords = lineTokens.reduce((sum, tokens) => sum + tokens.length, 0);
  const totalChars = lineTokens.reduce(
    (sum, tokens) => sum + tokens.reduce((chars, token) => chars + Array.from(token).length, 0),
    0,
  );

  // Every EDL TextAnimation, cue-relative frame, fps-aware timing.
  const motion = captionEntranceState(style.animation, frame - cue.startFrame, canvas.fps, {
    scale: canvas.width / CAPTION_MOTION_BASE_WIDTH,
    wordCount: totalWords,
    charCount: totalChars,
    reduceMotion,
  });

  const accent = captionAccentTarget(cue.lines, style.accent);
  const rule = captionRuleStyle(canvas, colours, cue, style);
  const visibleWords = motion.visibleWords;
  const visibleChars = motion.visibleChars;

  let wordIndex = 0;
  // Typewriter counts characters, not the spaces between words: the space
  // after a word appears with the word.
  let charCursor = 0;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={captionAnchorStyle(cue, canvas, style)}>
        <div
          style={{
            opacity: motion.opacity,
            transform: captionMotionTransform(motion, cue.rtl),
            ...(motion.blurPx > 0 ? { filter: `blur(${motion.blurPx}px)` } : {}),
          }}
        >
          <div style={captionPlateStyle(canvas, style)}>
            {rule ? <div style={rule} /> : null}
            <div
              style={captionTextStyle(
                cue,
                canvas,
                colours,
                style,
                motion.letterSpacingEm,
              )}
            >
              {lineTokens.map((tokens, lineIndex) => {
                const rendered = tokens.map((token, tokenIndex) => {
                  const index = wordIndex;
                  wordIndex += 1;
                  const isAccent =
                    accent !== null && accent.line === lineIndex && accent.word === tokenIndex;
                  const space = tokenIndex < tokens.length - 1 ? ' ' : '';
                  // A word that has not arrived yet keeps its box: opacity 0,
                  // never display: none, so the line never reflows.
                  const hiddenWord = visibleWords !== undefined && index >= visibleWords;

                  let content: ReactNode = `${token}${space}`;
                  if (visibleChars !== undefined) {
                    const chars = Array.from(token);
                    const shown = Math.max(0, Math.min(chars.length, visibleChars - charCursor));
                    charCursor += chars.length;
                    content = (
                      <>
                        <span>{chars.slice(0, shown).join('')}</span>
                        <span style={{ opacity: 0 }}>
                          {chars.slice(shown).join('')}
                          {space}
                        </span>
                      </>
                    );
                  }

                  return (
                    <span
                      key={`${lineIndex}-${tokenIndex}-${token}`}
                      style={{
                        color: isAccent ? colours[style.accentColour] : undefined,
                        ...(hiddenWord ? { opacity: 0 } : {}),
                      }}
                    >
                      {content}
                    </span>
                  );
                });

                return <div key={`line-${lineIndex}`}>{rendered}</div>;
              })}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
