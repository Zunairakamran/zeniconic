import { describe, expect, it } from 'vitest';
import { validateEdl } from '../../../packages/edl/src/index';
import { buildRemixEdl } from '../src/edl';
import { clearStoryboard, readStoryboard, saveStoryboard } from '../src/store';
import type { RemixStoryboard } from '../src/store';
import type { TimelineSlot } from '../src/presets';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const slots: TimelineSlot[] = [
  {
    order: 0, beat: 'hook', shotId: 'sh3', room: 'living',
    inSec: 8, outSec: 12, targetSec: 3, reason: 'Open on the room with the view.',
  },
  {
    order: 1, beat: 'ritual', shotId: 'sh1', room: 'kitchen',
    inSec: 2, outSec: 6, targetSec: 3, reason: 'Then the kitchen.',
  },
  {
    order: 2, beat: 'close', shotId: 'sh2', room: 'bedroom',
    inSec: 14, outSec: 18, targetSec: 3, reason: 'Close on the bedroom.',
  },
];

const facts = { address: 'Marina Gate 1, Dubai Marina', price: 'AED 1,850,000', beds: 2, baths: 2, currency: 'AED' as const };

describe('buildRemixEdl', () => {
  it('preserves the preset order and produces a valid EDL', () => {
    const edl = buildRemixEdl({
      listingId: '2026-11-17-remix',
      file: 'C:/remix/source.mp4',
      slots,
      facts,
      now: '2026-11-17T10:00:00.000Z',
    });
    expect(edl.clips.map((clip) => clip.inSec)).toEqual([8, 2, 14]);
    expect(new Set(edl.clips.map((clip) => clip.sourceId)).size).toBe(3);
    expect(edl.format.targetDurationSec).toBe(9);
    expect(edl.overlays[0]).toMatchObject({ kind: 'price', inSec: 5, outSec: 9 });
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('gives every clip a unique source id so backwards jumps are legal', () => {
    const reversed = [...slots].reverse();
    const edl = buildRemixEdl({
      listingId: '2026-11-17-remix',
      file: 'C:/remix/source.mp4',
      slots: reversed,
      facts,
      now: '2026-11-17T10:00:00.000Z',
    });
    expect(new Set(edl.clips.map((clip) => clip.sourceId)).size).toBe(3);
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('refuses a timeline outside 5–90 seconds', () => {
    expect(() =>
      buildRemixEdl({
        listingId: '2026-11-17-remix',
        file: 'ref.mp4',
        slots: [{ ...slots[0]!, targetSec: 2 }, { ...slots[1]!, targetSec: 2 }],
        facts,
        now: '2026-11-17T10:00:00.000Z',
      }),
    ).toThrow(/5–90/);
  });
});

describe('remix storyboard store', () => {
  const storyboard: RemixStoryboard = {
    version: 1,
    file: 'C:/remix/source.mp4',
    fileName: 'source.mp4',
    analyzedAt: '2026-11-17T10:00:00.000Z',
    durationSec: 30,
    fps: 30,
    orientation: 'portrait',
    shots: [{ shotId: 'sh1', startSec: 0, endSec: 3, durationSec: 3 }],
    presets: { marketing: [], original: [], price_led: [] },
    warnings: [],
  };

  it('round-trips and clears', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'remix-store-'));
    try {
      await saveStoryboard(dir, storyboard);
      expect((await readStoryboard(dir))?.fileName).toBe('source.mp4');
      await clearStoryboard(dir);
      expect(await readStoryboard(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('tolerates corrupt and wrong-version files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'remix-store-'));
    try {
      await saveStoryboard(dir, storyboard);
      await writeFile(join(dir, 'remix', 'storyboard.json'), '{bad', 'utf8');
      expect(await readStoryboard(dir)).toBeUndefined();
      await writeFile(join(dir, 'remix', 'storyboard.json'), JSON.stringify({ version: 2 }), 'utf8');
      expect(await readStoryboard(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
