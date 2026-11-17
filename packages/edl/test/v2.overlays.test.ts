import { describe, expect, it } from 'vitest';
import { validateEdl } from '../src/index';
import type { OverlayAnimation, OverlayExitAnimation } from '../src/index';
import { asJson, codes, expectIssue, overlayAt, v2Edl } from './helpers';

describe('v2 overlays — happy path', () => {
  it('accepts the full v2 overlay block', () => {
    const edl = v2Edl();
    const overlay = overlayAt(edl, 0);
    overlay.animation = 'typewriter';
    overlay.exitAnimation = 'slide_out';
    overlay.font = { family: 'Inter', weight: 700, sizePx: 48 };
    overlay.color = '#FFFFFF';
    overlay.background = { color: '#111111', opacity: 0.7, radiusPx: 10 };
    overlay.rotation = 4;
    overlay.keyframes = [
      { t: 0, x: 0.5, y: 0.8, scale: 0.9, opacity: 0 },
      { t: 0.2, opacity: 1 },
      { t: 1, x: 0.5, y: 0.78, scale: 1, opacity: 1, rotation: 4 },
    ];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it.each(['none', 'fade', 'rise', 'slide_in', 'count_up', 'pop', 'typewriter', 'tracking_in', 'blur_in', 'scale_in'] as OverlayAnimation[])(
    'accepts the %s animation',
    (animation) => {
      const edl = v2Edl();
      overlayAt(edl, 1).animation = animation;
      expect(validateEdl(edl).valid).toBe(true);
    },
  );

  it.each(['none', 'fade', 'slide_out'] as OverlayExitAnimation[])('accepts the %s exit animation', (exitAnimation) => {
    const edl = v2Edl();
    overlayAt(edl, 1).exitAnimation = exitAnimation;
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('accepts a single-keyframe hold', () => {
    const edl = v2Edl();
    overlayAt(edl, 2).keyframes = [{ t: 0, scale: 1.1 }];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });
});

describe('v2 overlays — stable codes', () => {
  it('reports E_TEXT_ANIMATION for an unknown overlay animation', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    const overlays = raw['overlays'] as Array<Record<string, unknown>>;
    overlays[0] = { ...overlays[0], animation: 'bounce' };

    const result = validateEdl(raw);
    expectIssue(result, 'E_TEXT_ANIMATION', '/overlays/0/animation');
    expect(codes(result)).toContain('E_SCHEMA');
  });

  it('reports E_TEXT_ANIMATION for an unknown exit animation', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    const overlays = raw['overlays'] as Array<Record<string, unknown>>;
    overlays[0] = { ...overlays[0], exitAnimation: 'zoom_out' };

    const result = validateEdl(raw);
    expectIssue(result, 'E_TEXT_ANIMATION', '/overlays/0/exitAnimation');
  });

  it('reports E_OVERLAY_KEYFRAME when t does not strictly increase', () => {
    const edl = v2Edl();
    overlayAt(edl, 0).keyframes = [
      { t: 0, opacity: 0 },
      { t: 0.5, opacity: 1 },
      { t: 0.5, opacity: 1 },
      { t: 1, opacity: 0 },
    ];

    expectIssue(validateEdl(edl), 'E_OVERLAY_KEYFRAME', '/overlays/0/keyframes/2/t');
  });

  it('bounds keyframe values', () => {
    const edl = v2Edl();
    overlayAt(edl, 0).keyframes = [
      { t: 0, x: 1.2, y: -0.1, scale: 0.05, opacity: 1.4, rotation: 200 },
    ];

    const result = validateEdl(edl);
    for (const field of ['x', 'y', 'scale', 'opacity', 'rotation']) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'E_OVERLAY_KEYFRAME', path: `/overlays/0/keyframes/0/${field}` }),
      );
    }
  });

  it('bounds keyframe t to 0..1', () => {
    const edl = v2Edl();
    overlayAt(edl, 0).keyframes = [{ t: 1.5, opacity: 1 }];

    expectIssue(validateEdl(edl), 'E_OVERLAY_KEYFRAME', '/overlays/0/keyframes/0/t');
  });

  it('bounds the overlay rotation', () => {
    const edl = v2Edl();
    overlayAt(edl, 0).rotation = -200;

    expectIssue(validateEdl(edl), 'E_OVERLAY_KEYFRAME', '/overlays/0/rotation');
  });

  it('still reports E_OVERLAY_RANGE for an overlay that leaves the timeline', () => {
    const edl = v2Edl();
    overlayAt(edl, 2).outSec = 31;

    expectIssue(validateEdl(edl), 'E_OVERLAY_RANGE', '/overlays/2/outSec');
  });
});
