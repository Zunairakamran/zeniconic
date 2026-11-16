import { describe, expect, it } from 'vitest';
import { MODEL_PRICES, estimateCostUsd } from '../src/index';

describe('estimateCostUsd', () => {
  it('costs google/gemini-3.8-flash at $4.95 for 1M prompt + 1M completion', () => {
    expect(MODEL_PRICES['google/gemini-3.8-flash']).toEqual({ input: 0.825, output: 4.125 });
    expect(
      estimateCostUsd('google/gemini-3.8-flash', {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
      }),
    ).toBe(4.95);
  });

  it('prices planning tokens from the pinned table', () => {
    expect(
      estimateCostUsd('openai/gpt-6-astra', { promptTokens: 1000, completionTokens: 1000 }),
    ).toBe(0.06);
  });

  it('prices a routing variant as its base model', () => {
    const usage = { promptTokens: 12_000, completionTokens: 3000 };
    const base = estimateCostUsd('google/gemini-3.8-flash', usage);
    expect(estimateCostUsd('google/gemini-3.8-flash:floor', usage)).toBe(base);
    expect(estimateCostUsd('google/gemini-3.8-flash:nitro', usage)).toBe(base);
  });

  it('returns zero for an empty usage', () => {
    expect(estimateCostUsd('google/gemini-4-carbon', { promptTokens: 0, completionTokens: 0 })).toBe(0);
  });

  it('ignores negative and non-finite token counts', () => {
    expect(
      estimateCostUsd('google/gemini-4-carbon', {
        promptTokens: -500,
        completionTokens: Number.NaN,
      }),
    ).toBe(0);
  });

  it('throws E_UNKNOWN_MODEL instead of guessing a price', () => {
    expect(() =>
      estimateCostUsd('acme/mystery-model', { promptTokens: 1, completionTokens: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'E_UNKNOWN_MODEL' }));
  });

  it('accepts an injected price table', () => {
    const prices = { 'test/model': { input: 1, output: 2 } };
    expect(estimateCostUsd('test/model', { promptTokens: 1_000_000, completionTokens: 500_000 }, prices)).toBe(2);
  });
});
