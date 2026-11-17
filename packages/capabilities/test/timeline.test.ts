import { describe, expect, it } from 'vitest';
import { durationSec } from '@zeniconic/edl';
import { createDefaultRegistry } from '../src/index';
import { makeEdl } from './fixtures';

const registry = createDefaultRegistry();

function apply(id: string, edl = makeEdl(), params: Record<string, unknown> = {}) {
  return registry.apply(id, edl, params);
}

describe('timeline capabilities', () => {
  it('retimes a longer film by slowing clips, not by inventing frames', () => {
    const result = apply('set_target_duration', makeEdl(), { targetSec: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(durationSec(result.edl)).toBeCloseTo(12, 3);
    for (const clip of result.edl.clips) {
      expect(clip.speed).toBeGreaterThanOrEqual(0.25);
      expect(clip.outSec - clip.inSec).toBeCloseTo(3, 3);
    }
  });

  it('retimes a shorter film by trimming tails', () => {
    const result = apply('set_target_duration', makeEdl(), { targetSec: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(durationSec(result.edl)).toBeCloseTo(6, 3);
  });

  it('refuses an impossible length', () => {
    const result = apply('set_target_duration', makeEdl(), { targetSec: 90 });
    expect(result.ok).toBe(false);
  });

  it('splits a clip without changing the film length or the source window', () => {
    const before = makeEdl();
    const result = apply('split_clip', before, { clipId: 'c02', atSec: 1.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edl.clips).toHaveLength(4);
    expect(durationSec(result.edl)).toBeCloseTo(durationSec(before), 3);
    const head = result.edl.clips[1]!;
    const tail = result.edl.clips[2]!;
    expect(head.outSec).toBeCloseTo(tail.inSec, 3);
    expect(tail.outSec).toBeCloseTo(3, 3);
  });

  it('deletes a clip and keeps the target length', () => {
    const before = makeEdl();
    const result = apply('delete_clip', before, { clipId: 'c02' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edl.clips).toHaveLength(2);
    expect(durationSec(result.edl)).toBeCloseTo(9, 2);
  });

  it('refuses to delete the last clip', () => {
    const one = makeEdl({
      clips: [makeEdl().clips[0]!],
      format: { id: 'cinematic_hero', label: 'x', targetDurationSec: 3 },
    });
    expect(apply('delete_clip', one, { clipId: 'c01' }).ok).toBe(false);
  });

  it('changes speed and keeps the film length by default', () => {
    const result = apply('set_clip_speed', makeEdl(), { clipId: 'c01', speed: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edl.clips[0]!.speed).toBe(2);
    expect(durationSec(result.edl)).toBeCloseTo(9, 2);
  });

  it('reorders only a complete permutation', () => {
    expect(apply('reorder_clips', makeEdl(), { order: ['c03', 'c01', 'c02'] }).ok).toBe(true);
    expect(apply('reorder_clips', makeEdl(), { order: ['c03', 'c01'] }).ok).toBe(false);
    expect(apply('reorder_clips', makeEdl(), { order: ['c01', 'c01', 'c02'] }).ok).toBe(false);
  });

  it('trims inside the source window and refuses to extend it', () => {
    const trimmed = apply('trim_clip', makeEdl(), { clipId: 'c01', outSec: 2, keepTarget: true });
    expect(trimmed.ok).toBe(true);
    const extended = apply('trim_clip', makeEdl(), { clipId: 'c01', outSec: 4 });
    expect(extended.ok).toBe(false);
  });

  it('sets a transition and mirrors it on the outgoing clip', () => {
    const result = apply('set_transition', makeEdl(), { clipId: 'c02', type: 'blur', durationSec: 0.4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edl.clips[1]!.transitionIn).toEqual({ type: 'blur', durationSec: 0.4 });
    expect(result.edl.clips[0]!.transitionOut).toEqual({ type: 'blur', durationSec: 0.4 });
  });

  it('refuses a transition longer than its neighbour', () => {
    const short = makeEdl({
      format: { id: 'cinematic_hero', label: 'x', targetDurationSec: 7 },
      clips: [
        makeEdl().clips[0]!,
        { ...makeEdl().clips[1]!, outSec: 1 },
        makeEdl().clips[2]!,
      ],
      overlays: [{ ...makeEdl().overlays[0]!, inSec: 3, outSec: 6 }],
    });
    const result = apply('set_transition', short, { clipId: 'c02', type: 'dissolve', durationSec: 1.2 });
    expect(result.ok).toBe(false);
  });

  it('refuses a transition on the first clip', () => {
    expect(apply('set_transition', makeEdl(), { clipId: 'c01', type: 'dissolve', durationSec: 0.3 }).ok).toBe(false);
  });
});

describe('speed ramp capability', () => {
  it('normalises speeds so the clip keeps its length', () => {
    const result = apply('speed_ramp', makeEdl(), {
      clipId: 'c01',
      points: [
        { t: 0, speed: 2 },
        { t: 0.5, speed: 1 },
        { t: 1, speed: 0.5 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clip = result.edl.clips[0]!;
    expect(clip.speed).toBe(1);
    expect(clip.speedRamp).toHaveLength(3);
    expect(clip.speedRamp?.[0]?.speed).toBeCloseTo(1.5, 3);
    expect(clip.speedRamp?.[1]?.speed).toBeCloseTo(0.75, 3);
    expect(clip.speedRamp?.[2]?.speed).toBeCloseTo(0.375, 3);
    expect(durationSec(result.edl)).toBeCloseTo(9, 2);
  });

  it('refuses malformed points and scalar speeds', () => {
    expect(apply('speed_ramp', makeEdl(), {
      clipId: 'c01', points: [{ t: 0, speed: 1 }],
    }).ok).toBe(false);
    expect(apply('speed_ramp', makeEdl(), {
      clipId: 'c01', points: [{ t: 0.2, speed: 1 }, { t: 1, speed: 1 }],
    }).ok).toBe(false);
    expect(apply('speed_ramp', makeEdl(), {
      clipId: 'c01', points: [{ t: 0, speed: 4 }, { t: 1, speed: 1 }],
    }).ok).toBe(false);
  });

  it('refuses a ramp when the clip already has a scalar speed', () => {
    const fast = apply('set_clip_speed', makeEdl(), { clipId: 'c01', speed: 2, keepTarget: false });
    expect(fast.ok).toBe(true);
    if (!fast.ok) return;
    expect(apply('speed_ramp', fast.edl, {
      clipId: 'c01', points: [{ t: 0, speed: 2 }, { t: 1, speed: 1 }],
    }).ok).toBe(false);
  });
});

describe('ramp safety', () => {
  it('never retimes a ramped clip through a scalar speed', () => {
    const ramped = apply('speed_ramp', makeEdl(), {
      clipId: 'c01',
      points: [{ t: 0, speed: 2 }, { t: 0.5, speed: 1 }, { t: 1, speed: 0.5 }],
    });
    expect(ramped.ok).toBe(true);
    if (!ramped.ok) return;

    const longer = apply('set_target_duration', ramped.edl, { targetSec: 12 });
    expect(longer.ok).toBe(true);
    if (!longer.ok) return;
    expect(longer.edl.clips[0]!.speed).toBe(1);
    expect(longer.edl.clips[0]!.speedRamp).toHaveLength(3);
    expect(durationSec(longer.edl)).toBeCloseTo(12, 2);
  });

  it('refuses a transition that needs a handle from a ramped clip', () => {
    const ramped = apply('speed_ramp', makeEdl(), {
      clipId: 'c01',
      points: [{ t: 0, speed: 2 }, { t: 1, speed: 1 }],
    });
    expect(ramped.ok).toBe(true);
    if (!ramped.ok) return;
    const transition = apply('set_transition', ramped.edl, {
      clipId: 'c02', type: 'blur', durationSec: 0.4,
    });
    expect(transition.ok).toBe(false);
  });
});
