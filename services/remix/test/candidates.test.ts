import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_CANDIDATES, buildCandidates } from '../src/index';
import type { Candidate } from '@zeniconic/planner';
import type { Shot } from '../src/index';

function shot(index: number, startSec: number, endSec: number): Shot {
  return { index, startSec, endSec, durationSec: Math.round((endSec - startSec) * 1000) / 1000 };
}

const SOURCE = {
  sourceId: 'import_14_oak',
  src: 'imports/14-oak-avenue.mp4',
  orientation: 'landscape' as const,
};

describe('buildCandidates', () => {
  it('turns shots into planner-compatible pseudo-clips', () => {
    const candidates = buildCandidates([shot(0, 0, 3.2), shot(1, 3.2, 7.9)], SOURCE);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      id: 'import_14_oak_s001',
      shotId: 'import_14_oak_s001',
      sourceId: 'import_14_oak',
      src: 'imports/14-oak-avenue.mp4',
      room: 'unknown',
      score: 0.5,
      inSec: 0,
      outSec: 3.2,
      orientation: 'landscape',
      reason:
        'Scene 1: 3.2s window recovered from the imported video; awaiting a room tag.',
    });

    // The extras do not stop the value being used as a planner Candidate.
    const plannerCandidate: Candidate = candidates[0] as Candidate;
    expect(plannerCandidate.outSec - plannerCandidate.inSec).toBe(3.2);
  });

  it('accepts tagger and scorer placeholders', () => {
    const candidates = buildCandidates([shot(4, 12, 16)], {
      ...SOURCE,
      room: 'kitchen',
      score: 0.82,
    });

    expect(candidates[0]?.room).toBe('kitchen');
    expect(candidates[0]?.score).toBe(0.82);
    expect(candidates[0]?.reason).toContain('4s kitchen window');
  });

  it('deduplicates identical in/out pairs', () => {
    const candidates = buildCandidates(
      [shot(0, 0, 4), shot(1, 0, 4), shot(2, 4, 8)],
      SOURCE,
    );

    expect(candidates.map((candidate) => candidate.shotId)).toEqual([
      'import_14_oak_s001',
      'import_14_oak_s003',
    ]);
  });

  it('sorts by source time before applying the cap', () => {
    const shots = [shot(2, 8, 12), shot(0, 0, 4), shot(1, 4, 8)];

    const candidates = buildCandidates(shots, { ...SOURCE, maxCandidates: 2 });

    expect(candidates.map((candidate) => candidate.inSec)).toEqual([0, 4]);
    expect(candidates).toHaveLength(2);
  });

  it('defaults the cap and rejects a non-positive one', () => {
    const shots = Array.from({ length: DEFAULT_MAX_CANDIDATES + 5 }, (_, index) =>
      shot(index, index * 2, index * 2 + 2),
    );

    expect(buildCandidates(shots, SOURCE)).toHaveLength(DEFAULT_MAX_CANDIDATES);
    expect(() => buildCandidates(shots, { ...SOURCE, maxCandidates: 0 })).toThrow(RangeError);
  });

  it('skips zero-length shots and rejects empty identifiers', () => {
    expect(buildCandidates([shot(0, 2, 2)], SOURCE)).toEqual([]);
    expect(() => buildCandidates([], { ...SOURCE, sourceId: '  ' })).toThrow(RangeError);
    expect(() => buildCandidates([], { ...SOURCE, src: '' })).toThrow(RangeError);
  });
});
