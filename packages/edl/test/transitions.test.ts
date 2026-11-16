import { describe, expect, it } from 'vitest';
import { validateEdl } from '../src/index';
import type { Clip, Edl, TransitionType } from '../src/index';
import example from '../example.edl.json';

function cloneExample(): Edl {
  return structuredClone(example) as unknown as Edl;
}

function clipAt(edl: Edl, index: number): Clip {
  const clip = edl.clips[index];
  if (!clip) throw new Error(`fixture has no clip at ${index}`);
  return clip;
}

const NEW_TRANSITIONS: TransitionType[] = ['zoom_blur', 'luma_wipe', 'light_leak'];

function expectIssue(result: ReturnType<typeof validateEdl>, code: string, path: string): void {
  expect(result.valid).toBe(false);
  expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe('marketing schema extensions', () => {
  it.each(NEW_TRANSITIONS)('round-trips %s through the schema', (type) => {
    const edl = cloneExample();
    clipAt(edl, 1).transitionIn = { type, durationSec: 0.35 };
    clipAt(edl, 0).transitionOut = { type, durationSec: 0.35 };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });

    // The JSON round-trip is the contract every consumer reads.
    const parsed = JSON.parse(JSON.stringify(edl)) as Edl;
    expect(parsed.clips[1]?.transitionIn).toEqual({ type, durationSec: 0.35 });
    expect(validateEdl(parsed).valid).toBe(true);
  });

  it('accepts the marketing_38 format id', () => {
    const edl = cloneExample();
    edl.format = { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 30 };
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('rejects an unknown transition type at the schema boundary', () => {
    const edl = cloneExample();
    const raw = JSON.parse(JSON.stringify(edl)) as Record<string, unknown>;
    const clips = raw['clips'] as Array<{ transitionIn: { type: string } }>;
    if (!clips[1]) throw new Error('fixture is missing clip 1');
    clips[1].transitionIn.type = 'spin';

    const result = validateEdl(raw);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'E_SCHEMA')).toBe(true);
  });

  it('accepts motionAtSelection on a clip', () => {
    const edl = cloneExample();
    clipAt(edl, 0).motionAtSelection = 0.42;
    expect(validateEdl(edl).valid).toBe(true);
  });
});

describe('transition handles', () => {
  it('accepts a handle no longer than its outgoing transition', () => {
    const edl = cloneExample();
    const clip = clipAt(edl, 0);
    clip.transitionOut = { type: 'zoom_blur', durationSec: 0.6 };
    clip.handleOutSec = 0.6;
    // The mirrored incoming transition must agree.
    clipAt(edl, 1).transitionIn = { type: 'zoom_blur', durationSec: 0.6 };

    expect(validateEdl(edl).valid).toBe(true);
  });

  it('reports E_HANDLE when a handle has no outgoing transition to feed', () => {
    const edl = cloneExample();
    const clip = clipAt(edl, 0);
    clip.transitionOut = { type: 'cut', durationSec: 0 };
    clip.handleOutSec = 0.3;

    expectIssue(validateEdl(edl), 'E_HANDLE', '/clips/0/handleOutSec');
  });

  it('reports E_HANDLE when the handle outlasts the transition', () => {
    const edl = cloneExample();
    const clip = clipAt(edl, 0);
    clip.transitionOut = { type: 'light_leak', durationSec: 0.2 };
    clip.handleOutSec = 0.5;
    clipAt(edl, 1).transitionIn = { type: 'light_leak', durationSec: 0.2 };

    expectIssue(validateEdl(edl), 'E_HANDLE', '/clips/0/handleOutSec');
  });
});
