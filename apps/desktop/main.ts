/**
 * Electron main process.
 *
 * The renderer is sandboxed and has no Node access. This file is the only
 * place that owns the store, the job runner and the filesystem; it exposes them
 * through the typed handler table in `@zeniconic/ipc`.
 *
 * Built to `dist/main/main.cjs` by `scripts/build-main.mjs`; the checked-in
 * `electron/main.cjs` is a two-line shim for the existing npm scripts.
 */

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, safeStorage, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { OpenRouterClient } from '../../packages/ai/src/index';
import { JsonJobStore, JobRunner } from '../../packages/jobs/src/index';
import type { StageExecutor } from '../../packages/jobs/src/index';
import { CostLedger } from '../../packages/ledger/src/index';
import {
  AGENT_EVENT_CHANNEL,
  CHANNELS,
  createHandlers,
  createSettings,
  JOB_PROGRESS_CHANNEL,
} from '../../packages/ipc/src/index';
import type {
  AgentEventDto,
  Handlers,
  JobProgressEvent,
  ReferencePort,
  SecretCipher,
  VoiceModelPort,
} from '../../packages/ipc/src/index';
import { JsonStore } from '../../packages/store/src/index';
import models from '../../services/pipeline/models.json';
import {
  configureStudioVoice,
  createVoiceGallery,
  KokoroModelDownloader,
  modelRoot,
} from '../../services/voice/src/index';
import { createAgentService } from './agent-service';
import { createChatService } from './chat';
import { createRemixService } from './remix';
import { createReviewService } from './review-service';
import { createMusicService } from './music-service';
import { DesktopPipeline } from './pipeline';
import { createSplashWindow, waitMinimum } from './splash';
import { previewResponse } from './media-protocol';
import { setupAutoUpdate } from './updater';
import { resolveFontsDirectory } from '../../services/pipeline/ffmpeg-overlays';
import { ffmpegPath } from '../../packages/media/src/index';
import { transcribeAudio } from '../../services/remix/src/index';
import {
  analyseReference,
  clearReferenceProfile,
  readReferenceProfile,
  saveReferenceProfile,
} from '../../services/reference/src/index';
import type { ReferenceProfileDto } from '../../packages/ipc/src/index';
import { basename } from 'node:path';

const isDev = !app.isPackaged;
const DEV_URL = process.env.ZENICONIC_DEV_URL || 'http://localhost:5173';
const MEDIA_SCHEME = 'zeniconic-media';

// Must run before `app.whenReady()`. The scheme serves draft previews to a
// <video> element with range requests; nothing else is readable through it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);
/** Development writes beside the checkout, never a hard-coded drive. */
const DEV_DATA_DIR = join(app.getAppPath(), 'data');

/**
 * Production home: `%APPDATA%\Zeniconic` (Electron would otherwise use the
 * npm package name, `%APPDATA%\zeniconic`). Fixing it at startup keeps the
 * store, cache and logs in one folder across renames of the package.
 */
const PROD_HOME = join(app.getPath('appData'), 'Zeniconic');
if (app.isPackaged) app.setPath('userData', PROD_HOME);

let mainWindow: BrowserWindow | null = null;

/**
 * Production writes under `%APPDATA%\Zeniconic\data`; development uses the
 * repo workspace. `ZENICONIC_DATA_DIR` wins in both, which is how tests and QA
 * point the app at a scratch folder.
 */
function dataRoot(): string {
  const override = process.env.ZENICONIC_DATA_DIR;
  if (typeof override === 'string' && override.trim().length > 0) {
    return resolve(override);
  }
  if (app.isPackaged) return join(app.getPath('userData'), 'data');
  return DEV_DATA_DIR;
}

function sendProgress(event: JobProgressEvent): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(JOB_PROGRESS_CHANNEL, event);
}

function sendAgentEvent(event: AgentEventDto): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(AGENT_EVENT_CHANNEL, event);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The shell's content policy.
 *
 * The renderer is a local bundle with no remote script: `default-src 'self'`
 * and a `connect-src` allow-list are the whole network surface. The OpenRouter
 * origin is allowed only because the optional relay talks to it from the main
 * process; the window itself never fetches it. Development additionally needs
 * Vite's origin and HMR socket.
 */
export function contentSecurityPolicy(): string {
  const connect = ["'self'", 'https://openrouter.ai'];
  const script = ["'self'"];
  const style = ["'self'", "'unsafe-inline'"];
  const img = ["'self'", 'data:', 'blob:'];
  const font = ["'self'", 'data:'];
  const media = ["'self'", 'blob:', 'data:', 'zeniconic-media:'];

  if (isDev) {
    const origin = new URL(DEV_URL).origin;
    connect.push(origin, origin.replace(/^http/, 'ws'));
    // Vite injects the React refresh preamble as an inline module script.
    script.push(origin, "'unsafe-inline'");
    style.push(origin);
    img.push(origin);
    font.push(origin);
  } else {
    // The packaged UI is loaded from file://; the scheme itself is the origin.
    script.push('file:');
    style.push('file:');
    img.push('file:');
    font.push('file:');
    media.push('file:');
    connect.push('file:');
  }

  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    `style-src ${style.join(' ')}`,
    `img-src ${img.join(' ')}`,
    `font-src ${font.join(' ')}`,
    `media-src ${media.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Serves `zeniconic-media://preview/<name>.mp4` from `<data>/previews` only.
 * Range requests are answered with a 206 so seeking works; any other host,
 * traversal attempt or non-MP4 name is a 404.
 */
function installMediaProtocol(root: string): void {
  const previews = resolve(root, 'previews');
  protocol.handle(MEDIA_SCHEME, (request) =>
    previewResponse(previews, request.url, request.headers.get('range')),
  );
}

/** CSP plus a navigation guard: a top frame can never leave the app. */
function installSecurity(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, done) => {
    // No camera, microphone, notifications or geolocation in this app.
    done(false);
  });
}

/** True for a URL the window is allowed to navigate to itself. */
function isAppUrl(url: string): boolean {
  if (isDev) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

function guardNavigation(win: BrowserWindow): void {
  const openOutside = (url: string): void => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url).catch(() => undefined);
    }
  };

  const block = (event: Electron.Event, url: string): void => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openOutside(url);
  };

  win.webContents.on('will-navigate', (event, url) => {
    block(event, url);
  });
  // Redirects are a separate event; an https redirect must not keep the
  // preload bridge either.
  win.webContents.on('will-redirect', (event, url) => {
    block(event, url);
  });
}

/**
 * Electron's DPAPI-backed storage. `safeStorage` is only usable after
 * `app.whenReady()`, which is why the adapter is created inside `start()`.
 */
function secureCipher(): SecretCipher {
  return {
    available(): boolean {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    encrypt(value: string): string {
      return safeStorage.encryptString(value).toString('base64');
    },
    decrypt(value: string): string {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    },
  };
}

async function chooseFootageFolder(): Promise<string | null> {  const options: Electron.OpenDialogOptions = {
    title: 'Choose your footage folder',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory'],
  };

  const result =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

async function chooseReferenceVideo(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a reference video',
    buttonLabel: 'Use this video',
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts'] },
    ],
  };
  const result =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

async function chooseRemixVideo(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a finished video to remix',
    buttonLabel: 'Use this video',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'] }],
  };
  const result =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

function createWindow(initialView?: 'settings', showWhenReady = true): BrowserWindow {  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#F7F4EF',
    title: 'Zeniconic',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (showWhenReady) win.once('ready-to-show', () => win.show());
  guardNavigation(win);

  // External links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url).catch(() => undefined);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    const url = initialView === undefined ? DEV_URL : `${DEV_URL}#${initialView}`;
    void win.loadURL(url);
    win.webContents.on('did-fail-load', () => {
      // Vite may still be starting; retry once shortly.
      setTimeout(() => {
        if (!win.isDestroyed()) void win.loadURL(url);
      }, 800);
    });
  } else {
    // dist/main/main.cjs → dist/ui/index.html
    const file = join(__dirname, '..', 'ui', 'index.html');
    void win.loadFile(
      file,
      initialView === undefined ? undefined : { hash: initialView },
    );
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

/**
 * First run without a key: the window is already routed to Settings, and this
 * native prompt says why. Shown on every launch until a key exists — analysis
 * cannot start without one, and the alternative (silent failure at the first
 * analysis) is worse.
 *
 * TODO(ipc): `settings:get` still exposes only `modelConfigured`, so first run
 * negates that. Prefer an explicit `needsKey: boolean` on the snapshot (the
 * `settings:setKey` / `settings:keyStatus` channels already exist) and let the
 * Settings screen keep owning the key field.
 */
function promptForModelKey(win: BrowserWindow): void {
  const show = (): void => {
    if (win.isDestroyed()) return;
    void dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Add an OpenRouter key',
      message: 'Zeniconic needs an OpenRouter API key before it can analyse footage.',
      detail:
        'Settings is open. Add the key there — it stays on this machine and is ' +
        'never written into the installer or a project file.\n\n' +
        'Intake, shot review, rendering and export all work without a key.',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    });
  };

  if (win.isVisible()) show();
  else win.once('ready-to-show', show);
}

/**
 * `ipcMain.handle` is registered only for the channels in the contract. The
 * renderer cannot invent a channel, and every handler validates its input.
 */
function registerIpc(handlers: Handlers): void {
  for (const channel of CHANNELS) {
    const handler = handlers[channel] as unknown as (
      ...args: unknown[]
    ) => Promise<unknown>;

    ipcMain.handle(channel, (_event, ...args: unknown[]) => handler(...args));
  }
}

/**
 * Removes export scratch directories a crash left behind. A killed job never
 * reaches its `finally`, and each one holds hard-linked footage plus a
 * Remotion encode; after a few crash-and-retry cycles this is gigabytes.
 * Only directories old enough that no live export can own them are touched.
 */
async function sweepOrphanedWorkDirs(dataDir: string): Promise<void> {
  const tmpDir = join(dataDir, 'tmp');
  const cutoff = Date.now() - 6 * 60 * 60_000;
  let entries: string[];
  try {
    entries = await readdir(tmpDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith('export-') && !entry.startsWith('review-')) continue;
    const path = join(tmpDir, entry);
    try {
      const info = await stat(path);
      if (info.isDirectory() && info.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      }
    } catch (error) {
      console.warn(`[pipeline] could not clear ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function start(): Promise<void> {
  const root = dataRoot();

  installSecurity();
  installMediaProtocol(root);

  const store = new JsonStore(root);
  await store.init();

  // Persisted jobs and spend. Hydration is read-only: nothing resumes at boot
  // until its source binding is known.
  const jobStore = new JsonJobStore(root);
  await jobStore.init();
  const ledger = new CostLedger(root, { caps: models.budgets });

  const canSpend = async (usd: number, listingId?: string): Promise<boolean> => {
    try {
      const verdict = await ledger.evaluate({
        amountUsd: usd,
        ...(listingId === undefined ? {} : { listingId }),
      });
      return verdict.allowed;
    } catch {
      return false;
    }
  };

  // Cheap, once per launch, and never blocks the window.
  void sweepOrphanedWorkDirs(root);

  const settings = createSettings({
    dataDir: root,
    // ADR-004: the key is never bundled; dev reads the environment. A key
    // saved from Settings is encrypted with the OS credential store.
    modelConfigured: () =>
      typeof process.env.OPENROUTER_API_KEY === 'string' &&
      process.env.OPENROUTER_API_KEY.trim().length > 0,
    apiKey: () => process.env.OPENROUTER_API_KEY,
    cipher: secureCipher(),
    version: app.getVersion(),
    // Model spend is only tracked by the stages that call a model; the desktop
    // pipeline is deterministic today, so the real total is zero.
    spendUsd: 0,
  });

  // First run is still derived from the settings snapshot; a stored key now
  // counts as configured because `createSettings` checks it too.
  const needsKey = !(await settings.get()).modelConfigured;

  const pipeline = new DesktopPipeline({
    store,
    dataDir: root,
    repoRoot: app.isPackaged ? app.getAppPath() : process.cwd(),
    onProgress: sendProgress,
    // Gemini Flash TTS is the configured studio voice; Kokoro is the backup.
    ttsModel: process.env.STUDIO_TTS_MODEL?.trim() || models.roles.tts.model,
    reduceMotion: nativeTheme.shouldUseReducedMotion,
    voiceOnCost: async (usd, listingId) => {
      await ledger.record({
        role: 'voice',
        model: process.env.STUDIO_TTS_MODEL?.trim() || models.roles.tts.model,
        listingId,
        costUsd: usd,
      });
    },
    musicTrack: async () => (await settings.get()).musicTrack,
    tagging: {
      model: models.roles.tagging.model,
      maxUsd: 0.25,
      enabled: async () => {
        const flag = process.env.ZENICONIC_TAG;
        if (flag === '1') return true;
        if (flag === '0') return false;
        return (await settings.get()).tagOnAnalyse;
      },
      canSpend: (usd, listingId) => canSpend(usd, listingId),
      client: async () => {
        const key = await settings.getKey();
        if (typeof key !== 'string' || key.trim().length === 0) return undefined;
        return new OpenRouterClient({
          apiKey: key,
          fetchImpl: (url, init) => fetch(url, init),
          ...(process.env.OPENROUTER_BASE_URL?.trim()
            ? { baseUrl: process.env.OPENROUTER_BASE_URL.trim() }
            : {}),
        });
      },
      onCost: async (usd, listingId) => {
        await ledger.record({
          role: 'tagging',
          model: models.roles.tagging.model,
          listingId,
          costUsd: usd,
        });
      },
    },
  });

  /**
   * The refine assistant. The key comes from the same secure provider Settings
   * writes to; a fresh client is built per call so a key added at runtime works
   * without a restart. Nothing is logged: the client redacts its own key.
   */
  const chat = createChatService({
    listingDir: (listingId) => store.dirFor(listingId),
    apiKey: () => settings.getKey(),
    model: process.env.PLANNING_MODEL?.trim() || models.roles.planning.model,
    complete: async (request) => {
      const apiKey = await settings.getKey();
      if (apiKey === undefined) {
        throw new Error('Add an OpenRouter key in Settings first.');
      }
      const baseUrl = process.env.OPENROUTER_BASE_URL?.trim();
      const client = new OpenRouterClient({
        apiKey,
        ...(baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl }),
        fetchImpl: (url, init) => fetch(url, init),
      });
      return client.complete(request);
    },
  });

  // The agent uses the same secure key and the same version store as the chat.
  const agent = createAgentService({
    store,
    chat,
    apiKey: () => settings.getKey(),
    models: [models.roles.agent.model, ...models.roles.agent.candidates],
    ...(process.env.OPENROUTER_BASE_URL?.trim()
      ? { baseUrl: process.env.OPENROUTER_BASE_URL.trim() }
      : {}),
    onEvent: sendAgentEvent,
    dataDir: root,
    fontsDir: resolveFontsDirectory(app.isPackaged ? app.getAppPath() : process.cwd()),
    canSpend: (usd, listingId) => canSpend(usd, listingId),
    onSpend: async (input) => {
      await ledger.record({
        role: input.role,
        model: input.model,
        listingId: input.listingId,
        runId: input.runId,
        costUsd: input.costUsd,
      });
    },
  });

  // The pipeline sends fine-grained progress; this wrapper makes the runner's
  // stage boundaries visible too, so the UI always hears when a stage ends —
  // and when it fails.
  const executor: StageExecutor = {
    async run(job, signal) {
      sendProgress({ jobId: job.id, stage: job.stage, percent: 0, status: 'running' });
      try {
        const result = await pipeline.run(job, signal);
        sendProgress({
          jobId: job.id,
          stage: result.stage,
          percent: 100,
          status: result.stage === 'done' ? 'complete' : 'running',
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        });
        return result;
      } catch (error) {
        sendProgress({
          jobId: job.id,
          stage: job.stage,
          percent: 0,
          status: signal.aborted ? 'cancelled' : 'failed',
          ...(signal.aborted ? {} : { error: messageOf(error) }),
        });
        throw error;
      }
    },
  };

  const runner = new JobRunner({ executor, store: jobStore });
  const restoredJobs = await runner.load();

  // A crash during analysis leaves a queued/running job with its folder in the
  // checkpoint. Rebind the source and let the runner resume from the last
  // completed stage.
  const resumable = restoredJobs.filter(
    (job) =>
      job.kind === 'analysis' &&
      typeof job.checkpoint === 'string' &&
      job.checkpoint.length > 0 &&
      (job.status === 'queued' || job.status === 'running'),
  );
  for (const job of resumable) {
    pipeline.prepareAnalysis({
      jobId: job.id,
      listingId: job.listingId,
      folder: job.checkpoint as string,
    });
    void runner
      .run(job.id)
      .then(async (finished) => {
        if (finished.status === 'complete') {
          await store.update(job.listingId, { status: 'ready' }).catch(() => undefined);
        } else if (finished.status === 'failed') {
          await store
            .update(job.listingId, {
              status: 'failed',
              lastError: finished.error ?? 'Analysis failed.',
            })
            .catch(() => undefined);
        } else if (finished.status === 'cancelled') {
          await store.update(job.listingId, { status: 'draft' }).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        console.warn(`[jobs] could not resume ${job.id}: ${messageOf(error)}`);
      });
  }
  const downloader = new KokoroModelDownloader({ root: modelRoot(root) });

  /**
   * The studio voice reads the same secure key Settings writes. Wiring it here
   * (rather than in the pipeline) keeps the secret in one place; the export
   * falls back to Kokoro with a warning when no key exists.
   */
  configureStudioVoice({
    getApiKey: () => settings.getKey(),
    getVoiceId: async () => (await settings.get()).voiceId,
  });

  /**
   * Bundled previews live beside the Electron assets. In a packaged build the
   * folder is inside `app.asar`; Electron reads the unpacked copy transparently.
   * The gallery hands the renderer `data:` URLs, never this path.
   */
  const voicesDir =
    process.env.ZENICONIC_VOICE_DIR?.trim() ||
    join(__dirname, '..', '..', 'apps', 'desktop', 'electron', 'assets', 'voices');
  const voiceGallery = createVoiceGallery({ dir: voicesDir });

  const voiceModel: VoiceModelPort = {
    status: () => downloader.status(),
    start: async () => {
      void downloader.start((status) => {
        // No event channel: the renderer polls `voice:modelStatus`. The
        // callback keeps the phase fresh for a status call that races the start.
        if (status.phase === 'error') console.warn(`[voice-model] ${status.error ?? 'failed'}`);
      });
      return await downloader.status();
    },
    cancel: async () => {
      downloader.cancel();
      return await downloader.status();
    },
  };
  const reference: ReferencePort = {
    chooseFile: chooseReferenceVideo,
    async analyze(listingId: string, file: string): Promise<ReferenceProfileDto> {
      const profile = await analyseReference({ file });
      const stored = await saveReferenceProfile(store.dirFor(listingId), { file, profile });
      return {
        analyzedAt: stored.analyzedAt,
        fileName: basename(file),
        profile: stored.profile,
      } as unknown as ReferenceProfileDto;
    },
    async get(listingId: string): Promise<ReferenceProfileDto | null> {
      const stored = await readReferenceProfile(store.dirFor(listingId));
      if (stored === undefined) return null;
      return {
        analyzedAt: stored.analyzedAt,
        fileName: basename(stored.file),
        profile: stored.profile,
      } as unknown as ReferenceProfileDto;
    },
    async clear(listingId: string): Promise<void> {
      await clearReferenceProfile(store.dirFor(listingId));
    },
  };

  const remix = createRemixService({    store,
    transcribe: async (file: string) => {
      const dir = await mkdtemp(join(root, 'tmp', 'remix-audio-'));
      const wav = join(dir, 'audio.wav');
      try {
        await promisify(execFile)(ffmpegPath(), [
          '-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000',
          '-c:a', 'pcm_s16le', wav,
        ]);
        const data = await readFile(wav);
        const key = await settings.getKey();
        if (typeof key !== 'string' || key.trim().length === 0) {
          throw new Error('Add an OpenRouter key in Settings to transcribe speech.');
        }
        const result = await transcribeAudio(
          { data, format: 'wav' },
          {
            getApiKey: () => key,
            model: models.roles.transcription.model,
            ...(process.env.OPENROUTER_BASE_URL?.trim()
              ? { baseUrl: process.env.OPENROUTER_BASE_URL.trim() }
              : {}),
          },
        );
        return {
          words: result.words,
          durationSec: result.durationSec,
          model: models.roles.transcription.model,
          // Only present when OpenRouter reports it; never guessed.
          ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    onTranscription: async ({ listingId, model, costUsd }) => {
      if (!(costUsd > 0)) return;
      await ledger.record({
        role: 'transcription',
        model,
        listingId,
        costUsd,
      });
    },
    canSpend: (usd, listingId) => canSpend(usd, listingId),
    estimateTranscriptionUsd: (seconds) => {
      // The rate lives in models.json when one is pinned. Without it there is no
      // honest estimate, so the pre-flight is skipped rather than invented.
      const role = models.roles.transcription as {
        perSecondUsd?: number;
        perMinuteUsd?: number;
      };
      if (typeof role.perSecondUsd === 'number' && role.perSecondUsd > 0) {
        return role.perSecondUsd * seconds;
      }
      if (typeof role.perMinuteUsd === 'number' && role.perMinuteUsd > 0) {
        return (role.perMinuteUsd * seconds) / 60;
      }
      return undefined;
    },
  });

  const review = createReviewService({
    dataDir: root,
    model: models.roles.review.model,
    client: async () => {
      const key = await settings.getKey();
      if (typeof key !== 'string' || key.trim().length === 0) return undefined;
      return new OpenRouterClient({
        apiKey: key,
        fetchImpl: (url, init) => fetch(url, init),
        ...(process.env.OPENROUTER_BASE_URL?.trim()
          ? { baseUrl: process.env.OPENROUTER_BASE_URL.trim() }
          : {}),
      });
    },
    onCost: async (usd) => {
      await ledger.record({
        role: 'review',
        model: models.roles.review.model,
        listingId: 'unknown',
        costUsd: usd,
      });
    },
  });

  const music = createMusicService({
    dataDir: root,
    model: models.roles.music.model,
    apiKey: () => settings.getKey(),
    canSpend: (usd) => canSpend(usd),
    onCost: async (usd) => {
      await ledger.record({
        role: 'music',
        model: models.roles.music.model,
        listingId: 'unknown',
        costUsd: usd,
      });
    },
    onSelect: (fileName) =>
      settings.setMusic === undefined ? undefined : settings.setMusic(fileName),
    ...(process.env.OPENROUTER_BASE_URL?.trim()
      ? { baseUrl: process.env.OPENROUTER_BASE_URL.trim() }
      : {}),
  });

  const handlers = createHandlers({
    store,
    runner,
    pipeline,
    settings,
    chat,
    agent,
    chooseFolder: chooseFootageFolder,
    dataDir: root,
    openPath: (path) => shell.openPath(path),
    voiceModel,
    voiceGallery,
    spend: {
      summary: async () => {
        const summary = await ledger.summary();
        return { monthUsd: summary.monthUsd };
      },
    },
    tagging: {
      estimate: (listingId) => pipeline.estimateTagging(listingId),
      start: (listingId) => pipeline.runTagging(listingId),
    },
    reference,
    remix: {
      chooseFile: chooseRemixVideo,
      analyze: (listingId, file, transcribe) => remix.analyze({ listingId, file, transcribe }),
      get: (listingId) => remix.get(listingId),
      create: (listingId, preset) => remix.create({ listingId, preset }),
      reorder: (listingId, preset, order) => remix.reorder({ listingId, preset, order }),
      retag: (listingId, shotId, room) => remix.retag({ listingId, shotId, room }),
    },
    review: {
      inspect: (input) => review.inspect(input),
    },
    music: {
      generate: (prompt) => music.generate(prompt),
    },
    refinePreview: {
      preview: (input) => agent.preview(input),
    },
  });

  registerIpc(handlers);

  // The ident plays while the store, settings and handlers come up. The main
  // window is created immediately but stays hidden until it has something to
  // show and the ident has had its minimum 1.6 s.
  const splashPath = join(__dirname, '..', '..', 'apps', 'desktop', 'electron', 'splash.html');
  const splashStarted = Date.now();
  const splash = existsSync(splashPath)
    ? createSplashWindow({ htmlPath: splashPath, minimumMs: 1600 })
    : null;

  mainWindow = createWindow(needsKey ? 'settings' : undefined, false);
  const win = mainWindow;

  const ready = new Promise<void>((done) => {
    if (!win.webContents.isLoading()) {
      done();
      return;
    }
    win.once('ready-to-show', () => done());
  });

  // A failed dev load must not leave the splash on screen forever.
  await Promise.race([
    Promise.all([ready, waitMinimum(splashStarted, 1600)]),
    new Promise<void>((done) => setTimeout(done, 10_000)),
  ]);

  if (!win.isDestroyed()) {
    win.show();
    win.focus();
  }
  if (splash !== null && !splash.isDestroyed()) splash.close();

  if (needsKey) promptForModelKey(win);

  // Packaged builds only; `setupAutoUpdate` also refuses development.
  if (app.isPackaged) {
    setupAutoUpdate((message) => console.log(`[updater] ${message}`));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(needsKey ? 'settings' : undefined);
    }
  });
}

app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    console.error('[main] failed to start:', error instanceof Error ? error.message : error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
