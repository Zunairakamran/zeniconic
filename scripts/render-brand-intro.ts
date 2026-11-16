// Render the 5 s brand ident from the BrandIntro composition.
// Usage: npx tsx scripts/render-brand-intro.ts

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const publicDir = resolve('data/brand-gen');
mkdirSync(publicDir, { recursive: true });
mkdirSync(resolve('docs/brand'), { recursive: true });

// Fonts must be reachable through publicDir for staticFile().
const fontsSrc = resolve('apps/render/public/fonts');
const fontsDst = resolve('data/brand-gen/fonts');
mkdirSync(fontsDst, { recursive: true });
for (const file of ['bricolage-grotesque-latin-var.woff2', 'archivo-latin-var.woff2', 'fonts.css']) {
  const from = resolve(fontsSrc, file);
  if (existsSync(from)) copyFileSync(from, resolve(fontsDst, file));
}
if (!existsSync(resolve(publicDir, 'brand-bg.png'))) {
  throw new Error('Missing data/brand-gen/brand-bg.png — run scripts/gen-brand-still.ts first.');
}

console.log('bundling composition…');
const serveUrl = await bundle({
  entryPoint: resolve('apps/render/src/entry.ts'),
  publicDir,
});

const composition = await selectComposition({ serveUrl, id: 'brand-intro', inputProps: {} });
const output = resolve('docs/brand/zeniconic-intro.mp4');

console.log('rendering 150 frames…');
await renderMedia({
  serveUrl,
  composition,
  inputProps: {},
  codec: 'h264',
  outputLocation: output,
  imageFormat: 'jpeg',
  jpegQuality: 92,
  crf: 18,
  x264Preset: 'veryfast',
  muted: true,
  overwrite: true,
  chromiumOptions: { gl: 'swangle' },
});

mkdirSync(resolve('apps/desktop/electron/assets'), { recursive: true });
copyFileSync(output, resolve('apps/desktop/electron/assets/intro.mp4'));
console.log(`wrote ${output} and apps/desktop/electron/assets/intro.mp4`);
