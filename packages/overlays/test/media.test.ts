import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOURS,
  fallbackGradient,
  hashString,
  permitText,
  resolveColours,
  staticMediaPath,
} from '../src/index';

const LISTING = 'D:/video/data/listings/2026-11-14-14-oak-avenue';

describe('staticMediaPath', () => {
  it('accepts a path relative to the listing workspace', () => {
    expect(staticMediaPath('raw/01_exterior.mp4', LISTING)).toBe('raw/01_exterior.mp4');
    expect(staticMediaPath('./cache/seg/seg_9f3c.mp4', LISTING)).toBe('cache/seg/seg_9f3c.mp4');
  });

  it('normalises Windows separators', () => {
    expect(staticMediaPath('raw\\01_exterior.mp4', LISTING)).toBe('raw/01_exterior.mp4');
    expect(staticMediaPath(`${LISTING}\\raw\\01_exterior.mp4`, LISTING)).toBe('raw/01_exterior.mp4');
  });

  it('matches the listing prefix case-insensitively', () => {
    const windowsPath = 'd:\\VIDEO\\data\\listings\\2026-11-14-14-oak-avenue\\raw\\a.mp4';
    expect(staticMediaPath(windowsPath, LISTING)).toBe('raw/a.mp4');
  });

  it('refuses absolute paths outside the listing', () => {
    expect(staticMediaPath('D:/video/data/fixtures/bars.mp4', LISTING)).toBeNull();
    expect(staticMediaPath('/etc/passwd', LISTING)).toBeNull();
    expect(staticMediaPath('C:\\Windows\\win.ini', LISTING)).toBeNull();
  });

  it('refuses remote and non-file schemes', () => {
    expect(staticMediaPath('https://example.com/a.mp4', LISTING)).toBeNull();
    expect(staticMediaPath('data:video/mp4;base64,AAAA', LISTING)).toBeNull();
  });

  it('refuses parent traversal', () => {
    expect(staticMediaPath('raw/../../secret.mp4', LISTING)).toBeNull();
    expect(staticMediaPath('..\\secret.mp4', LISTING)).toBeNull();
  });
});

describe('brand kit', () => {
  it('falls back to the design tokens', () => {
    expect(resolveColours(undefined)).toEqual(DEFAULT_COLOURS);
    expect(resolveColours({ agentName: 'Sara', agency: 'Co' }).brass).toBe('#B08A4A');
  });

  it('honours a partial palette', () => {
    const colours = resolveColours({
      agentName: 'Sara',
      agency: 'Co',
      colours: { brass: '#123456' },
    });
    expect(colours.brass).toBe('#123456');
    expect(colours.paper).toBe(DEFAULT_COLOURS.paper);
  });

  it('only produces a permit line when an ORN is present', () => {
    expect(permitText({ agentName: 'Sara', agency: 'Co' })).toBeNull();
    expect(permitText({ agentName: 'Sara', agency: 'Co', orn: ' 67890 ' })).toBe('ORN 67890');
  });
});

describe('fallbackGradient', () => {
  it('is deterministic for the same seed', () => {
    expect(fallbackGradient('c01')).toEqual(fallbackGradient('c01'));
    expect(hashString('c01')).toBe(hashString('c01'));
  });

  it('differs between clips and stays warm', () => {
    expect(fallbackGradient('c01')).not.toEqual(fallbackGradient('c02'));
    const { from } = fallbackGradient('c03');
    const hue = Number(/hsl\((\d+)/.exec(from)?.[1] ?? '0');
    expect(hue).toBeGreaterThanOrEqual(18);
    expect(hue).toBeLessThanOrEqual(54);
  });
});
