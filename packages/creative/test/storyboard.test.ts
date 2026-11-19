import { describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '../../edl/src/index';
import type { Room } from '../../edl/src/index';
import { clipTimelineSec, direct, interleaveByRoom, marketingStoryboard, windowsOf } from '../src/index';
import {
  crossRoomDissolveFixture,
  makeEdl,
  marketingDistributionFixture,
  sameRoomDissolveFixture,
} from './fixtures';

/** The marketing_38 room sheet the storyboard is built from. */
const MARKETING_TEMPLATE: Room[] = [
  'living',
  'kitchen',
  'living',
  'bedroom',
  'kitchen',
  'living',
  'kitchen',
  'bedroom',
  'kitchen',
  'living',
  'entry',
  'kitchen',
  'bedroom',
  'living',
  'bedroom',
  'living',
];

const ENTRY_TEMPLATE_INDEX = MARKETING_TEMPLATE.indexOf('entry');

function noAdjacentRooms(rooms: readonly (Room | undefined)[], exceptAt = -1): void {
  for (let index = 1; index < rooms.length; index += 1) {
    if (index === exceptAt) continue;
    expect(rooms[index]).not.toBe(rooms[index - 1]);
  }
}

describe('marketingStoryboard', () => {
  it('follows the room template and puts the entry clip at its intended slot', () => {
    const fixture = marketingDistributionFixture();
    const entries = fixture.clips.map((clip, index) => ({ clip, index }));

    const ordered = marketingStoryboard(entries);
    const rooms = ordered.map((entry) => entry.clip.room);

    expect(rooms).toEqual(MARKETING_TEMPLATE);
    expect(ordered.findIndex((entry) => entry.clip.room === 'entry')).toBe(ENTRY_TEMPLATE_INDEX);
    expect(ordered[ENTRY_TEMPLATE_INDEX]?.clip.room).toBe('entry');
  });

  it('keeps every clip exactly once', () => {
    const fixture = marketingDistributionFixture();
    const entries = fixture.clips.map((clip, index) => ({ clip, index }));

    const ordered = marketingStoryboard(entries);
    const ids = ordered.map((entry) => entry.clip.id);

    expect(ordered).toHaveLength(fixture.clips.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(fixture.clips.map((clip) => clip.id).sort());
    expect([...ordered.map((entry) => entry.index)].sort((a, b) => a - b)).toEqual(
      fixture.clips.map((_, index) => index),
    );
  });

  it('does not end on the same room twice', () => {
    const ordered = marketingStoryboard(
      marketingDistributionFixture().clips.map((clip, index) => ({ clip, index })),
    );
    const rooms = ordered.map((entry) => entry.clip.room);

    expect(rooms.at(-2)).not.toBe(rooms.at(-1));
    expect(rooms.at(-1)).toBe('living');
  });

  it('is deterministic', () => {
    const build = () =>
      marketingDistributionFixture().clips.map((clip, index) => ({ clip, index }));
    expect(marketingStoryboard(build())).toEqual(marketingStoryboard(build()));
  });
});

describe('direct marketingStoryboard', () => {
  it('retimes the boundary so the entry reveal lands near 23 s and keeps 38 s', () => {
    const fixture = marketingDistributionFixture();
    const before = windowsOf(fixture.clips).find((window) => window.clip.room === 'entry');
    const result = direct(fixture, { marketingStoryboard: true });

    const windows = windowsOf(result.edl.clips);
    const entryWindow = windows.find((window) => window.clip.room === 'entry');
    expect(entryWindow).toBeDefined();
    if (entryWindow === undefined) throw new Error('storyboard dropped the entry clip');

    expect(Math.abs(entryWindow.startSec - 23)).toBeLessThanOrEqual(0.5);
    // Not just inside the slack: the 0.3 s overrun was actually retimed away.
    expect(entryWindow.startSec).toBeCloseTo(23, 2);

    // The gain on the entry is paid for by the shot before it, not by the film.
    const previous = windows[entryWindow.index - 1];
    expect(previous).toBeDefined();
    if (previous === undefined) throw new Error('entry clip has no predecessor');
    expect(clipTimelineSec(previous.clip)).toBeCloseTo(2.3, 6);
    expect(clipTimelineSec(entryWindow.clip)).toBeCloseTo(2.8, 6);
    expect(before?.durationSec).toBeCloseTo(2.5, 6);

    expect(result.rationale.durationSec).toBe(38);
    expect(durationSec(result.edl)).toBe(38);
    expect(result.rationale.durationDeltaSec).toBe(0);
    expect(result.rationale.durationWithinTarget).toBe(true);
    expect(validateEdl(result.edl).valid).toBe(true);
  });

  it('never puts two clips of the same room next to each other when an alternative exists', () => {
    const fixture = marketingDistributionFixture();
    const defaultOrder = direct(fixture).edl.clips.map((clip) => clip.room);
    // Sanity check on the fixture: the planned order is grouped by room.
    expect(defaultOrder[0]).toBe(defaultOrder[1]);

    const result = direct(fixture, { marketingStoryboard: true });
    const rooms = result.edl.clips.map((clip) => clip.room);

    noAdjacentRooms(rooms);
    expect(rooms).toEqual(MARKETING_TEMPLATE);
    expect(result.edl.clips.map((clip) => clip.id)).toEqual(
      marketingStoryboard(
        fixture.clips.map((clip, index) => ({ clip, index })),
      ).map((entry) => entry.clip.id),
    );
  });
});

describe('existing dissolve handling', () => {
  function boundary(result: ReturnType<typeof direct>, fromClipId: string) {
    return result.rationale.transitions.find((entry) => entry.fromClipId === fromClipId);
  }

  it('converts a same-room dissolve to a hard cut', () => {
    const result = direct(sameRoomDissolveFixture());
    expect(result.rationale.marketingStructurePreserved).toBe(true);

    const second = result.edl.clips[1];
    const third = result.edl.clips[2];
    expect(second?.room).toBe('living');
    expect(third?.room).toBe('living');

    expect(boundary(result, 'c02')?.type).toBe('cut');
    expect(second?.transitionOut?.type).toBe('cut');
    expect(third?.transitionIn?.type).toBe('cut');
    expect(second?.handleOutSec).toBeUndefined();
    expect(boundary(result, 'c02')?.reason).toContain('same room');
    expect(validateEdl(result.edl).valid).toBe(true);
  });

  it('keeps a different-room dissolve that the beat sheet requested', () => {
    const result = direct(crossRoomDissolveFixture());
    expect(result.rationale.marketingStructurePreserved).toBe(true);

    const second = result.edl.clips[1];
    const third = result.edl.clips[2];
    expect(second?.room).toBe('living');
    expect(third?.room).toBe('kitchen');

    const kept = boundary(result, 'c02');
    expect(kept?.type).toBe('dissolve');
    expect(kept?.durationSec).toBeCloseTo(0.36, 6);
    expect(kept?.reason).toContain('kept from the marketing beat sheet');
    expect(second?.transitionOut?.type).toBe('dissolve');
    expect(third?.transitionIn?.type).toBe('dissolve');
    expect(second?.handleOutSec).toBeCloseTo(0.36, 6);
    expect(validateEdl(result.edl).valid).toBe(true);
  });
});

describe('interleaveByRoom', () => {
  function interleaveFixtureClips() {
    return makeEdl({
      clips: [
        { room: 'living', seconds: 3.0 },
        { room: 'living', seconds: 2.8 },
        { room: 'kitchen', seconds: 2.6 },
        { room: 'living', seconds: 2.4 },
        { room: 'kitchen', seconds: 2.2 },
        { room: 'bedroom', seconds: 3.2 },
      ],
    }).clips;
  }

  it('keeps the first and last clip and breaks up same-room neighbours', () => {
    const clips = interleaveFixtureClips();
    const entries = clips.map((clip, index) => ({ clip, index }));

    const mixed = interleaveByRoom(entries);

    expect(mixed).toHaveLength(entries.length);
    expect(mixed[0]?.clip).toBe(clips[0]);
    expect(mixed[mixed.length - 1]?.clip).toBe(clips[clips.length - 1]);

    noAdjacentRooms(mixed.map((entry) => entry.clip.room));
    expect([...mixed.map((entry) => entry.index)].sort((a, b) => a - b)).toEqual(
      clips.map((_, index) => index),
    );
    // The naive order repeats the opening living room; the interleave must not.
    expect(clips[0]?.room).toBe(clips[1]?.room);
  });

  it('returns copies unchanged for two or fewer entries', () => {
    const clips = interleaveFixtureClips().slice(0, 2);
    const entries = clips.map((clip, index) => ({ clip, index }));
    const mixed = interleaveByRoom(entries);

    expect(mixed).toEqual(entries);
    expect(mixed).not.toBe(entries);
  });
});
