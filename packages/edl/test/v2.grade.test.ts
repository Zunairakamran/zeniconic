import { describe, expect, it } from 'vitest';
import { validateEdl } from '../src/index';
import type { ColorGrade } from '../src/index';
import { clipAt, expectIssue, v2Edl } from './helpers';

const NEUTRAL_GRADE: ColorGrade = {
  preset: 'natural',
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  vibrance: 0,
  intensity: 1,
};

describe('v2 grade — happy path', () => {
  it('accepts a full root grade', () => {
    const edl = v2Edl();
    edl.grade = NEUTRAL_GRADE;

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('accepts a clip grade that overrides the root', () => {
    const edl = v2Edl();
    edl.grade = { preset: 'warm_cinematic' };
    clipAt(edl, 2).grade = { preset: 'noir', exposure: -0.4 };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('accepts a grade with only a LUT', () => {
    const edl = v2Edl();
    edl.grade = { lut: 'data/luts/luxury.cube', intensity: 0.8 };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it.each(['none', 'warm_cinematic', 'cool_cinematic', 'luxury', 'natural', 'vivid', 'noir'] as const)(
    'accepts the %s preset',
    (preset) => {
      const edl = v2Edl();
      edl.grade = { preset };
      expect(validateEdl(edl).valid).toBe(true);
    },
  );
});

describe('v2 grade — E_GRADE_RANGE', () => {
  it('bounds exposure to -2..2', () => {
    const edl = v2Edl();
    edl.grade = { exposure: 3 };

    expectIssue(validateEdl(edl), 'E_GRADE_RANGE', '/grade/exposure');
  });

  it('bounds contrast to 0.5..2', () => {
    const edl = v2Edl();
    edl.grade = { contrast: 0.2 };

    expectIssue(validateEdl(edl), 'E_GRADE_RANGE', '/grade/contrast');
  });

  it('bounds saturation to 0..2', () => {
    const edl = v2Edl();
    edl.grade = { saturation: 2.5 };

    expectIssue(validateEdl(edl), 'E_GRADE_RANGE', '/grade/saturation');
  });

  it.each([
    ['temperature', -1.5],
    ['tint', 1.5],
    ['highlights', -2],
    ['shadows', 2],
    ['vibrance', 1.1],
    ['intensity', 2],
  ] as const)('bounds %s to its documented range', (field, value) => {
    const edl = v2Edl();
    edl.grade = { [field]: value } as ColorGrade;

    expectIssue(validateEdl(edl), 'E_GRADE_RANGE', `/grade/${field}`);
  });

  it('reports the clip path for a clip grade', () => {
    const edl = v2Edl();
    clipAt(edl, 4).grade = { temperature: -3 };

    expectIssue(validateEdl(edl), 'E_GRADE_RANGE', '/clips/4/grade/temperature');
  });

  it('accepts the exact range edges', () => {
    const edl = v2Edl();
    edl.grade = { exposure: 2, contrast: 0.5, saturation: 0, temperature: 1, intensity: 0 };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });
});
