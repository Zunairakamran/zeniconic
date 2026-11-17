import { describe, expect, it } from 'vitest';
import { validateEdl } from '../src/index';
import type { CaptionAnchor, Captions, TextAnimation } from '../src/index';
import { asJson, codes, expectIssue, v2Edl } from './helpers';

function captionBlock(patch: Partial<Captions>): Captions {
  const edl = v2Edl();
  return { ...edl.captions, ...patch };
}

describe('v2 captions — happy path', () => {
  it('accepts the full v2 caption block', () => {
    const edl = v2Edl();
    edl.captions = captionBlock({
      animation: 'word_by_word',
      highlight: { color: '#FFD166', words: ['Oak', 'avenue'] },
      font: { family: 'Inter', weight: 700, sizePx: 54, uppercase: true },
      box: { color: '#000000', opacity: 0.6, radiusPx: 12 },
      position: { anchor: 'bottom_center', offsetPx: -80 },
      maxWordsPerLine: 4,
      maxLines: 2,
    });

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it.each([
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
  ] as TextAnimation[])('accepts the %s animation', (animation) => {
    const edl = v2Edl();
    edl.captions = captionBlock({ animation });

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('accepts highlight words regardless of case and punctuation', () => {
    const edl = v2Edl();
    edl.captions = captionBlock({ highlight: { words: ['oak', 'AVENUE.'] } });

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('accepts the cue-builder limits 6/2 and the extremes 8/3', () => {
    for (const [maxWordsPerLine, maxLines] of [
      [6, 2],
      [1, 1],
      [8, 3],
    ]) {
      const edl = v2Edl();
      edl.captions = captionBlock({ maxWordsPerLine, maxLines });
      expect(validateEdl(edl).valid).toBe(true);
    }
  });
});

describe('v2 captions — stable codes', () => {
  it('reports E_TEXT_ANIMATION for an unknown animation', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    raw['captions'] = { ...(raw['captions'] as Record<string, unknown>), animation: 'bounce' };

    const result = validateEdl(raw);
    expectIssue(result, 'E_TEXT_ANIMATION', '/captions/animation');
    expect(codes(result)).toContain('E_SCHEMA');
  });

  it.each([
    ['maxWordsPerLine', 9],
    ['maxWordsPerLine', 0],
    ['maxWordsPerLine', 2.5],
    ['maxLines', 4],
    ['maxLines', 0],
  ] as const)('reports E_CAPTION_STYLE for %s = %s', (field, value) => {
    const edl = v2Edl();
    edl.captions = captionBlock({ [field]: value } as Partial<Captions>);

    expectIssue(validateEdl(edl), 'E_CAPTION_STYLE', `/captions/${field}`);
  });

  it('reports E_CAPTION_STYLE when a highlighted word is not in the cues', () => {
    const edl = v2Edl();
    edl.captions = captionBlock({ highlight: { words: ['Oak', 'garden'] } });

    expectIssue(validateEdl(edl), 'E_CAPTION_STYLE', '/captions/highlight/words/1');
  });

  it('reports E_CAPTION_STYLE for a malformed highlight colour', () => {
    const edl = v2Edl();
    edl.captions = captionBlock({ highlight: { color: 'warm' } });

    expectIssue(validateEdl(edl), 'E_CAPTION_STYLE', '/captions/highlight/color');
  });

  it('reports E_CAPTION_STYLE for font and box ranges', () => {
    const cases = [
      [{ family: 'Inter', weight: 50 }, '/captions/font/weight'],
      [{ family: 'Inter', sizePx: 500 }, '/captions/font/sizePx'],
    ] as const;
    for (const [font, path] of cases) {
      const edl = v2Edl();
      edl.captions = captionBlock({ font: { ...font } });
      expectIssue(validateEdl(edl), 'E_CAPTION_STYLE', path);
    }

    const boxEdl = v2Edl();
    boxEdl.captions = captionBlock({ box: { opacity: 1.5, radiusPx: -2, color: 'black' } });
    const boxResult = validateEdl(boxEdl);
    expect(boxResult.issues).toContainEqual(
      expect.objectContaining({ code: 'E_CAPTION_STYLE', path: '/captions/box/opacity' }),
    );
    expect(boxResult.issues).toContainEqual(
      expect.objectContaining({ code: 'E_CAPTION_STYLE', path: '/captions/box/radiusPx' }),
    );
    expect(boxResult.issues).toContainEqual(
      expect.objectContaining({ code: 'E_CAPTION_STYLE', path: '/captions/box/color' }),
    );
  });

  it('reports E_CAPTION_STYLE for an unknown anchor and an extreme offset', () => {
    const edl = v2Edl();
    edl.captions = captionBlock({ position: { anchor: 'middle' as CaptionAnchor, offsetPx: 2000 } });

    const result = validateEdl(edl);
    expectIssue(result, 'E_CAPTION_STYLE', '/captions/position/anchor');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'E_CAPTION_STYLE', path: '/captions/position/offsetPx' }),
    );
  });
});
