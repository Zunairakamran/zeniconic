import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CHANNELS,
  createHandlers,
  createSettings,
  IpcError,
  isChannel,
  JOB_PROGRESS_CHANNEL,
} from '../src/index';
import type { Channel, VoiceModelStatus } from '../src/index';
import { FakeAgent, FakeChat, FakePipeline, FakeReference, FakeRemix, FakeReview, FakeRunner, FakeSettings, FakeStore, FakeTagging } from './fakes';

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

  it('refuses a version id the service invented outside the slug grammar', async () => {
    store.seed({ id: LISTING_ID });
    chat.result = {
      reply: 'Done.',
      diff: '1 change: kitchen removed',
      versionId: '../../calm-v1',
      warnings: [],
    };

    await expect(
      handlers['chat:send']({
        listingId: LISTING_ID,
        variantId: 'calm',
        message: 'Drop the kitchen.',
      }),
    ).rejects.toMatchObject({ code: 'E_CHAT' });

    chat.result = { reply: 'Done.', diff: 'no change', versionId: '', warnings: [] };
    await expect(
      handlers['chat:send']({
        listingId: LISTING_ID,
        variantId: 'calm',
        message: 'Drop the kitchen.',
      }),
    ).rejects.toMatchObject({ code: 'E_CHAT' });
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

describe('voice model', () => {
  const status = {
    phase: 'missing' as const,
    installed: false,
    bytes: 0,
    totalBytes: 92_364_770,
    updatedAt: '2026-11-16T00:00:00.000Z',
  };

  function withVoice(port: Partial<{ status: () => Promise<VoiceModelStatus>; start: () => Promise<VoiceModelStatus>; cancel: () => Promise<VoiceModelStatus> }>) {
    return createHandlers({
      store,
      runner,
      pipeline,
      settings,
      dataDir: tempDir,
      voiceModel: {
        status: async () => status,
        start: async () => status,
        cancel: async () => status,
        ...port,
      },
    });
  }

  it('returns the installer status', async () => {
    const handlersWithVoice = withVoice({});
    await expect(handlersWithVoice['voice:modelStatus']()).resolves.toEqual(status);
  });

  it('starts and cancels through the port', async () => {
    const calls: string[] = [];
    const handlersWithVoice = withVoice({
      start: async () => {
        calls.push('start');
        return { ...status, phase: 'downloading' as const };
      },
      cancel: async () => {
        calls.push('cancel');
        return status;
      },
    });

    const started = await handlersWithVoice['voice:modelDownload']();
    expect(started.phase).toBe('downloading');
    await handlersWithVoice['voice:modelCancel']();
    expect(calls).toEqual(['start', 'cancel']);
  });

  it('fails with a typed error when the build has no installer', async () => {
    await expect(handlers['voice:modelStatus']()).rejects.toMatchObject({
      code: 'E_VOICE_MODEL',
    });
  });

  it('wraps installer failures with the typed code', async () => {
    const handlersWithVoice = withVoice({
      status: async () => {
        throw new Error('disk unavailable');
      },
    });
    await expect(handlersWithVoice['voice:modelStatus']()).rejects.toMatchObject({
      code: 'E_VOICE_MODEL',
      message: 'disk unavailable',
    });
  });

  it('cannot be pointed at a path: every argument is dropped', async () => {
    // The three channels take no parameters. `ipcMain` still forwards whatever
    // the renderer sends, so prove the extra values never reach the installer.
    const received: unknown[][] = [];
    const record = (args: unknown[]): VoiceModelStatus => {
      received.push(args);
      return status;
    };
    const handlersWithVoice = createHandlers({
      store,
      runner,
      pipeline,
      settings,
      dataDir: tempDir,
      voiceModel: {
        status: async (...args: unknown[]) => record(args),
        start: async (...args: unknown[]) => record(args),
        cancel: async (...args: unknown[]) => record(args),
      },
    });

    const hostile = handlersWithVoice['voice:modelStatus'] as unknown as (
      ...args: unknown[]
    ) => Promise<VoiceModelStatus>;
    await hostile('C:/Windows/System32', { path: '../../secrets' });
    await (handlersWithVoice['voice:modelDownload'] as unknown as (
      ...args: unknown[]
    ) => Promise<VoiceModelStatus>)('D:/video/data/openrouter.key');
    await (handlersWithVoice['voice:modelCancel'] as unknown as (
      ...args: unknown[]
    ) => Promise<VoiceModelStatus>)(null, 42);

    expect(received).toEqual([[], [], []]);
  });
});

describe('voice gallery channels', () => {
  it('lists the catalogue with no samples when the build has no gallery port', async () => {
    const voices = await handlers['voice:list']();
    expect(voices).toHaveLength(21);
    expect(voices[0]).toMatchObject({
      id: 'matilda',
      name: 'Matilda',
      accent: 'British',
      gender: 'female',
      sampleId: 'matilda',
    });
    expect(voices[0]?.tone.length).toBeGreaterThan(0);
    expect(voices.every((voice) => voice.sampleUrl === undefined)).toBe(true);
  });

  it('strips a path or a non-audio URL from a gallery entry', async () => {
    const local = createHandlers({
      store,
      runner,
      pipeline,
      settings,
      voiceGallery: {
        list: async () => [
          {
            id: 'matilda',
            name: 'Matilda',
            accent: 'British',
            tone: ['warm'],
            gender: 'female',
            sampleId: 'matilda',
            sampleUrl: 'C:/Windows/System32/secret.mp3',
          },
          {
            id: 'not-a-voice',
            name: 'Fake',
            accent: 'None',
            tone: [],
            gender: 'female',
            sampleId: 'not-a-voice',
            sampleUrl: 'data:audio/mpeg;base64,AAAA',
          },
          {
            id: 'sarah',
            name: 'Sarah',
            accent: 'American',
            tone: ['soft'],
            gender: 'female',
            sampleId: 'sarah',
            sampleUrl: 'data:audio/mpeg;base64,AAAA',
            bytes: 3,
          },
        ],
      },
    });

    const voices = await local['voice:list']();
    expect(voices.map((voice) => voice.id)).toEqual(['matilda', 'sarah']);
    expect(voices[0]?.sampleUrl).toBeUndefined();
    expect(voices[1]?.sampleUrl).toBe('data:audio/mpeg;base64,AAAA');
  });

  it('persists a known voice and rejects anything else', async () => {
    await handlers['voice:setVoice']('george');
    expect(settings.voiceIds).toEqual(['george']);
    expect(settings.voiceId).toBe('george');

    await expect(handlers['voice:setVoice']('../secrets')).rejects.toMatchObject({
      code: 'E_INVALID_INPUT',
    });
    await expect(handlers['voice:setVoice']('unknown')).rejects.toMatchObject({
      code: 'E_INVALID_INPUT',
    });
    expect(settings.voiceIds).toEqual(['george']);
  });

  it('wraps a gallery failure with a typed code', async () => {
    const local = createHandlers({
      store,
      runner,
      pipeline,
      settings,
      voiceGallery: {
        list: async () => {
          throw new Error('samples folder unreadable');
        },
      },
    });
    await expect(local['voice:list']()).rejects.toMatchObject({
      code: 'E_VOICE',
      message: 'samples folder unreadable',
    });
  });
});

describe('channel contract', () => {
  /**
   * Declared arity per channel. A handler that grows a parameter the contract
   * does not declare is either dead code or an unvalidated input path.
   */
  const ARITY: Record<Channel, number> = {
    'listings:list': 0,
    'listings:create': 1,
    'listings:get': 1,
    'listings:updateFacts': 1,
    'analysis:chooseFolder': 0,
    'dialog:chooseReference': 0,
    'reference:analyze': 1,
    'reference:get': 1,
    'reference:clear': 1,
    'dialog:chooseRemix': 0,
    'remix:analyze': 1,
    'remix:get': 1,
    'remix:create': 1,
    'remix:reorder': 1,
    'remix:retag': 1,
    'review:inspect': 1,
    'music:generate': 1,
    'analysis:start': 1,
    'variants:list': 1,
    'shots:list': 1,
    'tagging:estimate': 1,
    'tagging:start': 1,
    'variants:approve': 1,
    'variants:preview': 1,
    'jobs:list': 0,
    'chat:send': 1,
    'chat:apply': 1,
    'chat:versions': 2,
    'agent:run': 1,
    'agent:approve': 1,
    'refine:preview': 1,
    'export:start': 1,
    'settings:get': 0,
    'settings:setTheme': 1,
  'settings:setTagging': 1,
    'settings:setKey': 1,
    'settings:keyStatus': 0,
    'voice:list': 0,
    'voice:setVoice': 1,
    'shell:openPath': 1,
    'voice:modelStatus': 0,
    'voice:modelDownload': 0,
    'voice:modelCancel': 0,
  };

  it('exposes exactly the handler table and no duplicate channels', () => {
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length);
    expect([...Object.keys(handlers)].sort()).toEqual([...CHANNELS].sort());
  });

  it('gives every handler the arity its channel declares', () => {
    for (const channel of CHANNELS) {
      expect({ channel, arity: handlers[channel].length }).toEqual({
        channel,
        arity: ARITY[channel],
      });
    }
  });

  it('allows only request channels through the preload allow-list', () => {
    for (const channel of CHANNELS) expect(isChannel(channel)).toBe(true);
    // The event channel is subscribe-only; it must never be invokable.
    expect(isChannel(JOB_PROGRESS_CHANNEL)).toBe(false);
    expect(isChannel('voice:modelDelete')).toBe(false);
    expect(isChannel('')).toBe(false);
    expect(isChannel(undefined)).toBe(false);
  });
});

describe('agent channels', () => {
  it('runs the agent with validated input and returns its result', async () => {
    const agent = new FakeAgent();
    const local = createHandlers({ store, runner, pipeline, settings, chat, agent });
    store.seed({ id: LISTING_ID });

    const result = await local['agent:run']({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: 'Make the opening warmer.',
      autonomy: 'auto',
    });

    expect(agent.runs).toEqual([
      { listingId: LISTING_ID, variantId: 'calm', message: 'Make the opening warmer.', autonomy: 'auto' },
    ]);
    expect(result).toMatchObject({
      ok: true,
      runId: 'agent_test_1',
      versionId: 'calm-v2',
      applied: true,
      costUsd: 0.001,
      steps: 2,
    });
    expect(result.edits).toEqual([
      { capability: 'apply_grade', summary: 'Applied warm grade.', risk: 'low' },
    ]);
  });

  it('turns a rendered preview path into a scheme URL without leaking the path', async () => {
    const agent = new FakeAgent();
    agent.result = {
      ...agent.result,
      previewPath: 'C:\\Users\\Admin\\AppData\\Roaming\\Zeniconic\\data\\previews\\calm-v2-abc.mp4',
    };
    const local = createHandlers({ store, runner, pipeline, settings, chat, agent });
    store.seed({ id: LISTING_ID });

    const result = await local['agent:run']({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: 'Render a preview.',
    });

    expect(result.previewUrl).toBe('zeniconic-media://preview/calm-v2-abc.mp4');
    expect(result).not.toHaveProperty('previewPath');
  });

  it('renders a draft preview through the port and returns a scheme URL', async () => {
    const local = createHandlers({
      store,
      runner,
      pipeline,
      settings,
      chat,
      refinePreview: {
        preview: async () => ({ path: 'D:/data/previews/calm-v3-xyz.mp4' }),
      },
    });
    store.seed({ id: LISTING_ID });

    await expect(
      local['refine:preview']({ listingId: LISTING_ID, variantId: 'calm' }),
    ).resolves.toEqual({ previewUrl: 'zeniconic-media://preview/calm-v3-xyz.mp4' });
  });

  it('surfaces a render failure instead of a broken URL', async () => {
    const local = createHandlers({
      store,
      runner,
      pipeline,
      settings,
      chat,
      refinePreview: {
        preview: async () => ({ warning: 'Preview failed: no source file.' }),
      },
    });
    store.seed({ id: LISTING_ID });

    await expect(
      local['refine:preview']({ listingId: LISTING_ID, variantId: 'calm' }),
    ).rejects.toMatchObject({ code: 'E_PIPELINE', message: 'Preview failed: no source file.' });
  });

  it('rejects an empty message before reaching the model', async () => {
    const agent = new FakeAgent();
    const local = createHandlers({ store, runner, pipeline, settings, chat, agent });
    store.seed({ id: LISTING_ID });

    await expect(
      local['agent:run']({ listingId: LISTING_ID, variantId: 'calm', message: '   ' }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(agent.runs).toEqual([]);
  });

  it('refuses when the build has no agent', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['agent:run']({ listingId: LISTING_ID, variantId: 'calm', message: 'Trim it.' }),
    ).rejects.toMatchObject({ code: 'E_PIPELINE' });
  });

  it('passes an approval to the running agent', async () => {
    const agent = new FakeAgent();
    const local = createHandlers({ store, runner, pipeline, settings, chat, agent });

    await expect(
      local['agent:approve']({ runId: 'agent_test_1', approved: true }),
    ).resolves.toEqual({ ok: true });
    expect(agent.approvals).toEqual([{ runId: 'agent_test_1', approved: true }]);
  });

  it('rejects an approval for an id that is not an agent run', async () => {
    const agent = new FakeAgent();
    const local = createHandlers({ store, runner, pipeline, settings, chat, agent });

    await expect(
      local['agent:approve']({ runId: '../evil', approved: true }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(agent.approvals).toEqual([]);
  });
});

describe('shots', () => {
  it('returns the persisted shot rows for a listing', async () => {
    store.seed({ id: LISTING_ID });
    pipeline.shots = [
      {
        shotId: 's_aaaaaaaa_sh1',
        sourceId: 's_aaaaaaaa',
        room: 'living',
        startSec: 0,
        endSec: 3.5,
        durationSec: 3.5,
        score: 0.82,
        sellingPoints: ['natural_light'],
        defects: [],
        reason: 'measured',
      },
    ];

    const rows = await handlers['shots:list'](LISTING_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shotId: 's_aaaaaaaa_sh1', room: 'living', score: 0.82 });
  });

  it('returns an empty list before analysis', async () => {
    store.seed({ id: LISTING_ID });
    await expect(handlers['shots:list'](LISTING_ID)).resolves.toEqual([]);
  });

  it('rejects a malformed listing id and an unknown listing', async () => {
    await expect(handlers['shots:list']('../etc')).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    await expect(handlers['shots:list'](LISTING_ID)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});

describe('tagging channels', () => {
  it('prices the persisted shots and starts a tagging run', async () => {
    const tagging = new FakeTagging();
    const local = createHandlers({ store, runner, pipeline, settings, chat, tagging });
    store.seed({ id: LISTING_ID });

    const estimate = await local['tagging:estimate'](LISTING_ID);
    expect(estimate).toMatchObject({ shots: 9, usd: 0.0144, tagged: 0 });

    const run = await local['tagging:start'](LISTING_ID);
    expect(run).toMatchObject({ tagged: 9, failed: 0, costUsd: 0.014 });
    expect(tagging.estimates).toEqual([LISTING_ID]);
    expect(tagging.runs).toEqual([LISTING_ID]);
  });

  it('refuses when tagging is not available', async () => {
    store.seed({ id: LISTING_ID });
    await expect(handlers['tagging:estimate'](LISTING_ID)).rejects.toMatchObject({ code: 'E_PIPELINE' });
    await expect(handlers['tagging:start'](LISTING_ID)).rejects.toMatchObject({ code: 'E_PIPELINE' });
  });

  it('validates the listing id', async () => {
    const tagging = new FakeTagging();
    const local = createHandlers({ store, runner, pipeline, settings, chat, tagging });
    await expect(local['tagging:start']('../escape')).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('persists the auto-tagging toggle', async () => {
    const seen: boolean[] = [];
    const port = Object.assign(new FakeSettings(), {
      async setTagging(enabled: boolean) {
        seen.push(enabled);
      },
    });
    const local = createHandlers({ store, runner, pipeline, settings: port });
    await local['settings:setTagging'](true);
    expect(seen).toEqual([true]);
    await expect(local['settings:setTagging']('yes' as never)).rejects.toMatchObject({
      code: 'E_INVALID_INPUT',
    });
  });
});

describe('reference channels', () => {
  it('picks a file and analyses it into a path-free profile', async () => {
    const reference = new FakeReference();
    const local = createHandlers({ store, runner, pipeline, settings, chat, reference });
    store.seed({ id: LISTING_ID });

    const picked = await local['dialog:chooseReference']();
    expect(picked).toMatch(/refs[\\/]luxury\.mp4$/);

    const profile = await local['reference:analyze']({
      listingId: LISTING_ID,
      path: 'C:/refs/luxury.mp4',
    });
    expect(profile.fileName).toBe('luxury.mp4');
    expect(profile.profile.pacing).toBe('fast');
    expect(reference.analyzed).toHaveLength(1);
    expect(reference.analyzed[0]?.listingId).toBe(LISTING_ID);
    expect(reference.analyzed[0]?.file).toMatch(/refs[\\/]luxury\.mp4$/);
  });

  it('rejects URLs and non-video paths before touching disk', async () => {
    const reference = new FakeReference();
    const local = createHandlers({ store, runner, pipeline, settings, chat, reference });
    store.seed({ id: LISTING_ID });

    await expect(
      local['reference:analyze']({ listingId: LISTING_ID, path: 'https://youtu.be/x' }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    await expect(
      local['reference:analyze']({ listingId: LISTING_ID, path: 'C:/notes.txt' }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    expect(reference.analyzed).toEqual([]);
  });

  it('gets and clears the saved profile', async () => {
    const reference = new FakeReference();
    const local = createHandlers({ store, runner, pipeline, settings, chat, reference });
    store.seed({ id: LISTING_ID });

    const profile = await local['reference:get'](LISTING_ID);
    expect(profile?.profile.aspect).toBe('9:16');

    await local['reference:clear'](LISTING_ID);
    expect(reference.cleared).toEqual([LISTING_ID]);
  });

  it('returns null when reference analysis is unavailable', async () => {
    store.seed({ id: LISTING_ID });
    await expect(handlers['dialog:chooseReference']()).resolves.toBeNull();
    await expect(handlers['reference:get'](LISTING_ID)).resolves.toBeNull();
  });
});

describe('remix channels', () => {
  it('analyses a video and creates a preset variant', async () => {
    const remix = new FakeRemix();
    const local = createHandlers({ store, runner, pipeline, settings, chat, remix });
    store.seed({ id: LISTING_ID });

    const picked = await local['dialog:chooseRemix']();
    expect(picked).toMatch(/remix[\\/]cut\.mp4$/);

    const storyboard = await local['remix:analyze']({
      listingId: LISTING_ID,
      file: 'C:/remix/cut.mp4',
    });
    expect(storyboard.fileName).toBe('cut.mp4');
    expect(storyboard.presets.marketing).toHaveLength(1);
    expect(remix.analyzed).toHaveLength(1);

    const variant = await local['remix:create']({ listingId: LISTING_ID, preset: 'marketing' });
    expect(variant.id).toBe('remix');
    expect(remix.created).toEqual([{ listingId: LISTING_ID, preset: 'marketing' }]);
  });

  it('rejects a URL and an unknown preset', async () => {
    const remix = new FakeRemix();
    const local = createHandlers({ store, runner, pipeline, settings, chat, remix });
    store.seed({ id: LISTING_ID });

    await expect(
      local['remix:analyze']({ listingId: LISTING_ID, file: 'https://youtu.be/x' }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    await expect(
      local['remix:create']({ listingId: LISTING_ID, preset: 'nope' as never }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('validates and forwards a manual order and a room tag', async () => {
    const remix = new FakeRemix();
    const local = createHandlers({ store, runner, pipeline, settings, chat, remix });
    store.seed({ id: LISTING_ID });

    const reordered = await local['remix:reorder']({
      listingId: LISTING_ID,
      preset: 'marketing',
      order: ['sh1'],
    });
    expect(reordered.orders?.marketing).toEqual(['sh1']);
    expect(remix.reordered).toEqual([
      { listingId: LISTING_ID, preset: 'marketing', order: ['sh1'] },
    ]);

    const tagged = await local['remix:retag']({
      listingId: LISTING_ID,
      shotId: 'sh1',
      room: 'kitchen',
    });
    expect(tagged.rooms?.sh1).toBe('kitchen');
    expect(remix.retagged).toEqual([
      { listingId: LISTING_ID, shotId: 'sh1', room: 'kitchen' },
    ]);
  });

  it('rejects a duplicated order and an unknown room before touching the port', async () => {
    const remix = new FakeRemix();
    const local = createHandlers({ store, runner, pipeline, settings, chat, remix });
    store.seed({ id: LISTING_ID });

    await expect(
      local['remix:reorder']({
        listingId: LISTING_ID,
        preset: 'marketing',
        order: ['sh1', 'sh1'],
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    await expect(
      local['remix:retag']({
        listingId: LISTING_ID,
        shotId: 'sh1',
        room: 'garage',
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });

    expect(remix.reordered).toHaveLength(0);
    expect(remix.retagged).toHaveLength(0);
  });

  it('returns null when remix is unavailable', async () => {
    store.seed({ id: LISTING_ID });
    await expect(handlers['dialog:chooseRemix']()).resolves.toBeNull();
    await expect(handlers['remix:get'](LISTING_ID)).resolves.toBeNull();
  });
});

describe('analysis job checkpoint', () => {
  it('records the folder and kind on the queued job', async () => {
    store.seed({ id: LISTING_ID });
    const folder = await makeVideoFolder('checkpoint');
    await handlers['analysis:start']({ listingId: LISTING_ID, folder });

    const job = [...runner.jobs.values()][0];
    expect(job).toMatchObject({ kind: 'analysis', checkpoint: folder });
  });

  it('cancels the job when preparation fails after enqueue', async () => {
    store.seed({ id: LISTING_ID });
    const folder = await makeVideoFolder('cancel');
    pipeline.prepareAnalysis = () => {
      throw new Error('binding failed');
    };
    await expect(
      handlers['analysis:start']({ listingId: LISTING_ID, folder }),
    ).rejects.toMatchObject({ code: 'E_PIPELINE' });

    const job = [...runner.jobs.values()][0];
    expect(job?.status).toBe('cancelled');
  });
});

describe('render inspection', () => {
  it('inspects an export inside the data folder and sanitises the result', async () => {
    const review = new FakeReview();
    const local = createHandlers({
      store, runner, pipeline, settings, chat, review, dataDir: tempDir,
    });
    store.seed({ id: LISTING_ID });
    const file = join(tempDir, 'export.mp4');

    const result = await local['review:inspect']({
      file,
      facts: { price: 'AED 1,850,000' },
    });
    expect(result).toMatchObject({ verdict: 'retry', score: 0.62, costUsd: 0.0021 });
    expect(result.issues[0]).toMatchObject({ severity: 'medium', atSec: 31.2 });
    expect(review.calls).toHaveLength(1);
    expect(review.calls[0]?.file).toBe(file);
  });

  it('refuses files outside the data folder or not mp4', async () => {
    const review = new FakeReview();
    const local = createHandlers({
      store, runner, pipeline, settings, chat, review, dataDir: tempDir,
    });
    store.seed({ id: LISTING_ID });

    await expect(
      local['review:inspect']({ file: 'C:/Windows/notepad.exe' }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
    await expect(
      local['review:inspect']({ file: join(tempDir, 'notes.txt') }),
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' });
  });

  it('refuses when inspection is unavailable', async () => {
    store.seed({ id: LISTING_ID });
    await expect(
      handlers['review:inspect']({ file: join(tempDir, 'export.mp4') }),
    ).rejects.toMatchObject({ code: 'E_PIPELINE' });
  });
});
