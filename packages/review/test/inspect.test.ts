import { describe, expect, it } from 'vitest';
import type { ChatClient, ChatResponse } from '@zeniconic/ai';
import { inspectRender, inspectTimes, validateInspectReply, INSPECT_SCHEMA } from '../src/inspect';
import type { FrameSample } from '../src/types';

const response = (json: unknown, text = JSON.stringify(json)): ChatResponse => ({
  text,
  json,
  usage: { promptTokens: 100, completionTokens: 50 },
  costUsd: 0.0012,
  model: 'google/gemini-4-hydrogen',
  cachedTokens: 0,
  cacheDiscountUsd: 0,
});

function client(json: unknown, text?: string): ChatClient {
  return { complete: async () => response(json, text) };
}

const good = {
  verdict: 'retry',
  score: 0.62,
  summary: 'Strong opening; the price card collides with the bottom safe area at the close.',
  issues: [
    { issue: 'price card low', severity: 'medium', atSec: 31.2, detail: 'The card sits under the caption block.' },
    { issue: 'soft frame', severity: 'low', atSec: 12.4, detail: 'The kitchen frame is slightly soft.' },
  ],
};

const deps = (overrides: Partial<Parameters<typeof inspectRender>[1]> = {}) => ({
  probe: async () => ({ durationSec: 38 }),
  sampleFrames: async (_file: string, times: number[]): Promise<FrameSample[]> =>
    times.map((t) => ({ t, jpegBase64: 'aGVsbG8=' })),
  client: client(good),
  model: 'google/gemini-4-hydrogen',
  ...overrides,
});

describe('inspectRender', () => {
  it('validates a reply and reports issues with timestamps', async () => {
    const result = await inspectRender({ file: 'export.mp4', facts: { price: 'AED 1,850,000' } }, deps());
    expect(result.verdict).toBe('retry');
    expect(result.score).toBeCloseTo(0.62);
    expect(result.issues[0]).toMatchObject({ severity: 'medium', atSec: 31.2 });
    expect(result.frames).toHaveLength(6);
    expect(result.costUsd).toBeCloseTo(0.0012);
  });

  it('accepts a fenced JSON reply', async () => {
    const result = await inspectRender(
      { file: 'export.mp4' },
      deps({ client: client(undefined, `\`\`\`json\n${JSON.stringify(good)}\n\`\`\``) }),
    );
    expect(result.summary).toContain('price card');
  });

  it('fails closed on a malformed reply', async () => {
    await expect(
      inspectRender({ file: 'export.mp4' }, deps({ client: client({ verdict: 'great' }) })),
    ).rejects.toMatchObject({ code: 'E_INSPECT_JSON' });
  });

  it('fails when no frames can be sampled', async () => {
    await expect(
      inspectRender(
        { file: 'export.mp4' },
        deps({ sampleFrames: async () => [] }),
      ),
    ).rejects.toMatchObject({ code: 'E_INSPECT_NO_FRAMES' });
  });

  it('rejects out-of-range values', () => {
    expect(validateInspectReply({ ...good, score: 2 })).toBeUndefined();
    expect(
      validateInspectReply({ ...good, issues: [{ ...good.issues[0], severity: 'urgent' }] }),
    ).toBeUndefined();
  });

  it('samples six interior points', () => {
    expect(inspectTimes(38)).toEqual([3.167, 9.5, 15.833, 22.167, 28.5, 34.833]);
    expect(INSPECT_SCHEMA.required).toContain('verdict');
  });
});
