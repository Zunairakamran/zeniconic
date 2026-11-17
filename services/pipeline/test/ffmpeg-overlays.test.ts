/**
 * The packaged overlay path: ASS tokens, Windows escaping and safe-area maths.
 * No FFmpeg runs here; `scripts/qa-ffmpeg-overlays.ts` burns the real listing.
 */

import { describe, expect, it } from 'vitest';
import example from '../../../packages/edl/example.edl.json';
import type { Cue } from '../../../packages/captions/src/index';
import type { Edl } from '../../../packages/edl/src/index';
import {
  ASS_TYPEWRITER_CHARS_PER_SEC,
  ASS_WORD_STAGGER_SEC,
  buildAssDocument,
  captionAnimationFor,
  captionCuesForExport,
  escapeFilterPath,
  planDrawTexts,
  resolveFontsDirectory,
} from '../ffmpeg-overlays';

const EDL = example as unknown as Edl;

/** A copy of the example EDL carrying one caption animation. */
function withAnimation(animation: string | undefined): Edl {
  const edl = JSON.parse(JSON.stringify(EDL)) as Edl;
  (edl.captions as { animation?: string }).animation = animation;
  return edl;
}

function dialogues(ass: string): string[] {
  return ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
}

/** The override block of one `Dialogue:` line, without its braces. */
function tagsOf(dialogue: string): string {
  const open = dialogue.indexOf('{');
  const close = dialogue.indexOf('}', open + 1);
  return open === -1 || close === -1 ? '' : dialogue.slice(open + 1, close);
}

/** The text of one `Dialogue:` line, after its override block. */
function textOf(dialogue: string): string {
  const close = dialogue.indexOf('}');
  return close === -1 ? '' : dialogue.slice(close + 1);
}

function timesOf(dialogue: string): { startSec: number; endSec: number } {
  const fields = dialogue.slice('Dialogue: '.length).split(',');
  return { startSec: assSeconds(fields[1] ?? ''), endSec: assSeconds(fields[2] ?? '') };
}

function assSeconds(stamp: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(stamp);
  if (match === null) throw new Error(`Not an ASS timestamp: ${stamp}`);
  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
  );
}

function near(actual: number, expected: number, epsilon = 0.011): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

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

describe('ffmpeg overlays — caption animation', () => {
  it('treats an absent animation as fade', () => {
    expect(captionAnimationFor(EDL)).toBe('fade');
    expect(captionAnimationFor(withAnimation(undefined))).toBe('fade');
  });

  it('falls back to fade for an unknown animation', () => {
    const unknown = withAnimation('sparkle');
    expect(captionAnimationFor(unknown)).toBe('fade');

    const cues = captionCuesForExport(unknown);
    expect(buildAssDocument(unknown, cues, 'vertical-social')).toBe(
      buildAssDocument(EDL, cues, 'vertical-social'),
    );
  });

  it('keeps the default fade output byte-identical', () => {
    const cues = captionCuesForExport(EDL);
    const ass = buildAssDocument(EDL, cues, 'vertical-social');
    expect(ass).toMatchInlineSnapshot(`
      "[Script Info]
      ; Zeniconic export captions
      ScriptType: v4.00+
      PlayResX: 1080
      PlayResY: 1920
      WrapStyle: 0
      ScaledBorderAndShadow: yes
      YCbCr Matrix: TV.709

      [V4+ Styles]
      Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
      Style: ZenCaption,Bricolage Grotesque,76,&H00EFF4F7,&H00EFF4F7,&H0014120F,&H8014120F,-1,0,0,0,100,100,0,0,1,3,2,2,60,120,340,1

      [Events]
      Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      Dialogue: 0,0:00:00.60,0:00:02.10,ZenCaption,,0,0,0,,{\\blur2}THIS IS 14\\NOAK AVENUE.
      "
    `);
    // One cue, one event, the pre-animation `\blur2` look.
    expect(dialogues(ass)).toHaveLength(1);
    expect(tagsOf(dialogues(ass)[0] ?? '')).toBe('\\blur2');
    expect(textOf(dialogues(ass)[0] ?? '')).toBe('THIS IS 14\\NOAK AVENUE.');
  });

  it('draws no captions for the none animation', () => {
    const edl = withAnimation('none');
    const cues = captionCuesForExport(edl);
    expect(cues.length).toBeGreaterThan(0);
    expect(dialogues(buildAssDocument(edl, cues, 'vertical-social'))).toHaveLength(0);
  });

  it('draws each entrance with its ASS override tags', () => {
    const expectations: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['fade', ['\\blur2']],
      [
        'pop',
        [
          '\\fad(120,0)',
          '\\t(0,160,\\fscx112\\fscy112)',
          '\\t(160,260,\\fscx100\\fscy100)',
        ],
      ],
      ['rise', ['\\move(540,1586,540,1580,0,220)', '\\fad(220,0)']],
      ['slide_in', ['\\move(508,1580,540,1580,0,220)', '\\fad(220,0)']],
      ['tracking_in', ['\\fsp8', '\\t(0,300,\\fsp-1)', '\\fad(300,0)']],
      ['blur_in', ['\\blur8', '\\t(0,300,\\blur0)', '\\fad(300,0)']],
      ['scale_in', ['\\fscx118', '\\fscy118', '\\t(0,360,\\fscx100\\fscy100)', '\\fad(360,0)']],
    ];

    for (const [animation, expected] of expectations) {
      const edl = withAnimation(animation);
      const ass = buildAssDocument(edl, captionCuesForExport(edl), 'vertical-social');
      const events = dialogues(ass);
      expect(events, animation).toHaveLength(1);
      const tags = tagsOf(events[0] ?? '');
      for (const tag of expected) expect(tags, `${animation}: ${tag}`).toContain(tag);
      // Whole-cue modes draw the complete cue, never a fragment.
      expect(textOf(events[0] ?? ''), animation).toBe('THIS IS 14\\NOAK AVENUE.');
    }
  });

  it('staggers one word event per word on the same baseline', () => {
    const edl = withAnimation('word_by_word');
    const cues = captionCuesForExport(edl);
    const events = dialogues(buildAssDocument(edl, cues, 'vertical-social'));

    // "This is 14 Oak Avenue." — five words, one event each.
    expect(events).toHaveLength(5);
    expect(events.map(textOf)).toEqual(['THIS', 'IS', '14', 'OAK', 'AVENUE.']);

    const cue = cues[0]!;
    events.forEach((event, index) => {
      const { startSec, endSec } = timesOf(event);
      expect(near(startSec, cue.startSec + index * ASS_WORD_STAGGER_SEC)).toBe(true);
      expect(startSec).toBeGreaterThanOrEqual(cue.startSec);
      expect(endSec).toBeLessThanOrEqual(cue.endSec);
      expect(tagsOf(event)).toContain('\\fad(120,0)');
    });

    // Every word sits on its line's baseline: two lines, two distinct y values.
    const baselines = new Set(
      events.map((event) => /\\pos\(\d+,(\d+)\)/.exec(tagsOf(event))?.[1] ?? ''),
    );
    expect(baselines.size).toBe(2);
    expect([...baselines].sort()).toEqual(['1493', '1580']);
    // Words on the first line march left to right.
    const xs = events.map((event) => Number(/\\pos\((\d+),/.exec(tagsOf(event))?.[1] ?? 0));
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
    expect(xs[1]).toBeLessThan(xs[2] ?? 0);
  });

  it('reveals one character per event at 20 characters per second', () => {
    const edl = withAnimation('typewriter');
    const cues = captionCuesForExport(edl);
    const events = dialogues(buildAssDocument(edl, cues, 'vertical-social'));

    // 18 non-space characters in "This is 14 Oak Avenue.".
    expect(events).toHaveLength(18);
    expect(events.map(textOf).join('')).toBe('THISIS14OAKAVENUE.');
    expect(ASS_TYPEWRITER_CHARS_PER_SEC).toBe(20);

    const cue = cues[0]!;
    events.forEach((event, index) => {
      const { startSec, endSec } = timesOf(event);
      expect(near(startSec, cue.startSec + index / ASS_TYPEWRITER_CHARS_PER_SEC)).toBe(true);
      expect(startSec).toBeGreaterThanOrEqual(cue.startSec);
      expect(endSec).toBeLessThanOrEqual(cue.endSec);
    });
  });

  it('never draws a word or character past its cue or over the next one', () => {
    const longCue: Cue = {
      startSec: 1,
      endSec: 1.06,
      lines: ['ALPHA BRAVO CHARLIE DELTA'],
    };
    const nextCue: Cue = { startSec: 1.06, endSec: 2, lines: ['NEXT CUE'] };

    for (const animation of ['word_by_word', 'typewriter'] as const) {
      const edl = withAnimation(animation);
      const events = dialogues(buildAssDocument(edl, [longCue, nextCue], 'vertical-social'));
      const firstCue = events.filter((event) => timesOf(event).startSec < 1.06);
      expect(firstCue.length, animation).toBeGreaterThan(1);

      for (const event of firstCue) {
        const { startSec, endSec } = timesOf(event);
        expect(startSec, animation).toBeGreaterThanOrEqual(1);
        expect(endSec, animation).toBeLessThanOrEqual(1.06);
      }
      // The short cue still reveals every word/character, just faster.
      const firstText = firstCue.map(textOf).join('');
      expect(firstText.length, animation).toBeGreaterThan(0);
    }
  });

  it('escapes braces and backslashes in per-word and per-character text', () => {
    const unsafe: Cue = { startSec: 0, endSec: 1, lines: ['A {B} C\\D'] };
    const edl = withAnimation('word_by_word');
    const events = dialogues(buildAssDocument(edl, [unsafe], 'vertical-social'));

    expect(events.map(textOf)).toEqual(['A', 'B', 'C/D']);
    for (const event of events) {
      expect(textOf(event)).not.toMatch(/[{}]/);
      expect(textOf(event)).not.toContain('\\');
    }

    const typed = dialogues(
      buildAssDocument(withAnimation('typewriter'), [unsafe], 'vertical-social'),
    );
    expect(typed.map(textOf).join('')).toBe('ABC/D');
  });

  it('keeps the caption style and safe-area margins for every animation', () => {
    const animations = [
      'fade',
      'pop',
      'rise',
      'slide_in',
      'tracking_in',
      'blur_in',
      'scale_in',
      'word_by_word',
      'typewriter',
    ];
    for (const animation of animations) {
      const edl = withAnimation(animation);
      const ass = buildAssDocument(edl, captionCuesForExport(edl), 'vertical-social');
      const style = ass.split('\n').find((line) => line.startsWith('Style: ZenCaption,'));
      expect(style, animation).toBeDefined();
      const fields = style!.split(',');
      expect(fields[2], animation).toBe('76');
      expect(fields[18], animation).toBe('2');
      expect(fields[21], animation).toBe('340');
    }
  });
});
