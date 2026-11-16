/**
 * Frameless splash that plays the brand ident for ~1.6 s while the main window
 * loads. Silent, skippable by clicking, and harmless if the video cannot play.
 */

import { BrowserWindow } from 'electron';

export interface SplashOptions {
  htmlPath: string;
  /** Milliseconds the ident must be visible before the main window shows. */
  minimumMs?: number;
}

export function createSplashWindow(options: SplashOptions): BrowserWindow {
  const splash = new BrowserWindow({
    width: 340,
    height: 604,
    frame: false,
    transparent: false,
    backgroundColor: '#14120F',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  splash.once('ready-to-show', () => splash.show());
  void splash.loadFile(options.htmlPath);

  // Clicking dismisses the ident early; the caller still waits for the minimum.
  splash.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'mouseDown' || input.key === 'Escape') splash.hide();
  });

  return splash;
}

export function waitMinimum(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = Math.max(0, minimumMs - (Date.now() - startedAt));
  return new Promise((resolve) => setTimeout(resolve, remaining));
}
