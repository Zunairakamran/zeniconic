/**
 * The packaged overlay path: ASS wiring, style/animation pass-through, Windows
 * escaping and safe-area maths. No FFmpeg runs here; `scripts/qa-caption-render.ts`
 * burns a real 1080×1920 clip and inspects the pixels.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import example from '../../../packages/edl/example.edl.json';
import type { Cue } from '../../../packages/captions/src/index';
import type { Edl } from '../../../packages/edl/src/index';
import {
  ASS_TYPEWRITER_CHARS_PER_SEC,
  attachCaptionWordTimings,
  buildAssDocument,
  captionAnimationFor,
  captionCuesForExport,
  captionEngineCuesForExport,
  captionSceneBounds,
  captionStyleForEdl,
  escapeFilterPath,
  planDrawTexts,
  resolveFontsDirectory,
  writeAssFile,
} from '../ffmpeg-overlays';
import { CAPTION_PRESETS } from '../caption-engine';
import type { CaptionPresetId } from '../caption-engine';

const EDL = example as unknown as Edl;

function withCaption(patch: {
  style?: string;
  animation?: string;
  font?: Edl['captions']['font'];
  box?: Edl['captions']['box'];
  position?: Edl['captions']['position'];
  highlight?: Edl['captions']['highlight'];
  maxWordsPerLine?: number;
  maxLines?: number;
}): Edl {
  const edl = JSON.parse(JSON.stringify(EDL)) as Edl;
  const captions: Record<string, unknown> = { ...edl.captions };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) captions[key] = value;
  }
  edl.captions = captions as unknown as Edl['captions'];
  return edl;
}

function dialogues(ass: string): string[] {
  return ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
}

function styleFields(ass: string): string[] {
  const line = ass.split('\n').find((entry) => entry.startsWith('Style: ZenCaption,'));
  if (line === undefined) throw new Error('No caption style emitted');
  return line.split(',');
}

function tagsOf(dialogue: string): string {
  const open = dialogue.indexOf('{');
  const close = dialogue.indexOf('}', open + 1);
  return open === -1 || close === -1 ? '' : dialogue.slice(open + 1, close);
}

function textOf(dialogue: string): string {
  const close = dialogue.indexOf('}');
  return close === -1 ? '' : dialogue.slice(close + 1);
}

function assSeconds(stamp: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(stamp);
  if (match === null) throw new Error(`Not an ASS timestamp: ${stamp}`);
  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
  );
}

function timesOf(dialogue: string): { startSec: number; endSec: number } {
  const fields = dialogue.slice('Dialogue: '.length).split(',');
  return { startSec: assSeconds(fields[1] ?? ''), endSec: assSeconds(fields[2] ?? '') };
}

// ---------------------------------------------------------------------------
// Preset wiring
// ---------------------------------------------------------------------------

describe('ffmpeg overlays — captions follow the EDL style', () => {
  it('changes the exported ASS when the preset changes', () => {
    const presets: CaptionPresetId[] = [
      'social_bold',
      'clean_reel',
      'editorial',
      'editorial_serif',
      'luxury_gold',
      'kinetic_bold',
      'minimal_white',
      'glass_pill',
      'bold_bw',
    ];
    const signatures = new Set<string>();

    for (const preset of presets) {
      const edl = withCaption({ style: preset });
      const cues = captionCuesForExport(edl);
      const ass = buildAssDocument(edl, cues, 'vertical-social');
      const fields = styleFields(ass);
      // Font, size, primary colour, alignment, border style and animation.
      signatures.add(
        [fields[1], fields[2], fields[3], fields[13], fields[18], fields[15], captionAnimationFor(edl)].join('|'),
      );
    }

    expect(signatures.size).toBe(presets.length);
  });

  it('keeps the legacy clean_lower EDL rendering, now as Clean Reel', () => {
    const cues = captionCuesForExport(EDL);
    expect(cues.length).toBeGreaterThan(0);
    expect(EDL.captions.style).toBe('clean_lower');

    const style = captionStyleForEdl(EDL);
    expect(style.id).toBe('clean_reel');
    expect(style.fontFamily).toBe('Archivo SemiBold');
    expect(style.sizeBase).toBe(64);

    const ass = buildAssDocument(EDL, cues, 'vertical-social');
    expect(ass).toContain('Style: ZenCaption,Archivo SemiBold,64,');
    const fields = styleFields(ass);
    expect(fields[18]).toBe('2'); // bottom-centre
    expect(fields[21]).toBe('340'); // safe-area bottom
  });

  it('uses the preset motion when the EDL has no animation', () => {
    const clean = withCaption({ style: 'clean_reel' });
    expect(captionAnimationFor(clean)).toBe('fade');

    const social = withCaption({ style: 'social_bold' });
    expect(captionAnimationFor(social)).toBe('pop');
    expect(tagsOf(dialogues(buildAssDocument(social, captionCuesForExport(social), 'vertical-social'))[0] ?? '')).toContain(
      '\\fscx86',
    );

    const kinetic = withCaption({ style: 'kinetic_bold' });
    expect(captionAnimationFor(kinetic)).toBe('word_by_word');
    expect(dialogues(buildAssDocument(kinetic, captionCuesForExport(kinetic), 'vertical-social'))).toHaveLength(5);
  });

  it('lets an explicit EDL animation override the preset motion', () => {
    const edl = withCaption({ style: 'social_bold', animation: 'rise' });
    expect(captionAnimationFor(edl)).toBe('rise');
    const tags = tagsOf(
      dialogues(buildAssDocument(edl, captionCuesForExport(edl), 'vertical-social'))[0] ?? '',
    );
    expect(tags).toContain('\\move(');
    expect(tags).not.toContain('\\fscx86');
  });

  it('scales the caption size to a landscape canvas', () => {
    const edl = withCaption({ style: 'social_bold' });
    const cues = captionCuesForExport(edl);
    const ass = buildAssDocument(edl, cues, 'landscape');
    // 76 px at 1080 wide → 135 px at 1920 wide.
    expect(ass).toContain('Style: ZenCaption,Bricolage Grotesque,135,');
  });

  it('honours font, box, position and highlight overrides from the EDL', () => {
    const edl = withCaption({
      style: 'clean_reel',
      font: { family: 'Anton', weight: 700, sizePx: 80, uppercase: true },
      box: { color: '#101010', opacity: 0.8 },
      position: { anchor: 'top_center', offsetPx: 24 },
      highlight: { words: ['oak'], color: '#FFD166' },
    });
    const ass = buildAssDocument(edl, captionCuesForExport(edl), 'vertical-social');
    const fields = styleFields(ass);

    expect(fields[1]).toBe('Anton');
    expect(fields[2]).toBe('80');
    expect(fields[7]).toBe('-1');
    expect(fields[15]).toBe('3'); // box
    expect(fields[18]).toBe('8'); // top-centre
    expect(fields[21]).toBe('274'); // 250 safe-area top + 24 offset
    expect(ass).toContain('Style: ZenCaption,Anton,80,');
    expect(ass).toContain('OAK');
  });
});

// ---------------------------------------------------------------------------
// Cue and animation wiring
// ---------------------------------------------------------------------------

describe('ffmpeg overlays — cue grouping and animation', () => {
  it('retains true word timings for the engine', () => {
    const cues = captionEngineCuesForExport(EDL);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.words.map((word) => word.text)).toEqual([
      'This',
      'is',
      '14',
      'Oak',
      'Avenue.',
    ]);
    expect(cues[0]?.words[3]?.startSec).toBe(1.2);
  });

  it('derives scene bounds from the clips and never crosses a cut', () => {
    const bounds = captionSceneBounds(EDL);
    expect(bounds.length).toBeGreaterThan(0);
    expect(bounds[0]?.startSec).toBe(0);
    for (let index = 1; index < bounds.length; index += 1) {
      expect(bounds[index]!.startSec).toBeGreaterThanOrEqual(bounds[index - 1]!.endSec - 0.001);
    }

    const edl = JSON.parse(JSON.stringify(EDL)) as Edl;
    edl.clips[0]!.outSec = edl.clips[0]!.inSec + 0.5;
    const cues = captionEngineCuesForExport(edl);
    // No cue may straddle the shortened first cut at 0.5 s.
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.endSec <= 0.501 || cue.startSec >= 0.499).toBe(true);
    }
  });

  it('staggers word_by_word at the real word starts, on one baseline per line', () => {
    const edl = withCaption({ style: 'kinetic_bold', animation: 'word_by_word' });
    const cues = captionCuesForExport(edl);
    const events = dialogues(buildAssDocument(edl, cues, 'vertical-social'));

    expect(events).toHaveLength(5);
    expect(events.map(textOf)).toEqual(['THIS', 'IS', '14', 'OAK', 'AVENUE.']);

    const starts = [0.6, 0.82, 0.94, 1.2, 1.48];
    events.forEach((event, index) => {
      const { startSec, endSec } = timesOf(event);
      expect(startSec).toBeCloseTo(starts[index] ?? 0, 2);
      expect(endSec).toBeLessThanOrEqual(2.1);
      expect(tagsOf(event)).toContain('\\t(0,140,');
    });

    const baselines = new Set(
      events.map((event) => /\\pos\(\d+,(\d+)\)/.exec(tagsOf(event))?.[1] ?? ''),
    );
    expect(baselines.size).toBe(2);
  });

  it('writes karaoke for glass_pill with \\kf chunks', () => {
    const edl = withCaption({ style: 'glass_pill' });
    expect(captionAnimationFor(edl)).toBe('karaoke');
    const events = dialogues(buildAssDocument(edl, captionCuesForExport(edl), 'vertical-social'));

    expect(events).toHaveLength(1);
    const chunks = [...textOf(events[0] ?? '').matchAll(/\\kf(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    expect(chunks).toHaveLength(5);
    expect(chunks.reduce((sum, value) => sum + value, 0)).toBe(150);

    const fields = styleFields(buildAssDocument(edl, captionCuesForExport(edl), 'vertical-social'));
    expect(fields[15]).toBe('3'); // box backing
    expect(fields[3]).toBe('&H00FFE8A9'); // ice active colour
  });

  it('reveals typewriter characters at 20 per second', () => {
    const edl = withCaption({ animation: 'typewriter' });
    const cues = captionCuesForExport(edl);
    const events = dialogues(buildAssDocument(edl, cues, 'vertical-social'));

    expect(events).toHaveLength(18);
    expect(events.map(textOf).join('')).toBe('Thisis14OakAvenue.');
    expect(ASS_TYPEWRITER_CHARS_PER_SEC).toBe(20);
    const cue = cues[0]!;
    events.forEach((event, index) => {
      const { startSec } = timesOf(event);
      expect(startSec).toBeCloseTo(cue.startSec + index / 20, 2);
    });
  });

  it('keeps safe-area margins for every preset', () => {
    const presets: CaptionPresetId[] = [
      'social_bold',
      'clean_reel',
      'editorial',
      'editorial_serif',
      'luxury_gold',
      'kinetic_bold',
      'minimal_white',
      'glass_pill',
      'bold_bw',
    ];
    for (const preset of presets) {
      const edl = withCaption({ style: preset });
      const fields = styleFields(buildAssDocument(edl, captionCuesForExport(edl), 'vertical-social'));
      expect(fields[19], preset).toBe('60');
      expect(fields[20], preset).toBe('120');
      // bold_bw is centre anchored; the rest sit on the bottom safe area.
      expect(fields[21], preset).toBe(preset === 'bold_bw' ? '0' : '340');
    }
  });

  it('never draws over the next cue', () => {
    const longCue: Cue = {
      startSec: 1,
      endSec: 1.06,
      lines: ['ALPHA BRAVO CHARLIE DELTA'],
    };
    const nextCue: Cue = { startSec: 1.06, endSec: 2, lines: ['NEXT CUE'] };
    const edl = withCaption({ animation: 'word_by_word' });

    const events = dialogues(buildAssDocument(edl, [longCue, nextCue], 'vertical-social'));
    for (const event of events) {
      const { startSec, endSec } = timesOf(event);
      expect(startSec).toBeGreaterThanOrEqual(1);
      expect(endSec).toBeLessThanOrEqual(2);
    }
  });

  it('attaches word timings to hand-built cues by count, or distributes them', () => {
    const cue: Cue = { startSec: 0.6, endSec: 2.1, lines: ['This is 14 Oak Avenue.'] };
    const attached = attachCaptionWordTimings([cue], EDL.captions.words ?? []);
    expect(attached[0]?.words[0]?.startSec).toBe(0.6);
    expect(attached[0]?.words[4]?.endSec).toBe(2.1);

    const other: Cue = { startSec: 0, endSec: 1, lines: ['ALPHA BRAVO'] };
    const distributed = attachCaptionWordTimings([other], []);
    expect(distributed[0]?.words).toHaveLength(2);
    expect(distributed[0]?.words[1]?.endSec).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// writeAssFile
// ---------------------------------------------------------------------------

describe('ffmpeg overlays — writeAssFile', () => {
  it('writes an inspectable ASS sidecar with the chosen preset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zeniconic-ass-'));
    try {
      const edl = withCaption({ style: 'luxury_gold' });
      const path = join(dir, 'nested', 'captions.ass');
      const result = await writeAssFile(edl, path, 'vertical-social');

      expect(result.preset).toBe('luxury_gold');
      expect(result.animation).toBe('rise');
      expect(result.cueCount).toBeGreaterThan(0);
      expect(result.eventCount).toBe(result.cueCount);

      const body = await readFile(path, 'utf8');
      expect(body).toContain('Style: ZenCaption,DM Serif Display,68,');
      expect(body).toContain('; preset: luxury_gold');
      expect(body).toContain('\\move(');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Drawtext plan
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exported preset catalogue stays aligned with the engine
// ---------------------------------------------------------------------------

describe('ffmpeg overlays — preset catalogue', () => {
  it('exports the same nine presets the engine draws', () => {
    expect(Object.keys(CAPTION_PRESETS)).toHaveLength(9);
  });
});
