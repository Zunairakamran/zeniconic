import { describe, expect, it } from 'vitest';
import type { Anchor, Rect, SafeArea, Size } from '../src/index';
import { placeOverlay, safeRect } from '../src/index';

const VERTICAL: Size = { w: 1080, h: 1920 };
const VERTICAL_SAFE: SafeArea = { top: 250, bottom: 340, left: 60, right: 120 };
const LANDSCAPE: Size = { w: 1920, h: 1080 };
const LANDSCAPE_SAFE: SafeArea = { top: 60, bottom: 90, left: 60, right: 60 };

function inside(rect: Rect, canvas: Size, safe: SafeArea): boolean {
  return (
    rect.x >= safe.left &&
    rect.y >= safe.top &&
    rect.x + rect.w <= canvas.w - safe.right &&
    rect.y + rect.h <= canvas.h - safe.bottom
  );
}

describe('safeRect', () => {
  it('insets the vertical-social canvas by its platform safe area', () => {
    expect(safeRect(1080, 1920, VERTICAL_SAFE)).toEqual({ x: 60, y: 250, w: 900, h: 1330 });
  });

  it('insets the landscape canvas by its platform safe area', () => {
    expect(safeRect(1920, 1080, LANDSCAPE_SAFE)).toEqual({ x: 60, y: 60, w: 1800, h: 930 });
  });

  it('accepts a zero inset on every edge', () => {
    expect(safeRect(100, 50, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
  });

  it('rejects a safe area that leaves no width', () => {
    expect(() => safeRect(100, 100, { top: 10, bottom: 10, left: 50, right: 50 })).toThrow(
      RangeError,
    );
    expect(() => safeRect(100, 100, { top: 10, bottom: 10, left: 90, right: 20 })).toThrow(
      RangeError,
    );
  });

  it('rejects a safe area that leaves no height', () => {
    expect(() => safeRect(100, 100, { top: 60, bottom: 40, left: 10, right: 10 })).toThrow(
      RangeError,
    );
  });

  it('rejects a canvas with no area', () => {
    expect(() => safeRect(0, 100, VERTICAL_SAFE)).toThrow(RangeError);
    expect(() => safeRect(100, -1, VERTICAL_SAFE)).toThrow(RangeError);
  });

  it('rejects negative insets', () => {
    expect(() => safeRect(1080, 1920, { ...VERTICAL_SAFE, top: -1 })).toThrow(RangeError);
  });
});

describe('placeOverlay', () => {
  const box: Size = { w: 300, h: 100 };
  const expected: Record<Anchor, Rect> = {
    top_left: { x: 60, y: 250, w: 300, h: 100 },
    top_center: { x: 360, y: 250, w: 300, h: 100 },
    top_right: { x: 660, y: 250, w: 300, h: 100 },
    center: { x: 360, y: 865, w: 300, h: 100 },
    bottom_left: { x: 60, y: 1480, w: 300, h: 100 },
    bottom_center: { x: 360, y: 1480, w: 300, h: 100 },
    bottom_right: { x: 660, y: 1480, w: 300, h: 100 },
  };

  it('places each of the seven anchors at its documented corner', () => {
    for (const anchor of Object.keys(expected) as Anchor[]) {
      const placement = placeOverlay(box, anchor, VERTICAL, VERTICAL_SAFE);
      expect(placement.rect).toEqual(expected[anchor]);
      expect(placement.valid).toBe(true);
      expect(placement.reasons).toEqual([]);
    }
  });

  it('keeps all seven anchors inside the safe area', () => {
    const anchors: Anchor[] = [
      'top_left',
      'top_center',
      'top_right',
      'center',
      'bottom_left',
      'bottom_center',
      'bottom_right',
    ];

    for (const anchor of anchors) {
      const { rect, valid } = placeOverlay(box, anchor, VERTICAL, VERTICAL_SAFE);
      expect(valid).toBe(true);
      expect(inside(rect, VERTICAL, VERTICAL_SAFE)).toBe(true);
    }
  });

  it('centres the center anchor inside the safe rect', () => {
    const { rect } = placeOverlay({ w: 400, h: 200 }, 'center', VERTICAL, VERTICAL_SAFE);
    expect(rect).toEqual({ x: 310, y: 815, w: 400, h: 200 });
  });

  it('reports an oversized-width box instead of clamping it', () => {
    const wide = placeOverlay({ w: 1000, h: 120 }, 'top_left', VERTICAL, VERTICAL_SAFE);
    expect(wide.valid).toBe(false);
    expect(wide.reasons).toContain('too_wide');
    expect(wide.rect.w).toBe(1000);
  });

  it('reports an oversized-height box instead of clamping it', () => {
    const tall = placeOverlay({ w: 200, h: 1400 }, 'top_left', VERTICAL, VERTICAL_SAFE);
    expect(tall.valid).toBe(false);
    expect(tall.reasons).toContain('too_tall');
    expect(tall.rect.h).toBe(1400);
  });

  it('keeps a fitting box inside the asymmetric safe area when centred', () => {
    const placement = placeOverlay({ w: 880, h: 100 }, 'center', VERTICAL, VERTICAL_SAFE);
    expect(placement.valid).toBe(true);
    expect(placement.reasons).toEqual([]);
  });

  it('reports both size and bounds reasons for a box larger than the safe area', () => {
    const placement = placeOverlay({ w: 2000, h: 2000 }, 'bottom_right', VERTICAL, VERTICAL_SAFE);
    expect(placement.valid).toBe(false);
    expect(placement.reasons).toContain('too_wide');
    expect(placement.reasons).toContain('too_tall');
    expect(placement.reasons).toContain('out_of_bounds');
  });

  it('accepts an overlay exactly the size of the safe rect', () => {
    const placement = placeOverlay({ w: 900, h: 1330 }, 'top_left', VERTICAL, VERTICAL_SAFE);
    expect(placement.valid).toBe(true);
    expect(placement.rect).toEqual({ x: 60, y: 250, w: 900, h: 1330 });
  });

  it('works on the landscape profile', () => {
    const placement = placeOverlay({ w: 600, h: 200 }, 'bottom_right', LANDSCAPE, LANDSCAPE_SAFE);
    expect(placement.rect).toEqual({ x: 1260, y: 790, w: 600, h: 200 });
    expect(placement.valid).toBe(true);
  });

  it('rejects a negative box size', () => {
    expect(() => placeOverlay({ w: -1, h: 10 }, 'center', VERTICAL, VERTICAL_SAFE)).toThrow(
      RangeError,
    );
  });
});
