/**
 * The persisted segment key is the only thing standing between a re-render and
 * silently reusing the wrong pixels. These tests pin down both directions:
 * every field that changes the picture changes the key, and fields that only
 * describe the plan (ids, room, transitions, audio gain) do not.
 */

import { describe, expect, it } from 'vitest';
import type { Clip } from '@zeniconic/edl';
import { SEGMENT_KEY_VERSION, segmentCacheKeyFor } from '../src/index';
import type { SegmentKeyInput } from '../src/index';

const CUT = { type: 'cut', durationSec: 0 } as const;

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c01',
    sourceId: 's_00000001',
    src: 'D:\\footage\\living.mp4',
    inSec: 2,
    outSec: 5.5,
    speed: 1,
    volumeDb: 0,
    room: 'living',
    transform: { mode: 'cover', focus: 'center', path: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }] },
    transitionIn: { ...CUT },
    reason: 'measured: blur 0.10',
    ...overrides,
  };
}

function input(overrides: Partial<SegmentKeyInput> = {}): SegmentKeyInput {
  return {
    sourcePath: 'D:\\footage\\living.mp4',
    sourceSize: 12_345_678,
    sourceMtimeMs: 1_700_000_000_000,
    clip: clip(),
    profile: 'vertical-social',
    width: 1080,
    height: 1920,
    fps: 30,
    quality: 'standard',
    ...overrides,
  };
}

function key(overrides: Partial<SegmentKeyInput> = {}): string {
  return segmentCacheKeyFor(input(overrides));
}

function withClip(overrides: Partial<Clip>, rest: Partial<SegmentKeyInput> = {}): string {
  return segmentCacheKeyFor(input({ clip: clip(overrides), ...rest }));
}

describe('segmentCacheKeyFor', () => {
  it('is stable for the same segment and carries the schema version', () => {
    expect(SEGMENT_KEY_VERSION).toBe(2);
    expect(key()).toMatch(/^seg2_[0-9a-f]{64}$/);
    expect(key()).toBe(key());
    expect(key({ clip: structuredClone(clip()) })).toBe(key());
  });

  it('changes when the source bytes change identity', () => {
    expect(key({ sourcePath: 'D:\\footage\\living-renamed.mp4' })).not.toBe(key());
    expect(key({ sourceSize: 12_345_679 })).not.toBe(key());
    expect(key({ sourceMtimeMs: 1_700_000_000_001 })).not.toBe(key());
  });

  it('changes with the source window and speed', () => {
    expect(withClip({ inSec: 2.1 })).not.toBe(key());
    expect(withClip({ outSec: 5.6 })).not.toBe(key());
    expect(withClip({ speed: 1.25 })).not.toBe(key());
    expect(withClip({ handleOutSec: 0.35 })).not.toBe(key());
    expect(withClip({ speedRamp: [{ t: 0, speed: 1 }, { t: 1, speed: 2 }], speed: 1 })).not.toBe(
      key(),
    );
  });

  it('changes with the canvas, profile and quality ladder', () => {
    expect(key({ width: 1080, height: 1350, profile: 'feed-portrait' })).not.toBe(key());
    expect(key({ fps: 25 })).not.toBe(key());
    expect(key({ quality: 'draft' })).not.toBe(key());
    expect(key({ quality: 'high' })).not.toBe(key());
    // Same canvas, different bitrate ladder: still a different encode.
    expect(key({ profile: 'pin', width: 1000, height: 1500 })).not.toBe(key());
  });

  it('changes with framing, grade and per-clip effects', () => {
    expect(withClip({ transform: { ...clip().transform, mode: 'pad_blur' } })).not.toBe(key());
    expect(withClip({ grade: { exposure: 0.2 } })).not.toBe(key());
    expect(withClip({ grade: { preset: 'warm_cinematic' } })).not.toBe(key());
    expect(
      withClip({
        effects: [{ id: 'e1', type: 'vignette', amount: 40 }],
      }),
    ).not.toBe(key());
  });

  it('ignores fields that never reach the pixels', () => {
    const base = key();
    // Plan metadata and audio gain are not picture.
    expect(
      withClip({
        id: 'c99',
        sourceId: 's_99999999',
        room: 'kitchen',
        reason: 'different reason',
        volumeDb: -6,
        scoreAtSelection: 0.42,
        motionAtSelection: 0.8,
      }),
    ).toBe(base);
    // Transitions belong to the assembly layer (the picture pass is cut-only).
    expect(
      withClip({
        transitionIn: { type: 'dissolve', durationSec: 0.35 },
        transitionOut: { type: 'whip', durationSec: 0.35 },
      }),
    ).toBe(base);
    // The graph centres the cover crop; focus/path are not consumed today.
    expect(withClip({ transform: { ...clip().transform, focus: 'left' } })).toBe(base);
  });

  it('ignores an effect that renders nothing or was renamed', () => {
    const base = key();
    expect(
      withClip({
        effects: [{ id: 'e1', type: 'grain', amount: 50, enabled: false }],
      }),
    ).toBe(base);
    // The effect id is not a pixel: the same lowering keeps the segment.
    expect(
      withClip({ effects: [{ id: 'e1', type: 'grain', amount: 50 }] }),
    ).toBe(withClip({ effects: [{ id: 'renamed', type: 'grain', amount: 50 }] }));
  });

  it('gives different keys to different clips of the same source', () => {
    const a = withClip({ id: 'c01', inSec: 0, outSec: 2 });
    const b = withClip({ id: 'c02', inSec: 2, outSec: 4 });
    expect(a).not.toBe(b);
  });
});
