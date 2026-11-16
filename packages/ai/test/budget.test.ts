import { describe, expect, it } from 'vitest';
import { BudgetLedger } from '../src/index';

describe('BudgetLedger', () => {
  it('reserves, commits the actual cost and reports the remainder', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 5 });

    ledger.reserve(0.5);
    expect(ledger.remainingUsd()).toBe(4.5);
    expect(ledger.spentUsd()).toBe(0);

    ledger.commit(0.4);
    expect(ledger.spentUsd()).toBe(0.4);
    expect(ledger.remainingUsd()).toBe(4.6);
  });

  it('frees a reservation on release without spending', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    ledger.reserve(0.25);
    ledger.release();
    expect(ledger.remainingUsd()).toBe(1);
    expect(ledger.spentUsd()).toBe(0);
  });

  it('honours startingSpendUsd', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 20, startingSpendUsd: 19.5 });
    expect(ledger.spentUsd()).toBe(19.5);
    expect(ledger.remainingUsd()).toBe(0.5);
  });

  it('throws E_BUDGET when the estimate exceeds the remaining cap', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 0.01 });
    expect(() => ledger.reserve(0.0501)).toThrowError(
      expect.objectContaining({ code: 'E_BUDGET' }),
    );
    expect(ledger.remainingUsd()).toBe(0.01);
  });

  it('throws E_BUDGET when the estimate exceeds the per-call cap', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 20, perCallCapUsd: 1 });
    expect(() => ledger.reserve(1.01)).toThrowError(
      expect.objectContaining({ code: 'E_BUDGET' }),
    );
    expect(() => ledger.reserve(1)).not.toThrow();
  });

  it('allows a reservation that exactly equals the remaining budget', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 0.01 });
    expect(() => ledger.reserve(0.01)).not.toThrow();
    expect(ledger.remainingUsd()).toBe(0);
  });

  it('refuses a second reservation while one is active', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    ledger.reserve(0.1);
    expect(() => ledger.reserve(0.1)).toThrowError(/active reservation/);
  });

  it('records an overspend instead of hiding it', () => {
    const ledger = new BudgetLedger({ monthlyCapUsd: 0.01 });
    ledger.reserve(0.01);
    ledger.commit(0.02);
    expect(ledger.spentUsd()).toBe(0.02);
    expect(ledger.remainingUsd()).toBe(0);
  });

  it('rejects invalid caps and amounts', () => {
    expect(() => new BudgetLedger({ monthlyCapUsd: -1 })).toThrowError(RangeError);
    expect(() => new BudgetLedger({ monthlyCapUsd: 1, perCallCapUsd: Number.NaN })).toThrowError(RangeError);
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    expect(() => ledger.commit(-0.01)).toThrowError(RangeError);
  });
});
