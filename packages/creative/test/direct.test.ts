import { describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '../../edl/src/index';
import { CreativeError, direct } from '../src/index';
import type { ClipPurpose, DirectResult } from '../src/index';
import {
  beatFixture,
  hookFixture,
  makeEdl,
  marketingFixture,
  narrativeFixture,
} from './fixtures';

const GROUP: Record<ClipPurpose, number> = {
  hook: 0,
  establishing: 1,
  space: 1,
  craft: 2,
  detail: 2,
  rest: 3,
  lifestyle: 4,
  feature: 4,
  close: 5,
};

function nonCut(result: DirectResult) {
  return result.rationale.transitions.filter(
    (entry) => entry.type !== 'cut' && entry.toClipId !== '',
  );
}

describe('narrative order', () => {
  it('opens on the hook, lands on the close and keeps every clip exactly once', () => {
    const fixture = narrativeFixture();
    const originalIds = fixture.clips.map((clip) => clip.id).sort();
    const result = direct(fixture);

    expect(result.rationale.narrativeOrder[0]).toBe(result.rationale.hook.clipId);
    expect(result.rationale.narrativeOrder.at(-1)).toBe(result.rationale.close.clipId);
    expect(result.rationale.clips[0]?.purpose).toBe('hook');
    expect(result.rationale.clips.at(-1)?.purpose).toBe('close');

    const ids = result.edl.clips.map((clip) => clip.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(originalIds);

    // Phases move forward: hook → establish/space → craft/detail → rest →
    // lifestyle/feature → close. Reordering is allowed inside a phase only.
    let previous = -1;
    for (const clip of result.rationale.clips) {
      const group = GROUP[clip.purpose];
      expect(group).toBeGreaterThanOrEqual(previous);
      previous = group;
    }

    expect(result.rationale.durationDeltaSec).toBe(0);
    expect(result.rationale.durationSec).toBe(durationSec(fixture));
    expect(result.edl.clips).toHaveLength(fixture.clips.length);
  });

  it('does not repeat a room back to back when a different room is available', () => {
    const result = direct(narrativeFixture());
    const rooms = result.edl.clips.map((clip) => clip.room);
    for (let index = 1; index < rooms.length; index += 1) {
      if (rooms[index] === rooms[index - 1]) {
        // Only the three-bedroom rest beat may legitimately repeat.
        expect(rooms[index]).toBe('bedroom');
      }
    }
  });

  it('refuses an EDL whose clips do not consume a positive interval', () => {
    const broken = makeEdl({ clips: [{ room: 'living', seconds: 2 }] });
    const first = broken.clips[0];
    if (first === undefined) throw new Error('fixture has no clip');
    first.outSec = first.inSec;

    expect(validateEdl(broken).valid).toBe(false);
    expect(() => direct(broken)).toThrow(CreativeError);
  });

  it('is deterministic for the same input and options', () => {
    const first = direct(narrativeFixture(), { beatGrid: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26] });
    const second = direct(narrativeFixture(), { beatGrid: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26] });
    expect(second.edl).toEqual(first.edl);
    expect(second.rationale).toEqual(first.rationale);
  });
});

describe('hook selection', () => {
  it('prefers a strong room over the longest clip', () => {
    const fixture = hookFixture();
    const result = direct(fixture);

    // c01 is the 4.0s living shot; c02 is the 2.5s living shot and should open.
    expect(result.rationale.hook.clipId).toBe('c02');
    expect(result.edl.clips[0]?.id).toBe('c02');
    expect(result.rationale.hook.reason).toContain('not the longest');
  });

  it('never opens on a detail room when a hero room exists', () => {
    const fixture = makeEdl({
      clips: [
        { room: 'bathroom', seconds: 4.0, score: 0.99 },
        { room: 'kitchen', seconds: 3.5, score: 0.98 },
        { room: 'living', seconds: 2.0, score: 0.5 },
        { room: 'bedroom', seconds: 3.0, score: 0.9 },
      ],
    });
    const result = direct(fixture);
    expect(result.rationale.hook.room).toBe('living');
    expect(result.edl.clips[0]?.room).toBe('living');
  });
});

describe('motion', () => {
  it('varies motion instead of one zoom on every clip', () => {
    const result = direct(narrativeFixture());
    const signatures = new Set(
      result.rationale.clips.map(
        (clip) =>
          `${clip.motion.kind}:${clip.motion.fromScale}-${clip.motion.toScale}:${clip.motion.focus}`,
      ),
    );

    expect(signatures.size).toBeGreaterThanOrEqual(3);
    expect(result.rationale.clips.some((clip) => clip.motion.kind === 'pull_out')).toBe(true);
    expect(result.rationale.clips.some((clip) => clip.motion.kind === 'push_in')).toBe(true);

    const hook = result.rationale.clips[0];
    expect(hook?.motion.kind).toBe('push_in');
    expect(hook?.motion.reason).toContain('opening');

    for (const clip of result.edl.clips) {
      const path = clip.transform.path;
      expect(path.length).toBeGreaterThanOrEqual(2);
      for (const point of path) {
        expect(point.scale).toBeGreaterThanOrEqual(1);
        expect(point.scale).toBeLessThanOrEqual(2.5);
      }
    }
  });

  it('keeps focus honest: wides centred, craft details saliency', () => {
    const result = direct(narrativeFixture());
    const view = result.rationale.clips.find((clip) => clip.room === 'view');
    expect(view?.motion.focus).toBe('center');
    const bathroom = result.rationale.clips.find((clip) => clip.room === 'bathroom');
    expect(bathroom?.motion.focus).toBe('saliency');
  });
});

describe('transitions', () => {
  it('places a few earned transitions and cuts same-room boundaries', () => {
    const result = direct(narrativeFixture());
    const placed = nonCut(result);

    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(result.edl.clips.length - 1);

    for (const transition of placed) {
      expect(transition.durationSec).toBeGreaterThanOrEqual(0.18);
      expect(transition.durationSec).toBeLessThanOrEqual(0.5);
      expect(transition.reason.length).toBeGreaterThan(0);
    }

    // hook out and close in are both present.
    const types = placed.map((entry) => entry.type);
    expect(types).toContain('whip');
    expect(types).toContain('dissolve');

    // The two adjacent bedrooms stay a hard cut.
    const clips = result.edl.clips;
    const bedroomBoundary = result.rationale.clips.find(
      (clip, index) =>
        index + 1 < clips.length &&
        clip.room === 'bedroom' &&
        clips[index + 1]?.room === 'bedroom',
    );
    expect(bedroomBoundary?.transitionOut.type).toBe('cut');

    // Every boundary has a rationale, including the cuts.
    for (const clip of result.rationale.clips) {
      expect(clip.transitionOut.reason.length).toBeGreaterThan(0);
    }
  });

  it('borrows a handle equal to the transition so the film keeps its length', () => {
    const result = direct(narrativeFixture());
    for (let index = 0; index + 1 < result.edl.clips.length; index += 1) {
      const clip = result.edl.clips[index];
      if (clip === undefined) continue;
      const outgoing = clip.transitionOut;
      if (outgoing !== undefined && outgoing.type !== 'cut') {
        expect(clip.handleOutSec).toBeCloseTo(outgoing.durationSec, 6);
      } else {
        expect(clip.handleOutSec).toBeUndefined();
      }
    }
    expect(result.rationale.durationDeltaSec).toBe(0);
  });

  it('falls back to cuts when handle borrowing is disabled and no handle exists', () => {
    const result = direct(narrativeFixture(), { borrowHandles: false });
    expect(nonCut(result)).toHaveLength(0);
    expect(result.rationale.limitations.join(' ')).toContain('all cuts');
  });
});

describe('beat grid', () => {
  it('pulls a cut onto a nearby beat without changing runtime', () => {
    const fixture = beatFixture();
    const result = direct(fixture, { beatGrid: [4, 8, 12], beatToleranceSec: 0.08 });

    const move = result.rationale.beatSnapping.moves[0];
    expect(move?.applied).toBe(true);
    expect(move?.fromSec).toBe(4.05);
    expect(move?.toSec).toBe(4);

    const first = result.edl.clips[0];
    const second = result.edl.clips[1];
    expect(first?.outSec).toBeCloseTo(5.0, 6);
    expect(second?.inSec).toBeCloseTo(0.95, 6);
    expect(result.rationale.durationDeltaSec).toBe(0);
    expect(result.rationale.durationWithinTarget).toBe(true);

    const firstTransition = result.rationale.transitions[0];
    expect(firstTransition?.atSec).toBe(4);
    expect(firstTransition?.type).not.toBe('cut');
    expect(validateEdl(result.edl).valid).toBe(true);
  });

  it('does not move a cut backwards to a later beat', () => {
    const fixture = makeEdl({
      clips: [
        { room: 'living', seconds: 3.95, score: 0.9 },
        { room: 'bedroom', seconds: 3.0, score: 0.8 },
        { room: 'bedroom', seconds: 3.0, score: 0.8 },
      ],
    });
    const result = direct(fixture, { beatGrid: [4, 8], beatToleranceSec: 0.08 });
    const move = result.rationale.beatSnapping.moves[0];
    expect(move?.applied).toBe(false);
    expect(move?.reason).toContain('past the known out point');
    expect(result.rationale.durationDeltaSec).toBe(0);
  });
});

describe('grade and effects', () => {
  it('adds a house grade with no invented LUT', () => {
    const result = direct(narrativeFixture());
    expect(result.edl.grade).toBeDefined();
    expect(result.edl.grade?.lut).toBeUndefined();
    expect(result.rationale.grade.preset).toBe('luxury');
    expect(result.edl.grade?.intensity).toBeGreaterThan(0);
    expect(result.edl.grade?.intensity).toBeLessThanOrEqual(1);
    expect(result.edl.edlVersion).toBe('2.0.0');
  });

  it('treats only a few clips, at low strength', () => {
    const result = direct(narrativeFixture());
    const effected = result.edl.clips.filter((clip) => (clip.effects ?? []).length > 0);

    expect(effected.length).toBeGreaterThan(0);
    expect(effected.length).toBeLessThanOrEqual(3);
    expect(effected.length).toBeLessThan(result.edl.clips.length);

    for (const clip of effected) {
      for (const effect of clip.effects ?? []) {
        expect(['vignette', 'grain', 'sharpen']).toContain(effect.type);
        expect(effect.amount ?? 0).toBeLessThanOrEqual(20);
      }
    }
    expect(result.rationale.effects).toHaveLength(effected.length);
  });

  it('can be disabled', () => {
    const result = direct(narrativeFixture(), { addEffects: false, gradePreset: 'none' });
    expect(result.rationale.effects).toHaveLength(0);
    expect(result.edl.grade).toBeUndefined();
  });
});

describe('marketing_38', () => {
  it('keeps the planned order, price/CTA windows and existing transition', () => {
    const fixture = marketingFixture();
    const originalOrder = fixture.clips.map((clip) => clip.id);
    const originalOverlays = structuredClone(fixture.overlays);

    const result = direct(fixture);

    expect(result.rationale.marketingStructurePreserved).toBe(true);
    expect(result.edl.clips.map((clip) => clip.id)).toEqual(originalOrder);
    expect(result.edl.overlays).toEqual(originalOverlays);
    expect(result.rationale.narrativeOrder).toEqual(originalOrder);

    expect(result.edl.clips[0]?.transitionOut?.type).toBe('whip');
    expect(result.edl.clips[1]?.transitionIn?.type).toBe('whip');
    expect(result.edl.clips[0]?.handleOutSec).toBeCloseTo(0.2, 6);

    const placed = nonCut(result);
    expect(placed.length).toBeGreaterThanOrEqual(2);
    expect(placed.length).toBeLessThan(result.edl.clips.length - 1);
    expect(placed.some((entry) => entry.reason.includes('kept from the marketing beat sheet'))).toBe(true);

    expect(validateEdl(result.edl).valid).toBe(true);
    expect(result.rationale.durationSec).toBe(19.6);
    expect(result.rationale.durationDeltaSec).toBe(0);
  });

  it('can be released from the structure explicitly', () => {
    const result = direct(marketingFixture(), { preserveMarketingStructure: false });
    expect(result.rationale.marketingStructurePreserved).toBe(false);
    // With a free hand the hook is still first, but the rest is reordered.
    expect(result.edl.clips[0]?.id).toBe(result.rationale.hook.clipId);
    expect(validateEdl(result.edl).valid).toBe(true);
  });
});
