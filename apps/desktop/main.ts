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

import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenRouterClient } from '../../packages/ai/src/index';
import { JobRunner } from '../../packages/jobs/src/index';
import type { StageExecutor } from '../../packages/jobs/src/index';
import {
  CHANNELS,
  createHandlers,
  createSettings,
  JOB_PROGRESS_CHANNEL,
} from '../../packages/ipc/src/index';
import type {
  Handlers,
  JobProgressEvent,
  SecretCipher,
} from '../../packages/ipc/src/index';
import { JsonStore } from '../../packages/store/src/index';
import models from '../../services/pipeline/models.json';
import { createChatService } from './chat';
import { DesktopPipeline } from './pipeline';
import { createSplashWindow, waitMinimum } from './splash';
import { setupAutoUpdate } from './updater';

const isDev = !app.isPackaged;
const DEV_URL = process.env.ZENICONIC_DEV_URL || 'http://localhost:5173';
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
  const media = ["'self'", 'blob:', 'data:'];

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

async function chooseFootageFolder(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
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

function createWindow(initialView?: 'settings', showWhenReady = true): BrowserWindow {
  const win = new BrowserWindow({
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

async function start(): Promise<void> {
  const root = dataRoot();

  installSecurity();

  const store = new JsonStore(root);
  await store.init();

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

  const runner = new JobRunner({ executor });
  const handlers = createHandlers({
    store,
    runner,
    pipeline,
    settings,
    chat,
    chooseFolder: chooseFootageFolder,
    dataDir: root,
    openPath: (path) => shell.openPath(path),
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
