import { describe, expect, it } from 'vitest';
import { durationSec, EDL_VERSION, EDL_VERSION_2, migrateEdl, validateEdl } from '../src/index';
import type { Edl } from '../src/index';
import example from '../example.edl.json';
import { v1Edl, v2Edl } from './helpers';

function issuePairs(result: ReturnType<typeof validateEdl>): Array<[string, string]> {
  return result.issues.map((issue) => [issue.code, issue.path]);
}

describe('v1 regression — the committed 1.0.0 fixture', () => {
  it('still validates with zero issues', () => {
    expect(validateEdl(example)).toEqual({ valid: true, issues: [] });
  });

  it('keeps edlVersion 1.0.0 and an unchanged 30 s duration', () => {
    const edl = v1Edl();

    expect(edl.edlVersion).toBe(EDL_VERSION);
    expect(durationSec(edl)).toBe(30);
    expect(durationSec(structuredClone(example) as unknown as Edl)).toBe(30);
  });

  it('produces exactly the same issue list as before v2', () => {
    const edl = v1Edl();
    edl.format.targetDurationSec = 20;
    const clip = edl.clips[1];
    if (!clip) throw new Error('fixture has no clip 1');
    clip.outSec = clip.inSec;

    expect(issuePairs(validateEdl(edl))).toEqual([
      ['E_OUT_LE_IN', '/clips/1/outSec'],
      ['E_DURATION', '/format/targetDurationSec'],
      ['E_OVERLAY_RANGE', '/overlays/2/outSec'],
      ['E_OVERLAY_RANGE', '/overlays/3/outSec'],
      ['E_OVERLAY_RANGE', '/overlays/4/outSec'],
    ]);
  });

  it('does not run v2 rules on a 1.0.0 document', () => {
    const baseline = issuePairs(validateEdl(v1Edl()));

    const edl = v1Edl() as Edl & {
      grade?: unknown;
      output?: unknown;
      effects?: unknown;
    };
    edl.grade = { exposure: 99 };
    edl.output = { fps: 1 };
    edl.effects = [{ id: 'e1', type: 'grain', outSec: 999 }];

    // 1.0.0 is validated with the v1 rules only; migrate first to get the v2
    // checks. (Both documents still fail the schema if a field is malformed.)
    expect(issuePairs(validateEdl(edl))).toEqual(baseline);
  });

  it('survives the migration with identical duration and clips', () => {
    const v1 = v1Edl();
    const migrated = migrateEdl(v1);

    expect(migrated.edlVersion).toBe(EDL_VERSION_2);
    expect(durationSec(migrated)).toBe(durationSec(v1));
    expect(migrated.clips).toEqual(v1.clips);
    expect(migrated.captions).toEqual(v1.captions);
    expect(migrated.overlays).toEqual(v1.overlays);
    expect(validateEdl(migrated)).toEqual({ valid: true, issues: [] });
  });

  it('keeps a migrated v1 document issue-free when no v2 field is set', () => {
    const edl = v2Edl();

    expect(edl.output).toBeUndefined();
    expect(edl.effects).toBeUndefined();
    expect(edl.grade).toBeUndefined();
    expect(edl.clips.every((clip) => clip.effects === undefined && clip.speedRamp === undefined)).toBe(true);
    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });
});
