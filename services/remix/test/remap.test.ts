import { describe, expect, it } from 'vitest';
import { validateEdl } from '../../../packages/edl/src/index';
import { buildRemixEdl } from '../src/edl';
import { remapWordsToSlots } from '../src/remap';
import type { TimelineSlot } from '../src/presets';
import type { TranscriptWord } from '../src/transcribe';

const slots: TimelineSlot[] = [
  {
    order: 0, beat: 'hook', shotId: 'sh1', room: 'living',
    inSec: 8, outSec: 12, targetSec: 3, reason: 'Open.',
  },
  {
    order: 1, beat: 'ritual', shotId: 'sh2', room: 'kitchen',
    inSec: 2, outSec: 6, targetSec: 3, reason: 'Kitchen.',
  },
  {
    order: 2, beat: 'close', shotId: 'sh3', room: 'bedroom',
    inSec: 14, outSec: 18, targetSec: 3, reason: 'Close.',
  },
];

const words: TranscriptWord[] = [
  { word: 'Hello', start: 9, end: 9.4 },
  { word: 'kitchen', start: 3, end: 3.4 },
  { word: 'view', start: 15.5, end: 16 },
  { word: 'unused', start: 100, end: 100.3 },
];

describe('remapWordsToSlots', () => {
  it('maps words onto the new order and drops words outside every window', () => {
    const mapped = remapWordsToSlots(words, slots);
    expect(mapped.map((word) => word.text)).toEqual(['Hello', 'kitchen', 'view']);
    expect(mapped[0]).toMatchObject({ startSec: 1, endSec: 1.4 });
    expect(mapped[1]).toMatchObject({ startSec: 4, endSec: 4.4 });
    expect(mapped[2]).toMatchObject({ startSec: 7.5, endSec: 8 });
  });

  it('never overlaps and never runs past the film', () => {
    const crowded: TranscriptWord[] = [
      { word: 'one', start: 8.1, end: 9.2 },
      { word: 'two', start: 9.1, end: 10.2 },
      { word: 'three', start: 2.1, end: 3.9 },
    ];
    const mapped = remapWordsToSlots(crowded, slots);
    for (let index = 1; index < mapped.length; index += 1) {
      expect(mapped[index]!.startSec).toBeGreaterThanOrEqual(mapped[index - 1]!.endSec);
    }
    expect(Math.max(...mapped.map((word) => word.endSec))).toBeLessThanOrEqual(9 + 1e-9);
  });

  it('is used by the EDL builder for burned captions', () => {
    const mapped = remapWordsToSlots(words, slots);
    const edl = buildRemixEdl({
      listingId: '2026-11-17-remix',
      file: 'C:/remix/source.mp4',
      slots,
      facts: { address: 'Marina Gate 1', currency: 'AED' },
      now: '2026-11-17T10:00:00.000Z',
      words: mapped,
    });
    expect(edl.captions.mode).toBe('burn');
    expect(edl.captions.style).toBe('social_bold');
    expect(edl.captions.words?.map((word) => word.text)).toEqual(['Hello', 'kitchen', 'view']);
    expect(validateEdl(edl).valid).toBe(true);
  });
});
