/**
 * Auto-update from GitHub Releases.
 *
 * The source repository is private, but update *binaries* live in a public
 * releases repository (`zeniconic-releases`). Electron's updater must be able to
 * fetch release metadata without shipping a GitHub token inside the installer —
 * a token on a client machine is a credential leak, not a feature.
 *
 * Runs only in a packaged app; development never checks for updates.
 */

import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

export interface UpdateLogger {
  (message: string): void;
}

export function setupAutoUpdate(log: UpdateLogger = () => {}): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('error', (error) => {
    log(`update check failed: ${error?.message ?? String(error)}`);
  });

  autoUpdater.on('update-available', (info) => {
    log(`update available: ${info.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    log('no update available');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart and update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Zeniconic update',
      message: `Version ${info.version} is ready`,
      detail:
        'Restarting applies the update. Your listings, media and settings stay where they are.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    log(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}
