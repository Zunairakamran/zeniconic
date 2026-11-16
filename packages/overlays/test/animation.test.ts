import { describe, expect, it } from 'vitest';
import { animationSpec, countUpText, isEndCardHold } from '../src/index';

describe('animationSpec', () => {
  it('converts the spec durations to frames', () => {
    expect(animationSpec('fade', 30, 1).enterFrames).toBe(7); // 240 ms
    expect(animationSpec('rise', 30, 1).enterFrames).toBe(10); // 320 ms
    expect(animationSpec('slide_in', 30, 1).enterFrames).toBe(8); // 280 ms
    expect(animationSpec('count_up', 30, 1).enterFrames).toBe(18); // 600 ms
  });

  it('scales travel with the canvas, not with pixels at 1080', () => {
    expect(animationSpec('rise', 30, 1).travelPx).toBe(12);
    expect(animationSpec('rise', 30, 0.5).travelPx).toBe(6);
    expect(animationSpec('slide_in', 30, 1).travelPx).toBe(24);
  });

  it('treats none as static', () => {
    expect(animationSpec('none', 30, 1)).toEqual({ enterFrames: 0, travelPx: 0, countUp: false });
  });
});

describe('isEndCardHold', () => {
  it('blocks an entrance inside the last 200 ms', () => {
    expect(isEndCardHold(300, 300, 30)).toBe(true);
    expect(isEndCardHold(295, 300, 30)).toBe(true);
    expect(isEndCardHold(293, 300, 30)).toBe(false);
    expect(isEndCardHold(0, 300, 30)).toBe(false);
  });
});

describe('countUpText', () => {
  it('counts the price up and then returns the original exactly', () => {
    expect(countUpText('AED 1,850,000', 0)).toBe('AED 0');
    expect(countUpText('AED 1,850,000', 0.5)).toBe('AED 925,000');
    expect(countUpText('AED 1,850,000', 1)).toBe('AED 1,850,000');
  });

  it('keeps a suffix and non-numeric text intact', () => {
    expect(countUpText('£845,000 guide', 1)).toBe('£845,000 guide');
    expect(countUpText('Price on application', 0.5)).toBe('Price on application');
  });

  it('keeps decimal places', () => {
    expect(countUpText('1,240.5 sq ft', 0.5)).toBe('620.3 sq ft');
  });

  it('clamps progress outside 0–1', () => {
    expect(countUpText('10 units', -1)).toBe('0 units');
    expect(countUpText('10 units', 4)).toBe('10 units');
  });
});
