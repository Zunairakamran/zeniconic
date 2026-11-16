import { describe, expect, it } from 'vitest';
import { cropAt, cropTransform } from '../src/crop';
import { clip } from '../../../packages/overlays/test/helpers';

describe('cropAt', () => {
  it('interpolates the crop path linearly', () => {
    const shot = clip({
      transform: {
        mode: 'cover',
        focus: 'saliency',
        path: [
          { t: 0, x: 0.4, y: 0.5, scale: 1 },
          { t: 1, x: 0.6, y: 0.4, scale: 1.2 },
        ],
      },
    });

    expect(cropAt(shot, 0)).toMatchObject({ x: 0.4, y: 0.5, scale: 1 });
    expect(cropAt(shot, 0.5)).toMatchObject({ x: 0.5, y: 0.45, scale: 1.1 });
    expect(cropAt(shot, 1)).toMatchObject({ x: 0.6, y: 0.4, scale: 1.2 });
  });

  it('clamps progress outside the clip', () => {
    const shot = clip({
      transform: {
        mode: 'cover',
        focus: 'center',
        path: [
          { t: 0, x: 0.5, y: 0.5, scale: 1.1 },
          { t: 1, x: 0.5, y: 0.5, scale: 1.2 },
        ],
      },
    });
    expect(cropAt(shot, -1).scale).toBe(1.1);
    expect(cropAt(shot, 2).scale).toBe(1.2);
  });

  it('uses the focus point when the path is empty', () => {
    const shot = clip({ transform: { mode: 'cover', focus: 'right', path: [] } });
    expect(cropAt(shot, 0.4)).toMatchObject({ x: 0.65, y: 0.5, scale: 1 });
  });
});

describe('cropTransform', () => {
  it('keeps the requested point at the viewport centre', () => {
    expect(cropTransform({ x: 0.5, y: 0.5, scale: 1.1 })).toBe(
      'translate(0.0000%, 0.0000%) scale(1.1000)',
    );
    expect(cropTransform({ x: 0.6, y: 0.4, scale: 1.1 })).toBe(
      'translate(-11.0000%, 11.0000%) scale(1.1000)',
    );
  });
});
