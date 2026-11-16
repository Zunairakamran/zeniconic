import { AiError } from './types';
import type { Usage } from './types';

export interface ModelPrice {
  /** USD per million prompt tokens. */
  input: number;
  /** USD per million completion tokens. */
  output: number;
}

/**
 * Pinned prices copied from `services/pipeline/models.json` (pinnedAt 2026-11-15),
 * in USD per million tokens. Models billed per generated track (music) have no
 * token price and are intentionally absent: costing them token-by-token would be
 * a guess. Keep this table in lockstep with the JSON.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'google/gemini-3.8-flash': { input: 0.825, output: 4.125 },
  'openai/gpt-6-astra': { input: 10, output: 50 },
  'google/gemini-4-carbon': { input: 2, output: 10 },
  'openai/gpt-audio': { input: 2.5, output: 2.5 },
};

const TOKENS_PER_MILLION = 1_000_000;
const VARIANT_SUFFIXES = new Set(['floor', 'nitro', 'free']);

/**
 * Rounds money so binary-float dust never reaches the ledger or an assertion.
 * Cost estimates keep 8 dp; committed costs use 6 dp (see `client.ts`).
 */
export function roundCostUsd(value: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** `google/gemini-3.8-flash:floor` is priced as `google/gemini-3.8-flash`. */
function baseModelId(model: string): string {
  const separator = model.lastIndexOf(':');
  if (separator <= 0) return model;
  const suffix = model.slice(separator + 1);
  return VARIANT_SUFFIXES.has(suffix) ? model.slice(0, separator) : model;
}

function priceFor(model: string, prices: Record<string, ModelPrice>): ModelPrice {
  const direct = prices[model];
  if (direct !== undefined) return direct;
  const base = prices[baseModelId(model)];
  if (base !== undefined) return base;
  throw new AiError(
    'E_UNKNOWN_MODEL',
    `No pinned price for model "${model}". Add it to services/pipeline/models.json and MODEL_PRICES instead of guessing.`,
  );
}

function tokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Cost of a completed call. Throws `E_UNKNOWN_MODEL` rather than inventing a
 * price: an unpriced call must be fixed in the price table, not discovered on
 * the invoice.
 */
export function estimateCostUsd(
  model: string,
  usage: Usage,
  prices: Record<string, ModelPrice> = MODEL_PRICES,
): number {
  const price = priceFor(model, prices);
  const promptTokens = tokenCount(usage.promptTokens);
  const completionTokens = tokenCount(usage.completionTokens);
  return roundCostUsd(
    (promptTokens * price.input + completionTokens * price.output) / TOKENS_PER_MILLION,
  );
}
