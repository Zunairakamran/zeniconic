import { describe, expect, it } from 'vitest';
import { canvasFor, defaultCanvas, isProfileId } from '../src/canvas';
import { PROFILES } from '../../../packages/render/src/profiles';
import { VERTICAL, edl } from '../../../packages/overlays/test/helpers';

describe('canvasFor', () => {
  it('takes dimensions and fps from the profile', () => {
    const canvas = canvasFor(edl(), 'feed-portrait');
    expect(canvas.width).toBe(PROFILES['feed-portrait'].width);
    expect(canvas.height).toBe(PROFILES['feed-portrait'].height);
    expect(canvas.fps).toBe(PROFILES['feed-portrait'].fps);
  });

  it('rescales the EDL safe area instead of hardcoding 1080×1920', () => {
    const document = edl();
    const canvas = canvasFor(document, 'feed-portrait');
    expect(canvas.safeArea.top).toBe(Math.round(VERTICAL.safeArea.top * (1350 / 1920)));
    expect(canvas.safeArea.right).toBe(Math.round(VERTICAL.safeArea.right * (1080 / 1080)));
  });

  it('leaves an already matching EDL untouched', () => {
    const canvas = canvasFor(edl(), 'vertical-social');
    expect(canvas.safeArea).toEqual(VERTICAL.safeArea);
  });

  it('falls back to documented insets without an EDL', () => {
    expect(defaultCanvas('landscape').safeArea).toEqual({ top: 60, bottom: 90, left: 60, right: 60 });
    expect(canvasFor(null, 'vertical-social').height).toBe(1920);
  });

  it('guards profile ids from the CLI', () => {
    expect(isProfileId('vertical-social')).toBe(true);
    expect(isProfileId('square')).toBe(false);
  });
});
