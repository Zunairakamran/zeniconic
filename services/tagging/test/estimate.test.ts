import { describe, expect, it } from 'vitest';
import {
  assertTaggingBudget,
  estimateLines,
  estimateTaggingCost,
  TAGGING_BUDGET_USD,
  TAGGING_INPUT_TOKENS_PER_SHOT,
} from '../src/index';
import {
  TAGGING_IMAGE_TILES_PER_CALL,
  TAGGING_IMAGE_TOKENS_PER_TILE,
  TAGGING_OUTPUT_TOKENS_PER_CALL,
  TAGGING_PROMPT_MARGIN,
  TAGGING_SYSTEM_TOKENS_PER_CALL,
} from '../src/estimate';

const MODEL = 'google/gemini-3.8-flash:floor';

/** 1,800 system + 6 × 258 image tiles, plus 10 % headroom. */
const PROMPT_TOKENS_PER_CALL = Math.ceil(
  (TAGGING_SYSTEM_TOKENS_PER_CALL + TAGGING_IMAGE_TILES_PER_CALL * TAGGING_IMAGE_TOKENS_PER_TILE) *
    TAGGING_PROMPT_MARGIN,
);

describe('estimateTaggingCost', () => {
  it('prices one call as system prompt, six image tiles and the capped reply', () => {
    expect(PROMPT_TOKENS_PER_CALL).toBe(3_683);
    expect(TAGGING_INPUT_TOKENS_PER_SHOT).toBe(PROMPT_TOKENS_PER_CALL);
    expect(TAGGING_OUTPUT_TOKENS_PER_CALL).toBe(700);

    const estimate = estimateTaggingCost(19, MODEL);

    expect(estimate.shots).toBe(19);
    expect(estimate.inputTokens).toBe(19 * TAGGING_INPUT_TOKENS_PER_SHOT);
    expect(estimate.inputTokens).toBe(69_977);
    expect(estimate.outputTokens).toBe(19 * TAGGING_OUTPUT_TOKENS_PER_CALL);
    expect(estimate.outputTokens).toBe(13_300);
    // 69,977 prompt × $0.825/M + 13,300 completion × $4.125/M
    expect(estimate.usd).toBeCloseTo(0.11259353, 8);
    expect(estimate.usd).toBeLessThan(TAGGING_BUDGET_USD);
    expect(estimate.inputUsdPerMillion).toBeCloseTo(0.825, 8);
    expect(estimate.outputUsdPerMillion).toBeCloseTo(4.125, 8);
  });

  it('covers the measured 24-call bill instead of quoting a fifth of it', () => {
    const estimate = estimateTaggingCost(24, MODEL);

    // The audit's real run: 24 calls billed $0.1268 against the old $0.0238.
    expect(estimate.usd).toBeCloseTo(0.1422234, 8);
    expect(estimate.usd).toBeGreaterThan(0.1268);
    expect(estimate.usd).toBeLessThan(TAGGING_BUDGET_USD);
  });

  it('prices the variant suffix the same as the base slug', () => {
    expect(estimateTaggingCost(19, MODEL).usd).toBe(
      estimateTaggingCost(19, 'google/gemini-3.8-flash').usd,
    );
  });

  it('is zero for an empty folder and linear in shots', () => {
    const empty = estimateTaggingCost(0, MODEL);
    expect(empty.usd).toBe(0);
    expect(empty.inputTokens).toBe(0);
    expect(empty.outputTokens).toBe(0);
    expect(estimateTaggingCost(10, MODEL).usd).toBeCloseTo(estimateTaggingCost(5, MODEL).usd * 2, 6);
  });

  it('rejects a negative or fractional shot count', () => {
    expect(() => estimateTaggingCost(-1, MODEL)).toThrow(RangeError);
    expect(() => estimateTaggingCost(1.5, MODEL)).toThrow(RangeError);
  });
});

describe('dry-run estimate', () => {
  it('prints the arithmetic, both prices and the budget verdict', () => {
    const lines = estimateLines(estimateTaggingCost(19, MODEL));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('19 shots');
    expect(lines[0]).toContain('3683 prompt');
    expect(lines[0]).toContain('700 completion');
    expect(lines[0]).toContain('69977 + 13300 tokens');
    expect(lines[1]).toContain('$0.825/M in');
    expect(lines[1]).toContain('$4.125/M out');
    expect(lines[1]).toContain('$0.1126');
    expect(lines[2]).toContain('within the $1.00 tagging budget');
  });

  it('refuses a batch over the cap', () => {
    const estimate = estimateTaggingCost(2000, MODEL);

    expect(estimate.usd).toBeGreaterThan(TAGGING_BUDGET_USD);
    expect(estimateLines(estimate)[2]).toContain('OVER the $1.00 tagging budget');
    expect(() => assertTaggingBudget(estimate)).toThrow(/exceeds the \$1\.00 tagging budget/);

    let thrown: unknown;
    try {
      assertTaggingBudget(estimate);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'E_BUDGET' });
  });

  it('allows a batch exactly at the cap and refuses a cent over', () => {
    const atCap = {
      shots: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: MODEL,
      inputUsdPerMillion: 0.825,
      outputUsdPerMillion: 4.125,
      usd: 1,
    };
    expect(() => assertTaggingBudget(atCap)).not.toThrow();

    const over = { ...atCap, usd: 1.000001 };
    expect(() => assertTaggingBudget(over)).toThrow(/exceeds/);
  });
});
