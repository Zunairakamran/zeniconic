import { AiError } from './types';
import { roundCostUsd } from './cost';

export interface BudgetCaps {
  monthlyCapUsd: number;
  perCallCapUsd?: number;
  startingSpendUsd?: number;
}

function assertMoney(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`);
  }
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Tracks spend for one stage or one listing. A reservation is made before the
 * network call and replaced by the real cost afterwards, so a refusal costs
 * nothing and a crash cannot silently free money that was already spent.
 */
export class BudgetLedger {
  private readonly monthlyCapUsd: number;
  private readonly perCallCapUsd: number | undefined;
  private spent: number;
  private reserved = 0;

  constructor(caps: BudgetCaps) {
    assertMoney(caps.monthlyCapUsd, 'monthlyCapUsd');
    if (caps.perCallCapUsd !== undefined) assertMoney(caps.perCallCapUsd, 'perCallCapUsd');
    const startingSpendUsd = caps.startingSpendUsd ?? 0;
    assertMoney(startingSpendUsd, 'startingSpendUsd');

    this.monthlyCapUsd = caps.monthlyCapUsd;
    this.perCallCapUsd = caps.perCallCapUsd;
    this.spent = roundCostUsd(startingSpendUsd);
  }

  remainingUsd(): number {
    return roundCostUsd(Math.max(0, this.monthlyCapUsd - this.spent - this.reserved));
  }

  /** Throws `E_BUDGET` before any request if this call cannot fit. */
  reserve(estimatedUsd: number): void {
    assertMoney(estimatedUsd, 'estimatedUsd');
    if (this.reserved > 0) {
      throw new Error('BudgetLedger.reserve called with an active reservation; commit or release it first.');
    }
    const estimate = roundCostUsd(estimatedUsd);

    if (this.perCallCapUsd !== undefined && estimate > this.perCallCapUsd) {
      throw new AiError(
        'E_BUDGET',
        `Estimated cost ${formatUsd(estimate)} exceeds the per-call cap of ${formatUsd(this.perCallCapUsd)}.`,
      );
    }

    const available = this.monthlyCapUsd - this.spent;
    if (estimate > available) {
      throw new AiError(
        'E_BUDGET',
        `Estimated cost ${formatUsd(estimate)} exceeds the remaining budget of ${formatUsd(Math.max(0, available))} (cap ${formatUsd(this.monthlyCapUsd)}).`,
      );
    }

    this.reserved = estimate;
  }

  commit(actualUsd: number): void {
    assertMoney(actualUsd, 'actualUsd');
    this.spent = roundCostUsd(this.spent + actualUsd);
    this.reserved = 0;
  }

  release(): void {
    this.reserved = 0;
  }

  spentUsd(): number {
    return this.spent;
  }
}
