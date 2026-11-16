/**
 * Builds `src/fonts.generated.ts` from the committed woff2 files.
 *
 * Remotion's public directory is the listing workspace (so `staticFile` can
 * reach the footage), which means the fonts cannot be served from
 * `apps/render/public`. They are embedded as data URIs instead: no CDN, no
 * second public directory, and the same bytes on every machine.
 *
 * Run with: node apps/render/scripts/build-fonts.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const fontsDir = join(appRoot, 'public', 'fonts');

const FACES = [
  {
    file: 'bricolage-grotesque-latin-var.woff2',
    family: 'Bricolage Grotesque',
    weight: '400 800',
  },
  {
    file: 'archivo-latin-var.woff2',
    family: 'Archivo',
    weight: '100 900',
  },
];

const faces = [];
for (const face of FACES) {
  const bytes = await readFile(join(fontsDir, face.file));
  faces.push({
    family: face.family,
    weight: face.weight,
    base64: bytes.toString('base64'),
  });
}

const css = faces
  .map(
    (face) => `@font-face {
  font-family: '${face.family}';
  font-style: normal;
  font-weight: ${face.weight};
  font-display: block;
  src: url(data:font/woff2;base64,${face.base64}) format('woff2');
}`,
  )
  .join('\n\n');

const source = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: public/fonts/*.woff2, downloaded from Google Fonts (OFL).
 * Rebuild with: node apps/render/scripts/build-fonts.mjs
 *
 * Bricolage Grotesque 650 (display) and Archivo 400/600 (UI) are both served
 * from the variable faces below.
 */

export const FONT_FACE_CSS = ${JSON.stringify(css)};

export const FONT_BUNDLE_HASH = ${JSON.stringify(
  faces.map((face) => `${face.family}:${face.weight}:${face.base64.length}`).join('|'),
)};
`;

await mkdir(join(appRoot, 'src'), { recursive: true });
await writeFile(join(appRoot, 'src', 'fonts.generated.ts'), source, 'utf8');
console.log(`Wrote src/fonts.generated.ts (${css.length} bytes of CSS)`);
