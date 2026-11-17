import { describe, expect, it } from 'vitest';
import type { Edl } from '@zeniconic/edl';
import { PROFILES, buildGraphWithDiagnostics, EffectRenderError } from '../src/index';
import example from '../../edl/example.edl.json';

const BASE = example as unknown as Edl;
const PROFILE = PROFILES['vertical-social'];

function withEffects(effects: Edl['effects'], grade?: Edl['grade']): Edl {
  return {
    ...structuredClone(BASE),
    edlVersion: '2.0.0',
    ...(effects === undefined ? {} : { effects }),
    ...(grade === undefined ? {} : { grade }),
  } as Edl;
}

describe('effect lowering', () => {
  it('adds no filters for a document without effects', () => {
    const graph = buildGraphWithDiagnostics(structuredClone(BASE), PROFILE).graph;
    expect(graph).not.toContain('gblur');
    expect(graph).not.toContain('eq=');
    expect(graph).not.toContain('lut3d');
  });

  it('draws clip blur, sharpen and grade in a real filter chain', () => {
    const edl = structuredClone(BASE) as Edl;
    edl.edlVersion = '2.0.0';
    edl.clips[0] = {
      ...edl.clips[0]!,
      effects: [{ id: 'e1', type: 'blur', params: { sigma: 6 } }],
      grade: { preset: 'warm_cinematic', intensity: 1 },
    };
    edl.clips[1] = {
      ...edl.clips[1]!,
      effects: [{ id: 'e2', type: 'sharpen', params: { amount: 1.2 } }],
    };

    const graph = buildGraphWithDiagnostics(edl, PROFILE).graph;
    expect(graph).toContain('gblur=sigma=6.00');
    expect(graph).toContain('unsharp=5:5:1.20');
    expect(graph).toContain('colortemperature=temperature=');
  });

  it('applies timeline effects after the assembled picture', () => {
    const edl = withEffects([{ id: 'e1', type: 'vignette', params: { angle: 0.4 } }], { preset: 'noir' });
    const graph = buildGraphWithDiagnostics(edl, PROFILE).graph;
    const outIndex = graph.lastIndexOf('[outv]');
    expect(graph).toContain('vignette=angle=');
    expect(graph.indexOf('vignette=angle=')).toBeGreaterThan(graph.indexOf('concat'));
    expect(outIndex).toBeGreaterThan(graph.indexOf('vignette=angle='));
  });

  it('supports every registered effect type with a concrete filter', () => {
    const cases: Array<[Edl['effects'] extends (infer E)[] | undefined ? E : never, string]> = [
      [{ id: 'e1', type: 'blur' }, 'gblur'],
      [{ id: 'e1', type: 'motion_blur' }, 'tmix'],
      [{ id: 'e1', type: 'grain' }, 'noise'],
      [{ id: 'e1', type: 'vignette' }, 'vignette'],
      [{ id: 'e1', type: 'sharpen' }, 'unsharp'],
      [{ id: 'e1', type: 'chromatic_aberration' }, 'rgbashift'],
      [{ id: 'e1', type: 'saturation' }, 'eq=saturation'],
      [{ id: 'e1', type: 'exposure' }, 'eq=brightness'],
      [{ id: 'e1', type: 'contrast' }, 'eq=contrast'],
      [{ id: 'e1', type: 'lut', params: { path: 'data/luts/luxury.cube' } }, 'lut3d'],
    ] as never;

    for (const [effect, needle] of cases) {
      const graph = buildGraphWithDiagnostics(withEffects([effect]), PROFILE).graph;
      expect(graph, `${effect.type} should lower to ${needle}`).toContain(needle);
    }
  });

  it('refuses a type with no renderer instead of dropping it', () => {
    const edl = withEffects([{ id: 'e1', type: 'glow' as never }]);
    expect(() => buildGraphWithDiagnostics(edl, PROFILE)).toThrow(EffectRenderError);
  });

  it('refuses a LUT that escapes the project', () => {
    const edl = withEffects([{ id: 'e1', type: 'lut', params: { path: '../../secret.cube' } }]);
    expect(() => buildGraphWithDiagnostics(edl, PROFILE)).toThrow(/must stay inside/);
  });

  it('honours an effect window with a timeline enable expression', () => {
    const edl = withEffects([{ id: 'e1', type: 'blur', inSec: 1, outSec: 2.5 }]);
    const graph = buildGraphWithDiagnostics(edl, PROFILE).graph;
    expect(graph).toContain("enable='between(t,1.000,2.500)'");
  });
});
