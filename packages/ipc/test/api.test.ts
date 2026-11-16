import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, toUiListing } from '../../../apps/ui/src/api';
import type { ListingRecord } from '../../../packages/store/src/index';

interface Scope {
  zeniconic?: unknown;
}

const scope = globalThis as unknown as Scope;

const RECORD: ListingRecord = {
  version: 1,
  id: '2026-11-15-12-oak-avenue',
  address: '12 Oak Avenue',
  createdAt: '2026-11-15T08:00:00.000Z',
  updatedAt: '2026-11-15T09:00:00.000Z',
  status: 'ready',
  facts: { address: '12 Oak Avenue', price: '925000', currency: 'GBP', beds: 4, baths: 2 },
  clipCount: 7,
  notes: 'Kensington',
};

beforeEach(() => {
  delete scope.zeniconic;
});

afterEach(() => {
  delete scope.zeniconic;
});

describe('api without the desktop bridge', () => {
  it('falls back to the demo listings', async () => {
    const records = await api.listings.list();
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]?.id).toBe('2026-11-14-marina-gate-1');
  });

  it('creates an in-memory demo listing', async () => {
    const before = (await api.listings.list()).length;
    const record = await api.listings.create({
      address: '7 Cedar Lane',
      facts: { beds: 3, currency: 'AED' },
    });

    expect(record.id).toMatch(/^\d{4}-\d{2}-\d{2}-7-cedar-lane$/);
    expect((await api.listings.list()).length).toBe(before + 1);
    await expect(api.listings.get(record.id)).resolves.toMatchObject({ address: '7 Cedar Lane' });
  });

  it('updates demo facts and keeps AED for a Dubai address', async () => {
    const record = await api.listings.create({ address: '7 Dubai Marina Walk, Dubai' });
    expect(record.facts.currency).toBe('AED');

    const updated = await api.listings.updateFacts({
      listingId: record.id,
      facts: { price: 'AED 1,850,000', beds: 3, baths: 2, currency: 'AED' },
    });
    expect(updated.facts).toMatchObject({
      price: 'AED 1,850,000',
      beds: 3,
      baths: 2,
      currency: 'AED',
    });

    await expect(
      api.listings.updateFacts({ listingId: 'missing', facts: { beds: 2 } }),
    ).rejects.toThrow(/not found/);
  });

  it('refuses to open a folder without the desktop shell', async () => {
    await expect(api.shell.openPath('D:/video/data/listings')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('desktop app'),
    });
  });

  it('returns a demo job id, no jobs and a demo export path', async () => {
    await expect(api.analysis.start({ listingId: RECORD.id, folder: 'D:/clips' })).resolves.toEqual(
      expect.objectContaining({ jobId: expect.stringMatching(/^job_demo_/) }),
    );
    await expect(api.jobs.list()).resolves.toEqual([]);

    const result = await api.export.start({
      listingId: RECORD.id,
      profiles: ['vertical-social', 'landscape'],
      quality: 'draft',
      captions: 'off',
      voice: 'music',
    });
    expect(result.files).toHaveLength(4);
    expect(result.files.every((file) => file.endsWith('.mp4'))).toBe(true);
  });

  it('lists, approves and previews demo variants', async () => {
    const variants = await api.variants.list(RECORD.id);
    expect(variants.length).toBeGreaterThan(0);

    const updated = await api.variants.approve({
      listingId: RECORD.id,
      variantId: variants[0]!.id,
      approved: false,
    });
    expect(updated.approved).toBe(false);

    await expect(
      api.variants.preview({ listingId: RECORD.id, variantId: variants[0]!.id }),
    ).resolves.toEqual({
      stillPath: expect.stringMatching(/variants\\previews\\.*\.jpg$/),
    });

    await expect(api.settings.keyStatus()).resolves.toEqual({ configured: false });
    await api.settings.setKey('sk-or-v1-demo-key');
    await expect(api.settings.keyStatus()).resolves.toEqual({ configured: true });
  });

  it('keeps the demo theme and a key set earlier', async () => {
    await api.settings.setTheme('dark');
    await expect(api.settings.get()).resolves.toMatchObject({ theme: 'dark' });
  });

  it('returns a demo diff and applies the matching version', async () => {
    const sent = await api.chat.send({
      listingId: RECORD.id,
      variantId: 'calm',
      message: 'Shorter, please.',
    });

    expect(sent.versionId).toMatch(/^calm-v\d+$/);
    expect(sent.diff.length).toBeGreaterThan(0);
    expect(sent.warnings[0]).toContain('Browser preview');

    const versions = await api.chat.versions(RECORD.id, 'calm');
    expect(versions[0]?.id).toBe(sent.versionId);

    await expect(
      api.chat.apply({ listingId: RECORD.id, variantId: 'calm', versionId: sent.versionId }),
    ).resolves.toEqual({ ok: true });
    await expect(
      api.chat.apply({ listingId: RECORD.id, variantId: 'calm', versionId: 'calm-v99' }),
    ).rejects.toThrow(/not found/);
  });

  it('returns a no-op unsubscribe for progress', () => {
    const unsubscribe = api.onJobProgress(() => undefined);
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('api with the desktop bridge', () => {
  it('forwards invocations and returns the main-process result', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    scope.zeniconic = {
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args });
        return [RECORD];
      },
      onJobProgress: () => () => undefined,
    };

    const records = await api.listings.list();
    expect(records).toEqual([RECORD]);
    expect(calls).toEqual([{ channel: 'listings:list', args: [] }]);

    await api['settings'].setTheme('light');
    expect(calls[1]).toEqual({ channel: 'settings:setTheme', args: ['light'] });
  });

  it('forwards progress events and unsubscribes', () => {
    let listener: ((event: { jobId: string; stage: string; percent: number }) => void) | undefined;
    let removed = false;
    scope.zeniconic = {
      invoke: async () => undefined,
      onJobProgress: (callback: typeof listener) => {
        listener = callback;
        return () => {
          removed = true;
        };
      },
    };

    const received: string[] = [];
    const unsubscribe = api.onJobProgress((event) => received.push(event.stage));
    listener?.({ jobId: 'job_1', stage: 'index', percent: 50 });
    unsubscribe();

    expect(received).toEqual(['index']);
    expect(removed).toBe(true);
  });
});

describe('toUiListing', () => {
  it('maps persisted facts onto the screen model', () => {
    const listing = toUiListing(RECORD);
    expect(listing).toMatchObject({
      id: RECORD.id,
      address: '12 Oak Avenue',
      community: 'Kensington',
      beds: 4,
      baths: 2,
      status: 'ready',
      variantCount: 0,
    });
    expect(listing.price).toContain('925,000');
    expect(listing.tone.length).toBeGreaterThan(0);
  });
});
