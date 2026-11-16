import { estimateCostUsd } from '@zeniconic/ai';

/**
 * Honest pre-flight cost for one tagging call.
 *
 * The old estimate charged 1,200 input tokens per shot and ignored the reply.
 * The measured run (24 shots, 24 calls) billed $0.1268 against a $0.0238
 * estimate, so a call is modelled as what it actually sends and receives:
 *
 *   1,800 prompt tokens  system prompt + tool description + JSON reply schema
 * + 6 × 258 prompt toks  the 3x2 contact sheet, one tile per frame
 * + 700 completion toks  the reply cap (room, move, points, defects, window)
 * × 1.10                prompt margin for drift and a schema-repair turn
 *
 * One shot is one call today, so the per-call number is the per-shot number.
 * The estimate stays deliberately pessimistic: the budget gate should refuse
 * early, never after the bill.
 */
export const TAGGING_SYSTEM_TOKENS_PER_CALL = 1_800;
export const TAGGING_IMAGE_TILES_PER_CALL = 6;
export const TAGGING_IMAGE_TOKENS_PER_TILE = 258;
export const TAGGING_OUTPUT_TOKENS_PER_CALL = 700;
/** 10 % headroom on the prompt side; the reply is already capped. */
export const TAGGING_PROMPT_MARGIN = 1.1;

/** Prompt tokens for one call, rounded up so the estimate never flatters. */
export const TAGGING_INPUT_TOKENS_PER_CALL = Math.ceil(
  (TAGGING_SYSTEM_TOKENS_PER_CALL + TAGGING_IMAGE_TILES_PER_CALL * TAGGING_IMAGE_TOKENS_PER_TILE) *
    TAGGING_PROMPT_MARGIN,
);

/** One call per shot is the current implementation; kept for the CLI's line. */
export const TAGGING_INPUT_TOKENS_PER_SHOT = TAGGING_INPUT_TOKENS_PER_CALL;

/** The CLI refuses a batch that would cost more than this. */
export const TAGGING_BUDGET_USD = 1;

export interface TaggingEstimate {
  shots: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** USD per million input tokens. */
  inputUsdPerMillion: number;
  /** USD per million completion tokens. */
  outputUsdPerMillion: number;
  usd: number;
}

/**
 * One million input tokens costs exactly the pinned input price, which reads
 * the price table through `estimateCostUsd` instead of copying it.
 */
function inputPricePerMillion(model: string): number {
  return estimateCostUsd(model, { promptTokens: 1_000_000, completionTokens: 0 });
}

/** Same trick on the completion side: 1M output tokens at the pinned price. */
function outputPricePerMillion(model: string): number {
  return estimateCostUsd(model, { promptTokens: 0, completionTokens: 1_000_000 });
}

/**
 * Pre-flight cost for a batch: `shots × 3,683` prompt plus `shots × 700`
 * completion tokens at the pinned prices. See the constants above for the
 * per-call breakdown; the returned `usd` is the number the budget gate uses.
 */
export function estimateTaggingCost(shots: number, model: string): TaggingEstimate {
  if (!Number.isInteger(shots) || shots < 0) {
    throw new RangeError(`Shot count must be a non-negative integer, got ${shots}.`);
  }
  const inputTokens = shots * TAGGING_INPUT_TOKENS_PER_CALL;
  const outputTokens = shots * TAGGING_OUTPUT_TOKENS_PER_CALL;
  return {
    shots,
    inputTokens,
    outputTokens,
    model,
    inputUsdPerMillion: inputPricePerMillion(model),
    outputUsdPerMillion: outputPricePerMillion(model),
    usd: estimateCostUsd(model, { promptTokens: inputTokens, completionTokens: outputTokens }),
  };
}

/** The three lines the CLI prints, before anything is sent. `--dry-run` stops here. */
export function estimateLines(estimate: TaggingEstimate, cap: number = TAGGING_BUDGET_USD): string[] {
  const plural = estimate.shots === 1 ? '' : 's';
  return [
    `${estimate.shots} shot${plural} × ${TAGGING_INPUT_TOKENS_PER_CALL} prompt + ${TAGGING_OUTPUT_TOKENS_PER_CALL} completion tokens = ${estimate.inputTokens} + ${estimate.outputTokens} tokens`,
    `${estimate.model} at $${estimate.inputUsdPerMillion.toFixed(3)}/M in, $${estimate.outputUsdPerMillion.toFixed(3)}/M out → $${estimate.usd.toFixed(4)}`,
    estimate.usd > cap
      ? `OVER the $${cap.toFixed(2)} tagging budget — refusing to run`
      : `within the $${cap.toFixed(2)} tagging budget`,
  ];
}

/**
 * Throws a typed `E_BUDGET` error instead of letting a mis-sized folder reach
 * the network. The estimate is always printed first by the caller.
 */
export function assertTaggingBudget(estimate: TaggingEstimate, cap: number = TAGGING_BUDGET_USD): void {
  if (estimate.usd <= cap) return;
  const error = new Error(
    `Estimated cost $${estimate.usd.toFixed(4)} for ${estimate.shots} shots exceeds the $${cap.toFixed(2)} tagging budget.`,
  );
  (error as Error & { code: string }).code = 'E_BUDGET';
  throw error;
}
