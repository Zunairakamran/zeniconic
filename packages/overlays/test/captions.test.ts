import { describe, expect, it } from 'vitest';
import {
  CAPTION_MAX_CHARS,
  CAPTION_MAX_LINES,
  CAPTION_PRESETS,
  avoidCaptions,
  captionCues,
  layoutOverlays,
  resolveCaptionStyle,
  splitLongCues,
} from '../src/index';
import { VERTICAL, edl, overlay, words } from './helpers';

const FPS = 30;

describe('captionCues', () => {
  it('splits speech into cues of at most two lines of CAPTION_MAX_CHARS characters', () => {
    const text =
      'Bright south facing apartment with a private balcony and a sea view and a large garden and a pool';
    const cues = captionCues(
      edl({ durationSec: 10, captionMode: 'burn', words: words(text) }),
      FPS,
    );

    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.lines.length).toBeGreaterThan(0);
      expect(cue.lines.length).toBeLessThanOrEqual(CAPTION_MAX_LINES);
      for (const line of cue.lines) {
        expect(Array.from(line).length).toBeLessThanOrEqual(CAPTION_MAX_CHARS);
      }
    }
  });

  it('never lets a long phrase wrap to a third line', () => {
    const text =
      'Thoughtfully designed interiors and everything you need to feel completely at home beside the marina';
    const cues = captionCues(
      edl({ durationSec: 14, captionMode: 'burn', words: words(text, 0, 0.2) }),
      FPS,
    );

    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) {
        expect(Array.from(line).length).toBeLessThanOrEqual(CAPTION_MAX_CHARS);
      }
    }
  });

  it('uses the style object for the line budget', () => {
    const text = 'A private marina view with a wide balcony and a separate study';
    const tight = captionCues(
      edl({ durationSec: 12, captionMode: 'burn', words: words(text, 0, 0.2) }),
      FPS,
      { maxCharsPerLine: 16, maxLines: 1 },
    );

    expect(tight.length).toBeGreaterThan(0);
    for (const cue of tight) {
      expect(cue.lines.length).toBe(1);
      expect(Array.from(cue.lines[0] ?? '').length).toBeLessThanOrEqual(16);
    }
  });

  it('converts cue seconds to whole frames in ascending order', () => {
    const cues = captionCues(
      edl({ durationSec: 10, captionMode: 'both', words: words('Two bedroom flat with a garden') }),
      FPS,
    );

    for (const cue of cues) {
      expect(Number.isInteger(cue.startFrame)).toBe(true);
      expect(Number.isInteger(cue.endFrame)).toBe(true);
      expect(cue.endFrame).toBeGreaterThan(cue.startFrame);
    }

    for (let index = 1; index < cues.length; index += 1) {
      const previous = cues[index - 1];
      const current = cues[index];
      expect(previous && current && current.startFrame >= previous.endFrame).toBe(true);
    }
  });

  it('flags Arabic as RTL and keeps the words in logical order', () => {
    const arabic = words('شقة غرفة نوم مطبخ واسع وشرفة مطلة على البحر', 0.2);
    const cues = captionCues(
      edl({ durationSec: 10, captionMode: 'burn', language: 'ar', words: arabic }),
      FPS,
    );

    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every((cue) => cue.rtl)).toBe(true);
    expect(cues[0]?.lines.join(' ')).not.toContain('\u202e');
    expect(cues[0]?.lines[0]).toContain('شقة');
  });

  it('marks English as left-to-right', () => {
    const cues = captionCues(
      edl({ durationSec: 10, captionMode: 'burn', language: 'en', words: words('Sunny flat') }),
      FPS,
    );
    expect(cues.every((cue) => cue.rtl === false)).toBe(true);
  });

  it('returns nothing when captions are switched off', () => {
    const cues = captionCues(
      edl({ captionMode: 'none', words: words('This should not render at all') }),
      FPS,
    );
    expect(cues).toEqual([]);
  });

  it('clips a cue that runs past the end of the composition', () => {
    const cues = captionCues(
      edl({ durationSec: 2, captionMode: 'sidecar', words: words('This is a much longer line of speech', 1.8, 0.3) }),
      FPS,
    );

    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.endFrame).toBeLessThanOrEqual(60);
    }
  });

  it('has a last cue that stops at the last frame of the timeline', () => {
    const cues = captionCues(
      edl({ durationSec: 3, captionMode: 'burn', words: words('A short sentence', 0, 0.2) }),
      FPS,
    );
    expect(cues[cues.length - 1]?.endFrame).toBeLessThanOrEqual(90);
  });
});

describe('splitLongCues', () => {
  it('splits an oversized cue without cutting a word', () => {
    const cue = {
      startSec: 1,
      endSec: 7,
      lines: ['One two three four five six seven', 'eight nine ten eleven twelve', 'thirteen fourteen'],
    };

    const split = splitLongCues([cue], 20, 2);

    expect(split.length).toBeGreaterThan(1);
    expect(split[0]?.startSec).toBe(1);
    expect(split[split.length - 1]?.endSec).toBe(7);

    for (let index = 0; index < split.length; index += 1) {
      const item = split[index];
      expect(item?.lines.length).toBeLessThanOrEqual(2);
      for (const line of item?.lines ?? []) {
        expect(Array.from(line).length).toBeLessThanOrEqual(20);
      }
      if (index > 0) {
        const previous = split[index - 1];
        expect(previous && item && item.startSec >= previous.endSec).toBe(true);
      }
    }

    const rejoined = split.flatMap((item) => item.lines.join(' ').split(' ')).join(' ');
    expect(rejoined).toBe(cue.lines.join(' '));
  });

  it('prefers a punctuation boundary when one fits', () => {
    const split = splitLongCues(
      [
        {
          startSec: 0,
          endSec: 4,
          lines: ['Pack the bags now, and meet', 'me at the station before', 'noon tomorrow'],
        },
      ],
      22,
      2,
    );

    expect(split[0]?.lines.join(' ').endsWith(',')).toBe(true);
  });
});

describe('resolveCaptionStyle', () => {
  it('defaults to Social Bold and maps legacy EDL strings', () => {
    expect(resolveCaptionStyle(undefined).preset).toBe('social_bold');
    expect(resolveCaptionStyle('bold_center').preset).toBe('social_bold');
    expect(resolveCaptionStyle('clean_lower').preset).toBe('clean_reel');
    expect(resolveCaptionStyle('editorial_serif').preset).toBe('editorial');
  });

  it('merges overrides over the preset and clamps unsafe numbers', () => {
    const style = resolveCaptionStyle({ preset: 'clean_reel', sizeBase: 200, maxLines: 9 });

    expect(style.preset).toBe('clean_reel');
    expect(style.font).toBe(CAPTION_PRESETS.clean_reel.font);
    expect(style.sizeBase).toBe(96);
    expect(style.maxLines).toBe(3);
  });
});

describe('avoidCaptions', () => {
  it('lifts a bottom-left lower third clear of an overlapping caption', () => {
    const document = edl({
      overlays: [
        overlay({ id: 'address', inSec: 0.4, outSec: 4.4, anchor: 'bottom_left' }),
        overlay({
          id: 'price',
          kind: 'price',
          text: '£845,000',
          inSec: 6,
          outSec: 9,
          anchor: 'bottom_center',
          style: 'price_lower',
        }),
      ],
    });

    const layout = layoutOverlays(document, VERTICAL);
    const address = layout.layouts.find((item) => item.id === 'address');
    const price = layout.layouts.find((item) => item.id === 'price');
    const cues = [{ startFrame: 12, endFrame: 60, lines: ['This is 14', 'Oak Avenue.'], rtl: false }];

    const adjusted = avoidCaptions(layout.layouts, cues, VERTICAL);
    const liftedAddress = adjusted.find((item) => item.id === 'address');
    const untouchedPrice = adjusted.find((item) => item.id === 'price');

    expect(address && liftedAddress && liftedAddress.y < address.y).toBe(true);
    expect(untouchedPrice?.y).toBe(price?.y);
    expect(liftedAddress?.y).toBeGreaterThanOrEqual(VERTICAL.safeArea.top);
  });

  it('leaves everything alone when there are no cues', () => {
    const document = edl({ overlays: [overlay({ id: 'address' })] });
    const layout = layoutOverlays(document, VERTICAL);
    expect(avoidCaptions(layout.layouts, [], VERTICAL)).toEqual(layout.layouts);
  });
});
