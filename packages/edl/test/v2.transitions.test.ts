import { describe, expect, it } from 'vitest';
import { validateEdl } from '../src/index';
import type { Edl, TransitionType } from '../src/index';
import { asJson, clipAt, codes, expectIssue, v2Edl } from './helpers';

/** The nine v2 additions from `docs/EDL_SCHEMA_CHANGES.md`. */
const V2_TRANSITIONS: TransitionType[] = [
  'dip_black',
  'dip_white',
  'blur',
  'directional_blur',
  'push_left',
  'push_right',
  'circle',
  'wipe',
  'glitch',
];

describe('v2 transition palette', () => {
  it.each(V2_TRANSITIONS)('round-trips %s through the schema', (type) => {
    const edl = v2Edl();
    clipAt(edl, 0).transitionOut = { type, durationSec: 0.35 };
    clipAt(edl, 1).transitionIn = { type, durationSec: 0.35 };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });

    const parsed = JSON.parse(JSON.stringify(edl)) as Edl;
    expect(parsed.clips[1]?.transitionIn).toEqual({ type, durationSec: 0.35 });
    expect(validateEdl(parsed).valid).toBe(true);
  });

  it('still rejects an unknown transition at the schema boundary', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    const clips = raw['clips'] as Array<{ transitionIn: { type: string } }>;
    if (!clips[1]) throw new Error('fixture is missing clip 1');
    clips[1].transitionIn.type = 'spin';

    const result = validateEdl(raw);
    expect(codes(result)).toContain('E_SCHEMA');
    expect(result.valid).toBe(false);
  });

  it('still enforces the 1.5 s transition cap', () => {
    const edl = v2Edl();
    clipAt(edl, 1).transitionIn = { type: 'glitch', durationSec: 1.6 };

    expectIssue(validateEdl(edl), 'E_TRANSITION', '/clips/1/transitionIn/durationSec');
  });

  it('keeps the seven v1 transitions working on a v2 document', () => {
    for (const type of ['cut', 'dissolve', 'slide', 'whip', 'zoom_blur', 'luma_wipe', 'light_leak'] as TransitionType[]) {
      const edl = v2Edl();
      clipAt(edl, 1).transitionIn = { type, durationSec: 0.3 };
      clipAt(edl, 0).transitionOut = { type, durationSec: 0.3 };

      expect(validateEdl(edl).valid).toBe(true);
    }
  });
});
