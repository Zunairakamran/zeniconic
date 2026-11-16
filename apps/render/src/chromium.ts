/**
 * Where Remotion keeps the browser it downloads.
 *
 * Remotion 4 resolves `<repo>/node_modules/.remotion` from the nearest
 * package.json. Tests must skip, not fail, when the download was blocked, so
 * this path is checked before a browser is ever opened.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export function appRoot(): string {
  return join(repoRoot(), 'apps', 'render');
}

export function renderEntry(): string {
  return join(appRoot(), 'src', 'entry.ts');
}

function platformFolder(): { shell: string; chrome: string; exe: string } {
  if (process.platform === 'win32') {
    return { shell: 'win64', chrome: 'win64', exe: '.exe' };
  }
  if (process.platform === 'darwin') {
    return { shell: process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64', chrome: '', exe: '' };
  }
  return {
    shell: process.arch === 'arm64' ? 'linux-arm64' : 'linux64',
    chrome: process.arch === 'arm64' ? 'linux-arm64' : 'linux64',
    exe: '',
  };
}

/** The headless shell Remotion downloads by default. */
export function remotionChromium(): string {
  const folder = platformFolder();
  const name = `chrome-headless-shell${folder.exe}`;
  return join(
    repoRoot(),
    'node_modules',
    '.remotion',
    'chrome-headless-shell',
    folder.shell,
    `chrome-headless-shell-${folder.shell}`,
    name,
  );
}

/** Stock Chrome for Testing, used when `chromeMode` asks for it. */
export function chromeForTesting(): string {
  const folder = platformFolder();
  const base = join(repoRoot(), 'node_modules', '.remotion', 'chrome-for-testing', folder.shell);
  if (process.platform === 'darwin') {
    return join(
      base,
      `chrome-${folder.shell}`,
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
  }
  const name = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
  return join(base, `chrome-${folder.chrome}`, name);
}

export function chromiumAvailable(): boolean {
  return existsSync(remotionChromium()) || existsSync(chromeForTesting());
}
