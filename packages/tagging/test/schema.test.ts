import { describe, expect, it } from 'vitest';
import { MAX_SELLING_POINT_CHARS, TAGGING_SCHEMA, validateTags } from '../src/index';
import { validTags } from './helpers';

function withPatch(patch: Record<string, unknown>): unknown {
  return { ...validTags(), ...patch };
}

describe('TAGGING_SCHEMA', () => {
  it('is a strict, closed object schema', () => {
    const schema = TAGGING_SCHEMA as {
      additionalProperties?: unknown;
      required?: unknown;
      properties?: Record<string, unknown>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('room');
    expect(schema.required).toContain('cameraMove');
    expect(schema.required).toContain('score');
    expect(Object.keys(schema.properties ?? {})).toContain('subjectBox');
  });
});

describe('validateTags — accepted output', () => {
  it('accepts the fixture record', () => {
    expect(validateTags(validTags())).toEqual({ valid: true, issues: [] });
  });

  it('accepts a record without optional trim times or subject box', () => {
    const tags = validTags() as unknown as Record<string, unknown>;
    delete tags['bestInSec'];
    delete tags['bestOutSec'];
    delete tags['subjectBox'];
    expect(validateTags(tags).valid).toBe(true);
  });
});

describe('validateTags — room and camera move', () => {
  it('rejects a room outside the closed set', () => {
    const result = validateTags(withPatch({ room: 'garage' }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/room');
    expect(result.issues.join(' ')).toContain('allowed');
  });

  it('rejects a camera move outside the closed set', () => {
    const result = validateTags(withPatch({ cameraMove: 'zoom_in' }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/cameraMove');
  });

  it('rejects a missing room', () => {
    const tags = validTags() as unknown as Record<string, unknown>;
    delete tags['room'];
    const result = validateTags(tags);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('room');
  });
});

describe('validateTags — score and confidence', () => {
  it.each([101, -1, 100.5])('rejects an out-of-range score of %s', (score) => {
    const result = validateTags(withPatch({ score }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/score');
  });

  it('accepts the endpoints 0 and 100', () => {
    expect(validateTags(withPatch({ score: 0 })).valid).toBe(true);
    expect(validateTags(withPatch({ score: 100 })).valid).toBe(true);
  });

  it('rejects confidence above 1 and below 0', () => {
    expect(validateTags(withPatch({ confidence: 1.01 })).valid).toBe(false);
    expect(validateTags(withPatch({ confidence: -0.1 })).valid).toBe(false);
  });

  it('rejects a non-numeric score', () => {
    expect(validateTags(withPatch({ score: '82' })).valid).toBe(false);
  });
});

describe('validateTags — arrays', () => {
  it('rejects more than four selling points', () => {
    const result = validateTags(withPatch({ sellingPoints: ['a', 'b', 'c', 'd', 'e'] }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/sellingPoints');
  });

  it(`rejects a selling point longer than ${MAX_SELLING_POINT_CHARS} characters`, () => {
    const result = validateTags(withPatch({ sellingPoints: ['x'.repeat(MAX_SELLING_POINT_CHARS + 1)] }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/sellingPoints/0');
  });

  it('rejects more than four defects', () => {
    const result = validateTags(
      withPatch({ defects: ['shaky', 'blurry', 'too_dark', 'clutter', 'people'] }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/defects');
  });

  it('rejects an unknown defect', () => {
    const result = validateTags(withPatch({ defects: ['watermark'] }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/defects/0');
  });

  it('accepts an empty defect list', () => {
    expect(validateTags(withPatch({ defects: [] })).valid).toBe(true);
  });
});

describe('validateTags — trim window and subject box', () => {
  it('rejects bestOutSec that is not after bestInSec', () => {
    const result = validateTags(withPatch({ bestInSec: 5, bestOutSec: 5 }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/bestOutSec');
  });

  it('rejects negative trim times', () => {
    expect(validateTags(withPatch({ bestInSec: -0.5 })).valid).toBe(false);
  });

  it('accepts bestInSec alone', () => {
    const tags = validTags() as unknown as Record<string, unknown>;
    delete tags['bestOutSec'];
    expect(validateTags(tags).valid).toBe(true);
  });

  it('rejects subject box components outside 0..1', () => {
    const result = validateTags(withPatch({ subjectBox: { x: 0.5, y: 0.5, w: 0.3, h: 1.2 } }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('/subjectBox');
  });

  it('rejects corner coordinates masquerading as a box', () => {
    const result = validateTags(withPatch({ subjectBox: { x: 0.9, y: 0.1, w: 0.9, h: 0.2 } }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('x + w');
  });
});

describe('validateTags — strictness', () => {
  it('rejects unknown properties', () => {
    expect(validateTags(withPatch({ tagError: null })).valid).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateTags(null).valid).toBe(false);
    expect(validateTags('kitchen').valid).toBe(false);
    expect(validateTags([]).valid).toBe(false);
  });
});
