import { describe, expect, it } from 'vitest';
import type { PlanRequest } from '@zeniconic/planner';
import edlSchema from '../../edl/schema.json';
import type { StylePack } from '../src/index';
import {
  CAPTION_STYLES,
  OVERLAY_ANIMATIONS,
  OVERLAY_STYLES,
  StyleError,
  TRANSITION_TYPES,
  applyStyle,
  getStyle,
  listStyles,
  validateStyle,
} from '../src/index';

const EDL_TRANSITIONS: readonly string[] = edlSchema.$defs.Transition.properties.type.enum;
const EDL_OVERLAY_STYLES: readonly string[] = edlSchema.$defs.Overlay.properties.style.enum;
const EDL_OVERLAY_ANIMATIONS: readonly string[] = edlSchema.$defs.Overlay.properties.animation.enum;
const EDL_CAPTION_MODES: readonly string[] = edlSchema.$defs.Captions.properties.mode.enum;
const EDL_CAPTION_STYLES: readonly string[] = edlSchema.$defs.Captions.properties.style.enum;
const EDL_LOOKS: readonly string[] = edlSchema.$defs.LookRef.properties.id.enum;

function makeRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    listingId: '2026-11-14-14-oak-avenue',
    format: {
      id: 'cinematic_hero',
      label: 'Cinematic hero',
      targetDurationSec: 36,
    },
    look: { id: 'calm', label: 'Calm' },
    profile: 'landscape',
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      safeArea: { top: 60, bottom: 90, left: 60, right: 60 },
    },
    candidates: [
      {
        shotId: 'sh_s4f2a1b9c_003',
        sourceId: 's_4f2a1b9c',
        src: 'raw/03_living.mp4',
        room: 'living',
        score: 0.91,
        inSec: 1.5,
        outSec: 5.5,
        reason: 'Living room, slow push towards the window.',
      },
      {
        shotId: 'sh_s4f2a1b9c_007',
        sourceId: 's_4f2a1b9c',
        src: 'raw/07_view.mp4',
        room: 'view',
        score: 0.88,
        inSec: 2.25,
        outSec: 6.75,
        reason: 'Marina view, clean horizon.',
      },
    ],
    facts: {
      address: 'Marina Gate 1, Dubai Marina',
      price: 'AED 1,850,000',
      beds: 3,
      baths: 2,
      currency: 'AED',
    },
    music: {
      trackId: 'bed_090',
      src: 'music/bed_090.m4a',
      beatGrid: [0.5, 1.5, 2.5],
      gainDb: -3.5,
      duckUnderVoiceDb: -18,
    },
    seed: 42,
    now: '2026-11-15T09:00:00.000Z',
    ...overrides,
  };
}

describe('style registry', () => {
  it('loads the four packs from config/styles', () => {
    const styles = listStyles();
    expect(styles).toHaveLength(4);
    expect(styles.map((style) => style.id).sort()).toEqual([
      'calm',
      'editorial',
      'social',
      'walkthrough',
    ]);
  });

  it('keeps the four packs genuinely different', () => {
    const signatures = new Set(
      listStyles().map((style) =>
        JSON.stringify({
          pacing: style.pacing,
          transitions: style.transitions,
          overlays: style.overlays,
          captions: style.captions,
          music: style.music,
          color: style.color,
        }),
      ),
    );
    expect(signatures.size).toBe(4);

    const calm = getStyle('calm');
    const social = getStyle('social');
    const walkthrough = getStyle('walkthrough');
    const editorial = getStyle('editorial');

    expect(social.pacing.targetAvgShotSec).toBeLessThan(calm.pacing.targetAvgShotSec);
    expect(social.transitions.in).toBe('whip');
    expect(social.transitions.everyNthCut).toBe(2);
    expect(social.captions.style).toBe('bold_center');

    expect(walkthrough.pacing.maxShotSec).toBeGreaterThan(calm.pacing.maxShotSec);
    expect(walkthrough.transitions.in).toBe('slide');
    expect(walkthrough.overlays.roomLabel).toBeDefined();

    expect(editorial.captions.style).toBe('editorial_serif');
    expect(editorial.transitions.durationSec).toBeGreaterThan(calm.transitions.durationSec);
  });

  it('returns copies, so a caller cannot corrupt the registry', () => {
    const styles = listStyles();
    const first = styles[0];
    if (!first) throw new Error('expected at least one style pack');
    first.label = 'Mutated';
    expect(getStyle(first.id).label).not.toBe('Mutated');
  });

  it('throws E_STYLE_NOT_FOUND for an unknown id', () => {
    expect(() => getStyle('does-not-exist')).toThrow(/E_STYLE_NOT_FOUND/);

    try {
      getStyle('does-not-exist');
    } catch (error) {
      expect(error).toBeInstanceOf(StyleError);
      if (error instanceof StyleError) {
        expect(error.code).toBe('E_STYLE_NOT_FOUND');
        expect(error.issues).toEqual([]);
      }
    }
  });
});

describe('validateStyle', () => {
  it('accepts every shipped pack', () => {
    for (const style of listStyles()) {
      expect(validateStyle(style)).toEqual({ valid: true, issues: [] });
    }
  });

  it('reports readable issues for a malformed pack', () => {
    const style = getStyle('calm');
    const result = validateStyle({
      ...style,
      label: '',
      transitions: { ...style.transitions, in: 'crossfade' },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.join(' ')).toContain('label');
    expect(result.issues.join(' ')).toContain('crossfade');
  });

  it('rejects inverted or out-of-range pacing', () => {
    const style = getStyle('calm');
    const result = validateStyle({
      ...style,
      pacing: { minShotSec: 4, maxShotSec: 2, targetAvgShotSec: 5 },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('greater than');
  });

  it('rejects a non-object value without throwing', () => {
    expect(validateStyle(null).valid).toBe(false);
    expect(validateStyle('calm').valid).toBe(false);
  });
});

describe('applyStyle', () => {
  it('is pure and copies every nested value the planner may touch', () => {
    const request = makeRequest();
    const before = structuredClone(request);
    const applied = applyStyle(request, getStyle('social'));

    expect(request).toEqual(before);
    expect(applied).not.toBe(request);
    expect(applied.format).not.toBe(request.format);
    expect(applied.canvas).not.toBe(request.canvas);
    expect(applied.canvas.safeArea).not.toBe(request.canvas.safeArea);
    expect(applied.candidates).not.toBe(request.candidates);
    expect(applied.candidates[0]).not.toBe(request.candidates[0]);
    expect(applied.facts).not.toBe(request.facts);
    expect(applied.music).not.toBe(request.music);
    expect(applied.music.beatGrid).not.toBe(request.music.beatGrid);
  });

  it('sets the look from the pack and injects the resolved style', () => {
    const applied = applyStyle(makeRequest(), getStyle('social'));

    expect(applied.format.label).toBe('Cinematic hero');
    expect(applied.format.targetDurationSec).toBe(36);
    expect(applied.look).toEqual({ id: 'social', label: 'Social' });
    expect(applied.style).toMatchObject({
      id: 'social',
      label: 'Social',
      pacing: { minShotSec: 1.2, maxShotSec: 2.2, targetAvgShotSec: 1.7 },
      transitions: {
        in: 'whip',
        out: 'whip',
        durationSec: 0.22,
        everyNthCut: 2,
      },
      captions: { mode: 'burn', style: 'bold_center' },
      music: { mood: 'energetic', energy: 5 },
    });
  });

  it('clamps runaway pacing and transition duration', () => {
    const calm = getStyle('calm');
    const wild: StylePack = {
      ...calm,
      pacing: { minShotSec: -3, maxShotSec: 99, targetAvgShotSec: 42 },
      transitions: { ...calm.transitions, durationSec: 9 },
    };
    const applied = applyStyle(makeRequest(), wild);

    expect(applied.style.pacing).toEqual({
      minShotSec: 1,
      maxShotSec: 6,
      targetAvgShotSec: 6,
    });
    expect(applied.style.transitions.durationSec).toBe(1);
  });

  it('clamps tiny pacing and transition duration up to the floor', () => {
    const calm = getStyle('calm');
    const tiny: StylePack = {
      ...calm,
      pacing: { minShotSec: 0.1, maxShotSec: 0.2, targetAvgShotSec: 0.15 },
      transitions: { ...calm.transitions, durationSec: 0.01 },
    };
    const applied = applyStyle(makeRequest(), tiny);

    expect(applied.style.pacing).toEqual({
      minShotSec: 1,
      maxShotSec: 1,
      targetAvgShotSec: 1,
    });
    expect(applied.style.transitions.durationSec).toBe(0.2);
  });

  it('caps pacing at a short format target', () => {
    const request = makeRequest({
      format: { id: 'price_drop', label: 'Price drop', targetDurationSec: 3 },
    });
    const applied = applyStyle(request, getStyle('walkthrough'));

    expect(applied.style.pacing.maxShotSec).toBeLessThanOrEqual(3);
    expect(applied.style.pacing.minShotSec).toBeLessThanOrEqual(
      applied.style.pacing.targetAvgShotSec,
    );
    expect(applied.style.pacing.targetAvgShotSec).toBeLessThanOrEqual(
      applied.style.pacing.maxShotSec,
    );
  });
});

describe('EDL compatibility', () => {
  it('uses only transition enums the EDL schema accepts', () => {
    for (const style of listStyles()) {
      expect(EDL_TRANSITIONS).toContain(style.transitions.in);
      expect(EDL_TRANSITIONS).toContain(style.transitions.out);
    }
    expect([...TRANSITION_TYPES].sort()).toEqual([...EDL_TRANSITIONS].sort());
  });

  it('uses only caption modes and styles the EDL schema accepts', () => {
    for (const style of listStyles()) {
      expect(EDL_CAPTION_MODES).toContain(style.captions.mode);
      expect(EDL_CAPTION_STYLES).toContain(style.captions.style);
    }
    expect([...CAPTION_STYLES].sort()).toEqual([...EDL_CAPTION_STYLES].sort());
  });

  it('uses only overlay styles and animations the EDL schema accepts', () => {
    for (const style of listStyles()) {
      expect(EDL_OVERLAY_STYLES).toContain(style.overlays.price);
      expect(EDL_OVERLAY_STYLES).toContain(style.overlays.address);
      if (style.overlays.roomLabel !== undefined) {
        expect(EDL_OVERLAY_STYLES).toContain(style.overlays.roomLabel);
      }
      expect(EDL_OVERLAY_ANIMATIONS).toContain(style.overlays.introAnimation);
      expect(EDL_OVERLAY_ANIMATIONS).toContain(style.overlays.outroAnimation);
    }
    expect([...OVERLAY_STYLES].sort()).toEqual([...EDL_OVERLAY_STYLES].sort());
    expect([...OVERLAY_ANIMATIONS].sort()).toEqual([...EDL_OVERLAY_ANIMATIONS].sort());
  });

  it('uses ids the EDL look enum accepts', () => {
    for (const style of listStyles()) {
      expect(EDL_LOOKS).toContain(style.id);
    }
  });
});
