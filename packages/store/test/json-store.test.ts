import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonStore, isValidListingId, listingPaths, StoreError } from '../src/index';

const NOW = '2026-11-14T09:30:00.000Z';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'zeniconic-store-'));
  roots.push(root);
  return root;
}

async function exists(path: string): Promise<boolean> {
  return fs
    .stat(path)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  vi.restoreAllMocks();
  const pending = roots.splice(0);
  await Promise.all(pending.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('JsonStore', () => {
  it('init is idempotent', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    await store.init();
    await store.init();

    expect((await fs.stat(join(root, 'listings'))).isDirectory()).toBe(true);
  });

  it('creates a listing with a dated slug id, directories and a round-tripping record', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    const record = await store.create({
      address: '14 Oak Avenue, Richmond TW9',
      now: NOW,
      facts: { price: '£850,000', beds: 3 },
    });

    expect(record.id).toBe('2026-11-14-14-oak-avenue-richmond-tw9');
    expect(record.version).toBe(1);
    expect(record.address).toBe('14 Oak Avenue, Richmond TW9');
    expect(record.status).toBe('draft');
    expect(record.clipCount).toBe(0);
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.facts).toMatchObject({
      address: '14 Oak Avenue, Richmond TW9',
      currency: 'GBP',
      price: '£850,000',
      beds: 3,
    });
    expect(record.facts.confirmedAt).toBeUndefined();

    const paths = listingPaths(root, record.id);
    expect((await fs.stat(paths.dir)).isDirectory()).toBe(true);
    expect((await fs.stat(paths.media)).isDirectory()).toBe(true);
    expect((await fs.stat(paths.cache)).isDirectory()).toBe(true);

    const loaded = await store.get(record.id);
    expect(loaded).toEqual(record);

    const onDisk: unknown = JSON.parse(await fs.readFile(paths.record, 'utf8'));
    expect(onDisk).toEqual(record);
  });

  it('accepts AED and infers AED for a Dubai address when no currency is given', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    const dubai = await store.create({
      address: 'Marina Gate 1, Dubai Marina, Dubai',
      now: NOW,
      facts: { price: 'AED 1,850,000', beds: 3 },
    });
    expect(dubai.facts.currency).toBe('AED');

    const explicit = await store.create({
      address: '14 Oak Avenue, Richmond TW9',
      now: NOW,
      facts: { currency: 'AED', price: 'AED 1,850,000' },
    });
    expect(explicit.facts.currency).toBe('AED');

    const reloaded = await store.get(dubai.id);
    expect(reloaded?.facts.currency).toBe('AED');
  });

  it('suffixes collisions with -2, -3 instead of overwriting', async () => {    const root = await makeRoot();
    const store = new JsonStore(root);

    const first = await store.create({ address: '14 Oak Avenue', now: NOW });
    const second = await store.create({ address: '14 Oak Avenue', now: NOW });
    const third = await store.create({ address: '14 Oak Avenue', now: NOW });

    expect(first.id).toBe('2026-11-14-14-oak-avenue');
    expect(second.id).toBe('2026-11-14-14-oak-avenue-2');
    expect(third.id).toBe('2026-11-14-14-oak-avenue-3');
    expect([first.id, second.id, third.id].every(isValidListingId)).toBe(true);

    expect(await store.get(first.id)).toEqual(first);
    expect(await store.get(second.id)).toEqual(second);
    expect(await store.get(third.id)).toEqual(third);
  });

  it('merges an update, bumps updatedAt, preserves createdAt, and rejects unknown ids', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    const created = await store.create({
      address: '14 Oak Avenue',
      now: '2021-01-01T00:00:00.000Z',
      facts: { beds: 2, price: '£850,000' },
    });

    const updated = await store.update(created.id, {
      status: 'ready',
      notes: 'first pass',
      clipCount: 12,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.version).toBe(1);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    expect(updated.status).toBe('ready');
    expect(updated.notes).toBe('first pass');
    expect(updated.clipCount).toBe(12);
    expect(updated.facts).toEqual(created.facts);

    expect(await store.get(created.id)).toEqual(updated);

    await expect(store.update('2021-01-01-does-not-exist', { notes: 'x' })).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    });
  });

  it('lists records newest first by updatedAt', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    const oldest = await store.create({ address: '1 Old Road', now: '2021-01-01T00:00:00.000Z' });
    const middle = await store.create({ address: '2 Middle Road', now: '2021-01-02T00:00:00.000Z' });
    const newest = await store.create({ address: '3 New Road', now: '2021-01-03T00:00:00.000Z' });

    expect((await store.list()).map((record) => record.id)).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ]);

    await store.update(oldest.id, { notes: 'touched' });
    expect((await store.list()).map((record) => record.id)).toEqual([
      oldest.id,
      newest.id,
      middle.id,
    ]);
  });

  it('skips a corrupt record and still returns the others', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const healthy = await store.create({ address: '1 Healthy Lane', now: NOW });
    const broken = await store.create({ address: '2 Broken Lane', now: NOW });
    await fs.writeFile(listingPaths(root, broken.id).record, '{ this is not json', 'utf8');

    const listed = await store.list();

    expect(listed.map((record) => record.id)).toEqual([healthy.id]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(broken.id);
  });

  it('resists path traversal and uppercase ids in dirFor', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    for (const id of ['../etc', '..\\x', '2026-11-14-14-Oak-Avenue', '', '..']) {
      expect(() => store.dirFor(id), id).toThrow(RangeError);
    }

    try {
      store.dirFor('../etc');
      expect.unreachable('expected a RangeError');
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect((error as { code?: unknown }).code).toBe('E_INVALID_ID');
    }

    const valid = await store.create({ address: '14 Oak Avenue', now: NOW });
    expect(store.dirFor(valid.id)).toBe(listingPaths(root, valid.id).dir);
  });

  it('keeps the record parseable and the temp file gone after 20 concurrent updates', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);
    const created = await store.create({ address: '14 Oak Avenue', now: NOW });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0
          ? store.update(created.id, { notes: `note-${index}` })
          : store.update(created.id, { lastError: `error-${index}` }),
      ),
    );

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toEqual([]);

    const paths = listingPaths(root, created.id);
    const raw = await fs.readFile(paths.record, 'utf8');
    const parsed: unknown = JSON.parse(raw);

    expect(parsed).toMatchObject({
      id: created.id,
      notes: expect.stringMatching(/^note-\d+$/),
      lastError: expect.stringMatching(/^error-\d+$/),
    });

    const entries = await fs.readdir(paths.dir);
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('removes a listing directory and drops it from list', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    const keep = await store.create({ address: '1 Keep Close', now: NOW });
    const drop = await store.create({ address: '2 Drop Close', now: NOW });

    await store.remove(drop.id);

    expect(await exists(listingPaths(root, drop.id).dir)).toBe(false);
    expect((await store.list()).map((record) => record.id)).toEqual([keep.id]);
    expect(await store.get(drop.id)).toBeUndefined();

    // Removing twice is a no-op, not an error.
    await store.remove(drop.id);
  });

  it('builds the documented slug for awkward addresses', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    const street = await store.create({
      address: '14 Oak Avenue, Richmond TW9',
      now: NOW,
    });
    const company = await store.create({ address: 'A&B Ltd', now: NOW });

    expect(street.id).toBe('2026-11-14-14-oak-avenue-richmond-tw9');
    expect(company.id).toBe('2026-11-14-a-and-b-ltd');
  });

  it('keeps two roots completely independent', async () => {
    const rootA = await makeRoot();
    const rootB = await makeRoot();
    const storeA = new JsonStore(rootA);
    const storeB = new JsonStore(rootB);

    const record = await storeA.create({ address: '14 Oak Avenue', now: NOW });

    expect(await storeB.list()).toEqual([]);
    expect(await storeB.get(record.id)).toBeUndefined();
  });

  it('reports store failures with a stable code', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    try {
      await store.update('2026-11-14-missing', { notes: 'x' });
      expect.unreachable('expected E_NOT_FOUND');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      expect((error as StoreError).code).toBe('E_NOT_FOUND');
    }
  });

  it('rejects an address that has nothing to slugify', async () => {
    const root = await makeRoot();
    const store = new JsonStore(root);

    await expect(store.create({ address: '!!! ???', now: NOW })).rejects.toMatchObject({
      code: 'E_INVALID_ADDRESS',
    });
  });
});
