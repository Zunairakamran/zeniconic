/**
 * The packaged overlay path: ASS tokens, Windows escaping and safe-area maths.
 * No FFmpeg runs here; `scripts/qa-ffmpeg-overlays.ts` burns the real listing.
 */

import { describe, expect, it } from 'vitest';
import example from '../../../packages/edl/example.edl.json';
import type { Edl } from '../../../packages/edl/src/index';
import {
  buildAssDocument,
  captionCuesForExport,
  escapeFilterPath,
  planDrawTexts,
  resolveFontsDirectory,
} from '../ffmpeg-overlays';

const EDL = example as unknown as Edl;

describe('ffmpeg overlays — captions', () => {
  it('uses Bricolage Grotesque 800 at 76 px with the safe-area bottom margin', () => {
    const cues = captionCuesForExport(EDL);
    expect(cues.length).toBeGreaterThan(0);

    const ass = buildAssDocument(EDL, cues, 'vertical-social');
    expect(ass).toContain('Style: ZenCaption,Bricolage Grotesque,76,');
    // Alignment 2 is bottom-centre; MarginV is the 340 px vertical inset.
    const style = ass.split('\n').find((line) => line.startsWith('Style: ZenCaption,'));
    expect(style).toBeDefined();
    const fields = style!.split(',');
    expect(fields[18]).toBe('2');
    expect(fields[21]).toBe('340');
    // Uppercase, centred cues; BorderStyle 1 is outline + shadow, no plate.
    expect(ass).toMatch(/Dialogue: 0,[^,]+,[^,]+,ZenCaption,,0,0,0,,\{\\blur2\}[A-Z0-9]/);
    expect(fields[15]).toBe('1');
    expect(fields[17]).toBe('2');
  });

  it('scales the caption size to a landscape canvas', () => {
    const cues = captionCuesForExport(EDL);
    const ass = buildAssDocument(EDL, cues, 'landscape');
    // 76 px at 1080 wide → 135 px at 1920 wide.
    expect(ass).toContain('Style: ZenCaption,Bricolage Grotesque,135,');
  });
});

describe('ffmpeg overlays — paths', () => {
  it('escapes a Windows drive path for the filter parser', () => {
    expect(escapeFilterPath('D:\\Zeniconic\\fonts\\Archivo.ttf')).toBe(
      'D\\:/Zeniconic/fonts/Archivo.ttf',
    );
    expect(escapeFilterPath("C:\\it's here\\a.ass")).toContain("\\'");
  });

  it('resolves the unpacked font directory in a packaged app', () => {
    expect(resolveFontsDirectory('C:\\Program Files\\Zeniconic\\resources\\app.asar')).toBe(
      'C:\\Program Files\\Zeniconic\\resources\\app.asar.unpacked\\apps\\desktop\\electron\\assets\\fonts',
    );
    expect(resolveFontsDirectory('D:\\video')).toBe(
      'D:\\video\\apps\\desktop\\electron\\assets\\fonts',
    );
  });
});

describe('ffmpeg overlays — drawtext plan', () => {
  it('keeps every card inside the landscape safe area', () => {
    const cues = captionCuesForExport(EDL);
    const specs = planDrawTexts({
      edl: EDL,
      profile: 'landscape',
      cues,
      facts: {
        address: 'Marina Gate 1, Dubai Marina',
        price: '1,850,000',
        currency: 'AED',
        beds: 3,
        baths: 2,
      },
      brand: { agentName: 'Sara Whitfield', agency: 'Whitfield & Co', orn: '67890' },
    });

    const ids = specs.map((spec) => spec.id);
    expect(ids).toEqual(['address', 'price', 'spec', 'permit', 'agent']);

    for (const spec of specs) {
      expect(spec.y).toBeGreaterThanOrEqual(60);
      expect(spec.y).toBeLessThanOrEqual(1080 - 90);
      expect(spec.inSec).toBeGreaterThanOrEqual(0);
      expect(spec.outSec).toBeLessThanOrEqual(EDL.format.targetDurationSec);
    }

    const price = specs.find((spec) => spec.id === 'price');
    // The EDL's own price card wins over the facts fallback.
    expect(price?.text).toContain('845,000');
    const permit = specs.find((spec) => spec.id === 'permit');
    expect(permit?.text).toBe('ORN 67890');
    expect(permit?.opacity).toBeLessThan(0.8);
  });

  it('omits the agent and permit when the brand kit has neither', () => {
    const specs = planDrawTexts({ edl: EDL, profile: 'vertical-social', cues: [] });
    expect(specs.some((spec) => spec.id === 'agent')).toBe(false);
    expect(specs.some((spec) => spec.id === 'permit')).toBe(false);
  });
});
