import { describe, expect, it } from 'vitest';
import {
  CAPTION_ENTRANCE_FRAMES,
  CAPTION_LINE_HEIGHT,
  CAPTION_WEIGHT,
  captionAccentTarget,
  captionAnchorStyle,
  captionBottomInset,
  captionEntrance,
  captionPlateStyle,
  captionRuleStyle,
  captionTextStyle,
  captionWidth,
  captionWordEntrance,
} from '../src/captions';
import { DISPLAY_FONT, UI_FONT } from '../src/theme';
import { RTL_FALLBACK_STACK } from '../../../packages/overlays/src/index';
import {
  CAPTION_MAX_CHARS,
  CAPTION_MAX_LINES,
  CAPTION_PRESETS,
  captionCues,
  resolveCaptionStyle,
} from '../../../packages/overlays/src/index';
import type { CanvasSpec } from '../../../packages/overlays/src/types';
import type { CaptionWord, Edl } from '../../../packages/edl/src/types';

const VERTICAL: CanvasSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
};

const HALF: CanvasSpec = { ...VERTICAL, width: 540, height: 960 };

const COLOURS = { brass: '#B08A4A', ink: '#14120F', paper: '#F7F4EF' };

const LTR = { rtl: false };
const RTL = { rtl: true };

function wordsOf(text: string, startSec = 0, stepSec = 0.2): CaptionWord[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token, index) => ({
      text: token,
      startSec: startSec + index * stepSec,
      endSec: startSec + (index + 1) * stepSec,
    }));
}

function documentWith(words: CaptionWord[]): Edl {
  return {
    edlVersion: '1.0.0',
    id: 'edl_caption_test',
    listingId: 'test-listing',
    createdAt: '2026-11-16T10:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Test', targetDurationSec: 20 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: VERTICAL.safeArea,
    },
    clips: [
      {
        id: 'c01',
        sourceId: 's_0000aaaa',
        src: 'raw/01.mp4',
        inSec: 0,
        outSec: 20,
        speed: 1,
        volumeDb: -6,
        transform: {
          mode: 'cover',
          focus: 'center',
          path: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }],
        },
        transitionIn: { type: 'cut', durationSec: 0 },
        reason: 'test',
      },
    ],
    overlays: [],
    audio: {
      music: { trackId: 'test', src: 'music/test.m4a', gainDb: -6, duckUnderVoiceDb: -18, beatGrid: [] },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: { mode: 'burn', style: 'bold_center', language: 'en-GB', words },
    provenance: {
      pipelineVersion: 'test',
      models: { tagging: 'test', planning: 'test' },
      promptVersions: { tagging: 'test', planning: 'test' },
      costUsd: 0,
    },
  };
}

describe('captionTextStyle', () => {
  it('sets 76 px at 1080 and scales with the canvas', () => {
    expect(captionTextStyle(LTR, VERTICAL, COLOURS).fontSize).toBe(76);
    expect(captionTextStyle(LTR, HALF, COLOURS).fontSize).toBe(38);
    expect(captionTextStyle(LTR, { ...VERTICAL, width: 1350 }, COLOURS).fontSize).toBe(95);
  });

  it('is heavy, tight, uppercase and centred in the display face', () => {
    const style = captionTextStyle(LTR, VERTICAL, COLOURS);
    expect(style.fontWeight).toBe(800);
    expect(CAPTION_WEIGHT).toBe(800);
    expect(style.lineHeight).toBe(0.98);
    expect(CAPTION_LINE_HEIGHT).toBe(0.98);
    expect(style.letterSpacing).toBe('-0.02em');
    expect(style.color).toBe(COLOURS.paper);
    expect(style.fontFamily).toBe(DISPLAY_FONT);
    expect(style.direction).toBe('ltr');
    expect(style.textAlign).toBe('center');
    expect(style.textTransform).toBe('uppercase');
  });

  it('keeps RTL direction and the Arabic face, without forcing case', () => {
    const style = captionTextStyle(RTL, VERTICAL, COLOURS);
    expect(style.direction).toBe('rtl');
    expect(style.fontFamily).toBe(RTL_FALLBACK_STACK);
    // docs/OVERLAYS.md: no tracking on Arabic.
    expect(style.letterSpacing).toBe(0);
    expect(style.textTransform).toBe('none');
    expect(style.fontSize).toBe(76);
  });
});

describe('caption presets', () => {
  it('ships Social Bold as the default', () => {
    const style = resolveCaptionStyle(undefined);
    expect(style).toEqual(CAPTION_PRESETS.social_bold);
    expect(style.font).toBe('bricolage');
    expect(style.weight).toBe(800);
    expect(style.sizeBase).toBe(76);
    expect(style.case).toBe('upper');
    expect(style.align).toBe('center');
    expect(style.backing).toBe('none');
    expect(style.animation).toBe('pop');
  });

  it('renders Clean Reel in Archivo, sentence case, with a soft shadow', () => {
    const style = captionTextStyle(LTR, VERTICAL, COLOURS, 'clean_reel');
    expect(style.fontFamily).toBe(UI_FONT);
    expect(style.fontSize).toBe(64);
    expect(style.fontWeight).toBe(600);
    expect(style.textTransform).toBe('none');
    expect(style.textAlign).toBe('center');
    expect(style.textShadow).toContain('0.78');
  });

  it('renders Editorial left-aligned in the serif face with a brass rule', () => {
    const style = captionTextStyle(LTR, VERTICAL, COLOURS, 'editorial');
    expect(style.fontSize).toBe(60);
    expect(style.fontWeight).toBe(400);
    expect(style.textAlign).toBe('left');
    expect(style.textTransform).toBe('none');
    expect(String(style.fontFamily)).toContain('Serif');

    const rule = captionRuleStyle(VERTICAL, COLOURS, LTR, 'editorial');
    expect(rule).not.toBeNull();
    expect(rule?.background).toBe(COLOURS.brass);
    expect(captionRuleStyle(VERTICAL, COLOURS, LTR, 'social_bold')).toBeNull();
  });

  it('mirrors alignment and padding for RTL', () => {
    const style = captionTextStyle(RTL, VERTICAL, COLOURS, 'editorial');
    expect(style.direction).toBe('rtl');
    expect(style.textAlign).toBe('right');
    expect(style.fontFamily).toBe(RTL_FALLBACK_STACK);
    expect(style.textTransform).toBe('none');

    const anchor = captionAnchorStyle(RTL, VERTICAL, 'editorial');
    expect(anchor.right).toBe(120);
    expect(anchor.justifyContent).toBe('flex-end');
  });

  it('accepts a style object with overrides', () => {
    const style = captionTextStyle(LTR, VERTICAL, COLOURS, {
      preset: 'editorial',
      colour: 'brass',
      case: 'upper',
      position: 'top',
    });
    expect(style.color).toBe(COLOURS.brass);
    expect(style.textTransform).toBe('uppercase');
    expect(captionAnchorStyle(LTR, VERTICAL, { position: 'top' }).top).toBe(256);
  });
});

describe('caption backing', () => {
  it('draws no plate: the type carries itself', () => {
    const style = captionPlateStyle(VERTICAL);
    expect(style.background).toBeUndefined();
    expect(style.padding).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
    expect(style.boxSizing).toBe('border-box');
    expect(style.textAlign).toBe('center');
  });

  it('keeps the solid plate available for busy footage', () => {
    const style = captionPlateStyle(VERTICAL, { backing: 'solid_plate' });
    expect(style.background).toBe('rgba(14,13,11,0.62)');
    expect(style.borderRadius).toBe(8);
    expect(style.padding).toBe('18px 24px');
  });
});

describe('caption layout', () => {
  it('keeps the caption column width', () => {
    expect(captionWidth(VERTICAL)).toBe(900);
  });

  it('centres the block inside the safe column for both directions', () => {
    const ltr = captionAnchorStyle(LTR, VERTICAL);
    expect(ltr.left).toBe(60);
    expect(ltr.right).toBeUndefined();
    expect(ltr.justifyContent).toBe('center');

    const rtl = captionAnchorStyle(RTL, VERTICAL);
    expect(rtl.right).toBe(120);
    expect(rtl.left).toBeUndefined();
    expect(rtl.justifyContent).toBe('center');
  });

  it('keeps the block inside the bottom safe area', () => {
    expect(captionBottomInset(VERTICAL)).toBeGreaterThan(VERTICAL.safeArea.bottom);
    expect(captionAnchorStyle(LTR, VERTICAL).bottom).toBe(346);
  });
});

describe('captionEntrance', () => {
  it('fades, rises and pops over eight frames from the cue start', () => {
    expect(CAPTION_ENTRANCE_FRAMES).toBe(8);

    const start = captionEntrance(120, 120, VERTICAL);
    expect(start.opacity).toBe(0);
    expect(start.offsetY).toBe(6);
    expect(start.scale).toBe(0.94);

    const middle = captionEntrance(124, 120, VERTICAL);
    expect(middle.opacity).toBeGreaterThan(0);
    expect(middle.opacity).toBeLessThan(1);
    expect(middle.offsetY).toBeGreaterThan(0);
    expect(middle.offsetY).toBeLessThan(6);
    expect(middle.scale).toBeGreaterThan(0.94);
    expect(middle.scale).toBeLessThan(1);

    const settled = captionEntrance(128, 120, VERTICAL);
    expect(settled).toEqual({ opacity: 1, offsetY: 0, scale: 1 });

    expect(captionEntrance(160, 120, VERTICAL)).toEqual({ opacity: 1, offsetY: 0, scale: 1 });
    expect(captionEntrance(100, 120, VERTICAL)).toEqual({ opacity: 0, offsetY: 6, scale: 0.94 });
  });

  it('scales the rise with the canvas', () => {
    expect(captionEntrance(0, 0, HALF).offsetY).toBe(3);
    expect(captionEntrance(8, 0, HALF).opacity).toBe(1);
  });

  it('fades without motion for the fade animation', () => {
    expect(captionEntrance(120, 120, VERTICAL, 'fade')).toEqual({
      opacity: 0,
      offsetY: 0,
      scale: 1,
    });
    expect(captionEntrance(124, 120, VERTICAL, 'fade').opacity).toBeGreaterThan(0);
    expect(captionEntrance(128, 120, VERTICAL, 'fade')).toEqual({
      opacity: 1,
      offsetY: 0,
      scale: 1,
    });
  });

  it('staggers words for the word_stagger animation', () => {
    // The block is visible; the words carry the entrance.
    expect(captionEntrance(120, 120, VERTICAL, 'word_stagger')).toEqual({
      opacity: 1,
      offsetY: 0,
      scale: 1,
    });
    expect(captionWordEntrance(120, 120, 0, 3, VERTICAL, 'word_stagger').opacity).toBe(0);
    expect(captionWordEntrance(120, 120, 1, 3, VERTICAL, 'word_stagger').opacity).toBe(0);

    const second = captionWordEntrance(124, 120, 1, 3, VERTICAL, 'word_stagger');
    expect(second.opacity).toBeGreaterThan(0);
    expect(second.opacity).toBeLessThan(1);
    expect(captionWordEntrance(130, 120, 2, 3, VERTICAL, 'word_stagger').opacity).toBe(1);
    expect(captionWordEntrance(120, 120, 0, 3, VERTICAL, 'pop').opacity).toBe(1);
  });
});

describe('no three-line cues', () => {
  it('splits long speech into at most two lines of 28 characters', () => {
    const text =
      'Fully furnished three bedroom apartment with a private balcony and a marina view ready to move in today';
    const cues = captionCues(documentWith(wordsOf(text)), 30);

    expect(CAPTION_MAX_CHARS).toBe(28);
    expect(CAPTION_MAX_LINES).toBe(2);
    expect(cues.length).toBeGreaterThan(1);

    for (const cue of cues) {
      expect(cue.lines.length).toBeGreaterThan(0);
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) {
        expect(Array.from(line).length).toBeLessThanOrEqual(28);
      }
    }
  });

  it('accents the last word without reordering anything', () => {
    expect(captionAccentTarget(['Marina Gate One', 'Dubai Marina.'], 'last_word')).toEqual({
      line: 1,
      word: 1,
    });
    expect(captionAccentTarget(['Marina Gate One', 'Dubai Marina.'], 'first_word')).toEqual({
      line: 0,
      word: 0,
    });
    expect(captionAccentTarget(['Marina Gate One'], 'none')).toBeNull();
  });
});
