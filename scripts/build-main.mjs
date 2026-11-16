/**
 * Builds the Electron main process and preload as two CommonJS bundles.
 *
 * The repo is `"type": "module"`, but Electron loads the main script with
 * `require`, so both outputs end in `.cjs`. Everything except Electron is
 * bundled; the two static-binary packages stay external because they resolve
 * their binary relative to their own package directory, which a bundle would
 * move. Nothing else is copied — the UI build owns `dist/ui`.
 */

import { build } from 'esbuild';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'dist', 'main');

const pkg = (name) => join(root, 'packages', name, 'src', 'index.ts');

/** The tsconfig aliases, repeated for esbuild's resolver. */
const alias = {
  '@zeniconic/core': pkg('core'),
  '@zeniconic/edl': pkg('edl'),
  '@zeniconic/media': pkg('media'),
  '@zeniconic/analysis': pkg('analysis'),
  '@zeniconic/planner': pkg('planner'),
  '@zeniconic/render': pkg('render'),
  '@zeniconic/ai': pkg('ai'),
  '@zeniconic/store': pkg('store'),
  '@zeniconic/jobs': pkg('jobs'),
  '@zeniconic/ipc': pkg('ipc'),
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Electron is provided by the runtime. The static FFmpeg packages find their
  // binaries with __dirname, so leaving them external keeps the path correct.
  // Kokoro dynamically imports onnxruntime-node's native binaries; bundling it
  // would make esbuild try to load every platform's `.node` file.
  external: ['electron', 'ffmpeg-static', 'ffprobe-static', 'kokoro-js'],
  tsconfig: join(root, 'tsconfig.json'),
  alias,
  legalComments: 'none',
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(root, 'apps', 'desktop', 'main.ts')],
    outfile: join(outDir, 'main.cjs'),
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'apps', 'desktop', 'preload.ts')],
    outfile: join(outDir, 'preload.cjs'),
  }),
]);

for (const name of ['main.cjs', 'preload.cjs']) {
  const info = await stat(join(outDir, name));
  console.log(`built dist/main/${name} — ${(info.size / 1024).toFixed(1)} KiB`);
}
