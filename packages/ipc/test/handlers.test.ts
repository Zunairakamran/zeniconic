import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHandlers, createSettings, IpcError } from '../src/index';
import { FakeChat, FakePipeline, FakeRunner, FakeSettings, FakeStore } from './fakes';

const LISTING_ID = '2026-11-15-12-oak-avenue';

let store: FakeStore;
let runner: FakeRunner;
let pipeline: FakePipeline;
let settings: FakeSettings;
let chat: FakeChat;
let handlers: ReturnType<typeof createHandlers>;
let tempDir: string;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  store = new FakeStore();
  runner = new FakeRunner();
  pipeline = new FakePipeline();
  settings = new FakeSettings();
  chat = new FakeChat();
  handlers = createHandlers({ store, runner, pipeline, settings, chat });
  tempDir = await mkdtemp(join(tmpdir(), 'zeniconic-ipc-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function makeVideoFolder(name = 'footage'): Promise<string> {
  const folder = join(tempDir, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'clip.mp4'), Buffer.alloc(0));
  return folder;
}

describe('listings', () => {
  it('lists records from the store', async () => {
    store.seed({ id: LISTING_ID });
    const records = await handlers['listings:list']();
    expect(records.map((record) => record.id)).toEqual([LISTING_ID]);
  });

  it('creates a listing with a trimmed address and known facts only', async () => {
    const record = await handlers['listings:create']({
      address: '  12 Oak Avenue  ',
      facts: { beds: 3, baths: 2, currency: 'GBP' },
    });

    expect(record.address).toBe('12 Oak Avenue');
    expect(record.facts.beds).toBe(3);
    expect(record.facts.baths).toBe(2);
  });

  it('rejects an unknown fact key instead of storing it', async () => {
    await expect(
      handlers['listings:create']({
        address: '12 Oak Avenue',
        facts: { address: '12 Oak Avenue', haunted: true } as never,
      }),
    ).rejects.toBeInstanceOf(IpcError);
  });

  it('rejects an invalid listing id before touching the store', async () => {
    await expect(handlers['listings:get']('../../etc/passwd')).rejects.toMatchObject({
      name: 'IpcError',
      code: 'E_INVALID_INPUT',
    });
  });

  it('returns undefined for a valid id the store does not know', async () => {
    await expect(handlers['listings:get'](LISTING_ID)).resolves.toBeUndefined();
  });
});

describe('listings:updateFacts', () => {
  it('accepts AED and returns the persisted record', async () => {
    store.seed({ id: LISTING_ID });

    const record = await handlers['listings:updateFacts']({
      listingId: LISTING_ID,
      facts: {
        address: 'Marina Gate 1, Dubai Marina',
        price: 'AED 1,850,000',
        beds: 3,
        baths: 2,
        sqft: 1240,
        currency: 'AED',
        confirmedAt: '2026-11-15T09:00:00.000Z',
      },
    });

    expect(record.facts).toMatchObject({
      address: 'Marina Gate 1, Dubai Marina',
      price: 'AED 1,850,000',
      beds: 3,
      baths: 2,
      sqft: 1240,
      currency: 'AED',
    });
    expect(store.updates).toEqual([
      {
        id: LISTING_ID,
        patch: {
          facts: {
            address: 'Marina Gate 1, Dubai Marina',
            price: 'AED 1,850,000',
            beds: 3,
            baths: 2,
            sqft: 1240,
            currency: 'AED',
            confirmedAt: '2026-11-15T09:00:00.000Z',
          },
        },
      },
    ]);
  });

  it('rejects an unknown fact key instead of storing it', async () => {
    store.seed({ id: LISTING_ID });

    await expect(
      handlers['listings:updateFacts']({
        listingId: LISTING_ID,
        facts: { price: 'AED 1,850,000', haunted: true } as never,
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(store.updates).toEqual([]);
  });

  it('rejects a missing listing id and a traversal-shaped id', async () => {
    store.seed({ id: LISTING_ID });

    await expect(
      handlers['listings:updateFacts']({ facts: { beds: 3 } } as never),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });

    await expect(
      handlers['listings:updateFacts']({
        listingId: '../../etc/passwd',
        facts: { beds: 3 },
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(store.updates).toEqual([]);
  });

  it('rejects an unknown listing before writing', async () => {
    await expect(
      handlers['listings:updateFacts']({
        listingId: LISTING_ID,
        facts: { price: 'AED 1,850,000' },
      }),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    expect(store.updates).toEqual([]);
  });

  it('rejects a price with no number, a fractional room count and a bad currency', async () => {
    store.seed({ id: LISTING_ID });

    await expect(
      handlers['listings:updateFacts']({
        listingId: LISTING_ID,
        facts: { price: 'offer invited' },
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });

    await expect(
      handlers['listings:updateFacts']({
        listingId: LISTING_ID,
        facts: { beds: 3.5 },
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });

    await expect(
      handlers['listings:updateFacts']({
        listingId: LISTING_ID,
        facts: { currency: 'JPY' as never },
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(store.updates).toEqual([]);
  });

  it('rejects an empty facts patch', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['listings:updateFacts']({ listingId: LISTING_ID, facts: {} }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(store.updates).toEqual([]);
  });
});

describe('analysis', () => {
  it('enqueues a job, binds the folder and marks the listing analysing', async () => {
    store.seed({ id: LISTING_ID });
    const folder = await makeVideoFolder();

    const { jobId } = await handlers['analysis:start']({ listingId: LISTING_ID, folder });

    expect(jobId.length).toBeGreaterThan(0);
    expect(runner.enqueued).toEqual([LISTING_ID]);
    expect(runner.runCalls).toEqual([jobId]);
    expect(pipeline.prepared).toEqual([{ jobId, listingId: LISTING_ID, folder }]);

    await tick();
    expect(store.records.get(LISTING_ID)?.status).toBe('ready');
  });

  it('rejects a folder that does not exist', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['analysis:start']({
        listingId: LISTING_ID,
        folder: join(tempDir, 'missing'),
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(runner.enqueued).toEqual([]);
  });

  it('rejects a folder with no video files', async () => {
    store.seed({ id: LISTING_ID });
    const folder = join(tempDir, 'empty');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'notes.txt'), 'no footage');

    await expect(
      handlers['analysis:start']({ listingId: LISTING_ID, folder }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(runner.enqueued).toEqual([]);
  });

  it('rejects an unknown listing', async () => {
    const folder = await makeVideoFolder();
    await expect(
      handlers['analysis:start']({ listingId: LISTING_ID, folder }),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    expect(runner.enqueued).toEqual([]);
  });

  it('records a failed job on the listing', async () => {
    store.seed({ id: LISTING_ID });
    runner.finalStatus = 'failed';
    runner.finalStage = 'index';
    runner.failure = 'ffmpeg exited';
    const folder = await makeVideoFolder();

    await handlers['analysis:start']({ listingId: LISTING_ID, folder });
    await tick();

    const record = store.records.get(LISTING_ID);
    expect(record?.status).toBe('failed');
    expect(record?.lastError).toBe('ffmpeg exited');
  });

  it('lists jobs from the runner', async () => {
    store.seed({ id: LISTING_ID });
    await handlers['analysis:start']({ listingId: LISTING_ID, folder: await makeVideoFolder() });
    await expect(handlers['jobs:list']()).resolves.toHaveLength(1);
  });
});

describe('variants', () => {
  it('lists variants after checking the listing exists', async () => {
    store.seed({ id: LISTING_ID });
    await expect(handlers['variants:list'](LISTING_ID)).resolves.toEqual([]);
    await expect(handlers['variants:list']('2026-11-15-missing')).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    });
  });

  it('approves a variant through the pipeline', async () => {
    store.seed({ id: LISTING_ID });
    pipeline.variants = [
      {
        id: 'calm',
        look: 'calm',
        format: 'cinematic_hero',
        targetDurationSec: 30,
        clipCount: 11,
        score: 80,
        edlPath: 'D:/video/data/calm.json',
        approved: false,
      },
    ];

    const updated = await handlers['variants:approve']({
      listingId: LISTING_ID,
      variantId: 'calm',
      approved: true,
    });

    expect(updated.approved).toBe(true);
    expect(pipeline.approvals).toEqual([
      { listingId: LISTING_ID, variantId: 'calm', approved: true },
    ]);
  });

  it('rejects a traversal-shaped variant id', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['variants:approve']({
        listingId: LISTING_ID,
        variantId: '../calm',
        approved: true,
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('returns a preview still path', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['variants:preview']({ listingId: LISTING_ID, variantId: 'social' }),
    ).resolves.toEqual({ stillPath: 'D:/video/data/social.jpg' });
  });
});

describe('export', () => {
  it('delegates every profile and returns the written files', async () => {
    store.seed({ id: LISTING_ID });

    const result = await handlers['export:start']({
      listingId: LISTING_ID,
      profiles: ['vertical-social', 'landscape', 'vertical-social'],
      quality: 'draft',
      captions: 'burned',
      voice: 'ai',
    });

    expect(result.files).toEqual([pipeline.output]);
    expect(result.exportDir).toBe(pipeline.outputDir);
    expect(pipeline.exports).toHaveLength(1);
    expect(pipeline.exports[0]?.profiles).toEqual(['vertical-social', 'landscape']);
    expect(pipeline.exports[0]?.quality).toBe('draft');
    expect(store.records.get(LISTING_ID)?.status).toBe('exported');
  });

  it('rejects an unknown profile and quality', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['export:start']({
        listingId: LISTING_ID,
        profiles: ['cinema'],
        quality: 'draft',
        captions: 'off',
        voice: 'music',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });

    await expect(
      handlers['export:start']({
        listingId: LISTING_ID,
        profiles: ['landscape'],
        quality: 'ultra' as never,
        captions: 'off',
        voice: 'music',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(pipeline.exports).toEqual([]);
  });

  it('rejects an unknown voice mode', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['export:start']({
        listingId: LISTING_ID,
        profiles: ['landscape'],
        quality: 'standard',
        captions: 'off',
        voice: 'loud' as never,
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('rejects an empty profile list and an unknown caption mode', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['export:start']({
        listingId: LISTING_ID,
        profiles: [],
        quality: 'standard',
        captions: 'off',
        voice: 'music',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });

    await expect(
      handlers['export:start']({
        listingId: LISTING_ID,
        profiles: ['landscape'],
        quality: 'standard',
        captions: 'karaoke' as never,
        voice: 'music',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('rejects an unknown listing', async () => {
    await expect(
      handlers['export:start']({
        listingId: LISTING_ID,
        profiles: ['landscape'],
        quality: 'standard',
        captions: 'off',
        voice: 'music',
      }),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});

describe('chat', () => {
  it('sends a validated request through the chat port', async () => {
    store.seed({ id: LISTING_ID });

    const result = await handlers['chat:send']({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: '  Swap the kitchen for the balcony.  ',
    });

    expect(result.versionId).toBe('calm-v1');
    expect(chat.sends).toEqual([
      {
        listingId: LISTING_ID,
        variantId: 'calm',
        message: 'Swap the kitchen for the balcony.',
      },
    ]);
  });

  it('rejects a missing listing, an empty message and a traversal variant', async () => {
    await expect(
      handlers['chat:send']({
        listingId: LISTING_ID,
        variantId: 'calm',
        message: 'Shorter',
      }),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });

    store.seed({ id: LISTING_ID });
    await expect(
      handlers['chat:send']({
        listingId: LISTING_ID,
        variantId: 'calm',
        message: '   ',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(chat.sends).toEqual([]);

    await expect(
      handlers['chat:send']({
        listingId: LISTING_ID,
        variantId: '../calm',
        message: 'Shorter',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('rejects a message longer than the prompt budget', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['chat:send']({
        listingId: LISTING_ID,
        variantId: 'calm',
        message: 'x'.repeat(2_001),
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('applies a version and forwards typed chat failures', async () => {
    store.seed({ id: LISTING_ID });

    await expect(
      handlers['chat:apply']({
        listingId: LISTING_ID,
        variantId: 'calm',
        versionId: 'calm-v2',
      }),
    ).resolves.toEqual({ ok: true });
    expect(chat.applies).toEqual([
      { listingId: LISTING_ID, variantId: 'calm', versionId: 'calm-v2' },
    ]);

    await expect(
      handlers['chat:apply']({
        listingId: LISTING_ID,
        variantId: 'calm',
        versionId: '../../calm-v2',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('returns version summaries and translates a service failure', async () => {
    store.seed({ id: LISTING_ID });

    await expect(
      handlers['chat:versions'](LISTING_ID, 'calm'),
    ).resolves.toEqual(chat.versionList);
    expect(chat.versionCalls).toEqual([{ listingId: LISTING_ID, variantId: 'calm' }]);

    chat.failure = new Error('Add an OpenRouter key in Settings first.');
    await expect(handlers['chat:versions'](LISTING_ID, 'calm')).rejects.toMatchObject({
      code: 'E_CHAT',
      message: 'Add an OpenRouter key in Settings first.',
    });
  });

  it('reports when the assistant is not available in this build', async () => {
    store.seed({ id: LISTING_ID });
    const local = createHandlers({ store, runner, pipeline, settings });

    await expect(
      local['chat:send']({ listingId: LISTING_ID, variantId: 'calm', message: 'Shorter' }),
    ).rejects.toMatchObject({ code: 'E_PIPELINE' });
  });
});

describe('settings', () => {
  it('delegates get and persists the theme to disk', async () => {
    const port = createSettings({ dataDir: tempDir, modelConfigured: true });
    const local = createHandlers({
      store,
      runner,
      pipeline,
      settings: port,
    });

    await expect(local['settings:get']()).resolves.toMatchObject({
      dataDir: tempDir,
      modelConfigured: true,
      theme: 'light',
    });

    await local['settings:setTheme']('dark');

    const reopened = createSettings({ dataDir: tempDir, modelConfigured: false });
    await expect(reopened.get()).resolves.toMatchObject({ theme: 'dark' });
  });

  it('rejects an unknown theme', async () => {
    await expect(handlers['settings:setTheme']('sepia' as never)).rejects.toMatchObject({
      code: 'E_INVALID_INPUT',
    });
    expect(settings.themes).toEqual([]);
  });

  it('reads the injected settings port', async () => {
    settings.theme = 'dark';
    await expect(handlers['settings:get']()).resolves.toMatchObject({ theme: 'dark' });
  });

  it('exposes the version and recorded spend instead of UI defaults', async () => {
    const port = createSettings({
      dataDir: tempDir,
      modelConfigured: false,
      version: '9.9.9',
      spendUsd: 1.84,
    });
    await expect(port.get()).resolves.toMatchObject({
      dataDir: tempDir,
      version: '9.9.9',
      spendUsd: 1.84,
    });

    const local = createHandlers({ store, runner, pipeline, settings: port });
    await expect(local['settings:get']()).resolves.toMatchObject({
      version: '9.9.9',
      spendUsd: 1.84,
    });
  });

  it('stores a key without echoing it and reports it configured', async () => {
    settings.configured = false;
    await expect(handlers['settings:keyStatus']()).resolves.toEqual({ configured: false });

    await handlers['settings:setKey']('  sk-or-v1-test-key-123456  ');

    expect(settings.keys).toEqual(['sk-or-v1-test-key-123456']);
    await expect(handlers['settings:keyStatus']()).resolves.toEqual({ configured: true });
  });

  it('rejects malformed keys before they reach settings', async () => {
    await expect(handlers['settings:setKey']('short')).rejects.toMatchObject({
      code: 'E_INVALID_INPUT',
    });
    await expect(
      handlers['settings:setKey']('sk-or-v1-key\nwith-newline'),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(settings.keys).toEqual([]);
  });

  it('surfaces E_KEY_STORAGE when Windows credential storage is unavailable', async () => {
    const port = createSettings({ dataDir: tempDir, modelConfigured: false });
    const local = createHandlers({ store, runner, pipeline, settings: port });

    await expect(local['settings:setKey']('sk-or-v1-test-key-123456')).rejects.toMatchObject({
      code: 'E_KEY_STORAGE',
      message: expect.stringContaining('credential storage is unavailable'),
    });
    // The session still holds it, so the rest of this run can use the key.
    await expect(local['settings:keyStatus']()).resolves.toEqual({ configured: true });
  });
});

describe('analysis folder picker', () => {
  it('returns null when the platform has no picker', async () => {
    await expect(handlers['analysis:chooseFolder']()).resolves.toBeNull();
  });

  it('returns the picked absolute path', async () => {
    const local = createHandlers({
      store,
      runner,
      pipeline,
      settings,
      chooseFolder: async () => tempDir,
    });
    await expect(local['analysis:chooseFolder']()).resolves.toBe(tempDir);
  });
});

describe('shell:openPath', () => {
  function withShell(dataDir: string, opened: string[]) {
    return createHandlers({
      store,
      runner,
      pipeline,
      settings,
      dataDir,
      openPath: async (path) => {
        opened.push(path);
        return '';
      },
    });
  }

  it('opens a folder inside the data directory', async () => {
    const exportsDir = join(tempDir, 'listings', LISTING_ID, 'exports');
    await mkdir(exportsDir, { recursive: true });
    const opened: string[] = [];
    const local = withShell(tempDir, opened);

    await expect(local['shell:openPath'](exportsDir)).resolves.toEqual({ ok: true });
    expect(opened).toEqual([exportsDir]);
  });

  it('rejects a path outside the data directory', async () => {
    const opened: string[] = [];
    const local = withShell(tempDir, opened);

    await expect(
      local['shell:openPath'](join(tempDir, '..', 'elsewhere')),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    await expect(local['shell:openPath']('C:/Windows/System32')).rejects.toMatchObject({
      code: 'E_INVALID_INPUT',
    });
    expect(opened).toEqual([]);
  });

  it('reports the shell error string instead of throwing', async () => {
    const local = createHandlers({
      store,
      runner,
      pipeline,
      settings,
      dataDir: tempDir,
      openPath: async () => 'The folder no longer exists.',
    });

    await expect(local['shell:openPath'](join(tempDir, 'gone'))).resolves.toEqual({
      ok: false,
      error: 'The folder no longer exists.',
    });
  });

  it('refuses an empty path', async () => {
    const local = withShell(tempDir, []);
    await expect(local['shell:openPath']('  ')).rejects.toMatchObject({
      code: 'E_INVALID_INPUT',
    });
  });
});
