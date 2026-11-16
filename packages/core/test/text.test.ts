import { describe, expect, it } from 'vitest';
import type { TextStyle } from '../src/index';
import { OVERLAY_STYLES, estimateTextBox } from '../src/index';

function style(name: string): TextStyle {
  const found = OVERLAY_STYLES[name];
  if (!found) throw new Error(`Missing overlay style ${name}`);
  return found;
}

const price = style('price_lower');
const caption = style('caption');

describe('OVERLAY_STYLES', () => {
  it('defines the seven overlay styles', () => {
    expect(Object.keys(OVERLAY_STYLES).sort()).toEqual([
      'address_tag',
      'caption',
      'cta_card',
      'price_lower',
      'room_label',
      'small_print',
      'spec_pill',
    ]);
  });

  it('uses the documented size, advance, weight and padding', () => {
    expect(price).toEqual({ size: 96, advance: 0.58, weight: 700, pad: 18 });
    expect(style('cta_card')).toEqual({ size: 44, advance: 0.52, weight: 600, pad: 20 });
    expect(style('spec_pill')).toEqual({ size: 34, advance: 0.52, weight: 500, pad: 14 });
    expect(style('address_tag')).toEqual({ size: 32, advance: 0.52, weight: 500, pad: 12 });
    expect(style('room_label')).toEqual({ size: 40, advance: 0.5, weight: 500, pad: 10 });
    expect(caption).toEqual({ size: 40, advance: 0.5, weight: 500, pad: 0 });
    expect(style('small_print')).toEqual({ size: 24, advance: 0.52, weight: 400, pad: 6 });
  });
});

describe('estimateTextBox', () => {
  it('measures a price at price_lower on a 1080-wide canvas', () => {
    const box = estimateTextBox('£845,000', price, 1080);
    expect(box).toEqual({ w: 481, h: 146 });
  });

  it('returns whole pixels', () => {
    const box = estimateTextBox('£845,000', price, 1080);
    expect(Number.isInteger(box.w)).toBe(true);
    expect(Number.isInteger(box.h)).toBe(true);
  });

  it('keeps a short price well inside the canvas', () => {
    const box = estimateTextBox('£845,000', price, 1080);
    expect(box.w).toBeLessThan(1080);
    expect(box.h).toBeLessThan(1920);
    expect(box.h).toBeGreaterThan(0);
  });

  it('scales every dimension with the canvas width', () => {
    const full = estimateTextBox('£845,000', price, 1080);
    const half = estimateTextBox('£845,000', price, 540);
    expect(half.w).toBeLessThan(full.w);
    expect(half.h).toBeLessThan(full.h);
    expect(half.w).toBeCloseTo(full.w / 2, -1);
  });

  it('wraps very long text onto more lines, making the box taller', () => {
    const short = estimateTextBox('£845,000', price, 1080);
    const long = estimateTextBox(
      'Five bedroom detached house with a south-facing garden in Richmond',
      price,
      1080,
    );
    expect(long.h).toBeGreaterThan(short.h * 3);
    expect(long.w).toBeLessThanOrEqual(fullWidthCap(price, 1080));
  });

  it('wraps earlier when maxWidthPct is narrower', () => {
    const text = 'Five bedroom detached house with a south-facing garden in Richmond';
    const wide = estimateTextBox(text, price, 1080, 90);
    const narrow = estimateTextBox(text, price, 1080, 50);
    expect(narrow.h).toBeGreaterThan(wide.h);
    expect(narrow.w).toBeLessThan(wide.w);
  });

  it('defaults maxWidthPct to 90', () => {
    const text = 'Five bedroom detached house with a south-facing garden in Richmond';
    expect(estimateTextBox(text, price, 1080)).toEqual(estimateTextBox(text, price, 1080, 90));
  });

  it('measures a caption with zero padding', () => {
    const box = estimateTextBox('Two reception rooms', caption, 1080);
    expect(box.w).toBe(380);
    expect(box.h).toBe(46);
  });

  it('adds padding on both sides for a padded style', () => {
    const box = estimateTextBox('£1', price, 1080);
    expect(box.w).toBe(Math.round(2 * 55.68) + 36);
  });

  it('never returns a zero-sized box for empty text', () => {
    const box = estimateTextBox('', caption, 1080);
    expect(box.w).toBeGreaterThanOrEqual(1);
    expect(box.h).toBeGreaterThanOrEqual(1);
  });

  it('rejects a canvas width that is not positive', () => {
    expect(() => estimateTextBox('£845,000', price, 0)).toThrow(RangeError);
    expect(() => estimateTextBox('£845,000', price, -1080)).toThrow(RangeError);
    expect(() => estimateTextBox('£845,000', price, Number.NaN)).toThrow(RangeError);
  });

  it('rejects a maxWidthPct outside (0, 100]', () => {
    expect(() => estimateTextBox('£845,000', price, 1080, 0)).toThrow(RangeError);
    expect(() => estimateTextBox('£845,000', price, 1080, 101)).toThrow(RangeError);
  });
});

function fullWidthCap(font: TextStyle, canvasW: number): number {
  return (90 / 100) * canvasW + 2 * font.pad;
}
