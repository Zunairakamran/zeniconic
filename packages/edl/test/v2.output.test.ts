import { describe, expect, it } from 'vitest';
import { assertEdl, validateEdl } from '../src/index';
import type { Audio, Output } from '../src/index';
import { asJson, codes, expectIssue, v1Edl, v2Edl } from './helpers';

describe('v2 output — happy path', () => {
  it('accepts a full output block', () => {
    const edl = v2Edl();
    edl.output = { width: 1080, height: 1920, fps: 30, videoBitrate: '8M', audioBitrate: '192k' };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it.each([
    ['videoBitrate', '6000k'],
    ['videoBitrate', '8M'],
    ['audioBitrate', '192k'],
  ] as const)('accepts %s = %s', (field, value) => {
    const edl = v2Edl();
    edl.output = { [field]: value } as Output;

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('accepts partial overrides', () => {
    const edl = v2Edl();
    edl.output = { fps: 24 };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('round-trips output, effects and grade through JSON', () => {
    const edl = v2Edl();
    edl.output = { width: 1920, height: 1080, fps: 60, videoBitrate: '12M' };
    edl.effects = [{ id: 'e1', type: 'grain', amount: 20, params: { strength: 0.2 } }];
    edl.grade = { preset: 'vivid', intensity: 0.5 };

    const parsed = asJson(edl);
    expect(parsed['output']).toEqual(edl.output);
    expect(parsed['effects']).toEqual(edl.effects);
    expect(parsed['grade']).toEqual(edl.grade);
    expect(validateEdl(parsed).valid).toBe(true);
  });
});

describe('v2 output — E_OUTPUT_RANGE', () => {
  it.each([
    ['width', 200],
    ['width', 8000],
    ['height', 200],
    ['height', 8000],
    ['fps', 120],
    ['fps', 6],
  ] as const)('rejects %s = %s', (field, value) => {
    const edl = v2Edl();
    edl.output = { [field]: value } as Output;

    expectIssue(validateEdl(edl), 'E_OUTPUT_RANGE', `/output/${field}`);
  });

  it('rejects a non-integer width', () => {
    const edl = v2Edl();
    edl.output = { width: 1080.5 };

    expectIssue(validateEdl(edl), 'E_OUTPUT_RANGE', '/output/width');
  });

  it('rejects a frame size the schema would take but the encoder cannot', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    raw['output'] = { width: '1920' };

    const result = validateEdl(raw);
    expectIssue(result, 'E_OUTPUT_RANGE', '/output/width');
    expect(codes(result)).toContain('E_SCHEMA');
  });

  it.each(['fast', '8', '8m', '8MB'])('rejects the video bitrate %s', (videoBitrate) => {
    const edl = v2Edl();
    edl.output = { videoBitrate };

    expectIssue(validateEdl(edl), 'E_OUTPUT_RANGE', '/output/videoBitrate');
  });

  it.each(['192', '192K', '192kb'])('rejects the audio bitrate %s', (audioBitrate) => {
    const edl = v2Edl();
    edl.output = { audioBitrate };

    expectIssue(validateEdl(edl), 'E_OUTPUT_RANGE', '/output/audioBitrate');
  });

  it('accepts the exact frame-size edges', () => {
    const edl = v2Edl();
    edl.output = { width: 320, height: 7680, fps: 12 };
    expect(validateEdl(edl).valid).toBe(true);
  });
});

describe('v2 audio fades', () => {
  it('accepts fadeInSec/fadeOutSec inside 0..5', () => {
    const edl = v2Edl();
    edl.audio = { ...edl.audio, fadeInSec: 0.6, fadeOutSec: 5 };

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('rejects a fade longer than 5 s at the schema boundary', () => {
    const edl = v2Edl();
    edl.audio = { ...edl.audio, fadeOutSec: 6 } as Audio;

    const result = validateEdl(edl);
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain('E_SCHEMA');
  });

  it('rejects a negative fade', () => {
    const edl = v2Edl();
    edl.audio = { ...edl.audio, fadeInSec: -1 };

    const result = validateEdl(edl);
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain('E_SCHEMA');
  });
});

describe('v2 output — assertEdl', () => {
  it('accepts a v2 document with output overrides', () => {
    const edl = v2Edl();
    edl.output = { width: 1080, height: 1920 };

    const input: unknown = edl;
    expect(() => assertEdl(input)).not.toThrow();
  });

  it('rejects an out-of-range output through assertEdl', () => {
    const edl = v2Edl();
    edl.output = { fps: 6 };

    expect(() => assertEdl(edl)).toThrow(/E_OUTPUT_RANGE/);
  });

  it('leaves 1.0.0 documents on the v1 rule set', () => {
    const edl = v1Edl();
    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });
});
