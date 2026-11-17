import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COST_LEDGER_FILE,
  COST_LEDGER_VERSION,
  CostLedger,
  CostLedgerError,
  makeEntryId,
  sanitiseLedgerEntry,
} from '../src/index';
import type { BudgetCaps, LedgerEntry } from '../src/index';

const CAPS: BudgetCaps = {
  monthlyCapUsd: 20,
  dailyCapUsd: 5,
  perListingDefaultUsd: 1,
  perListingAbsoluteUsd: 2,
};

const TODAY = '2026-11-15T12:00:00.000Z';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'zeniconic-ledger-'));
  roots.push(root);
  return root;
}

async function exists(path: string): Promise<boolean> {
  return fs
    .stat(path)
    .then(() => true)
    .catch(() => false);
}

function clockAt(iso: string): () => Date {
  return () => new Date(iso);
}

function quiet(): () => void {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return () => spy.mockRestore();
}

function ledger(root: string, now = TODAY, caps: BudgetCaps = CAPS): CostLedger {
  return new CostLedger(root, { clock: clockAt(now), caps });
}

function entry(id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id,
    at: TODAY,
    role: 'agent',
    model: 'deepseek/deepseek-v4.1-flash',
    promptTokens: 1000,
    completionTokens: 200,
    costUsd: 0.25,
    ...overrides,
  };
}

/** Writes a raw envelope, bypassing the ledger, to simulate a bad file. */
async function writeEnvelope(root: string, value: unknown): Promise<void> {
  await fs.writeFile(join(root, COST_LEDGER_FILE), JSON.stringify(value), 'utf8');
}

afterEach(async () => {
  vi.restoreAllMocks();
  const pending = roots.splice(0);
  await Promise.all(pending.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('CostLedger storage', () => {
  it('reports an empty summary and does not invent a file', async () => {
    const root = await makeRoot();
    const cost = ledger(root);

    const summary = await cost.summary();
    expect(summary).toEqual({ todayUsd: 0, monthUsd: 0, allUsd: 0, entries: [] });
    expect(summary.lastAt).toBeUndefined();
    expect(await exists(join(root, COST_LEDGER_FILE))).toBe(false);
  });

  it('round-trips an entry through a fresh instance', async () => {
    const root = await makeRoot();
    const first = ledger(root);
    const recorded = await first.record({
      role: 'agent',
      model: 'deepseek/deepseek-v4.1-flash',
      listingId: 'oak-avenue',
      runId: 'run-1',
      promptTokens: 1200,
      completionTokens: 300,
      costUsd: 0.000288,
    });

    const second = ledger(root);
    const { entries } = await second.summary();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(recorded);
    expect(recorded.id).toMatch(/^led_\d{17}_\d{6}$/);
    expect(await exists(join(root, COST_LEDGER_FILE))).toBe(true);
  });

  it('tolerates a corrupt file and starts empty', async () => {
    const root = await makeRoot();
    const restore = quiet();
    await fs.writeFile(join(root, COST_LEDGER_FILE), '{ this is not json', 'utf8');

    const cost = ledger(root);
    await expect(cost.summary()).resolves.toEqual({
      todayUsd: 0,
      monthUsd: 0,
      allUsd: 0,
      entries: [],
    });

    // A record over a corrupt file still succeeds and produces a valid file.
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.01 });
    const { entries } = await cost.summary();
    expect(entries).toHaveLength(1);
    restore();
  });

  it('ignores an envelope with the wrong version', async () => {
    const root = await makeRoot();
    const restore = quiet();
    await writeEnvelope(root, {
      version: COST_LEDGER_VERSION + 1,
      updatedAt: TODAY,
      nextSequence: 3,
      entries: [entry('led_20261115120000000_000001')],
    });

    const cost = ledger(root);
    await expect(cost.list()).resolves.toEqual([]);
    restore();
  });

  it('drops invalid rows and unknown keys on load', async () => {
    const root = await makeRoot();
    const restore = quiet();
    await writeEnvelope(root, {
      version: COST_LEDGER_VERSION,
      updatedAt: TODAY,
      nextSequence: 9,
      entries: [
        entry('led_1'),
        { ...entry('led_2'), costUsd: -1 },
        { ...entry('led_3'), role: '' },
        { ...entry('led_4'), at: 'not-a-date' },
        { ...entry('led_5'), promptTokens: 1.5 },
        { ...entry('led_1'), costUsd: 99 },
        { ...entry('led_6'), listingId: 42 },
        { ...entry('led_7'), sneaky: 'field' },
        { ...entry('led_8'), costUsd: Number.NaN },
        'not an object',
      ],
    });

    const cost = ledger(root);
    const entries = await cost.list();

    expect(entries.map((row) => row.id)).toEqual(['led_1', 'led_7']);
    expect(entries[0]?.costUsd).toBe(0.25);
    expect(Object.keys(entries[1] ?? {})).not.toContain('sneaky');
    restore();
  });

  it('rejects an entry the caller cannot justify', async () => {
    const root = await makeRoot();
    const cost = ledger(root);

    await expect(
      cost.record({ role: '', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.01 }),
    ).rejects.toBeInstanceOf(CostLedgerError);
    await expect(
      cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: -0.01 }),
    ).rejects.toThrow(/costUsd/);
    await expect(
      cost.record({
        role: 'agent',
        model: 'deepseek/deepseek-v4.1-flash',
        promptTokens: -5,
        costUsd: 0.01,
      }),
    ).rejects.toThrow(/promptTokens/);
  });

  it('defaults token counts to zero and generates deterministic ids', async () => {
    const root = await makeRoot();
    const cost = ledger(root);

    const a = await cost.record({ role: 'tagging', model: 'perceptron/perceptron-mk1.5', costUsd: 0.03 });
    const b = await cost.record({ role: 'tagging', model: 'perceptron/perceptron-mk1.5', costUsd: 0.03 });

    expect(a.promptTokens).toBe(0);
    expect(a.completionTokens).toBe(0);
    // Fixed clock + persisted sequence: the same inputs can never collide.
    expect(a.id).toBe(makeEntryId(new Date(TODAY), 0));
    expect(b.id).toBe(makeEntryId(new Date(TODAY), 1));
    expect(a.id).not.toBe(b.id);
  });

  it('keeps every row when records run concurrently', async () => {
    const root = await makeRoot();
    const cost = ledger(root);

    const records = Array.from({ length: 25 }, (_, index) =>
      cost.record({
        role: 'agent',
        model: 'deepseek/deepseek-v4.1-flash',
        listingId: `listing-${index % 3}`,
        runId: `run-${index}`,
        costUsd: 0.01,
      }),
    );
    const written = await Promise.all(records);
    await cost.flush();

    const entries = await cost.list();
    expect(entries).toHaveLength(25);
    expect(new Set(entries.map((row) => row.id)).size).toBe(25);
    expect(entries.map((row) => row.runId)).toEqual(written.map((row) => row.runId));

    // Nothing was lost on reload either.
    const reloaded = await ledger(root).list();
    expect(reloaded).toEqual(entries);
  });

  it('preserves stable append order across reloads', async () => {
    const root = await makeRoot();
    const cost = ledger(root);

    for (const id of ['c', 'a', 'b']) {
      await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', runId: id, costUsd: 0.1 });
    }

    expect((await cost.list()).map((row) => row.runId)).toEqual(['c', 'a', 'b']);
    expect((await ledger(root).list()).map((row) => row.runId)).toEqual(['c', 'a', 'b']);
  });

  it('ignores a leftover temp file from a crash mid-write', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', runId: 'kept', costUsd: 0.2 });

    // Simulate a crash between write and rename: half an envelope, never renamed.
    await fs.writeFile(join(root, `${COST_LEDGER_FILE}.tmp`), '{"version":1,"entries":[{', 'utf8');

    const afterCrash = await ledger(root).list();
    expect(afterCrash.map((row) => row.runId)).toEqual(['kept']);

    // The next write replaces the temp file and publishes a complete envelope.
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', runId: 'next', costUsd: 0.1 });
    expect(await exists(join(root, `${COST_LEDGER_FILE}.tmp`))).toBe(false);
    expect((await ledger(root).list()).map((row) => row.runId)).toEqual(['kept', 'next']);
  });

  it('clears memory and disk on reset()', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.4 });

    await cost.reset();

    await expect(cost.list()).resolves.toEqual([]);
    expect(await exists(join(root, COST_LEDGER_FILE))).toBe(false);
    await expect(cost.evaluate({ amountUsd: 1 })).resolves.toMatchObject({ allowed: true });
  });

  it('sanitises a row without inventing values', () => {
    expect(sanitiseLedgerEntry(entry('led_1'))).toEqual(entry('led_1'));
    expect(sanitiseLedgerEntry({ ...entry('led_2'), costUsd: 'free' })).toBeUndefined();
    expect(sanitiseLedgerEntry(null)).toBeUndefined();
  });
});

describe('CostLedger summary', () => {
  it('totals across UTC day and month boundaries', async () => {
    const root = await makeRoot();
    const cost = ledger(root);

    const rows: Array<[string, number]> = [
      ['2026-10-31T23:59:59.000Z', 0.1],
      ['2026-11-01T00:00:00.000Z', 0.2],
      ['2026-11-14T23:59:59.000Z', 0.3],
      ['2026-11-15T00:00:00.000Z', 0.4],
      ['2026-11-15T23:59:59.000Z', 0.5],
    ];
    for (const [at, costUsd] of rows) {
      await cost.record({ at, role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd });
    }

    const summary = await cost.summary('2026-11-15T12:00:00.000Z');
    expect(summary.todayUsd).toBeCloseTo(0.9, 8);
    expect(summary.monthUsd).toBeCloseTo(1.4, 8);
    expect(summary.allUsd).toBeCloseTo(1.5, 8);
    expect(summary.entries).toHaveLength(5);
    expect(summary.lastAt).toBe('2026-11-15T23:59:59.000Z');

    // A different `now` moves both windows without changing the lifetime total.
    const nextMonth = await cost.summary('2026-12-02T09:00:00.000Z');
    expect(nextMonth.todayUsd).toBe(0);
    expect(nextMonth.monthUsd).toBe(0);
    expect(nextMonth.allUsd).toBeCloseTo(1.5, 8);
  });

  it('uses the injected clock when no time is passed', async () => {
    const root = await makeRoot();
    const cost = ledger(root, '2026-11-15T08:00:00.000Z');
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.75 });

    const summary = await cost.summary();
    expect(summary.todayUsd).toBeCloseTo(0.75, 8);
    expect(summary.entries[0]?.at).toBe('2026-11-15T08:00:00.000Z');
  });

  it('returns copies so a caller cannot mutate the ledger', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.2 });

    const [row] = await cost.list();
    if (row) row.costUsd = 999;
    expect((await cost.list())[0]?.costUsd).toBe(0.2);
  });
});

describe('CostLedger caps', () => {
  it('allows spending exactly the remaining daily headroom', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 4.99 });

    await expect(cost.evaluate({ amountUsd: 0.01 })).resolves.toEqual({
      allowed: true,
      remaining: { dailyUsd: 0.01, monthlyUsd: 15.01, listingUsd: 1 },
    });
  });

  it('refuses a cent over the daily cap', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 4.99 });

    const verdict = await cost.evaluate({ amountUsd: 0.02 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('daily');
    expect(verdict.remaining.dailyUsd).toBeCloseTo(0.01, 8);
  });

  it('refuses once the monthly cap is reached', async () => {
    const root = await makeRoot();
    const caps: BudgetCaps = { ...CAPS, dailyCapUsd: 100, perListingDefaultUsd: 100, perListingAbsoluteUsd: 100 };
    const cost = ledger(root, TODAY, caps);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 19.99 });

    expect((await cost.evaluate({ amountUsd: 0.01 })).allowed).toBe(true);
    const refused = await cost.evaluate({ amountUsd: 0.02 });
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe('monthly');
    expect(refused.remaining.monthlyUsd).toBeCloseTo(0.01, 8);
  });

  it('counts only the named listing against its cap', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', listingId: 'oak', costUsd: 0.8 });
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', listingId: 'harbour', costUsd: 0.9 });

    const fits = await cost.evaluate({ amountUsd: 0.2, listingId: 'oak' });
    expect(fits.allowed).toBe(true);
    expect(fits.remaining.listingUsd).toBeCloseTo(0.2, 8);

    const refused = await cost.evaluate({ amountUsd: 0.25, listingId: 'oak' });
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe('listing');
  });

  it('skips the listing cap when no listing is named', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', listingId: 'oak', costUsd: 1.5 });

    await expect(cost.evaluate({ amountUsd: 1 })).resolves.toMatchObject({ allowed: true });
  });

  it('clamps an approved listing budget to the absolute ceiling', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', listingId: 'oak', costUsd: 1.5 });

    // $5 approved per listing still cannot pass the $2 absolute cap.
    const verdict = await cost.evaluate({ amountUsd: 0.6, listingId: 'oak', listingCapUsd: 5 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('listing');
    expect(verdict.remaining.listingUsd).toBeCloseTo(0.5, 8);

    // A lower approved budget tightens it further: $1.60 approved leaves exactly
    // ten cents, $1.50 approved leaves nothing.
    expect((await cost.evaluate({ amountUsd: 0.1, listingId: 'oak', listingCapUsd: 1.6 })).allowed).toBe(
      true,
    );
    expect((await cost.evaluate({ amountUsd: 0.1, listingId: 'oak', listingCapUsd: 1.5 })).reason).toBe(
      'listing',
    );
  });

  it('takes the caps from the caller, not from a hardcoded table', async () => {
    const root = await makeRoot();
    const cost = ledger(root);
    await cost.record({ role: 'agent', model: 'deepseek/deepseek-v4.1-flash', costUsd: 3 });

    // models.json says $5/day; a caller may pass a stricter temporary budget.
    // $4/day leaves exactly $1; $3.90/day leaves 90 cents and refuses $1.
    const strict = await cost.evaluate({ amountUsd: 1, caps: { ...CAPS, dailyCapUsd: 4 } });
    expect(strict.allowed).toBe(true);

    const tighter = await cost.evaluate({ amountUsd: 1, caps: { ...CAPS, dailyCapUsd: 3.9 } });
    expect(tighter.allowed).toBe(false);
    expect(tighter.reason).toBe('daily');
  });

  it('refuses to evaluate without caps or with invalid ones', async () => {
    const root = await makeRoot();
    const bare = new CostLedger(root, { clock: clockAt(TODAY) });
    await expect(bare.evaluate({ amountUsd: 0.1 })).rejects.toThrow(/BudgetCaps/);

    const cost = ledger(root);
    await expect(
      cost.evaluate({ amountUsd: 0.1, caps: { ...CAPS, monthlyCapUsd: -1 } }),
    ).rejects.toMatchObject({ code: 'E_BUDGET_CONFIG' });
    await expect(
      cost.evaluate({
        amountUsd: 0.1,
        caps: { ...CAPS, perListingDefaultUsd: 5, perListingAbsoluteUsd: 2 },
      }),
    ).rejects.toMatchObject({ code: 'E_BUDGET_CONFIG' });
    await expect(cost.evaluate({ amountUsd: -1 })).rejects.toMatchObject({ code: 'E_INVALID_ENTRY' });
  });

  it('enforces the cap against persisted spend after a restart', async () => {
    const root = await makeRoot();
    await ledger(root).record({
      role: 'tagging',
      model: 'perceptron/perceptron-mk1.5',
      costUsd: 4.5,
    });

    const relaunched = ledger(root);
    const verdict = await relaunched.evaluate({ amountUsd: 0.75 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('daily');
  });
});
