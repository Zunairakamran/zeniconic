/**
 * Caption engine: cue grouping, safe-area geometry, style differences and the
 * exact ASS tags each animation emits. Pure: no FFmpeg, no font files.
 */

import { describe, expect, it } from 'vitest';
import {
  ANIMATION_SUPPORT,
  CAPTION_PRESETS,
  assColour,
  assInlineColour,
  assTimestamp,
  captionFrame,
  groupCaptionCues,
  layoutCaptionLines,
  normaliseCaptionWord,
  normaliseWordTimings,
  placeCaptionCue,
  resolveCaptionStyle,
  distributeWordTimings,
} from '../caption-engine';
import type {
  CaptionCanvas,
  CaptionCue,
  CaptionPresetId,
  CaptionWordTiming,
} from '../caption-engine';
import { buildCaptionAss } from '../caption-engine';

const CANVAS: CaptionCanvas = {
  width: 1080,
  height: 1920,
  safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
};

const WORDS = [
  { text: 'Wake', startSec: 0.2, endSec: 0.5 },
  { text: 'up', startSec: 0.5, endSec: 0.7 },
  { text: 'to', startSec: 0.7, endSec: 0.8 },
  { text: 'this', startSec: 0.8, endSec: 1.0 },
  { text: 'view.', startSec: 1.0, endSec: 1.4 },
  { text: 'Three', startSec: 1.8, endSec: 2.1 },
  { text: 'bedrooms', startSec: 2.1, endSec: 2.6 },
  { text: 'and', startSec: 2.6, endSec: 2.7 },
  { text: 'a', startSec: 2.7, endSec: 2.8 },
  { text: 'private', startSec: 2.8, endSec: 3.2 },
  { text: 'pool.', startSec: 3.2, endSec: 3.7 },
];

function cue(lines: string[], words: CaptionWordTiming[], startSec = 0, endSec?: number): CaptionCue {
  return {
    startSec,
    endSec: endSec ?? words[words.length - 1]?.endSec ?? startSec + 1,
    lines,
    words,
  };
}

/** Override block of one dialogue, without braces. */
function tagsOf(line: string): string {
  const open = line.indexOf('{');
  const close = line.indexOf('}', open + 1);
  return open === -1 || close === -1 ? '' : line.slice(open + 1, close);
}

function textOf(line: string): string {
  const close = line.indexOf('}');
  return close === -1 ? '' : line.slice(close + 1);
}

function dialogues(ass: string): string[] {
  return ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
}

function styleFields(ass: string): string[] {
  const line = ass.split('\n').find((entry) => entry.startsWith('Style: ZenCaption,'));
  if (line === undefined) throw new Error('No caption style emitted');
  return line.split(',');
}

function assSeconds(stamp: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(stamp);
  if (match === null) throw new Error(`Not an ASS timestamp: ${stamp}`);
  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
  );
}

function timesOf(line: string): { startSec: number; endSec: number } {
  const fields = line.slice('Dialogue: '.length).split(',');
  return { startSec: assSeconds(fields[1] ?? ''), endSec: assSeconds(fields[2] ?? '') };
}

// ---------------------------------------------------------------------------
// Presets and style resolution
// ---------------------------------------------------------------------------

describe('caption engine — presets', () => {
  it('ships nine presets with genuinely different type and motion', () => {
    const ids = Object.keys(CAPTION_PRESETS) as CaptionPresetId[];
    expect(ids).toHaveLength(9);
    for (const id of ids) {
      expect(CAPTION_PRESETS[id].id).toBe(id);
    }

    const signatures = ids.map((id) => {
      const preset = CAPTION_PRESETS[id];
      return [preset.fontFamily, preset.sizeBase, preset.case, preset.align, preset.animation].join('|');
    });
    expect(new Set(signatures).size).toBe(ids.length);

    expect(CAPTION_PRESETS.luxury_gold.animation).toBe('rise');
    expect(CAPTION_PRESETS.kinetic_bold.animation).toBe('word_by_word');
    expect(CAPTION_PRESETS.glass_pill.animation).toBe('karaoke');
    expect(CAPTION_PRESETS.bold_bw.animation).toBe('pop');
  });

  it('maps every legacy EDL style string to a drawable preset', () => {
    expect(resolveCaptionStyle('bold_center').id).toBe('social_bold');
    expect(resolveCaptionStyle('clean_lower').id).toBe('clean_reel');
    expect(resolveCaptionStyle('editorial_serif').id).toBe('editorial_serif');
    expect(resolveCaptionStyle('editorial').id).toBe('editorial');
    expect(resolveCaptionStyle(undefined).id).toBe('social_bold');
    expect(resolveCaptionStyle('not-a-preset').id).toBe('social_bold');
  });

  it('merges additive overrides and clamps unsafe numbers', () => {
    const style = resolveCaptionStyle('clean_reel', {
      font: { family: 'Inter', weight: 900, sizePx: 200, uppercase: true },
      box: { color: '#101010', opacity: 1.4 },
      position: { anchor: 'top_center', offsetPx: 900 },
      highlight: { color: '#FFD166' },
      animation: 'word_stagger',
      maxLines: 9,
    });

    expect(style.fontFamily).toBe('Inter');
    expect(style.weight).toBe(900);
    expect(style.sizeBase).toBe(140);
    expect(style.case).toBe('upper');
    expect(style.hasBox).toBe(true);
    expect(style.borderStyle).toBe(3);
    expect(style.boxOpacity).toBe(1);
    expect(style.anchor).toBe('top');
    expect(style.offsetPx).toBe(400);
    expect(style.accentColour).toBe('#FFD166');
    expect(style.animation).toBe('word_by_word');
    expect(style.maxLines).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Cue grouping
// ---------------------------------------------------------------------------

describe('caption engine — cue grouping', () => {
  it('breaks on sentence punctuation and on a long silence', () => {
    const cues = groupCaptionCues(WORDS, {
      maxCharsPerLine: 20,
      maxLines: 2,
      gapSec: 0.35,
    });

    expect(cues).toHaveLength(2);
    expect(cues[0]?.lines.join(' ')).toContain('view.');
    expect(cues[1]?.lines.join(' ')).toContain('bedrooms');
    expect(cues[1]!.startSec).toBeGreaterThanOrEqual(1.8);
    expect(cues[0]!.endSec).toBeLessThanOrEqual(cues[1]!.startSec);
  });

  it('caps each cue at maxLines and maxCharsPerLine', () => {
    const cues = groupCaptionCues(WORDS, {
      maxCharsPerLine: 12,
      maxLines: 1,
      gapSec: 10,
    });
    expect(cues.length).toBeGreaterThan(1);
    for (const entry of cues) {
      expect(entry.lines).toHaveLength(1);
      expect(Array.from(entry.lines[0] ?? '').length).toBeLessThanOrEqual(12);
    }
  });

  it('honours a per-line word cap from the EDL', () => {
    const tokens = ['one', 'two', 'three', 'four', 'five'];
    expect(layoutCaptionLines(tokens, 40, 2, 2)).toEqual(['one two', 'three four', 'five']);
    const cues = groupCaptionCues(
      tokens.map((text, index) => ({ text, startSec: index * 0.2, endSec: index * 0.2 + 0.18 })),
      { maxCharsPerLine: 40, maxLines: 2, maxWordsPerLine: 2, gapSec: 10 },
    );
    for (const entry of cues) {
      for (const line of entry.lines) {
        expect(line.split(/\s+/).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('splits at scene bounds and never crosses a cut', () => {
    const cues = groupCaptionCues(WORDS, {
      maxCharsPerLine: 40,
      maxLines: 2,
      gapSec: 10,
      sceneBounds: [
        { startSec: 0, endSec: 1.6 },
        { startSec: 1.6, endSec: 4 },
      ],
    });

    expect(cues.length).toBeGreaterThanOrEqual(2);
    for (const entry of cues) {
      const insideFirst = entry.endSec <= 1.6;
      const insideSecond = entry.startSec >= 1.6;
      expect(insideFirst || insideSecond).toBe(true);
    }
  });

  it('clamps cue windows to the passed timeline bounds', () => {
    const cues = groupCaptionCues(WORDS, {
      maxCharsPerLine: 40,
      maxLines: 2,
      gapSec: 10,
      bounds: { startSec: 0.8, endSec: 3.0 },
    });
    expect(cues.length).toBeGreaterThan(0);
    for (const entry of cues) {
      expect(entry.startSec).toBeGreaterThanOrEqual(0.8);
      expect(entry.endSec).toBeLessThanOrEqual(3.0);
    }
  });

  it('never emits overlapping cues or words', () => {
    const cues = groupCaptionCues(
      [
        { text: 'one', startSec: 0, endSec: 0.6 },
        { text: 'two', startSec: 0.4, endSec: 0.9 },
        { text: 'three', startSec: 0.8, endSec: 1.2 },
        { text: 'four', startSec: 1.2, endSec: 1.6 },
      ],
      { maxCharsPerLine: 10, maxLines: 2, gapSec: 10 },
    );

    let previousEnd = 0;
    for (const entry of cues) {
      expect(entry.startSec).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = entry.endSec;
      let wordEnd = entry.startSec;
      for (const word of entry.words) {
        expect(word.startSec).toBeGreaterThanOrEqual(wordEnd - 1e-9);
        expect(word.endSec).toBeGreaterThanOrEqual(word.startSec);
        wordEnd = word.endSec;
      }
    }
  });

  it('pushes an overlapping word forward instead of drawing two on top', () => {
    const words = normaliseWordTimings([
      { text: 'one', startSec: 0, endSec: 1 },
      { text: 'two', startSec: 0.5, endSec: 1.2 },
    ]);
    expect(words[1]?.startSec).toBe(1);
    expect(words[1]?.endSec).toBeGreaterThanOrEqual(1.2);
  });

  it('distributes a cue when no word timings exist', () => {
    const words = distributeWordTimings(['alpha', 'bravo', 'charlie'], 1, 2.5);
    expect(words).toHaveLength(3);
    expect(words[0]?.startSec).toBe(1);
    expect(words[words.length - 1]?.endSec).toBe(2.5);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.startSec).toBeGreaterThanOrEqual(words[index - 1]!.endSec);
    }
  });
});

// ---------------------------------------------------------------------------
// Layout and safe area
// ---------------------------------------------------------------------------

describe('caption engine — safe-area geometry', () => {
  it('anchors bottom captions on the safe-area margin', () => {
    const style = resolveCaptionStyle('social_bold');
    const frame = captionFrame(CANVAS, style);

    expect(frame.alignment).toBe(2);
    expect(frame.marginV).toBe(340);
    expect(frame.baseX).toBe(540);
    expect(frame.baseY).toBe(1580);
    expect(frame.marginL).toBe(60);
    expect(frame.marginR).toBe(120);
    expect(frame.fontSize).toBe(76);
  });

  it('scales type with the canvas and keeps the safe column', () => {
    const style = resolveCaptionStyle('social_bold');
    const frame = captionFrame(
      { width: 1920, height: 1080, safeArea: { top: 60, bottom: 90, left: 96, right: 96 } },
      style,
    );
    expect(frame.fontSize).toBe(135);
    expect(frame.maxWidth).toBe(1728);
    expect(frame.baseY).toBe(990);
  });

  it('moves top and centre anchors, and applies offsetPx', () => {
    const bottom = resolveCaptionStyle('clean_reel', { position: { offsetPx: 40 } });
    expect(captionFrame(CANVAS, bottom).baseY).toBe(1540);

    // A negative offset never pushes copy out of the bottom safe area.
    const outward = resolveCaptionStyle('clean_reel', { position: { offsetPx: -200 } });
    expect(captionFrame(CANVAS, outward).marginV).toBe(340);

    const top = resolveCaptionStyle('clean_reel', { position: { anchor: 'top_center' } });
    const topFrame = captionFrame(CANVAS, top);
    expect(topFrame.alignment).toBe(8);
    expect(topFrame.baseY).toBe(250);

    const centre = resolveCaptionStyle('bold_bw');
    const centreFrame = captionFrame(CANVAS, centre);
    expect(centreFrame.alignment).toBe(5);
    expect(centreFrame.baseY).toBe(960);
  });

  it('places every line inside the safe area', () => {
    const style = resolveCaptionStyle('kinetic_bold');
    const frame = captionFrame(CANVAS, style);
    const placed = placeCaptionCue(
      cue(['THIS IS A LONG', 'CAPTION LINE'], [
        { text: 'THIS', startSec: 0, endSec: 0.3 },
        { text: 'IS', startSec: 0.3, endSec: 0.5 },
        { text: 'A', startSec: 0.5, endSec: 0.6 },
        { text: 'LONG', startSec: 0.6, endSec: 1 },
        { text: 'CAPTION', startSec: 1, endSec: 1.4 },
        { text: 'LINE', startSec: 1.4, endSec: 1.8 },
      ], 0, 1.8),
      style,
      frame,
    );

    expect(placed).toHaveLength(2);
    for (const line of placed) {
      expect(line.leftX).toBeGreaterThanOrEqual(frame.marginL - 0.01);
      expect(line.leftX + line.widthPx).toBeLessThanOrEqual(
        frame.width - frame.marginR + 0.01,
      );
      expect(line.bottom).toBeLessThanOrEqual(frame.height - CANVAS.safeArea.bottom + 0.01);
    }
    // Words on a line march left to right without overlapping.
    const words = placed[0]?.words ?? [];
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.leftX).toBeGreaterThanOrEqual(
        words[index - 1]!.leftX + words[index - 1]!.widthPx,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ASS output
// ---------------------------------------------------------------------------

describe('caption engine — ASS style', () => {
  const sample = groupCaptionCues(WORDS, { maxCharsPerLine: 24, maxLines: 2, gapSec: 10 });

  it('writes a different font, size, colour, alignment and border per preset', () => {
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
    const signatures = presets.map((id) => {
      const style = resolveCaptionStyle(id);
      const ass = buildCaptionAss({ cues: sample, canvas: CANVAS, style }).text;
      const fields = styleFields(ass);
      return [fields[1], fields[2], fields[3], fields[13], fields[18], fields[15]].join('|');
    });
    expect(new Set(signatures).size).toBe(presets.length);
  });

  it('writes the box colour and opacity for a plate style', () => {
    const style = resolveCaptionStyle('glass_pill');
    const ass = buildCaptionAss({ cues: sample, canvas: CANVAS, style }).text;
    const fields = styleFields(ass);
    expect(fields[15]).toBe('3');
    // Boxes use BackColour with the requested alpha; #0B0F12 at 0.72.
    expect(fields[6]).toBe(assColour('#0B0F12', 0.72));
    expect(fields[6]?.startsWith('&H47')).toBe(true);
  });

  it('uppercases only the presets that ask for it', () => {
    const social = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style: resolveCaptionStyle('social_bold'),
    }).text;
    const clean = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style: resolveCaptionStyle('clean_reel'),
    }).text;
    const plain = (line: string): string => textOf(line).replace(/\{[^}]*\}/g, '');
    expect(plain(dialogues(social)[0] ?? '')).toMatch(/^WAKE/);
    expect(plain(dialogues(clean)[0] ?? '')).toMatch(/^Wake/);
  });

  it('colours explicit highlight words and falls back to the longest word', () => {
    const style = resolveCaptionStyle('social_bold');
    const ass = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style,
      highlight: { words: ['bedrooms'], color: '#FF0000' },
    }).text;
    expect(ass).toContain(`{\\c${assInlineColour('#FF0000')}}BEDROOMS`);

    const accent = buildCaptionAss({ cues: sample, canvas: CANVAS, style }).text;
    expect(accent).toContain(`\\c${assInlineColour(style.accentColour)}`);
  });

  it('keeps ASS colours in BGR order and fades in/out with \\fad', () => {
    expect(assColour('#FF0000')).toBe('&H000000FF');
    expect(assColour('#00FF00')).toBe('&H0000FF00');
    expect(assColour('#0000FF')).toBe('&H00FF0000');
    expect(assColour('#FFFFFF', 0.5)).toBe('&H80FFFFFF');
    expect(assTimestamp(3661.239)).toBe('1:01:01.24');

    const ass = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style: resolveCaptionStyle('clean_reel'),
    }).text;
    expect(tagsOf(dialogues(ass)[0] ?? '')).toMatch(/\\fad\(160,80\)/);
  });
});

describe('caption engine — ASS animation', () => {
  const sampleWords: CaptionWordTiming[] = [
    { text: 'Wake', startSec: 0.2, endSec: 0.5 },
    { text: 'up', startSec: 0.5, endSec: 0.7 },
    { text: 'to', startSec: 0.7, endSec: 0.8 },
    { text: 'this', startSec: 0.8, endSec: 1.0 },
    { text: 'view.', startSec: 1.0, endSec: 1.4 },
  ];
  const sample = [cue(['Wake up to this view.'], sampleWords, 0.2, 1.4)];

  it('draws no events for none and claims no tags it does not emit', () => {
    const style = resolveCaptionStyle('clean_reel');
    const ass = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style,
      animation: 'none',
    });
    expect(ass.eventCount).toBe(0);
    expect(dialogues(ass.text)).toHaveLength(0);
    expect(ANIMATION_SUPPORT.none.tags).toBe('no dialogue events');
  });

  it('emits the exact tags for every whole-cue entrance', () => {
    const style = resolveCaptionStyle('clean_reel');
    const expectations: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['fade', ['\\fad(160,80)', '\\pos(']],
      ['rise', ['\\move(', '\\fad(160,80)']],
      ['slide_in', ['\\move(', '\\fad(160,80)']],
      ['pop', ['\\fscx86', '\\fscy86', '\\t(0,120,', '\\t(120,230,']],
      ['scale_in', ['\\fscx118', '\\fscy118', '\\t(0,360,']],
      ['blur_in', ['\\blur', '\\t(0,320,\\blur0)']],
      ['tracking_in', ['\\fsp', '\\t(0,340,\\fsp']],
    ];

    for (const [animation, expected] of expectations) {
      const result = buildCaptionAss({
        cues: sample,
        canvas: CANVAS,
        style,
        animation,
      });
      expect(result.eventCount, animation).toBe(1);
      const tags = tagsOf(dialogues(result.text)[0] ?? '');
      for (const tag of expected) expect(tags, `${animation}: ${tag}`).toContain(tag);
      expect(textOf(dialogues(result.text)[0] ?? '')).toBe('Wake up to this view.');
    }
  });

  it('reveals word_by_word at the real word starts', () => {
    const style = resolveCaptionStyle('kinetic_bold');
    const ass = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style,
      animation: 'word_by_word',
    });
    const events = dialogues(ass.text);

    expect(events).toHaveLength(sampleWords.length);
    expect(events.map(textOf)).toEqual(['WAKE', 'UP', 'TO', 'THIS', 'VIEW.']);
    events.forEach((event, index) => {
      const { startSec, endSec } = timesOf(event);
      expect(Math.abs(startSec - (sampleWords[index]?.startSec ?? 0))).toBeLessThanOrEqual(0.011);
      expect(startSec).toBeGreaterThanOrEqual(0.2);
      expect(endSec).toBeLessThanOrEqual(1.4);
    });
    // Each word carries its own pop-in transform, not a static pose.
    for (const event of events) {
      expect(tagsOf(event)).toContain('\\t(0,140,');
    }
  });

  it('writes karaoke as one event whose \\kf chunks sum to the cue duration', () => {
    const style = resolveCaptionStyle('glass_pill');
    const ass = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style,
      animation: 'karaoke',
    });
    const events = dialogues(ass.text);
    expect(events).toHaveLength(1);

    const text = textOf(events[0] ?? '');
    const chunks = [...text.matchAll(/\\kf(\d+)/g)].map((match) => Number(match[1]));
    expect(chunks).toHaveLength(sampleWords.length);
    expect(chunks.reduce((sum, value) => sum + value, 0)).toBe(120); // 1.2 s
    expect(text).toContain('Wake');
    // The style is what carries active-word colour for karaoke.
    const fields = styleFields(ass.text);
    expect(fields[3]).toBe(assColour(style.accentColour));
    expect(fields[4]).toBe(assColour(style.colour));
  });

  it('reveals typewriter characters at 20 per second without overlap', () => {
    const style = resolveCaptionStyle('clean_reel');
    const ass = buildCaptionAss({
      cues: sample,
      canvas: CANVAS,
      style,
      animation: 'typewriter',
    });
    const events = dialogues(ass.text);
    const visible = 'Wakeuptothisview.'.length;
    expect(events).toHaveLength(visible);
    expect(events.map(textOf).join('')).toBe('Wakeuptothisview.');

    let previous = 0;
    for (const event of events) {
      const { startSec } = timesOf(event);
      expect(startSec).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = startSec;
    }
  });

  it('never draws a word or character past its cue or over the next cue', () => {
    const short = cue(['ALPHA BRAVO CHARLIE'], [
      { text: 'ALPHA', startSec: 1, endSec: 1.02 },
      { text: 'BRAVO', startSec: 1.02, endSec: 1.04 },
      { text: 'CHARLIE', startSec: 1.04, endSec: 1.06 },
    ], 1, 1.06);
    const next = cue(['NEXT'], [{ text: 'NEXT', startSec: 1.06, endSec: 2 }], 1.06, 2);

    for (const animation of ['word_by_word', 'typewriter', 'karaoke'] as const) {
      const ass = buildCaptionAss({
        cues: [short, next],
        canvas: CANVAS,
        style: resolveCaptionStyle('clean_reel'),
        animation,
      });
      for (const event of dialogues(ass.text)) {
        const { startSec, endSec } = timesOf(event);
        expect(startSec, animation).toBeGreaterThanOrEqual(1);
        expect(endSec, animation).toBeLessThanOrEqual(2);
      }
    }
  });

  it('escapes braces and backslashes in text', () => {
    const unsafe = cue(['A {B} C\\D'], [
      { text: 'A', startSec: 0, endSec: 0.3 },
      { text: 'B', startSec: 0.3, endSec: 0.6 },
      { text: 'C', startSec: 0.6, endSec: 0.9 },
    ], 0, 1);
    const ass = buildCaptionAss({
      cues: [unsafe],
      canvas: CANVAS,
      style: resolveCaptionStyle('clean_reel'),
      animation: 'word_by_word',
    });
    const events = dialogues(ass.text);
    expect(events.map(textOf)).toEqual(['A', 'B', 'C/D']);
    for (const event of events) {
      expect(textOf(event)).not.toMatch(/[{}]/);
    }
  });
});

describe('caption engine — word normalisation', () => {
  it('normalises a highlighted word the way the validator does', () => {
    expect(normaliseCaptionWord('Avenue.')).toBe('avenue');
    expect(normaliseCaptionWord('“Oak”')).toBe('oak');
    expect(normaliseCaptionWord('—')).toBe('');
  });
});
