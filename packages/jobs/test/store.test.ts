import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_STORE_FILE, JsonJobStore, JobStoreError } from '../src/index';
import type { JobRecord } from '../src/index';

const NOW = '2026-11-15T10:00:00.000Z';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'zeniconic-jobs-'));
  roots.push(root);
  return root;
}

async function exists(path: string): Promise<boolean> {
  return fs
    .stat(path)
    .then(() => true)
    .catch(() => false);
}

/** A fixed clock, so the envelope is reproducible. */
function clock(): string {
  return NOW;
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job_0001_2026-11-15-oak',
    listingId: '2026-11-15-oak',
    stage: 'plan',
    status: 'running',
    attempts: 0,
    createdAt: '2026-11-15T09:59:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
    progress: { stage: 'plan', percent: 40 },
    ...overrides,
  };
}

async function readRaw(root: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(join(root, JOB_STORE_FILE), 'utf8'));
}

afterEach(async () => {
  vi.restoreAllMocks();
  const pending = roots.splice(0);
  await Promise.all(pending.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('JsonJobStore', () => {
  it('returns an empty list when nothing has been persisted', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);

    await expect(store.list()).resolves.toEqual([]);
    // Reading must not invent a file.
    expect(await exists(join(root, JOB_STORE_FILE))).toBe(false);
  });

  it('round-trips records, including the optional additive fields', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const analysis = job();
    const exporting = job({
      id: 'job_0002_2026-11-15-harbour',
      listingId: '2026-11-15-harbour',
      stage: 'render',
      status: 'failed',
      attempts: 2,
      error: 'encoder exploded',
      errorCode: 'E_RENDER_FAILED',
      kind: 'export',
      checkpoint: 'data/cache/render-0002.mp4',
      progress: { stage: 'plan', percent: 100, detail: 'plan done' },
    });

    await store.put(analysis);
    await store.put(exporting);
    await store.flush();

    expect(warn).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([analysis, exporting]);

    // A fresh instance is the restart path.
    const reloaded = new JsonJobStore(root, clock);
    expect(await reloaded.list()).toEqual([analysis, exporting]);

    const envelope = await readRaw(root);
    expect(envelope).toMatchObject({ version: 1, updatedAt: NOW });
    expect((envelope as { jobs: unknown[] }).jobs).toHaveLength(2);
  });

  it('writes atomically: one file, no temp leftovers, valid JSON', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);

    await store.put(job());
    await store.flush();

    const entries = await fs.readdir(root);
    expect(entries.sort()).toEqual([JOB_STORE_FILE]);
    expect((await readRaw(root)) as { version: number }).toMatchObject({ version: 1 });
  });

  it('serialises concurrent puts, keeps insertion order and leaves no temp file', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);

    const records = Array.from({ length: 20 }, (_, index) =>
      job({
        id: `job_${String(index + 1).padStart(4, '0')}_listing-${index}`,
        listingId: `listing-${index}`,
        stage: 'index',
        status: 'queued',
        progress: { stage: 'index', percent: 0 },
      }),
    );

    await Promise.all(records.map((record) => store.put(record)));

    expect((await store.list()).map((record) => record.id)).toEqual(
      records.map((record) => record.id),
    );

    const entries = await fs.readdir(root);
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(((await readRaw(root)) as { jobs: unknown[] }).jobs).toHaveLength(20);

    // A later restart reads back every record in the same order.
    const reloaded = new JsonJobStore(root, clock);
    expect((await reloaded.list()).map((record) => record.id)).toEqual(
      records.map((record) => record.id),
    );
  });

  it('tolerates a corrupt file instead of throwing', async () => {
    const root = await makeRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(join(root, JOB_STORE_FILE), '{ this is not json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const store = new JsonJobStore(root, clock);
    await expect(store.list()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();

    // Writing still works and replaces the corrupt file.
    await store.put(job());
    expect(((await readRaw(root)) as { jobs: unknown[] }).jobs).toHaveLength(1);
  });

  it('tolerates an envelope with an unknown version', async () => {
    const root = await makeRoot();
    await fs.writeFile(
      join(root, JOB_STORE_FILE),
      JSON.stringify({ version: 99, jobs: [job()] }),
      'utf8',
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const store = new JsonJobStore(root, clock);
    await expect(store.list()).resolves.toEqual([]);
  });

  it('drops invalid rows and keeps the valid ones', async () => {
    const root = await makeRoot();
    const good = job();
    await fs.writeFile(
      join(root, JOB_STORE_FILE),
      JSON.stringify({
        version: 1,
        updatedAt: NOW,
        jobs: [
          good,
          null,
          'not a job',
          { ...job({ id: 'job_0002_bad-stage' }), stage: 'explode' },
          { ...job({ id: 'job_0003_bad-status' }), status: 'paused' },
          { ...job({ id: 'job_0004_bad-attempts' }), attempts: -1 },
          { ...job({ id: 'job_0005_bad-date' }), createdAt: 'yesterday' },
          { ...job({ id: 'job_0006_bad-percent' }), progress: { stage: 'plan', percent: 140 } },
          { ...job({ id: 'job_0007_bad-kind' }), kind: 'transcode' },
          { ...job({ id: good.id }), status: 'complete' },
        ],
      }),
      'utf8',
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const store = new JsonJobStore(root, clock);
    const listed = await store.list();

    // Only the first row survives: the duplicate id is ignored and every
    // malformed row is dropped.
    expect(listed).toEqual([good]);
  });

  it('ignores a leftover temp file from a crashed write', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);
    await store.put(job());
    await store.flush();

    await fs.writeFile(join(root, `${JOB_STORE_FILE}.tmp`), '{ half a fil', 'utf8');

    const reloaded = new JsonJobStore(root, clock);
    expect(await reloaded.list()).toEqual([job()]);
  });

  it('updates in place without reordering the list', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);

    const first = job({ id: 'job_0001_first', listingId: 'first' });
    const second = job({ id: 'job_0002_second', listingId: 'second' });
    await store.put(first);
    await store.put(second);

    await store.put({ ...first, status: 'complete', stage: 'done', progress: { stage: 'done', percent: 100 } });

    expect((await store.list()).map((record) => record.id)).toEqual(['job_0001_first', 'job_0002_second']);

    const reloaded = new JsonJobStore(root, clock);
    expect((await reloaded.list()).map((record) => record.id)).toEqual([
      'job_0001_first',
      'job_0002_second',
    ]);
  });

  it('removes a job and persists the removal', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);

    const keep = job({ id: 'job_0001_keep', listingId: 'keep' });
    const drop = job({ id: 'job_0002_drop', listingId: 'drop' });
    await store.put(keep);
    await store.put(drop);

    await store.remove(drop.id);

    expect((await store.list()).map((record) => record.id)).toEqual(['job_0001_keep']);
    const reloaded = new JsonJobStore(root, clock);
    expect((await reloaded.list()).map((record) => record.id)).toEqual(['job_0001_keep']);

    // Removing twice is a no-op, not an error.
    await store.remove(drop.id);
  });

  it('keeps the previous snapshot and the cache consistent when a write fails', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);

    const persisted = job({ id: 'job_0001_persisted', listingId: 'persisted' });
    await store.put(persisted);
    await store.flush();

    // Block the temp path so the write cannot even start.
    await fs.mkdir(join(root, `${JOB_STORE_FILE}.tmp`));

    const fresh = job({ id: 'job_0002_fresh', listingId: 'fresh' });
    await expect(store.put(fresh)).rejects.toMatchObject({ code: 'E_WRITE_FAILED' });

    expect(await store.list()).toEqual([persisted]);
    expect((await readRaw(root)) as { jobs: unknown[] }).toMatchObject({
      version: 1,
      jobs: [persisted],
    });
  });

  it('reports a missing directory it cannot create as a coded write failure', async () => {
    const root = await makeRoot();
    const blocker = join(root, 'not-a-directory');
    await fs.writeFile(blocker, 'x', 'utf8');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const store = new JsonJobStore(join(blocker, 'jobs'));

    // Reading degrades to an empty list instead of throwing…
    await expect(store.list()).resolves.toEqual([]);
    // …but a write still reports why it failed.
    await expect(store.put(job())).rejects.toBeInstanceOf(JobStoreError);
    await expect(store.put(job())).rejects.toMatchObject({ code: 'E_WRITE_FAILED' });
  });

  it('rejects a record that cannot be validated', async () => {
    const root = await makeRoot();
    const store = new JsonJobStore(root, clock);

    await expect(store.put({ ...job(), stage: 'explode' as JobRecord['stage'] })).rejects.toMatchObject({
      code: 'E_INVALID_JOB',
    });
    expect(await exists(join(root, JOB_STORE_FILE))).toBe(false);
  });

  it('keeps two roots completely independent', async () => {
    const rootA = await makeRoot();
    const rootB = await makeRoot();

    await new JsonJobStore(rootA, clock).put(job());

    expect(await new JsonJobStore(rootB, clock).list()).toEqual([]);
  });
});
