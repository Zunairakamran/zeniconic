import { describe, expect, it } from 'vitest';
import { assertEdl, durationSec, validateEdl } from '../src/index';
import type { Effect, EffectType } from '../src/index';
import { asJson, clipAt, codes, expectIssue, v2Edl } from './helpers';

const PARAMS_BY_TYPE: Record<EffectType, Effect['params']> = {
  blur: { sigma: 20 },
  motion_blur: { angle: 90, length: 20 },
  glow: { sigma: 10, intensity: 0.5 },
  grain: { strength: 0.3 },
  vignette: { angle: 0.4 },
  sharpen: { amount: 1 },
  chromatic_aberration: { offset: 2 },
  saturation: { value: 1.2 },
  exposure: { value: -0.5 },
  contrast: { value: 1.1 },
  lut: { path: 'data/luts/warm.cube' },
  stabilize: { shakiness: 5, accuracy: 5 },
};

describe('v2 effects — happy path', () => {
  it.each(Object.keys(PARAMS_BY_TYPE) as EffectType[])('accepts a %s effect with its params', (type) => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type, params: PARAMS_BY_TYPE[type] }];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });

    const parsed = asJson(edl);
    expect(parsed['effects']).toEqual(edl.effects);
  });

  it('accepts clip-scoped effects, a bounded window and enabled:false', () => {
    const edl = v2Edl();
    clipAt(edl, 1).effects = [
      { id: 'e1', type: 'blur', amount: 40, inSec: 0.5, outSec: 2, params: { sigma: 12 } },
      { id: 'e2', type: 'grain', enabled: false, params: { strength: 0.2 } },
    ];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('lets the same effect id live in two scopes', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'vignette', params: { angle: 0.3 } }];
    clipAt(edl, 2).effects = [{ id: 'e1', type: 'sharpen', params: { amount: 1.5 } }];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('defaults an unspecified window to the whole scope', () => {
    const edl = v2Edl();
    clipAt(edl, 1).effects = [{ id: 'e1', type: 'contrast', inSec: 1 }];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('accepts window edges exactly on the scope boundary', () => {
    const edl = v2Edl();
    const clip = clipAt(edl, 1);
    clip.effects = [{ id: 'e1', type: 'glow', inSec: 0, outSec: clip.outSec - clip.inSec }];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('narrows through assertEdl', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'noir' as EffectType }];
    // The schema rejects the bogus type, so assertEdl throws rather than
    // silently accepting an unrenderable effect.
    expect(() => assertEdl(edl)).toThrow();
  });
});

describe('v2 effects — stable codes', () => {
  it('reports E_EFFECT_TYPE for an unknown type', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    raw['effects'] = [{ id: 'e1', type: 'spin' }];

    const result = validateEdl(raw);
    expectIssue(result, 'E_EFFECT_TYPE', '/effects/0/type');
    expect(codes(result)).toContain('E_SCHEMA');
  });

  it('reports E_EFFECT_PARAM for a parameter the type does not have', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'blur', params: { sigma: 10, radius: 4 } }];

    expectIssue(validateEdl(edl), 'E_EFFECT_PARAM', '/effects/0/params/radius');
  });

  it('reports E_EFFECT_PARAM when a numeric parameter is a string', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'blur', params: { sigma: '12' } }];

    expectIssue(validateEdl(edl), 'E_EFFECT_PARAM', '/effects/0/params/sigma');
  });

  it('reports E_EFFECT_RANGE when a parameter is outside its table bounds', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'blur', params: { sigma: 80 } }];

    expectIssue(validateEdl(edl), 'E_EFFECT_RANGE', '/effects/0/params/sigma');
  });

  it('reports E_EFFECT_RANGE when amount leaves 0..100', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'grain', amount: 140 }];

    expectIssue(validateEdl(edl), 'E_EFFECT_RANGE', '/effects/0/amount');
  });

  it('reports E_EFFECT_RANGE when a clip effect window leaves the clip', () => {
    const edl = v2Edl();
    clipAt(edl, 1).effects = [{ id: 'e1', type: 'blur', inSec: 0, outSec: 9 }];

    expectIssue(validateEdl(edl), 'E_EFFECT_RANGE', '/clips/1/effects/0/outSec');
  });

  it('reports E_EFFECT_RANGE when a root effect window leaves the timeline', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'grain', outSec: 31 }];

    expectIssue(validateEdl(edl), 'E_EFFECT_RANGE', '/effects/0/outSec');
  });

  it('reports E_EFFECT_RANGE for a zero-length window', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'grain', inSec: 2, outSec: 2 }];

    expectIssue(validateEdl(edl), 'E_EFFECT_RANGE', '/effects/0/outSec');
  });

  it('reports E_EFFECT_ID when a scope reuses an id', () => {
    const edl = v2Edl();
    edl.effects = [
      { id: 'e1', type: 'grain', params: { strength: 0.2 } },
      { id: 'e1', type: 'vignette', params: { angle: 0.2 } },
    ];

    expectIssue(validateEdl(edl), 'E_EFFECT_ID', '/effects/1/id');
  });

  it('reports E_EFFECT_ID inside a clip scope', () => {
    const edl = v2Edl();
    clipAt(edl, 2).effects = [
      { id: 'e1', type: 'grain' },
      { id: 'e1', type: 'blur' },
    ];

    expectIssue(validateEdl(edl), 'E_EFFECT_ID', '/clips/2/effects/1/id');
  });
});

describe('v2 LUT paths', () => {
  it('accepts a repo-relative cube under data/luts', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'lut', params: { path: 'data/luts/teal-orange_v2.cube' } }];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it.each(['../secrets.cube', 'data/../../etc/passwd.cube', '/abs/data/luts/x.cube', 'C:/luts/x.cube'])(
    'reports E_LUT_PATH for %s',
    (path) => {
      const edl = v2Edl();
      edl.effects = [{ id: 'e1', type: 'lut', params: { path } }];

      expectIssue(validateEdl(edl), 'E_LUT_PATH', '/effects/0/params/path');
    },
  );

  it('rejects a non-.cube effect path at runtime', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'lut', params: { path: 'data/luts/warm.png' } }];

    const result = validateEdl(edl);
    expectIssue(result, 'E_LUT_PATH', '/effects/0/params/path');
    expect(codes(result)).toEqual(['E_LUT_PATH']);
  });

  it('applies the same rule to a grade LUT', () => {
    const edl = v2Edl();
    edl.grade = { lut: '../escape.cube' };

    expectIssue(validateEdl(edl), 'E_LUT_PATH', '/grade/lut');
  });
});

describe('v2 effects — duration is untouched', () => {
  it('does not change the timeline when effects are added', () => {
    const edl = v2Edl();
    edl.effects = [{ id: 'e1', type: 'blur', params: { sigma: 4 } }];
    clipAt(edl, 0).effects = [{ id: 'e1', type: 'grain', params: { strength: 0.4 } }];

    expect(durationSec(edl)).toBe(durationSec(v2Edl()));
  });
});
