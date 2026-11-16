import { describe, expect, it } from 'vitest';
import {
  CHECK_ORDER,
  checkHook,
  checkLoudness,
  checkNoRepeatedShot,
  DURATION_TOLERANCE_SEC,
  FREEZE_LIMIT_SEC,
  HOOK_WINDOW_SEC,
  jpegStats,
  LOUDNESS_TOLERANCE_LU,
  meanLumaFromJpeg,
  reviewRender,
} from '../src/index';
import {
  FACTS,
  JPEG_BLACK,
  JPEG_BLUR,
  JPEG_GRAY64,
  JPEG_GRAY128,
  JPEG_GRAY200,
  JPEG_SHARP,
  PROFILE,
  frameAt,
  makeEdl,
  makeDeps,
  perfectScores,
  visionSpy,
} from './fixtures';

const INPUT = { output: 'takes/2026-11-15-oak_vertical_v1.mp4', profile: PROFILE };

describe('reviewRender — deterministic gate', () => {
  it('passes a clean take, with all ten schema checks and no spend', async () => {
    const result = await reviewRender({ ...INPUT, edl: makeEdl(), facts: FACTS }, makeDeps());

    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
    expect(result.costUsd).toBe(0);
    expect(result.feedback).toBeUndefined();
    expect(result.checks).toHaveLength(10);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual([
      'duration',
      'no_black_frames',
      'no_freeze',
      'hook_visible',
      'loudness',
      'text_safe_area',
      'cta_legible',
      'room_order',
      'no_repeated_shot',
      'facts_present',
    ]);
    expect(result.checks.map((check) => check.id)).toEqual([...CHECK_ORDER]);
  });

  it('fails a short render without calling vision', async () => {
    const vision = visionSpy([{ scores: perfectScores(0.9) }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ durationSec: 30 - (DURATION_TOLERANCE_SEC + 1.2), vision }),
    );

    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(vision.calls).toHaveLength(0);
    expect(result.checks.find((check) => check.id === 'duration')).toMatchObject({
      passed: false,
    });
    expect(result.feedback).toBeUndefined();
  });

  it('fails black frames without calling vision', async () => {
    const vision = visionSpy([{ scores: perfectScores(0.9) }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ frames: () => JPEG_BLACK, vision }),
    );

    expect(result.verdict).toBe('fail');
    expect(result.costUsd).toBe(0);
    expect(vision.calls).toHaveLength(0);
    expect(result.checks.find((check) => check.id === 'no_black_frames')).toMatchObject({
      passed: false,
    });
  });

  it('fails a freeze held longer than the limit', async () => {
    const vision = visionSpy([{ scores: perfectScores(0.9) }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ frames: () => JPEG_GRAY128, vision }),
    );

    const freeze = result.checks.find((check) => check.id === 'no_freeze');
    expect(freeze?.passed).toBe(false);
    expect(freeze?.detail).toContain(`${(FREEZE_LIMIT_SEC).toFixed(1)} s`);
    expect(result.verdict).toBe('fail');
    expect(vision.calls).toHaveLength(0);
  });

  it('fails loudness beyond half a LU without calling vision', async () => {
    const vision = visionSpy([{ scores: perfectScores(0.9) }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ lufs: PROFILE.lufs - (LOUDNESS_TOLERANCE_LU + 0.5), vision }),
    );

    expect(result.verdict).toBe('fail');
    expect(vision.calls).toHaveLength(0);
    expect(result.checks.find((check) => check.id === 'loudness')).toMatchObject({
      passed: false,
    });
  });

  it('accepts half a LU of loudness drift and rejects more', () => {
    expect(checkLoudness({ lufs: PROFILE.lufs + 0.4, truePeak: -1.6 }, PROFILE.lufs).passed).toBe(
      true,
    );
    expect(checkLoudness({ lufs: PROFILE.lufs + 0.5, truePeak: -1.6 }, PROFILE.lufs).passed).toBe(
      true,
    );
    expect(checkLoudness({ lufs: PROFILE.lufs + 0.6, truePeak: -1.6 }, PROFILE.lufs).passed).toBe(
      false,
    );
  });

  it('fails a black hook in the first 1.5 s', async () => {
    const frames = (t: number) => (t <= HOOK_WINDOW_SEC ? JPEG_BLACK : frameAt(t).jpegBase64);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ frames }),
    );

    const hook = result.checks.find((check) => check.id === 'hook_visible');
    expect(hook?.passed).toBe(false);
    expect(hook?.detail).toContain('black');
    expect(result.verdict).toBe('fail');
  });

  it('retries a soft hook without spending on vision', async () => {
    const frames = (t: number) =>
      Math.floor(t * 5) % 2 === 0
        ? t <= HOOK_WINDOW_SEC
          ? JPEG_BLUR
          : JPEG_SHARP
        : JPEG_GRAY200;
    const vision = visionSpy([{ scores: perfectScores(0.9) }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ frames, vision }),
    );

    const hook = result.checks.find((check) => check.id === 'hook_visible');
    expect(hook?.passed).toBe(false);
    expect(hook?.detail).toContain('soft');
    expect(result.verdict).toBe('retry');
    expect(result.feedback).toContain('sharp');
    expect(result.costUsd).toBe(0);
    expect(vision.calls).toHaveLength(0);
  });

  it('retries a source shot that starts twice', async () => {
    const edl = makeEdl();
    const source = edl.clips[1];
    const target = edl.clips[2];
    if (source === undefined || target === undefined) throw new Error('fixture has too few clips');
    target.sourceId = source.sourceId;
    target.inSec = source.inSec;

    const result = await reviewRender({ ...INPUT, edl, facts: FACTS }, makeDeps());

    const repeated = result.checks.find((check) => check.id === 'no_repeated_shot');
    expect(repeated?.passed).toBe(false);
    expect(repeated?.detail).toContain(`${source.id} and ${target.id}`);
    expect(result.verdict).toBe('retry');
    expect(result.feedback).toContain('repeated shot');
  });

  it('fails facts when the confirmed price overlay is missing, and still does not pay for vision', async () => {
    const edl = makeEdl();
    edl.overlays = edl.overlays.filter((overlay) => overlay.kind !== 'price');
    const vision = visionSpy([{ scores: perfectScores(0.9) }]);

    const result = await reviewRender(
      { ...INPUT, edl, facts: FACTS },
      makeDeps({ vision }),
    );

    const facts = result.checks.find((check) => check.id === 'facts_present');
    expect(facts?.passed).toBe(false);
    expect(facts?.detail).toContain('price');
    expect(result.verdict).toBe('retry');
    expect(result.feedback).toContain('price');
    expect(result.costUsd).toBe(0);
    expect(vision.calls).toHaveLength(0);
  });

  it('rejects a price overlay that contradicts the confirmed fact', async () => {
    const edl = makeEdl();
    const price = edl.overlays.find((overlay) => overlay.kind === 'price');
    if (price === undefined) throw new Error('fixture has no price overlay');
    price.text = '£850,000';

    const result = await reviewRender({ ...INPUT, edl, facts: FACTS }, makeDeps());

    const facts = result.checks.find((check) => check.id === 'facts_present');
    expect(facts?.passed).toBe(false);
    expect(facts?.detail).toContain('confirmed price');
    expect(result.verdict).toBe('retry');
  });

  it('retries a safe-area fault with planner feedback', async () => {
    const edl = makeEdl();
    const overlay = edl.overlays.find((entry) => entry.kind === 'room_label');
    expect(overlay).toBeDefined();
    if (overlay === undefined) throw new Error('fixture has no room label');

    overlay.text = 'W'.repeat(90);
    overlay.maxWidthPct = 100;

    const result = await reviewRender({ ...INPUT, edl, facts: FACTS }, makeDeps());

    expect(result.checks.find((check) => check.id === 'text_safe_area')?.passed).toBe(false);
    expect(result.verdict).toBe('retry');
    expect(result.feedback).toMatch(/^Planner:/);
    expect(result.feedback).not.toContain('\n');
  });

  it('gives up instead of retrying a third time', async () => {
    const edl = makeEdl();
    edl.overlays = edl.overlays.filter((overlay) => overlay.kind !== 'price');

    const result = await reviewRender(
      { ...INPUT, edl, facts: FACTS, retriesUsed: 2 },
      makeDeps(),
    );

    expect(result.verdict).toBe('fail');
    expect(result.feedback).toBeUndefined();
  });

  it('throws only when the artefact cannot be read', async () => {
    const deps = {
      ...makeDeps(),
      probe: async () => {
        throw new Error('E02: ffprobe could not read the file');
      },
    };

    await expect(reviewRender({ ...INPUT, edl: makeEdl(), facts: FACTS }, deps)).rejects.toThrow(
      'E02',
    );
  });
});

describe('reviewRender — vision pass', () => {
  it('retries at 0.5 with a feedback paragraph, and records the spend', async () => {
    const vision = visionSpy([{ scores: perfectScores(0.5), costUsd: 0.004 }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ vision }),
    );

    expect(result.verdict).toBe('retry');
    expect(result.score).toBe(0.5);
    expect(result.feedback).toContain('Planner:');
    expect(result.feedback).toContain('0.50');
    expect(result.feedback).not.toContain('\n');
    expect(result.costUsd).toBe(0.004);
    expect(vision.calls).toHaveLength(1);
  });

  it('passes at 0.9 and still records the spend', async () => {
    const vision = visionSpy([{ scores: perfectScores(0.9), costUsd: 0.003 }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ vision }),
    );

    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(0.9);
    expect(result.feedback).toBeUndefined();
    expect(result.costUsd).toBe(0.003);
    expect(vision.calls).toHaveLength(1);
    expect(vision.calls[0]?.jsonSchema).toBeDefined();
  });

  it('samples exactly six frames for the reviewer', async () => {
    const vision = visionSpy([{ scores: perfectScores(0.9) }]);
    await reviewRender({ ...INPUT, edl: makeEdl(), facts: FACTS }, makeDeps({ vision }));

    const request = vision.calls[0];
    expect(request).toBeDefined();
    const user = request?.messages.find((message) => message.role === 'user');
    expect(Array.isArray(user?.content)).toBe(true);
    if (!Array.isArray(user?.content)) throw new Error('vision request has no user parts');
    expect(user.content).toHaveLength(7); // one text part + six frames
    expect(user.content.filter((part) => part.type === 'image_url')).toHaveLength(6);
  });

  it('retries once on a schema-invalid reply, then fails closed', async () => {
    const invalid = {
      adherence: 0.9,
      pacing: 0.9,
      visualQuality: 0.9,
      notes: 'Missing one axis.',
    };
    const vision = visionSpy([
      { scores: invalid, costUsd: 0.004 },
      { scores: invalid, costUsd: 0.006 },
    ]);

    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ vision }),
    );

    expect(vision.calls).toHaveLength(2);
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
    expect(result.costUsd).toBe(0.01);
  });

  it('accumulates the cost of a repair and then accepts the take', async () => {
    const invalid = { text: 'not json at all', costUsd: 0.002 };
    const vision = visionSpy([
      invalid,
      { scores: perfectScores(0.9), costUsd: 0.003 },
    ]);

    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ vision }),
    );

    expect(vision.calls).toHaveLength(2);
    expect(result.verdict).toBe('pass');
    expect(result.costUsd).toBe(0.005);
  });

  it('fails closed when the reviewer returns frames but no usable reply', async () => {
    const vision = visionSpy([{ text: '{}', costUsd: 0.001 }]);
    const result = await reviewRender(
      { ...INPUT, edl: makeEdl(), facts: FACTS },
      makeDeps({ vision }),
    );

    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
    expect(result.costUsd).toBe(0.002);
  });
});

describe('checkHook', () => {
  it('fails closed when no frame lands in the hook window', () => {
    expect(checkHook([{ t: 5, jpegBase64: JPEG_GRAY128 }])).toMatchObject({
      id: 'hook_visible',
      passed: false,
    });
  });

  it('passes a lit, detailed opening', () => {
    expect(
      checkHook([
        { t: 0.2, jpegBase64: JPEG_SHARP },
        { t: 1.0, jpegBase64: JPEG_SHARP },
      ]),
    ).toMatchObject({ id: 'hook_visible', passed: true });
  });
});

describe('checkNoRepeatedShot', () => {
  it('allows two windows from one source at different in-points', () => {
    const edl = makeEdl();
    const source = edl.clips[1];
    const target = edl.clips[2];
    if (source === undefined || target === undefined) throw new Error('fixture has too few clips');
    target.sourceId = source.sourceId;
    target.inSec = source.inSec + 1;

    expect(checkNoRepeatedShot(edl)).toMatchObject({ id: 'no_repeated_shot', passed: true });
  });
});

describe('jpegStats', () => {
  it('separates a sharp frame from a blurred one', () => {
    const sharp = jpegStats(JPEG_SHARP);
    const blur = jpegStats(JPEG_BLUR);

    expect(sharp).toBeDefined();
    expect(blur).toBeDefined();
    expect(sharp?.detail).toBeGreaterThan(0.5);
    expect(blur?.detail).toBeLessThan(0.2);
    expect(blur?.detail).toBeLessThan((sharp?.detail ?? 0) * 0.5);
    expect(sharp?.luma).toBeCloseTo(0.49, 1);
  });

  it('returns undefined for a payload that is not a baseline JPEG', () => {
    expect(jpegStats('not an image')).toBeUndefined();
    expect(jpegStats('')).toBeUndefined();
  });
});

describe('meanLumaFromJpeg', () => {
  it('reads the four fixture levels within a quantiser step', () => {
    const cases: Array<[string, number]> = [
      [JPEG_BLACK, 0],
      [JPEG_GRAY64, 64 / 255],
      [JPEG_GRAY128, 128 / 255],
      [JPEG_GRAY200, 200 / 255],
    ];

    for (const [base64, expected] of cases) {
      expect(meanLumaFromJpeg(base64)).toBeCloseTo(expected, 2);
    }
  });

  it('returns undefined for a payload that is not a baseline JPEG', () => {
    expect(meanLumaFromJpeg('not an image')).toBeUndefined();
    expect(meanLumaFromJpeg('')).toBeUndefined();
  });
});
