import { describe, expect, it } from 'vitest';
import { durationSec } from '@zeniconic/edl';
import type { Edl } from '@zeniconic/edl';
import { PROFILES, buildGraphWithDiagnostics } from '../src/index';
import example from '../../edl/example.edl.json';

const BASE = example as unknown as Edl;
const PROFILE = PROFILES['vertical-social'];

describe('speed ramp rendering', () => {
  it('splits the clip into segments, concats them and reports the ramp duration', () => {
    const edl = structuredClone(BASE) as Edl;
    edl.edlVersion = '2.0.0';
    edl.clips[0] = {
      ...edl.clips[0]!,
      speed: 1,
      speedRamp: [
        { t: 0, speed: 1.5 },
        { t: 0.5, speed: 0.75 },
        { t: 1, speed: 0.375 },
      ],
    };
    // The ramp integrates to 1, so the clip keeps its length.
    const expected = durationSec(BASE);

    const result = buildGraphWithDiagnostics(edl, PROFILE);
    expect(result.graph).toContain('concat=n=2:v=1:a=0[cr0]');
    expect(result.graph.match(/setpts=\(PTS-STARTPTS\)\//g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(durationSec(edl)).toBeCloseTo(expected, 2);
    // The example carries xfades, so the assembled picture is shorter than the
    // sum of clip lengths; the ramp must not change that relationship.
    expect(result.durationSec).toBeCloseTo(29.1, 2);
  });

  it('refuses a ramp with a scalar speed or a transition handle', () => {
    const edl = structuredClone(BASE) as Edl;
    edl.edlVersion = '2.0.0';
    edl.clips[0] = { ...edl.clips[0]!, speed: 1, speedRamp: [{ t: 0, speed: 1 }, { t: 1, speed: 1 }] };
    expect(() => buildGraphWithDiagnostics({ ...edl, clips: [{ ...edl.clips[0]!, speed: 2 }] }, PROFILE)).toThrow(
      /scalar speed/,
    );

    const withHandle = structuredClone(edl) as Edl;
    withHandle.clips[0] = { ...withHandle.clips[0]!, handleOutSec: 0.4 };
    withHandle.clips[1] = {
      ...withHandle.clips[1]!,
      transitionIn: { type: 'dissolve', durationSec: 0.4 },
    };
    expect(() => buildGraphWithDiagnostics(withHandle, PROFILE)).toThrow(/transition handle/);
  });
});
