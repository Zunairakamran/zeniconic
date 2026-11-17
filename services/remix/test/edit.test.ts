/**
 * Manual remix edits: slot order, room tags, the EDL they produce, and the
 * transcription cost the analysis records.
 *
 * The desktop adapter is exercised with a fake store and injected probe/split
 * so this suite never spawns ffmpeg or calls a provider.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRemixService } from '../../../apps/desktop/remix';
import type { RemixTranscriptionRecord } from '../../../apps/desktop/remix';
import { readVariantEdl } from '../../../apps/desktop/variants';
import type { Store } from '../../../packages/store/src/index';
import {
  RemixEditError,
  reorderSlots,
  requireRoom,
  setSlotRoom,
} from '../src/edit';
import { readStoryboard, saveStoryboard } from '../src/store';
import type { RemixSlotDto, RemixStoryboard } from '../src/store';
import type { Shot } from '../src/split';

const LISTING_ID = '2026-11-17-oak-avenue';

const listing = {
  id: LISTING_ID,
  address: '14 Oak Avenue',
  status: 'ready',
  createdAt: '2026-11-17T09:00:00.000Z',
  updatedAt: '2026-11-17T09:00:00.000Z',
  facts: {
    address: '14 Oak Avenue',
    currency: 'GBP',
    price: '£850,000',
    beds: 2,
    baths: 1,
  },
};

function slot(
  order: number,
  shotId: string,
  room: string,
  inSec: number,
  targetSec = 2,
): RemixSlotDto {
  return {
    order,
    beat: order === 0 ? 'hook' : order === 1 ? 'ritual' : 'close',
    shotId,
    room,
    inSec,
    outSec: inSec + 3,
    targetSec,
    reason: `${room} at ${inSec}s`,
  };
}

function storyboard(): RemixStoryboard {
  return {
    version: 1,
    file: 'C:/remix/source.mp4',
    fileName: 'source.mp4',
    analyzedAt: '2026-11-17T10:00:00.000Z',
    durationSec: 15,
    fps: 30,
    orientation: 'portrait',
    shots: [0, 3, 6, 9, 12].map((start, index) => ({
      shotId: `sh${index + 1}`,
      startSec: start,
      endSec: start + 3,
      durationSec: 3,
    })),
    presets: {
      marketing: [
        slot(0, 'sh1', 'living', 0),
        slot(1, 'sh2', 'kitchen', 3),
        slot(2, 'sh3', 'bedroom', 6),
      ],
      original: [0, 3, 6, 9, 12].map((start, index) =>
        slot(index, `sh${index + 1}`, 'unknown', start),
      ),
      price_led: [
        slot(0, 'sh3', 'bedroom', 6),
        slot(1, 'sh1', 'living', 0),
        slot(2, 'sh2', 'kitchen', 3),
      ],
    },
    warnings: [],
    words: [
      { word: 'One', start: 0.2, end: 0.8 },
      { word: 'Two', start: 3.2, end: 3.8 },
      { word: 'Three', start: 6.2, end: 6.8 },
    ],
  };
}

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'remix-edit-'));
  store = {
    async get() {
      return listing;
    },
    dirFor() {
      return dir;
    },
  } as unknown as Store;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('reorderSlots', () => {
  const slots = storyboard().presets.marketing;

  it('applies an exact permutation and renumbers the order', () => {
    const next = reorderSlots(slots, ['sh3', 'sh1', 'sh2']);
    expect(next.map((entry) => entry.shotId)).toEqual(['sh3', 'sh1', 'sh2']);
    expect(next.map((entry) => entry.order)).toEqual([0, 1, 2]);
    // Pure: the input is untouched.
    expect(slots.map((entry) => entry.shotId)).toEqual(['sh1', 'sh2', 'sh3']);
  });

  it('rejects an unknown, missing or duplicated shot id', () => {
    for (const order of [
      ['sh3', 'sh1', 'nope'],
      ['sh3', 'sh1'],
      ['sh3', 'sh1', 'sh1'],
      [],
    ]) {
      expect(() => reorderSlots(slots, order)).toThrow(RemixEditError);
    }
    try {
      reorderSlots(slots, ['sh3', 'sh1', 'nope']);
    } catch (error) {
      expect(error).toMatchObject({ code: 'E_BAD_ORDER' });
    }
  });
});

describe('setSlotRoom and requireRoom', () => {
  it('tags only the matching shot', () => {
    const next = setSlotRoom(storyboard().presets.marketing, 'sh2', 'dining');
    expect(next.map((entry) => entry.room)).toEqual(['living', 'dining', 'bedroom']);
  });

  it('rejects a room outside the EDL vocabulary', () => {
    expect(requireRoom('kitchen')).toBe('kitchen');
    expect(() => requireRoom('garage')).toThrow(RemixEditError);
  });
});

describe('remix service: order, rooms and variants', () => {
  it('creates the variant in the user order and updates an existing variant on reorder', async () => {
    await saveStoryboard(dir, storyboard());
    const remix = createRemixService({ store });

    const first = await remix.create({ listingId: LISTING_ID, preset: 'marketing' });
    expect(first.clipCount).toBe(3);
    expect((await readVariantEdl(dir, 'remix')).clips.map((clip) => clip.inSec)).toEqual([0, 3, 6]);

    const updated = await remix.reorder({
      listingId: LISTING_ID,
      preset: 'marketing',
      order: ['sh3', 'sh1', 'sh2'],
    });
    expect(updated.orders?.marketing).toEqual(['sh3', 'sh1', 'sh2']);
    expect(updated.presets.marketing.map((entry) => entry.order)).toEqual([0, 1, 2]);

    // The persisted storyboard carries the order across a reload.
    expect((await readStoryboard(dir))?.orders?.marketing).toEqual(['sh3', 'sh1', 'sh2']);

    // The already-created variant is refreshed, so a later export uses it.
    const synced = await readVariantEdl(dir, 'remix');
    expect(synced.clips.map((clip) => clip.inSec)).toEqual([6, 0, 3]);

    // A new create uses the same order and remaps captions onto it.
    const second = await remix.create({ listingId: LISTING_ID, preset: 'marketing' });
    expect(second.clipCount).toBe(3);
    const edl = await readVariantEdl(dir, 'remix');
    expect(edl.clips.map((clip) => clip.inSec)).toEqual([6, 0, 3]);
    expect(edl.captions.mode).toBe('burn');
    expect(edl.captions.words?.[0]?.text).toBe('Three');
    expect(edl.captions.words?.[0]?.startSec).toBeCloseTo(0.2, 1);
  });

  it('persists a room tag and uses it in the created clips', async () => {
    await saveStoryboard(dir, storyboard());
    const remix = createRemixService({ store });

    const tagged = await remix.retag({
      listingId: LISTING_ID,
      shotId: 'sh1',
      room: 'kitchen',
    });
    expect(tagged.rooms?.sh1).toBe('kitchen');
    expect(
      tagged.presets.marketing.some(
        (entry) => entry.shotId === 'sh1' && entry.room === 'kitchen',
      ),
    ).toBe(true);

    await remix.create({ listingId: LISTING_ID, preset: 'marketing' });
    const edl = await readVariantEdl(dir, 'remix');
    expect(edl.clips.some((clip) => clip.room === 'kitchen')).toBe(true);
  });

  it('keeps a manual order when a room is retagged afterwards', async () => {
    await saveStoryboard(dir, storyboard());
    const remix = createRemixService({ store });

    await remix.reorder({
      listingId: LISTING_ID,
      preset: 'marketing',
      order: ['sh3', 'sh1', 'sh2'],
    });
    const tagged = await remix.retag({
      listingId: LISTING_ID,
      shotId: 'sh2',
      room: 'dining',
    });

    expect(tagged.orders?.marketing).toEqual(['sh3', 'sh1', 'sh2']);
    expect(tagged.presets.marketing.map((entry) => entry.shotId)).toEqual(['sh3', 'sh1', 'sh2']);
    expect(tagged.presets.marketing.find((entry) => entry.shotId === 'sh2')?.room).toBe('dining');
  });

  it('rejects an invalid room without touching the persisted storyboard', async () => {
    await saveStoryboard(dir, storyboard());
    const remix = createRemixService({ store });

    await expect(
      remix.retag({ listingId: LISTING_ID, shotId: 'sh1', room: 'garage' }),
    ).rejects.toMatchObject({ code: 'E_UNKNOWN_ROOM' });
    expect((await readStoryboard(dir))?.rooms).toBeUndefined();
  });

  it('rejects a reorder that names a shot outside the preset', async () => {
    await saveStoryboard(dir, storyboard());
    const remix = createRemixService({ store });

    await expect(
      remix.reorder({
        listingId: LISTING_ID,
        preset: 'marketing',
        order: ['sh1', 'sh2', 'sh5'],
      }),
    ).rejects.toMatchObject({ code: 'E_BAD_ORDER' });
  });
});

describe('remix service: transcription cost', () => {
  const shots: Shot[] = [0, 3, 6, 9, 12].map((start, index) => ({
    index,
    startSec: start,
    endSec: start + 3,
    durationSec: 3,
  }));

  function analyzeService(options: {
    costUsd?: number;
    estimateUsd?: number;
    canSpend?: (usd: number) => boolean;
    onTranscription?: (record: RemixTranscriptionRecord) => void;
  }) {
    const records: RemixTranscriptionRecord[] = [];
    let transcribed = false;
    const remix = createRemixService({
      store,
      now: () => '2026-11-17T10:00:00.000Z',
      probe: async () => ({ durationSec: 15, fps: 30, orientation: 'portrait' }),
      split: async () => ({ shots, method: 'scene', warnings: [], threshold: 0.3 }),
      transcribe: async () => {
        transcribed = true;
        return {
          words: [{ word: 'Hello', start: 0.2, end: 0.6 }],
          durationSec: 12.5,
          model: 'elevenlabs/scribe-v2',
          ...(options.costUsd === undefined ? {} : { costUsd: options.costUsd }),
        };
      },
      ...(options.estimateUsd === undefined
        ? {}
        : { estimateTranscriptionUsd: () => options.estimateUsd }),
      ...(options.canSpend === undefined ? {} : { canSpend: (usd) => options.canSpend!(usd) }),
      onTranscription: (record) => {
        records.push(record);
        options.onTranscription?.(record);
      },
    });
    return { remix, records, transcribed: () => transcribed };
  }

  it('records the provider-reported cost under the transcription role', async () => {
    const { remix, records } = analyzeService({ costUsd: 0.0042 });
    const board = await remix.analyze({
      listingId: LISTING_ID,
      file: 'C:/remix/source.mp4',
      transcribe: true,
    });

    expect(board.transcription).toMatchObject({
      words: 1,
      costUsd: 0.0042,
      costSource: 'provider',
      model: 'elevenlabs/scribe-v2',
    });
    expect(records).toEqual([
      {
        listingId: LISTING_ID,
        model: 'elevenlabs/scribe-v2',
        costUsd: 0.0042,
        costSource: 'provider',
        durationSec: 12.5,
      },
    ]);
  });

  it('labels a configured-rate cost as estimated and records it', async () => {
    const { remix, records } = analyzeService({ estimateUsd: 0.02 });
    const board = await remix.analyze({
      listingId: LISTING_ID,
      file: 'C:/remix/source.mp4',
      transcribe: true,
    });

    expect(board.transcription).toMatchObject({ costUsd: 0.02, costSource: 'estimated' });
    expect(records[0]).toMatchObject({ costUsd: 0.02, costSource: 'estimated' });
  });

  it('records nothing and warns when the provider reports no cost', async () => {
    const { remix, records } = analyzeService({});
    const board = await remix.analyze({
      listingId: LISTING_ID,
      file: 'C:/remix/source.mp4',
      transcribe: true,
    });

    expect(board.transcription).toMatchObject({ costSource: 'unreported' });
    expect(board.transcription?.costUsd).toBeUndefined();
    expect(records).toHaveLength(0);
    expect(board.warnings.some((warning) => warning.includes('did not report a cost'))).toBe(true);
  });

  it('refuses to transcribe when the estimate exceeds the budget', async () => {
    const { remix, transcribed } = analyzeService({
      estimateUsd: 0.5,
      canSpend: () => false,
    });

    await expect(
      remix.analyze({ listingId: LISTING_ID, file: 'C:/remix/source.mp4', transcribe: true }),
    ).rejects.toThrow(/exceed the remaining budget/);
    expect(transcribed()).toBe(false);
  });
});
