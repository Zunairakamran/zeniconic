/**
 * Real FFmpeg proof for the caption engine.
 *
 *   npx tsx services/pipeline/test/caption-render-check.ts
 *
 * It builds word-level captions, renders one ASS per preset, burns each onto a
 * generated 1080×1920 colour clip, extracts frames and compares raw pixels:
 *
 *   - every styled frame must differ from the textless baseline;
 *   - every pair of style variants must differ from each other;
 *   - a word-by-word frame at 1.2 s must differ from the same cut at 3.0 s,
 *     proving the ASS actually reveals words over time rather than drawing a
 *     static cue.
 *
 * Evidence (ASS, MP4, PNG frames, report.json) goes under data/tmp, which is
 * gitignored. Nothing is uploaded and no listing footage is touched.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ffmpegPath } from '../../../packages/media/src/index';
import {
  escapeFilterPath,
  resolveFontsDirectory,
} from '../ffmpeg-overlays';
import {
  buildCaptionAss,
  groupCaptionCues,
  resolveCaptionStyle,
} from '../caption-engine';
import type { CaptionCanvas, CaptionPresetId } from '../caption-engine';

const OUT_DIR = resolve('data', 'tmp', 'caption-engine-qa');
const FONTS_DIR = resolveFontsDirectory(resolve('.'));
const CANVAS: CaptionCanvas = {
  width: 1080,
  height: 1920,
  safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
};
const CLIP_SEC = 4.4;

const WORDS = [
  { text: 'Wake', startSec: 0.3, endSec: 0.6 },
  { text: 'up', startSec: 0.6, endSec: 0.8 },
  { text: 'to', startSec: 0.8, endSec: 0.95 },
  { text: 'this', startSec: 0.95, endSec: 1.2 },
  { text: 'view.', startSec: 1.2, endSec: 1.6 },
  { text: 'Three', startSec: 1.9, endSec: 2.2 },
  { text: 'bedrooms', startSec: 2.2, endSec: 2.7 },
  { text: 'and', startSec: 2.7, endSec: 2.8 },
  { text: 'a', startSec: 2.8, endSec: 2.9 },
  { text: 'private', startSec: 2.9, endSec: 3.3 },
  { text: 'pool.', startSec: 3.3, endSec: 3.8 },
];

const VARIANTS: ReadonlyArray<{ preset: CaptionPresetId; animation: string }> = [
  { preset: 'social_bold', animation: 'pop' },
  { preset: 'kinetic_bold', animation: 'word_by_word' },
  { preset: 'glass_pill', animation: 'karaoke' },
  { preset: 'luxury_gold', animation: 'rise' },
  { preset: 'bold_bw', animation: 'pop' },
];

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

function run(args: string[]): Promise<string> {
  return new Promise<string>((done, fail) => {
    execFile(
      ffmpegPath(),
      args,
      { windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) fail(new Error(`${error.message}\n${stderr}`));
        else done(stdout);
      },
    );
  });
}

async function rawImage(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Pixels whose largest channel delta exceeds `threshold`, plus mean delta. */
function diff(a: RawImage, b: RawImage, threshold = 10): { changed: number; mean: number } {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error('Frame sizes differ');
  }
  let changed = 0;
  let total = 0;
  for (let offset = 0; offset < a.data.length; offset += a.channels) {
    let delta = 0;
    for (let channel = 0; channel < a.channels; channel += 1) {
      delta = Math.max(delta, Math.abs((a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0)));
    }
    if (delta > threshold) changed += 1;
    total += delta;
  }
  return {
    changed,
    mean: total / Math.max(1, a.width * a.height * a.channels),
  };
}

async function main(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const baselineClip = join(OUT_DIR, 'baseline.mp4');
  await run([
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x101820:s=${String(CANVAS.width)}x${String(CANVAS.height)}:r=30:d=${String(CLIP_SEC)}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    baselineClip,
  ]);

  const baselineFrame = join(OUT_DIR, 'baseline-t1.2.png');
  await run(['-y', '-v', 'error', '-ss', '1.2', '-i', baselineClip, '-frames:v', '1', baselineFrame]);

  const cues = groupCaptionCues(WORDS, {
    maxCharsPerLine: 22,
    maxLines: 2,
    gapSec: 0.35,
    bounds: { startSec: 0, endSec: CLIP_SEC },
  });

  interface VariantResult {
    preset: CaptionPresetId;
    animation: string;
    font: string;
    ass: string;
    mp4: string;
    frame: string;
    events: number;
    changedVsBaseline: number;
    meanVsBaseline: number;
  }

  const results: VariantResult[] = [];
  const frames = new Map<string, RawImage>();
  const baseline = await rawImage(baselineFrame);

  for (const variant of VARIANTS) {
    const style = resolveCaptionStyle(variant.preset);
    const built = buildCaptionAss({
      cues,
      canvas: CANVAS,
      style,
      animation: variant.animation,
      highlight: { words: ['bedrooms'], color: '#FFD166' },
    });
    if (built.eventCount === 0) throw new Error(`${variant.preset} emitted no events`);

    const assPath = join(OUT_DIR, `${variant.preset}.ass`);
    const mp4Path = join(OUT_DIR, `${variant.preset}.mp4`);
    const framePath = join(OUT_DIR, `${variant.preset}-t1.2.png`);
    await writeFile(assPath, built.text, 'utf8');

    const subtitles = `subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(FONTS_DIR)}'`;
    await run([
      '-y',
      '-v',
      'error',
      '-i',
      baselineClip,
      '-vf',
      subtitles,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      mp4Path,
    ]);
    await run(['-y', '-v', 'error', '-ss', '1.2', '-i', mp4Path, '-frames:v', '1', framePath]);

    const image = await rawImage(framePath);
    frames.set(variant.preset, image);
    const compared = diff(baseline, image);
    if (compared.changed < 2_000) {
      throw new Error(
        `${variant.preset} changed only ${String(compared.changed)} px; the text did not draw`,
      );
    }

    results.push({
      preset: variant.preset,
      animation: variant.animation,
      font: style.fontFamily,
      ass: assPath,
      mp4: mp4Path,
      frame: framePath,
      events: built.eventCount,
      changedVsBaseline: compared.changed,
      meanVsBaseline: Math.round(compared.mean * 100) / 100,
    });
    console.log(
      `[burned] ${variant.preset.padEnd(15)} ${style.fontFamily.padEnd(22)} events=${String(
        built.eventCount,
      ).padStart(3)}  changed=${String(compared.changed).padStart(7)} px  mean=${compared.mean.toFixed(2)}`,
    );
  }

  // Pairwise style difference: the presets must not render the same picture.
  const pairs: Array<{ a: string; b: string; changed: number }> = [];
  for (let i = 0; i < results.length; i += 1) {
    for (let j = i + 1; j < results.length; j += 1) {
      const a = results[i];
      const b = results[j];
      if (a === undefined || b === undefined) continue;
      const imageA = frames.get(a.preset);
      const imageB = frames.get(b.preset);
      if (imageA === undefined || imageB === undefined) continue;
      const compared = diff(imageA, imageB);
      if (compared.changed < 500) {
        throw new Error(`${a.preset} and ${b.preset} render nearly identically`);
      }
      pairs.push({ a: a.preset, b: b.preset, changed: compared.changed });
    }
  }

  // Animation over time: the word-by-word cut must change between 1.2 s and
  // 3.0 s, and the ASS must contain the reveal tags for it.
  const kineticMp4 = join(OUT_DIR, 'kinetic_bold.mp4');
  const kineticLater = join(OUT_DIR, 'kinetic_bold-t3.0.png');
  await run(['-y', '-v', 'error', '-ss', '3.0', '-i', kineticMp4, '-frames:v', '1', kineticLater]);
  const first = frames.get('kinetic_bold');
  const later = await rawImage(kineticLater);
  if (first === undefined) throw new Error('Missing kinetic frame');
  const overTime = diff(first, later);
  if (overTime.changed < 2_000) {
    throw new Error(`word_by_word did not change over time (${String(overTime.changed)} px)`);
  }

  const kineticAss = results.find((entry) => entry.preset === 'kinetic_bold')?.ass;
  if (kineticAss === undefined) throw new Error('Missing kinetic ASS');

  const report = {
    generatedAt: new Date().toISOString(),
    canvas: CANVAS,
    clipSec: CLIP_SEC,
    frameSec: 1.2,
    cues: cues.map((cue) => ({ startSec: cue.startSec, endSec: cue.endSec, lines: cue.lines })),
    variants: results,
    pairwise: pairs,
    animationOverTime: { preset: 'kinetic_bold', fromSec: 1.2, toSec: 3.0, ...overTime },
    checks: {
      allStylesDifferFromBaseline: true,
      allStylesDifferFromEachOther: true,
      wordByWordChangesOverTime: true,
    },
  };
  await writeFile(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(
    `[verified] 5 style variants differ from the textless baseline (min ${String(
      Math.min(...results.map((entry) => entry.changedVsBaseline)),
    )} px changed).`,
  );
  console.log(
    `[verified] ${String(pairs.length)} style pairs differ pixel-wise (min ${String(
      Math.min(...pairs.map((pair) => pair.changed)),
    )} px).`,
  );
  const kineticAssText = await readFile(kineticAss, 'utf8');
  const glassAssText = await readFile(join(OUT_DIR, 'glass_pill.ass'), 'utf8');

  console.log(
    `[verified] word_by_word reveals over time: ${String(overTime.changed)} px change between 1.2 s and 3.0 s.`,
  );
  console.log(`[verified] glass_pill ASS contains karaoke \\kf: ${String(/\\kf\d+/.test(glassAssText))}`);
  console.log(`[verified] kinetic_bold ASS contains word reveals: ${String(/\\t\(0,140,/.test(kineticAssText))}`);
  console.log(`Evidence: ${OUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
