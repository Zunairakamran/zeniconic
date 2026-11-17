import { describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '../src/index';
import { asJson, clipAt, codes, expectIssue, v2Edl } from './helpers';

/** A ramp whose math is exactly the source window: 0.25/0.5 + 0.75/1.5 = 1. */
const BALANCED_RAMP = [
  { t: 0, speed: 0.5 },
  { t: 0.25, speed: 1.5 },
  { t: 1, speed: 1 },
];

describe('v2 speedRamp — happy path', () => {
  it('accepts a balanced ramp on a 4 s clip', () => {
    const edl = v2Edl();
    const clip = clipAt(edl, 1);
    clip.speed = 1;
    clip.speedRamp = BALANCED_RAMP;

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });

  it('keeps the timeline duration equal to (outSec-inSec)/speed', () => {
    const baseline = v2Edl();
    const edl = v2Edl();
    const clip = clipAt(edl, 1);
    clip.speedRamp = BALANCED_RAMP;

    expect(durationSec(edl)).toBeCloseTo(durationSec(baseline), 6);
  });

  it('accepts exactly eight points', () => {
    const edl = v2Edl();
    clipAt(edl, 1).speedRamp = [
      { t: 0, speed: 1 },
      { t: 0.14, speed: 1 },
      { t: 0.28, speed: 1 },
      { t: 0.42, speed: 1 },
      { t: 0.56, speed: 1 },
      { t: 0.7, speed: 1 },
      { t: 0.85, speed: 1 },
      { t: 1, speed: 1 },
    ];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
  });
});

describe('v2 speedRamp — E_SPEED_RAMP', () => {
  it('requires speed === 1 when a ramp is present', () => {
    const edl = v2Edl();
    const clip = clipAt(edl, 1);
    clip.speed = 1.25;
    clip.speedRamp = BALANCED_RAMP;

    expectIssue(validateEdl(edl), 'E_SPEED_RAMP', '/clips/1/speedRamp');
  });

  it('requires strictly increasing t', () => {
    const edl = v2Edl();
    clipAt(edl, 1).speedRamp = [
      { t: 0, speed: 1 },
      { t: 0.5, speed: 1 },
      { t: 0.5, speed: 1 },
      { t: 1, speed: 1 },
    ];

    expectIssue(validateEdl(edl), 'E_SPEED_RAMP', '/clips/1/speedRamp/2/t');
  });

  it('requires the first point at t = 0', () => {
    const edl = v2Edl();
    clipAt(edl, 1).speedRamp = [
      { t: 0.1, speed: 1 },
      { t: 1, speed: 1 },
    ];

    expectIssue(validateEdl(edl), 'E_SPEED_RAMP', '/clips/1/speedRamp/0/t');
  });

  it('requires the last point at t = 1', () => {
    const edl = v2Edl();
    clipAt(edl, 1).speedRamp = [
      { t: 0, speed: 1 },
      { t: 0.9, speed: 1 },
    ];

    expectIssue(validateEdl(edl), 'E_SPEED_RAMP', '/clips/1/speedRamp/1/t');
  });

  it('bounds each point speed to 0.25..4', () => {
    const edl = v2Edl();
    clipAt(edl, 1).speedRamp = [
      { t: 0, speed: 6 },
      { t: 1, speed: 1 },
    ];

    expectIssue(validateEdl(edl), 'E_SPEED_RAMP', '/clips/1/speedRamp/0/speed');
  });

  it('bounds each point t to 0..1', () => {
    const edl = v2Edl();
    clipAt(edl, 1).speedRamp = [
      { t: 0, speed: 1 },
      { t: 1.4, speed: 1 },
    ];

    expectIssue(validateEdl(edl), 'E_SPEED_RAMP', '/clips/1/speedRamp/1/t');
  });

  it('rejects fewer than two points even though the schema also does', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    const clips = raw['clips'] as Array<Record<string, unknown>>;
    clips[1] = { ...clips[1], speedRamp: [{ t: 0, speed: 1 }] };

    const result = validateEdl(raw);
    expectIssue(result, 'E_SPEED_RAMP', '/clips/1/speedRamp');
    expect(codes(result)).toContain('E_SCHEMA');
  });

  it('rejects more than eight points', () => {
    const edl = v2Edl();
    const raw = asJson(edl);
    const clips = raw['clips'] as Array<Record<string, unknown>>;
    const ramp = Array.from({ length: 9 }, (_, index) => ({ t: index / 8, speed: 1 }));
    clips[1] = { ...clips[1], speedRamp: ramp };

    const result = validateEdl(raw);
    expectIssue(result, 'E_SPEED_RAMP', '/clips/1/speedRamp');
    expect(codes(result)).toContain('E_SCHEMA');
  });
});

describe('v2 speedRamp — E_SPEED_RAMP_DURATION', () => {
  it('rejects a ramp that drifts from (outSec-inSec)/speed', () => {
    const edl = v2Edl();
    // 0.5/0.5 + 0.5/2 = 1.25 source-seconds, i.e. 5 s for a 4 s window.
    clipAt(edl, 1).speedRamp = [
      { t: 0, speed: 0.5 },
      { t: 0.5, speed: 2 },
      { t: 1, speed: 1 },
    ];

    const result = validateEdl(edl);
    expectIssue(result, 'E_SPEED_RAMP_DURATION', '/clips/1/speedRamp');
    // The drift is large enough to move the timeline too.
    expect(codes(result)).toContain('E_DURATION');
    expect(durationSec(edl)).toBeCloseTo(31, 3);
  });

  it('accepts drift inside the 0.05 s tolerance', () => {
    const edl = v2Edl();
    // 0.25/0.5 + 0.75/1.47 = 1.0102 source-seconds -> 4.041 s for a 4 s
    // window: 41 ms of drift, inside the tolerance.
    clipAt(edl, 1).speedRamp = [
      { t: 0, speed: 0.5 },
      { t: 0.25, speed: 1.47 },
      { t: 1, speed: 1 },
    ];

    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
    expect(durationSec(edl)).toBeCloseTo(30.041, 2);
  });
});
