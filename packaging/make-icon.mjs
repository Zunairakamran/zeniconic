/**
 * Builds `build/icon.ico` from the brand SVG.
 *
 * Windows needs a real multi-size .ico: NSIS embeds the icon as RT_ICON
 * resources, and those must be uncompressed 32-bit DIBs (PNG-compressed ICO
 * frames are legal for the shell but not for the resource compiler). So this
 * script rasterises the SVG at each size and writes classic BMP frames — no
 * ImageMagick, no admin rights, just `sharp`.
 *
 * Usage: `npm run icon` (or `node packaging/make-icon.mjs`).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = join(root, 'docs', 'brand', 'zeniconic-app-icon.svg');
const outDir = join(root, 'build');

/** Windows convention: 256 is stored as 0 in the directory entry. */
const SIZES = [256, 128, 64, 48, 32, 16];

/**
 * Encodes one square RGBA bitmap as a 32-bit bottom-up DIB with the legacy
 * 1-bit AND mask. Icons ignore the mask when alpha is present, but a zeroed
 * mask keeps older shell code paths happy.
 */
function encodeBmpFrame(rgba, size) {
  const headerSize = 40;
  const pixelsSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const maskSize = maskRowBytes * size;
  const frame = Buffer.alloc(headerSize + pixelsSize + maskSize);

  // BITMAPINFOHEADER. Height is doubled: XOR bitmap + AND mask.
  frame.writeUInt32LE(headerSize, 0);
  frame.writeInt32LE(size, 4);
  frame.writeInt32LE(size * 2, 8);
  frame.writeUInt16LE(1, 12); // planes
  frame.writeUInt16LE(32, 14); // bits per pixel
  frame.writeUInt32LE(0, 16); // BI_RGB
  frame.writeUInt32LE(pixelsSize + maskSize, 20);

  let offset = headerSize;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const src = (y * size + x) * 4;
      // BMP stores BGRA.
      frame[offset] = rgba[src + 2];
      frame[offset + 1] = rgba[src + 1];
      frame[offset + 2] = rgba[src];
      frame[offset + 3] = rgba[src + 3];
      offset += 4;
    }
  }

  const maskStart = headerSize + pixelsSize;
  for (let y = 0; y < size; y += 1) {
    const row = (size - 1 - y) * maskRowBytes;
    for (let x = 0; x < size; x += 1) {
      const alpha = rgba[(y * size + x) * 4 + 3];
      if (alpha < 128) {
        frame[maskStart + row + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { frame, maskRowBytes };
}

function encodeIco(frames) {
  const count = frames.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  let offset = header.length;
  frames.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header[entry + 2] = 0; // palette colours
    header[entry + 3] = 0; // reserved
    header.writeUInt16LE(1, entry + 4); // planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...frames.map((frame) => frame.data)]);
}

await mkdir(outDir, { recursive: true });

// Rasterise once at high resolution, then downsample, so every size comes from
// the same antialiased master instead of a re-parse at tiny dimensions.
const master = sharp(source, { density: 1440 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .png();

const masterBuffer = await master.toBuffer();

const frames = [];
for (const size of SIZES) {
  const { data } = await sharp(masterBuffer)
    .resize(size, size, { kernel: 'lanczos3', fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { frame } = encodeBmpFrame(data, size);
  frames.push({ size, data: frame });
  console.log(`  ${size}×${size} — ${(frame.length / 1024).toFixed(1)} KiB`);
}

const ico = encodeIco(frames);
const icoPath = join(outDir, 'icon.ico');
await writeFile(icoPath, ico);

// electron-builder is also happy with a 512 px PNG (useful for previews and
// future Linux/macOS targets), so keep one next to the .ico.
await sharp(masterBuffer).resize(512, 512).png().toFile(join(outDir, 'icon.png'));

console.log(
  `wrote ${icoPath} — ${SIZES.join('/')} — ${(ico.length / 1024).toFixed(1)} KiB`,
);
