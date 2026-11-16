/**
 * Proves the packaged FFmpeg overlay graph on the real listing.
 *
 * It burns the prototype EDL's captions and cards onto the real 1080p picture
 * with `services/pipeline/ffmpeg-overlays.ts`, then diffs sampled frames
 * against a textless encode of the same picture. Text that never drew leaves
 * the frame identical; captions and cards change the pixels they occupy.
 *
 *   npx tsx scripts/qa-ffmpeg-overlays.ts
 *
 * Writes `<tmp>/zeniconic-qa-overlays/` with the two MP4s and four frames.
 */

import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { validateEdl } from '../packages/edl/src/index';
import type { Edl } from '../packages/edl/src/index';
import { ffmpegPath, probe } from '../packages/media/src/index';
import { PROFILES } from '../packages/render/src/index';
import { renderEdl } from '../services/pipeline/service';
import {
  buildAssDocument,
  captionCuesForExport,
  renderFfmpegOverlays,
  resolveFontsDirectory,
} from '../services/pipeline/ffmpeg-overlays';

const repoRoot = resolve('.');
const edlPath = join(repoRoot, 'data', 'listings', 'marina-gate-1', 'out', 'prototype-final.edl.json');
const outDir =
  process.argv[2] === '--out' && process.argv[3] !== undefined
    ? resolve(process.argv[3])
    : join(tmpdir(), 'zeniconic-qa-overlays');

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    execFile(bin, args, { windowsHide: true, timeout: 300_000 }, (error) => {
      if (error) fail(new Error(error.message));
      else done();
    });
  });
}

async function frame(video: string, at: number, path: string): Promise<void> {
  await run(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-ss',
    at.toFixed(3),
    '-i',
    video,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    path,
  ]);
  // ffmpeg exits 0 when a seek lands past the last frame and writes nothing.
  if (!existsSync(path)) {
    throw new Error(`No frame at ${at.toFixed(2)} s in ${video}; the file may be shorter than the EDL.`);
  }
}

interface Changed {
  fraction: number;
  maxDelta: number;
}

/** Fraction of pixels in a rectangle whose RGB changed by more than 32. */
async function changedFraction(
  leftPath: string,
  rightPath: string,
  rect: { left: number; top: number; width: number; height: number },
): Promise<Changed> {
  const options = { ...rect };
  const [left, right] = await Promise.all([
    sharp(leftPath).extract(options).raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).extract(options).raw().toBuffer({ resolveWithObject: true }),
  ]);

  const a = left.data;
  const b = right.data;
  const pixels = Math.min(a.length, b.length) / 3;
  let changed = 0;
  let maxDelta = 0;

  for (let index = 0; index + 2 < Math.min(a.length, b.length); index += 3) {
    const delta = Math.max(
      Math.abs((a[index] ?? 0) - (b[index] ?? 0)),
      Math.abs((a[index + 1] ?? 0) - (b[index + 1] ?? 0)),
      Math.abs((a[index + 2] ?? 0) - (b[index + 2] ?? 0)),
    );
    maxDelta = Math.max(maxDelta, delta);
    if (delta > 32) changed += 1;
  }

  return { fraction: pixels === 0 ? 0 : changed / pixels, maxDelta };
}

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const raw = JSON.parse(await readFile(edlPath, 'utf8')) as Edl;
  const target = raw.format.targetDurationSec;
  const clips = [] as Edl['clips'];
  let total = 0;

  for (const clip of raw.clips) {
    const src = resolve(repoRoot, clip.src);
    // The prototype EDL asks for a few frames more than two sources carry.
    // A real plan is clamped to the shot; QA does the same so the picture is
    // the full 30 s and the duration assertion tests the pipeline, not the EDL.
    const available = (await probe(src)).durationSec;
    const outSec = Math.min(clip.outSec, Math.max(clip.inSec + 0.2, available - 0.02));
    clips.push({
      ...clip,
      src,
      outSec,
      transitionIn: { type: 'cut', durationSec: 0 },
      transitionOut: { type: 'cut', durationSec: 0 },
    });
    total += (outSec - clip.inSec) / clip.speed;
  }

  if (total < target) {
    const last = clips[clips.length - 1];
    if (last === undefined) throw new Error('The QA EDL has no clips.');
    last.outSec = Math.round((last.outSec + target - total) * 1000) / 1000;
  }

  const edl: Edl = { ...raw, clips };
  const check = validateEdl(edl);
  if (!check.valid) throw new Error(`QA EDL is invalid: ${check.issues[0]?.message ?? 'unknown'}`);

  const profile = 'vertical-social' as const;
  const spec = PROFILES[profile];
  const safeArea = { top: 250, bottom: 340, left: 60, right: 120 };

  // A real, textless 1080p picture from the listing. The old test reused a
  // Remotion output that already had text, which double-drew every layer.
  const picture = join(outDir, 'picture-1080.mp4');
  await renderEdl(edl, profile, 'standard', picture);

  const info = await probe(picture);
  if (info.width !== 1080 || info.height !== 1920) {
    throw new Error(`Expected the 1080×1920 picture, received ${info.width}×${info.height}`);
  }

  const cues = captionCuesForExport(edl);
  if (cues.length === 0) throw new Error('The real EDL has no caption cues to burn.');
  const assDocument = buildAssDocument(edl, cues, profile);
  const assPath = join(outDir, 'check.ass');
  await writeFile(assPath, assDocument, 'utf8');

  const fontsDir = resolveFontsDirectory(repoRoot);
  const fontFiles = await readdir(fontsDir);

  const overlay = join(outDir, 'overlay-1080.mp4');
  const burned = await renderFfmpegOverlays({
    edl,
    profile,
    quality: 'standard',
    picture,
    output: overlay,
    workDir: join(outDir, 'work'),
    burnCaptions: true,
    facts: {
      address: 'Marina Gate 1, Dubai Marina',
      price: '1,850,000',
      currency: 'AED',
      beds: 3,
      baths: 2,
    },
    brand: { agentName: 'Sara Whitfield', agency: 'Whitfield & Co', orn: '67890' },
    fontsDir,
  });

  // The textless picture is the control: any difference in the bands below is
  // text, not compression.
  const baseline = picture;

  const captionRect = {
    left: 0,
    top: info.height - safeArea.bottom - 260,
    width: info.width,
    height: 260,
  };
  const topRect = { left: 0, top: safeArea.top - 20, width: info.width, height: 160 };
  const endRect = {
    left: 0,
    top: info.height - safeArea.bottom - 420,
    width: info.width,
    height: 420,
  };

  const frames: Record<string, { overlay: string; baseline: string }> = {};
  for (const at of [2, 28] as const) {
    const overlayFrame = join(outDir, `overlay-${String(at)}s.jpg`);
    const baselineFrame = join(outDir, `baseline-${String(at)}s.jpg`);
    await frame(overlay, at, overlayFrame);
    await frame(baseline, at, baselineFrame);
    frames[String(at)] = { overlay: overlayFrame, baseline: baselineFrame };
  }

  const twoSeconds = frames['2']!;
  const endCard = frames['28']!;
  const captions = await changedFraction(twoSeconds.baseline, twoSeconds.overlay, captionRect);
  const address = await changedFraction(twoSeconds.baseline, twoSeconds.overlay, topRect);
  const endText = await changedFraction(endCard.baseline, endCard.overlay, endRect);

  const report = {
    outDir,
    picture,
    pictureSpec: `${String(info.width)}×${String(info.height)}`,
    overlay,
    overlayDurationSec: (await probe(overlay)).durationSec,
    targetDurationSec: edl.format.targetDurationSec,
    profile,
    target: { lufs: spec.lufs, truePeak: spec.truePeak },
    cueCount: burned.cueCount,
    textLayers: burned.textLayers,
    assPath,
    assDialogueLines: (assDocument.match(/^Dialogue:/gm) ?? []).length,
    assFont: /Style: ZenCaption,([^,]+)/.exec(assDocument)?.[1] ?? null,
    assFontSize: /Style: ZenCaption,[^,]+,(\d+)/.exec(assDocument)?.[1] ?? null,
    fontsDir,
    fontFiles,
    captionBand: captions,
    topBand: address,
    endCardBand: endText,
    frames: {
      captionFrame: twoSeconds.overlay,
      captionBaseline: twoSeconds.baseline,
      endFrame: endCard.overlay,
      endBaseline: endCard.baseline,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  // Captions occupy the bottom band at 2 s; the address occupies the top; the
  // price card occupies the end-card band at 28 s.
  if (captions.fraction < 0.002) {
    throw new Error(`Captions are not visible: only ${(captions.fraction * 100).toFixed(3)}% of the band changed.`);
  }
  if (address.fraction < 0.0005) {
    throw new Error(`The address is not visible: only ${(address.fraction * 100).toFixed(3)}% of the top band changed.`);
  }
  if (endText.fraction < 0.002) {
    throw new Error(`The end card is not visible: only ${(endText.fraction * 100).toFixed(3)}% of the band changed.`);
  }
  if (!fontFiles.includes('Archivo.ttf') || !fontFiles.includes('BricolageGrotesque.ttf')) {
    throw new Error(`Font assets are missing from ${fontsDir}`);
  }
  if (report.assFont !== 'Bricolage Grotesque' || report.assFontSize !== '76') {
    throw new Error(`ASS style is ${String(report.assFont)} ${String(report.assFontSize)} px, expected Bricolage Grotesque 76.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
