import { describe, expect, it } from 'vitest';
import { roundTime } from '@zeniconic/core';
import type { Room } from '@zeniconic/edl';
import type { Candidate, PlannedClip, SequenceSpec } from '../src/index';
import { ROOM_ORDER, planSequence, validateSequence } from '../src/sequence';

const SPEC: SequenceSpec = {
  targetDurationSec: 10,
  minShotSec: 1.2,
  maxShotSec: 4.5,
  roomOrder: [...ROOM_ORDER],
};

type ClipInput = Partial<PlannedClip> & { shotId: string; room: Room };

function planned(input: ClipInput): PlannedClip {
  return {
    sourceId: 's_aaaaaaaa',
    src: `raw/${input.shotId}.mp4`,
    score: 0.8,
    inSec: 0,
    outSec: 100,
    durationSec: 2,
    reason: 'test shot',
    ...input,
  };
}

function candidate(shotId: string, room: Room, score = 0.8): Candidate {
  return {
    shotId,
    sourceId: `s_${shotId.replace(/[^a-f0-9]/g, '').slice(0, 8).padEnd(8, '0')}`,
    src: `raw/${shotId}.mp4`,
    room,
    score,
    inSec: 0,
    outSec: 5,
    reason: `${room} test shot`,
  };
}

const spec = (overrides: Partial<SequenceSpec> = {}): SequenceSpec => ({ ...SPEC, ...overrides });

describe('validateSequence', () => {
  it('accepts a well-formed sequence', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'exterior', durationSec: 4, inSec: 0 }),
      planned({ shotId: 'c_2', room: 'living', durationSec: 3, inSec: 5 }),
      planned({ shotId: 'c_3', room: 'view', durationSec: 3, inSec: 10 }),
    ];

    expect(validateSequence(clips, spec())).toEqual([]);
  });

  it('rejects a sequence two seconds off target with E_SEQUENCE_DURATION', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'exterior', durationSec: 2.667 }),
      planned({ shotId: 'c_2', room: 'living', durationSec: 2.667 }),
      planned({ shotId: 'c_3', room: 'view', durationSec: 2.666 }),
    ];

    const issues = validateSequence(clips, spec());
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'E_SEQUENCE_DURATION', path: '/targetDurationSec' }),
    );
  });

  it('rejects a 0.5s clip with E_SEQUENCE_MIN_SHOT', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'exterior', durationSec: 0.5 }),
      planned({ shotId: 'c_2', room: 'living', durationSec: 4.75 }),
      planned({ shotId: 'c_3', room: 'view', durationSec: 4.75 }),
    ];

    expect(validateSequence(clips, spec())).toContainEqual(
      expect.objectContaining({ code: 'E_SEQUENCE_MIN_SHOT', path: '/clips/0/durationSec' }),
    );
  });

  it('rejects a consecutively repeated room with E_SEQUENCE_ROOM_REPEAT', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'living', durationSec: 4.5 }),
      planned({ shotId: 'c_2', room: 'living', durationSec: 4.5 }),
    ];

    expect(validateSequence(clips, spec())).toContainEqual(
      expect.objectContaining({ code: 'E_SEQUENCE_ROOM_REPEAT', path: '/clips/1/room' }),
    );
  });

  it('rejects a repeated shot with E_SEQUENCE_SHOT_REPEAT', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'living', durationSec: 4.5, inSec: 0 }),
      planned({ shotId: 'c_2', room: 'kitchen', durationSec: 3, inSec: 6 }),
      planned({ shotId: 'c_1', room: 'living', durationSec: 2.5, inSec: 0 }),
    ];

    expect(validateSequence(clips, spec())).toContainEqual(
      expect.objectContaining({ code: 'E_SEQUENCE_SHOT_REPEAT', path: '/clips/2/shotId' }),
    );
  });

  it('allows an explicit return shot at a different timecode', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'living', durationSec: 4.5, inSec: 0 }),
      planned({ shotId: 'c_2', room: 'kitchen', durationSec: 3, inSec: 6 }),
      planned({
        shotId: 'c_1',
        room: 'living',
        durationSec: 2.5,
        inSec: 12,
        isReturn: true,
      }),
    ];

    expect(validateSequence(clips, spec())).toEqual([]);
  });

  it('still rejects a return that reuses the same timecode', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'living', durationSec: 4.5, inSec: 0 }),
      planned({ shotId: 'c_2', room: 'kitchen', durationSec: 3, inSec: 6 }),
      planned({ shotId: 'c_1', room: 'living', durationSec: 2.5, inSec: 0, isReturn: true }),
    ];

    expect(validateSequence(clips, spec())).toContainEqual(
      expect.objectContaining({ code: 'E_SEQUENCE_SHOT_REPEAT' }),
    );
  });

  it('rejects clips over the maximum length and over their source window', () => {
    const clips = [
      planned({ shotId: 'c_1', room: 'exterior', durationSec: 5, outSec: 10 }),
      planned({ shotId: 'c_2', room: 'living', durationSec: 3, outSec: 2 }),
      planned({ shotId: 'c_3', room: 'view', durationSec: 2, outSec: 10 }),
    ];

    const codes = validateSequence(clips, spec()).map((issue) => issue.code);
    expect(codes).toContain('E_SEQUENCE_MAX_SHOT');
    expect(codes).toContain('E_SEQUENCE_SOURCE_WINDOW');
  });

  it('gives every failure mode a distinct code', () => {
    const cases: PlannedClip[][] = [
      [
        planned({ shotId: 'c_1', room: 'exterior', durationSec: 2 }),
        planned({ shotId: 'c_2', room: 'living', durationSec: 2 }),
        planned({ shotId: 'c_3', room: 'view', durationSec: 2 }),
      ],
      [
        planned({ shotId: 'c_1', room: 'exterior', durationSec: 0.5 }),
        planned({ shotId: 'c_2', room: 'living', durationSec: 4.75 }),
        planned({ shotId: 'c_3', room: 'view', durationSec: 4.75 }),
      ],
      [
        planned({ shotId: 'c_1', room: 'living', durationSec: 4.5, inSec: 0 }),
        planned({ shotId: 'c_2', room: 'living', durationSec: 4.5 }),
      ],
      [
        planned({ shotId: 'c_1', room: 'living', durationSec: 4.5, inSec: 0 }),
        planned({ shotId: 'c_2', room: 'kitchen', durationSec: 3 }),
        planned({ shotId: 'c_1', room: 'living', durationSec: 2.5, inSec: 0 }),
      ],
    ];

    const codes = cases.map((clips) => validateSequence(clips, spec())[0]?.code);
    expect(new Set(codes).size).toBe(cases.length);
    expect(codes.every((code) => typeof code === 'string')).toBe(true);
  });
});

describe('planSequence duration and cuts', () => {
  it('snaps internal cuts to nearby beats without drifting the total', () => {
    const clips = planSequence(
      [
        candidate('sh_a_001', 'living'),
        candidate('sh_b_002', 'kitchen'),
        candidate('sh_c_003', 'dining'),
      ],
      spec(),
      'calm',
      Array.from({ length: 41 }, (_, index) => roundTime(index * 0.5)),
    );

    expect(clips.map((clip) => clip.durationSec)).toEqual([3.5, 3, 3.5]);
    expect(roundTime(clips.reduce((sum, clip) => sum + clip.durationSec, 0))).toBe(10);

    let cursor = 0;
    for (const clip of clips.slice(0, -1)) {
      cursor = roundTime(cursor + clip.durationSec);
      expect(Math.abs(cursor * 2 - Math.round(cursor * 2))).toBeLessThan(1e-9);
    }
  });

  it('never exceeds a shot\'s source window or the clip bounds', () => {
    const clips = planSequence(
      [
        { ...candidate('sh_a_001', 'living'), outSec: 1.5 },
        candidate('sh_b_002', 'kitchen'),
        candidate('sh_c_003', 'dining'),
        candidate('sh_d_004', 'bedroom'),
      ],
      spec(),
      'social',
      [],
    );

    expect(clips.length).toBeGreaterThan(1);
    for (const clip of clips) {
      expect(clip.durationSec).toBeGreaterThanOrEqual(1.2);
      expect(clip.durationSec).toBeLessThanOrEqual(4.5);
      expect(clip.durationSec).toBeLessThanOrEqual(
        roundTime(clip.outSec - clip.inSec) + 1e-9,
      );
    }
  });

  it('keeps the sequence valid for a look that wants few cuts', () => {
    const clips = planSequence(
      [
        candidate('sh_a_001', 'exterior', 0.9),
        candidate('sh_b_002', 'entry', 0.7),
        candidate('sh_c_003', 'living', 0.8),
        candidate('sh_d_004', 'kitchen', 0.6),
        candidate('sh_e_005', 'view', 0.85),
      ],
      spec({ targetDurationSec: 20 }),
      'calm',
      [],
    );

    expect(validateSequence(clips, spec({ targetDurationSec: 20 }))).toEqual([]);
  });

  it('throws a clear error when the pool cannot fill the target', () => {
    expect(() =>
      planSequence(
        [
          candidate('sh_a_001', 'living'),
          candidate('sh_b_002', 'kitchen'),
          candidate('sh_c_003', 'dining'),
        ],
        spec({ targetDurationSec: 30 }),
        'calm',
        [],
      ),
    ).toThrow(/can fill at most/);
  });
});
