/**
 * Generates the small reference-video fixtures used by `services/reference`
 * tests. Clips are built locally with the bundled ffmpeg — nothing is
 * downloaded, and every file is checked to stay under 1 MB.
 *
 *   node scripts/make-media-fixtures.mjs             # only missing clips
 *   node scripts/make-media-fixtures.mjs --force     # rebuild everything
 *   node scripts/make-media-fixtures.mjs shaky       # just one clip
 *
 * Output: tests/fixtures/media/*.mp4 (generated, not source).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'tests', 'fixtures', 'media');
const MAX_BYTES = 1024 * 1024;

if (typeof ffmpegStatic !== 'string' || ffmpegStatic.length === 0) {
  throw new Error('ffmpeg-static did not resolve to a binary for this platform.');
}

/** Shared encoding flags: tiny, deterministic, fast. */
const ENCODE = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '30',
  '-pix_fmt',
  'yuv420p',
  '-r',
  '30',
  '-movflags',
  '+faststart',
];

const AUDIO = ['-c:a', 'aac', '-b:a', '48k', '-ac', '2'];

/**
 * Four hard-cut scenes with distinct dominant colours (red, teal, sand, blue),
 * 1 s each, plus a quiet tone so loudness is measurable. Expects 4 shots at
 * ~1 s: shotCount > 3 and pacing "fast".
 */
function fastCut() {
  return {
    name: 'fast-cut-9x16',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xB03A2E:s=540x960:d=1:r=30',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x0F4C5C:s=540x960:d=1:r=30',
      '-f',
      'lavfi',
      '-i',
      'color=c=0xE0C068:s=540x960:d=1:r=30',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x2A4B8D:s=540x960:d=1:r=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:sample_rate=48000:duration=4',
      '-filter_complex',
      '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,format=yuv420p[v]',
      '-map',
      '[v]',
      '-map',
      '4:a',
      '-af',
      'volume=0.06',
      ...ENCODE,
      ...AUDIO,
      '-shortest',
    ],
  };
}

/** One held 6 s landscape frame: a single shot, so pacing is "slow". */
function slowLandscape() {
  return {
    name: 'slow-16x9',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x2E4057:s=640x360:d=6:r=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=48000:duration=6',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-af',
      'volume=0.05',
      ...ENCODE,
      ...AUDIO,
      '-shortest',
    ],
  };
}

/** Square, two held scenes: aspect "1:1". */
function square() {
  return {
    name: 'square-1x1',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x7A5C3E:s=360x360:d=1.5:r=30',
      '-f',
      'lavfi',
      '-i',
      'color=c=0xC7B299:s=360x360:d=1.5:r=30',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]',
      '-map',
      '[v]',
      ...ENCODE,
    ],
  };
}

/** Video only: proves the loudness path is skipped, not faked. */
function noAudio() {
  return {
    name: 'no-audio',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x3B6E4F:s=320x180:d=2:r=30',
      '-map',
      '0:v',
      ...ENCODE,
    ],
  };
}

/**
 * Every frame is a different flat grey (`mod(N*53,255)`), which is the cheapest
 * honest stand-in for handheld motion: huge frame differences, no cuts.
 */
function shaky() {
  return {
    name: 'shaky',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x333333:s=320x180:d=4:r=30',
      '-vf',
      "geq=lum='mod(N*53,255)':cb=128:cr=128,format=yuv420p",
      ...ENCODE,
    ],
  };
}

const CLIPS = [fastCut(), slowLandscape(), square(), noAudio(), shaky()];

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const wanted = argv.filter((arg) => !arg.startsWith('--'));

mkdirSync(outDir, { recursive: true });

const selected =
  wanted.length > 0
    ? CLIPS.filter((clip) => wanted.some((name) => clip.name === name))
    : CLIPS;

if (selected.length === 0) {
  console.error(`No clip matched ${wanted.join(', ')}. Known: ${CLIPS.map((c) => c.name).join(', ')}`);
  process.exitCode = 1;
}

let failures = 0;

for (const clip of selected) {
  const out = join(outDir, `${clip.name}.mp4`);

  if (!force && existsSync(out)) {
    console.log(`skip   ${clip.name}.mp4 (exists)`);
    continue;
  }

  const result = spawnSync(
    ffmpegStatic,
    ['-y', '-hide_banner', '-v', 'error', ...clip.args, out],
    { windowsHide: true, encoding: 'utf8' },
  );

  if (result.status !== 0) {
    failures += 1;
    console.error(`FAIL   ${clip.name}.mp4 (exit ${result.status})`);
    console.error(`${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-8).join('\n'));
    continue;
  }

  const bytes = statSync(out).size;
  if (bytes > MAX_BYTES) {
    failures += 1;
    console.error(
      `FAIL   ${clip.name}.mp4 is ${(bytes / 1024).toFixed(0)} KB, over the 1 MB fixture budget.`,
    );
    continue;
  }

  console.log(`built  ${clip.name}.mp4  ${(bytes / 1024).toFixed(0)} KB`);
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`\nFixtures in ${outDir}`);
}
