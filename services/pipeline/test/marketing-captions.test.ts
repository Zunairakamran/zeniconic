/**
 * Regression: `renderMarketingFilm` used to build its ASS from
 * `marketingCaptionCues`, its own "six words a line, two lines" wrapper that
 * ignored the EDL preset. It now feeds the caption engine's
 * `captionEngineCuesForExport`, so the ASS uses the style's max characters per
 * line and max lines. Before the fix a long word stream could become one giant
 * line on the marketing path regardless of the preset.
 *
 * The companion defect lived in `packages/render/src/graph.ts`: a
 * `force_style` on the `subtitles=` filter overrode the ASS stylesheet and
 * forced FontSize=18 — every preset rendered tiny. See
 * `packages/render/test/captions-graph.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import example from '../../../packages/edl/example.edl.json';
import type { Edl } from '../../../packages/edl/src/index';
import {
  buildAssDocument,
  captionEngineCuesForExport,
  captionStyleForEdl,
} from '../ffmpeg-overlays';
import { buildGraphForRender, PROFILES } from '../../../packages/render/src/index';

const EDL = example as unknown as Edl;

const PHRASE = [
  { text: 'Bathroom.', startSec: 0.2, endSec: 0.45 },
  { text: 'Offered', startSec: 0.45, endSec: 0.7 },
  { text: 'At', startSec: 0.7, endSec: 0.85 },
  { text: 'AED', startSec: 0.85, endSec: 1.05 },
  { text: '1,400,000.', startSec: 1.05, endSec: 1.7 },
];

/** The same voice with more to say: one dense stream that must split. */
const LONG_STREAM = [
  ...PHRASE.slice(0, 4),
  { text: '1,400,000', startSec: 1.05, endSec: 1.4 },
  { text: 'Fully', startSec: 1.4, endSec: 1.7 },
  { text: 'Renovated', startSec: 1.7, endSec: 2.0 },
  { text: 'With', startSec: 2.0, endSec: 2.2 },
  { text: 'Private', startSec: 2.2, endSec: 2.5 },
  { text: 'Garden', startSec: 2.5, endSec: 2.8 },
  { text: 'And', startSec: 2.8, endSec: 3.0 },
  { text: 'Sea', startSec: 3.0, endSec: 3.2 },
  { text: 'Views.', startSec: 3.2, endSec: 3.6 },
];

/**
 * One 8 s clip, so no cue is split by a scene cut and the character budget is
 * the only thing that can break a cue.
 */
function singleScene(
  words: ReadonlyArray<{ text: string; startSec: number; endSec: number }>,
  style = 'luxury_gold',
): Edl {
  const edl = structuredClone(EDL);
  const clip = edl.clips[0];
  if (clip === undefined) throw new Error('example.edl.json has no clips');
  clip.inSec = 0;
  clip.outSec = 8;
  clip.speed = 1;
  clip.transitionIn = { type: 'cut', durationSec: 0 };
  clip.transitionOut = { type: 'cut', durationSec: 0 };
  delete clip.handleOutSec;
  edl.clips = [clip];
  edl.format.targetDurationSec = 8;
  edl.captions = {
    ...edl.captions,
    mode: 'burn',
    style: style as Edl['captions']['style'],
    words: words as Edl['captions']['words'],
  };
  return edl;
}

/** Dialogue lines, with ASS override tags stripped and hard breaks split. */
function dialogueTextLines(ass: string): string[] {
  return ass
    .split('\n')
    .filter((line) => line.startsWith('Dialogue:'))
    .flatMap((line) => {
      const close = line.indexOf('}');
      const text = close === -1 ? line : line.slice(close + 1);
      return text.split('\\N');
    })
    .map((line) => line.replace(/\{[^}]*\}/g, '').trim())
    .filter((line) => line.length > 0);
}

function styleLine(ass: string): string {
  const line = ass.split('\n').find((entry) => entry.startsWith('Style: ZenCaption,'));
  if (line === undefined) throw new Error('No caption style emitted');
  return line;
}

describe('marketing captions use the EDL preset, not a hardcoded wrapper', () => {
  it('splits the long word stream at the style character budget', () => {
    const edl = singleScene(LONG_STREAM);
    const style = captionStyleForEdl(edl);
    expect(style.id).toBe('luxury_gold');
    expect(style.maxCharsPerLine).toBe(22);
    expect(style.maxLines).toBe(2);

    const cues = captionEngineCuesForExport(edl);
    expect(cues.length).toBeGreaterThan(1);

    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(style.maxLines);
      expect(cue.lines.length).toBeGreaterThan(0);
      for (const line of cue.lines) {
        // A single unsplittable word may overflow; nothing here is that long.
        expect(line.length, line).toBeLessThanOrEqual(style.maxCharsPerLine);
      }
    }

    // The whole stream never survives as one line.
    const allLines = cues.flatMap((cue) => cue.lines);
    const wholeStream = LONG_STREAM.map((word) => word.text).join(' ');
    expect(allLines).not.toContain(wholeStream);
    expect(Math.max(...allLines.map((line) => line.length))).toBeLessThanOrEqual(
      style.maxCharsPerLine,
    );
    // No word was silently dropped while regrouping.
    expect(allLines.join(' ').split(/\s+/)).toHaveLength(LONG_STREAM.length);
  });

  it('wraps the price claim into two short lines, not one giant line', () => {
    const edl = singleScene(PHRASE);
    const style = captionStyleForEdl(edl);
    const cues = captionEngineCuesForExport(edl);
    const priceCue = cues[cues.length - 1];

    expect(priceCue?.lines).toEqual(['Offered At', 'AED 1,400,000.']);
    expect(priceCue?.lines.length).toBeLessThanOrEqual(style.maxLines);
    for (const line of priceCue?.lines ?? []) {
      expect(line.length).toBeLessThanOrEqual(style.maxCharsPerLine);
    }
    // "Offered At AED 1,400,000." is one line only on the broken path.
    expect(cues.flatMap((cue) => cue.lines)).not.toContain('Offered At AED 1,400,000.');
  });

  it('writes the preset font size into the ASS Style line, not 18', () => {
    const edl = singleScene(PHRASE);
    const cues = captionEngineCuesForExport(edl);
    const ass = buildAssDocument(edl, cues, 'vertical-social');
    const style = styleLine(ass);
    const fields = style.split(',');

    expect(style).toContain('Style: ZenCaption,DM Serif Display,68,');
    expect(fields[2]).toBe('68');
    expect(fields[2]).not.toBe('18');
    expect(style).not.toMatch(/FontName=Archivo/);
  });

  it('burns that ASS through a filter graph with no style override', () => {
    const edl = singleScene(PHRASE);
    const profile = PROFILES['vertical-social'];
    const graph = buildGraphForRender(edl, profile, 'data/marketing/marketing.ass').graph;

    expect(graph).toContain("subtitles='data/marketing/marketing.ass'");
    expect(graph).not.toMatch(/force_style/i);
    expect(graph).not.toContain('FontSize=18');
  });

  it('keeps every ASS dialogue line inside the style budget', () => {
    const edl = singleScene(LONG_STREAM);
    const style = captionStyleForEdl(edl);
    const ass = buildAssDocument(edl, captionEngineCuesForExport(edl), 'vertical-social');
    const lines = dialogueTextLines(ass);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(style.maxCharsPerLine);
    }
  });
});
