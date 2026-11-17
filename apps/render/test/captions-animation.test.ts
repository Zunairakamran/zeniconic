import { describe, expect, it } from 'vitest';
import {
  CAPTION_ANIMATIONS,
  CAPTION_ENTRANCE_SEC,
  CAPTION_TRACKING_REST_EM,
  captionEntrance,
  isCaptionAnimation,
  normalizeCaptionAnimation,
  resolveCaptionStyle,
  withReducedMotion,
} from '../../../packages/overlays/src/captions';
import type {
  CaptionAnimation,
  CaptionEntranceState,
  CaptionStyle,
} from '../../../packages/overlays/src/captions';

/**
 * The Remotion caption path: every EDL `TextAnimation` value resolved to the
 * numbers the composition draws. This suite is pure — no DOM, no Remotion
 * runtime, no render.
 *
 * The FFmpeg/ASS marketing path does not run any of this; it has no animation
 * support and is out of scope here.
 */

const FPS = 30;
/** 8 frames at 30 fps. */
const ENTRANCE_FRAMES = Math.round(CAPTION_ENTRANCE_SEC * FPS);

const DRAWABLE: CaptionAnimation[] = [
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
];

function at(
  animation: string,
  frame: number,
  options: Parameters<typeof captionEntrance>[3] = {},
  fps = FPS,
): CaptionEntranceState {
  return captionEntrance(animation, frame, fps, options);
}

function numericValues(state: CaptionEntranceState): number[] {
  return [
    state.opacity,
    state.translateX,
    state.translateY,
    state.scale,
    state.letterSpacingEm,
    state.blurPx,
  ];
}

describe('caption animation coverage', () => {
  it('knows every EDL TextAnimation plus the legacy alias', () => {
    for (const animation of DRAWABLE) expect(isCaptionAnimation(animation)).toBe(true);
    expect(isCaptionAnimation('word_stagger')).toBe(true);
    // `count_up` is an overlay animation, not a caption one.
    expect(isCaptionAnimation('count_up')).toBe(false);
    expect(isCaptionAnimation('')).toBe(false);
    expect(isCaptionAnimation(42)).toBe(false);
    expect(CAPTION_ANIMATIONS).toContain('word_by_word');
    expect(CAPTION_ANIMATIONS).toContain('word_stagger');
  });

  it('maps the EDL animation string through resolveCaptionStyle', () => {
    for (const animation of DRAWABLE) {
      expect(resolveCaptionStyle({ animation }).animation).toBe(animation);
    }
    // Backward-compatible alias, and no undefined entrance.
    expect(resolveCaptionStyle({ animation: 'word_stagger' }).animation).toBe('word_stagger');
    expect(resolveCaptionStyle({ animation: 'none' }).animation).toBe('none');
    // An invented value cannot smuggle itself into the renderer.
    const bogus = { animation: 'wobble' } as unknown as Partial<CaptionStyle>;
    expect(resolveCaptionStyle(bogus).animation).toBe(resolveCaptionStyle(undefined).animation);
    // A preset or legacy string still resolves its own animation.
    expect(resolveCaptionStyle('clean_reel').animation).toBe('fade');
    expect(resolveCaptionStyle('editorial_serif').animation).toBe('fade');
  });

  it('falls back deterministically for unknown and legacy values', () => {
    expect(normalizeCaptionAnimation('nope')).toBe('fade');
    expect(normalizeCaptionAnimation(undefined)).toBe('fade');
    expect(normalizeCaptionAnimation('pop')).toBe('pop');
    expect(normalizeCaptionAnimation('word_stagger')).toBe('word_stagger');
    // Unknown animation renders exactly like the documented fallback.
    expect(at('wobble', 4)).toEqual(at('fade', 4));
    expect(at('', 4)).toEqual(at('fade', 4));
  });
});

describe('captionEntrance: frame 0, mid and end', () => {
  it('none: already settled at frame 0, no entrance at all', () => {
    const start = at('none', 0);
    expect(start.opacity).toBe(1);
    expect(start.translateX).toBe(0);
    expect(start.translateY).toBe(0);
    expect(start.scale).toBe(1);
    expect(at('none', -10)).toEqual(start);
    expect(at('none', 60)).toEqual(start);
    expect(start.visibleChars).toBeUndefined();
    expect(start.visibleWords).toBeUndefined();
  });

  it('fade: opacity only, 0 -> 1 over eight frames', () => {
    expect(at('fade', 0).opacity).toBe(0);
    const mid = at('fade', ENTRANCE_FRAMES / 2);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.translateX).toBe(0);
    expect(mid.translateY).toBe(0);
    expect(mid.scale).toBe(1);
    expect(mid.blurPx).toBe(0);
    expect(mid.letterSpacingEm).toBe(CAPTION_TRACKING_REST_EM);
    expect(at('fade', ENTRANCE_FRAMES)).toEqual({
      opacity: 1,
      translateX: 0,
      translateY: 0,
      scale: 1,
      letterSpacingEm: CAPTION_TRACKING_REST_EM,
      blurPx: 0,
    });
  });

  it('rise: 6 px from the safe edge to rest', () => {
    expect(at('rise', 0).translateY).toBe(6);
    const mid = at('rise', ENTRANCE_FRAMES / 2);
    expect(mid.translateY).toBeGreaterThan(0);
    expect(mid.translateY).toBeLessThan(6);
    expect(at('rise', ENTRANCE_FRAMES).translateY).toBe(0);
    // A rise stays vertical.
    expect(at('rise', 0).translateX).toBe(0);
    expect(at('rise', ENTRANCE_FRAMES / 2).translateX).toBe(0);
    // Translating does not scale.
    expect(at('rise', 0).scale).toBe(1);
    // The travel follows the canvas: 540-wide take rises half as far.
    expect(at('rise', 0, { scale: 0.5 }).translateY).toBe(3);
  });

  it('slide_in: a 32 px horizontal push from the safe edge, not a rise', () => {
    const start = at('slide_in', 0);
    expect(start.translateX).toBe(32);
    // It must not travel vertically any more: that is what `rise` is for.
    expect(start.translateY).toBe(0);

    const mid = at('slide_in', ENTRANCE_FRAMES / 2);
    expect(mid.translateX).toBeGreaterThan(0);
    expect(mid.translateX).toBeLessThan(32);
    expect(mid.translateY).toBe(0);

    const settled = at('slide_in', ENTRANCE_FRAMES);
    expect(settled.translateX).toBe(0);
    expect(settled.translateY).toBe(0);
    expect(settled.opacity).toBe(1);

    // Travel follows the canvas: 540-wide take pushes half as far.
    expect(at('slide_in', 0, { scale: 0.5 }).translateX).toBe(16);
    // And it fades while it moves.
    expect(start.opacity).toBe(0);
    expect(mid.opacity).toBeGreaterThan(0);
  });

  it('pop: grows from 0.88 to exactly 1, with a small overshoot', () => {
    expect(at('pop', 0).scale).toBe(0.88);
    const scales = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((frame) => at('pop', frame).scale);
    expect(scales.some((scale) => scale > 1)).toBe(true);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.02);
    expect(at('pop', ENTRANCE_FRAMES).scale).toBe(1);
    expect(at('pop', 60).scale).toBe(1);
    expect(at('pop', 0).opacity).toBe(0);
    expect(at('pop', ENTRANCE_FRAMES).opacity).toBe(1);
  });

  it('typewriter: reveals characters at 20 per second, bounded', () => {
    expect(at('typewriter', 0, { charCount: 24 }).visibleChars).toBe(1);
    expect(at('typewriter', 3, { charCount: 24 }).visibleChars).toBe(3);
    expect(at('typewriter', 15, { charCount: 24 }).visibleChars).toBe(11);
    // Fully revealed and never past the cue length.
    expect(at('typewriter', 600, { charCount: 24 }).visibleChars).toBe(24);
    expect(at('typewriter', 600, { charCount: 7 }).visibleChars).toBe(7);
    // No characters before the cue exists.
    expect(at('typewriter', -1, { charCount: 24 }).visibleChars).toBe(0);
    // Only the reveal moves.
    const mid = at('typewriter', 5, { charCount: 24 });
    expect(mid.opacity).toBe(1);
    expect(mid.translateY).toBe(0);
    expect(mid.scale).toBe(1);
    expect(mid.visibleWords).toBeUndefined();

    for (const frame of [-5, 0, 1, 2, 9, 30, 900]) {
      const state = at('typewriter', frame, { charCount: 24 });
      expect(state.visibleChars).toBeGreaterThanOrEqual(0);
      expect(state.visibleChars).toBeLessThanOrEqual(24);
    }
  });

  it('word_by_word: one word at a time, every word shown by the end', () => {
    const options = { wordCount: 4 };
    expect(at('word_by_word', 0, options).visibleWords).toBe(1);
    // A 1.5-frame stagger at 30 fps: word 1 lands on frame 2, word 3 on frame 5.
    expect(at('word_by_word', 2, options).visibleWords).toBe(2);
    expect(at('word_by_word', 3, options).visibleWords).toBe(3);
    expect(at('word_by_word', 5, options).visibleWords).toBe(4);
    expect(at('word_by_word', 30, options).visibleWords).toBe(4);
    expect(at('word_by_word', -1, options).visibleWords).toBe(0);
    // Revealing words never touches the block pose.
    const mid = at('word_by_word', 2, options);
    expect(mid.opacity).toBe(1);
    expect(mid.scale).toBe(1);
    expect(mid.visibleChars).toBeUndefined();

    // Non-decreasing over the whole cue, and never past wordCount.
    let previous = 0;
    for (const frame of [-2, 0, 1, 2, 3, 4, 5, 10, 40]) {
      const visible = at('word_by_word', frame, options).visibleWords ?? 0;
      expect(visible).toBeGreaterThanOrEqual(previous);
      expect(visible).toBeLessThanOrEqual(4);
      previous = visible;
    }

    // Long cues keep the last word from waiting too long (1.5-frame stagger).
    expect(at('word_by_word', 13, { wordCount: 12 }).visibleWords).toBe(12);
  });

  it('treats the legacy word_stagger alias exactly like word_by_word', () => {
    for (const frame of [-1, 0, 1, 2, 3, 8, 40]) {
      expect(at('word_stagger', frame, { wordCount: 3 })).toEqual(
        at('word_by_word', frame, { wordCount: 3 }),
      );
    }
  });

  it('tracking_in: starts wide and settles on the resting tracking', () => {
    expect(at('tracking_in', 0).letterSpacingEm).toBe(0.32);
    const mid = at('tracking_in', 5).letterSpacingEm;
    expect(mid).toBeLessThan(0.32);
    expect(mid).toBeGreaterThan(CAPTION_TRACKING_REST_EM);
    expect(at('tracking_in', 10).letterSpacingEm).toBe(CAPTION_TRACKING_REST_EM);
    expect(at('tracking_in', 90).letterSpacingEm).toBe(CAPTION_TRACKING_REST_EM);
    expect(at('tracking_in', 0).opacity).toBe(0);
  });

  it('blur_in: starts blurred and clears', () => {
    expect(at('blur_in', 0).blurPx).toBe(12);
    const mid = at('blur_in', 5).blurPx;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(12);
    expect(at('blur_in', 10).blurPx).toBe(0);
    expect(at('blur_in', 90).blurPx).toBe(0);
    expect(at('blur_in', 0).scale).toBe(1);
    expect(at('blur_in', 0, { scale: 0.5 }).blurPx).toBe(6);
  });

  it('scale_in: settles down from 1.18 rather than growing', () => {
    expect(at('scale_in', 0).scale).toBe(1.18);
    const mid = at('scale_in', 6).scale;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(1.18);
    expect(at('scale_in', 12).scale).toBe(1);
    expect(at('scale_in', 90).scale).toBe(1);
    // Distinct from pop, which grows into place.
    expect(at('scale_in', 0).scale).toBeGreaterThan(1);
    expect(at('pop', 0).scale).toBeLessThan(1);
  });
});

describe('captionEntrance: horizontal travel belongs to slide_in alone', () => {
  const OTHERS = DRAWABLE.filter((animation) => animation !== 'slide_in');

  it('leaves translateX at zero for every other animation and frame', () => {
    for (const animation of [...OTHERS, 'word_stagger']) {
      for (const frame of [-12, 0, 1, 4, 8, 13, 60]) {
        expect(at(animation, frame, { wordCount: 4, charCount: 12 }).translateX).toBe(0);
      }
    }
  });

  it('keeps translateX non-negative and finite, and settles on zero', () => {
    for (const frame of [-12, 0, 1, 3, 6, 8, 20, 240]) {
      const state = at('slide_in', frame);
      expect(Number.isFinite(state.translateX)).toBe(true);
      expect(state.translateX).toBeGreaterThanOrEqual(0);
    }
    expect(at('slide_in', 240).translateX).toBe(0);
    expect(at('slide_in', -12).translateX).toBe(32);
  });
});

describe('captionEntrance: robustness', () => {
  it('never returns NaN or an out-of-range number', () => {
    for (const animation of [...DRAWABLE, 'word_stagger', 'nope']) {
      for (const frame of [-30, -1, 0, 1, 4, 8, 13, 60, 600]) {
        const state = at(animation, frame, { wordCount: 5, charCount: 18 });
        for (const value of numericValues(state)) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(state.opacity).toBeGreaterThanOrEqual(0);
        expect(state.opacity).toBeLessThanOrEqual(1);
        expect(state.translateX).toBeGreaterThanOrEqual(0);
        expect(state.translateY).toBeGreaterThanOrEqual(0);
        expect(state.scale).toBeGreaterThan(0);
        expect(state.blurPx).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is monotonic in opacity for every entrance that fades', () => {
    for (const animation of [
      'fade',
      'rise',
      'slide_in',
      'pop',
      'tracking_in',
      'blur_in',
      'scale_in',
      'none',
    ]) {
      let previous = -1;
      for (let frame = 0; frame <= ENTRANCE_FRAMES + 4; frame += 1) {
        const opacity = at(animation, frame).opacity;
        expect(opacity).toBeGreaterThanOrEqual(previous);
        previous = opacity;
      }
      expect(previous).toBe(1);
    }
  });

  it('holds its starting pose before the cue and its settled pose after it', () => {
    for (const animation of DRAWABLE) {
      const before = at(animation, -12);
      expect(Number.isFinite(before.opacity)).toBe(true);
      if (animation === 'none') {
        expect(before.opacity).toBe(1);
      } else if (animation === 'typewriter') {
        expect(before.visibleChars).toBe(0);
      } else if (animation === 'word_by_word') {
        expect(before.visibleWords).toBe(0);
      } else {
        expect(before.opacity).toBe(0);
      }
      const settled = at(animation, 240);
      expect(settled.opacity).toBe(1);
      expect(settled.translateX).toBe(0);
      expect(settled.translateY).toBe(0);
      expect(settled.scale).toBe(1);
      expect(settled.blurPx).toBe(0);
      expect(settled.letterSpacingEm).toBe(CAPTION_TRACKING_REST_EM);
      // Identical on a later frame: the entrance is over, nothing drifts.
      expect(at(animation, 900)).toEqual(settled);
    }
  });

  it('scales its timing with fps and survives a broken fps', () => {
    // 8 frames at 30 fps is 16 frames at 60 fps.
    expect(at('fade', 16, {}, 60).opacity).toBe(1);
    expect(at('fade', 8, {}, 60).opacity).toBeLessThan(1);
    expect(at('fade', 8, {}, 60).opacity).toBe(at('fade', 4, {}, 30).opacity);
    // Garbage fps falls back to 30 instead of dividing by zero.
    expect(at('fade', 0, {}, 0)).toEqual(at('fade', 0, {}, 30));
    expect(Number.isFinite(at('fade', 5, {}, Number.NaN).opacity)).toBe(true);
  });

  it('honours reduceMotion without losing the text reveal', () => {
    const reduced = at('rise', 0, { reduceMotion: true });
    expect(reduced.translateY).toBe(0);
    expect(reduced.opacity).toBe(0);

    // Slide is a spatial move too: no horizontal travel either.
    expect(at('slide_in', 0, { reduceMotion: true }).translateX).toBe(0);
    expect(at('slide_in', 0, { reduceMotion: true }).translateY).toBe(0);
    expect(at('pop', 2, { reduceMotion: true }).scale).toBe(1);
    expect(at('scale_in', 0, { reduceMotion: true }).scale).toBe(1);
    expect(at('blur_in', 0, { reduceMotion: true }).blurPx).toBe(0);
    expect(at('tracking_in', 0, { reduceMotion: true }).letterSpacingEm).toBe(
      CAPTION_TRACKING_REST_EM,
    );

    // The opacity ramp survives, so the cue still appears rather than pops on.
    expect(at('fade', 0, { reduceMotion: true }).opacity).toBe(0);
    expect(at('fade', 4, { reduceMotion: true }).opacity).toBeGreaterThan(0);
    expect(at('fade', 4, { reduceMotion: true }).opacity).toBeLessThan(1);
    expect(at('slide_in', 0, { reduceMotion: true }).opacity).toBe(0);
    expect(at('slide_in', ENTRANCE_FRAMES, { reduceMotion: true }).opacity).toBe(1);

    // Text still appears progressively: that is not vestibular motion.
    expect(at('typewriter', 3, { reduceMotion: true, charCount: 24 }).visibleChars).toBe(3);
    expect(at('word_by_word', 1, { reduceMotion: true, wordCount: 4 }).visibleWords).toBe(1);
    expect(at('word_by_word', 2, { reduceMotion: true, wordCount: 4 }).visibleWords).toBe(2);

    // Every animation loses its pose but keeps its reveal.
    for (const animation of DRAWABLE) {
      const state = at(animation, 1, { reduceMotion: true, wordCount: 4, charCount: 12 });
      expect(state.translateX).toBe(0);
      expect(state.translateY).toBe(0);
      expect(state.scale).toBe(1);
      expect(state.blurPx).toBe(0);
      expect(state.letterSpacingEm).toBe(CAPTION_TRACKING_REST_EM);
    }

    // Default is off: the same frame moves when nothing asks for reduced motion.
    expect(at('rise', 0).translateY).toBe(6);
    expect(at('slide_in', 0).translateX).toBe(32);

    // withReducedMotion is the same transform, usable on a stored state.
    const moving = at('slide_in', 0);
    expect(withReducedMotion(moving, false)).toBe(moving);
    expect(withReducedMotion(moving, true).translateX).toBe(0);
    const blurred = at('blur_in', 0);
    expect(withReducedMotion(blurred, false)).toBe(blurred);
    expect(withReducedMotion(blurred, true).blurPx).toBe(0);
  });

  it('treats a zero word or character count as one', () => {
    expect(at('typewriter', 30, { charCount: 0 }).visibleChars).toBe(1);
    expect(at('word_by_word', 30, { wordCount: 0 }).visibleWords).toBe(1);
    expect(at('typewriter', 0, { charCount: Number.NaN }).visibleChars).toBe(1);
  });
});
