/**
 * QA harness for the export path.
 *
 * It builds a scratch store from the *real* Marina Gate footage and the
 * prototype EDL (30.00 s, dissolves), then exports it at the requested
 * profiles. Every file goes through the production `DesktopPipeline`:
 * path resolution → FFmpeg picture → Remotion or FFmpeg text → two-pass audio
 * master → review gate → SRT/cover sidecars.
 *
 *   npx tsx scripts/qa-landscape-export.ts
 *   npx tsx scripts/qa-landscape-export.ts --profiles vertical-social,landscape
 *   npx tsx scripts/qa-landscape-export.ts --remotion --timeout-ms 5000
 *
 * The script has its own 14.5-minute watchdog: a hang prints the last progress
 * events and exits non-zero instead of sitting until the shell times out.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { validateEdl } from '../packages/edl/src/index';
import type { Edl } from '../packages/edl/src/index';
import { ffmpegPath, probe } from '../packages/media/src/index';
import { PROFILES } from '../packages/render/src/index';
import type { ProfileId } from '../packages/render/src/index';
import { JsonStore } from '../packages/store/src/index';
import type { ListingRecord } from '../packages/store/src/index';
import { DesktopPipeline } from '../apps/desktop/pipeline';

const repoRoot = resolve('.');
const sourceListing = join(repoRoot, 'data', 'listings', 'marina-gate-1');
const sourceEdlPath = join(sourceListing, 'out', 'prototype-final.edl.json');

type CaptionMode = 'off' | 'burned' | 'srt' | 'both';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const flag = (name: string): boolean => process.argv.includes(name);
const root = resolve(argument('--data') ?? join(tmpdir(), 'zeniconic-qa-export'));
const quality = (argument('--quality') ?? 'standard') as 'draft' | 'standard' | 'high';
const captions = (argument('--captions') ?? 'both') as CaptionMode;
const voice = (argument('--voice') ?? 'restore') as 'restore' | 'ai' | 'music';
const profiles = (argument('--profiles') ?? 'vertical-social,landscape')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0) as ProfileId[];
const useRemotion = flag('--remotion');
const watchdogMs = Number(argument('--timeout-ms') ?? 14.5 * 60_000);

if (!useRemotion) process.env.ZENICONIC_REMOTION = 'off';

const progress: Array<{ stage: string; percent: number; detail?: string }> = [];
const startedAt = Date.now();

const watchdog = setTimeout(() => {
  const events = progress.slice(-8).map((event) => `${event.stage} ${String(event.percent)}% ${event.detail ?? ''}`);
  console.error(`[qa] TIMEOUT: no result after ${(watchdogMs / 1000).toFixed(1)} s.`);
  console.error(`[qa] last progress:\n${events.join('\n')}`);
  process.exit(1);
}, watchdogMs);

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const causes: string[] = [error.message];
  let current: unknown = (error as { cause?: unknown }).cause;
  while (current instanceof Error) {
    causes.push(`caused by: ${current.message}`);
    current = (current as { cause?: unknown }).cause;
  }
  return causes.join('\n');
}

async function ensureListing(store: JsonStore): Promise<ListingRecord> {
  const existing = (await store.list()).find(
    (record) => record.address === 'Marina Gate 1, Dubai Marina',
  );
  if (existing !== undefined) return existing;
  return store.create({
    address: 'Marina Gate 1, Dubai Marina',
    facts: {
      address: 'Marina Gate 1, Dubai Marina',
      // The store still rejects AED (audit B3); the EDL's price card carries
      // "AED 1,850,000" and the review matches on digits.
      currency: 'USD',
      price: '1,850,000',
      beds: 3,
      baths: 2,
    },
    now: '2026-11-16T12:00:00.000Z',
  });
}

async function stageMedia(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
  } catch {
    await copyFile(source, destination);
  }
}

/** Three legitimate path shapes plus one absolute, all on the same EDL. */
async function writeQaEdl(listing: ListingRecord, listingDir: string): Promise<Edl> {
  const raw = JSON.parse(await readFile(sourceEdlPath, 'utf8')) as Edl;

  await mkdir(join(listingDir, 'raw'), { recursive: true });
  for (const clip of raw.clips) {
    const source = resolve(repoRoot, clip.src);
    await stageMedia(source, join(listingDir, 'raw', basename(source)));
  }

  const target = raw.format.targetDurationSec;
  let total = 0;
  const clips = [] as Edl['clips'];

  for (const [index, clip] of raw.clips.entries()) {
    const source = resolve(repoRoot, clip.src);
    const name = basename(source);
    const src =
      index % 4 === 0
        ? name // relative to the listing raw/ directory (the schema contract)
        : index % 4 === 1
          ? `raw/${name}` // relative to the listing workspace
          : index % 4 === 2
            ? clip.src // relative to the repository
            : source; // absolute

    // Two prototype windows run a few frames past their source. Clamp them so
    // the picture is the full 30 s and the duration assertion measures the
    // pipeline rather than an over-long EDL.
    const available = (await probe(source)).durationSec;
    const outSec = Math.min(clip.outSec, Math.max(clip.inSec + 0.2, available - 0.02));
    total += (outSec - clip.inSec) / clip.speed;

    clips.push({
      ...clip,
      src,
      outSec,
      transitionIn:
        index === 0 ? { type: 'cut', durationSec: 0 } : { type: 'dissolve', durationSec: 0.35 },
      transitionOut:
        index === raw.clips.length - 1
          ? { type: 'cut', durationSec: 0 }
          : { type: 'dissolve', durationSec: 0.35 },
    });
  }

  if (total < target) {
    const last = clips[clips.length - 1];
    if (last === undefined) throw new Error('The QA EDL has no clips.');
    last.outSec = Math.round((last.outSec + target - total) * 1000) / 1000;
  }

  const edl: Edl = { ...raw, listingId: listing.id, clips };

  const check = validateEdl(edl);
  if (!check.valid) throw new Error(`QA EDL is invalid: ${check.issues[0]?.message ?? 'unknown issue'}`);
  return edl;
}

function extractFrame(file: string, at: number, path: string): boolean {
  const result = spawnSync(
    ffmpegPath(),
    ['-y', '-v', 'error', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-q:v', '2', path],
    { windowsHide: true, encoding: 'utf8', timeout: 60_000 },
  );
  return result.status === 0 && existsSync(path);
}

/** White-text fraction in a frame band; captions are paper white. */
async function whiteFraction(
  framePath: string,
  rect: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const { data } = await sharp(framePath).extract(rect).raw().toBuffer({ resolveWithObject: true });
  let white = 0;
  const pixels = data.length / 3;
  for (let index = 0; index + 2 < data.length; index += 3) {
    if ((data[index] ?? 0) > 228 && (data[index + 1] ?? 0) > 228 && (data[index + 2] ?? 0) > 220) {
      white += 1;
    }
  }
  return pixels === 0 ? 0 : white / pixels;
}

interface AudioReading {
  lufs: number | null;
  truePeak: number | null;
}

function measureAudio(file: string): AudioReading {
  const result = spawnSync(
    ffmpegPath(),
    ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { windowsHide: true, encoding: 'utf8', timeout: 120_000 },
  );
  const log = `${result.stderr ?? ''}`;
  const lufs = [...log.matchAll(/I:\s*(-?[0-9.]+)\s*LUFS/g)].at(-1)?.[1];
  const peak = [...log.matchAll(/Peak:\s*(-?[0-9.]+)\s*dBFS/g)].at(-1)?.[1];
  return {
    lufs: lufs === undefined ? null : Number(lufs),
    truePeak: peak === undefined ? null : Number(peak),
  };
}

async function main(): Promise<void> {
  await mkdir(root, { recursive: true });
  const store = new JsonStore(root);
  await store.init();
  const listing = await ensureListing(store);
  const listingDir = store.dirFor(listing.id);

  const edl = await writeQaEdl(listing, listingDir);

  const variantsDir = join(listingDir, 'variants');
  await mkdir(variantsDir, { recursive: true });
  await writeFile(join(variantsDir, 'calm.json'), `${JSON.stringify(edl, null, 2)}\n`, 'utf8');
  await writeFile(
    join(variantsDir, 'variants.json'),
    `${JSON.stringify(
      {
        version: 1,
        variants: [
          {
            id: 'calm',
            look: 'calm',
            format: edl.format.id,
            targetDurationSec: edl.format.targetDurationSec,
            clipCount: edl.clips.length,
            score: 80,
            // Relative to the listing workspace (H7).
            edlPath: 'variants/calm.json',
            approved: true,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await writeFile(
    join(listingDir, 'brand.json'),
    `${JSON.stringify(
      { agentName: 'Sara Whitfield', agency: 'Whitfield & Co', orn: '67890' },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const pipeline = new DesktopPipeline({
    store,
    dataDir: root,
    repoRoot,
    onProgress: (event) => {
      progress.push({
        stage: event.stage,
        percent: event.percent,
        ...(event.detail === undefined ? {} : { detail: event.detail }),
      });
    },
  });

  console.log(
    `[qa] export ${profiles.join(', ')} · ${quality} · captions ${captions} · voice ${voice} · remotion ${
      useRemotion ? 'on' : 'off'
    }`,
  );

  const result = await pipeline.exportListing({
    listing,
    profiles,
    quality,
    captions,
    voice,
  });

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const files = result.files;
  const videos = files.filter((file) => file.toLowerCase().endsWith('.mp4'));
  const halfEven = (value: number): number => {
    const half = Math.floor(value / 2);
    return half % 2 === 0 ? half : half - 1;
  };
  const expectedSize =
    quality === 'draft'
      ? (spec: { width: number; height: number }): { width: number; height: number } => ({
          width: halfEven(spec.width),
          height: halfEven(spec.height),
        })
      : (spec: { width: number; height: number }): { width: number; height: number } => spec;
  const report: Record<string, unknown> = {
    root,
    fileCount: files.length,
    files,
    elapsedSec,
    warnings: result.warnings ?? [],
    videos: [],
  };

  for (const video of videos) {
    const name = basename(video);
    const profile = profiles.find((candidate) => name.includes(`_${candidate}_`));
    if (profile === undefined) throw new Error(`Cannot tell which profile ${name} belongs to.`);
    const spec = PROFILES[profile];
    const info = await probe(video);
    const audio = measureAudio(video);

    const captionFrame = join(root, `qa_${profile}_captions.jpg`);
    const endFrame = join(root, `qa_${profile}_end.jpg`);
    const captionOk = extractFrame(video, 2, captionFrame);
    const endOk = extractFrame(video, Math.max(0, info.durationSec - 2), endFrame);

    const bandHeight = Math.round(info.height * 0.22);
    const white = captionOk
      ? await whiteFraction(captionFrame, {
          left: 0,
          top: Math.max(0, info.height - Math.round(info.height * 0.3)),
          width: info.width,
          height: Math.min(bandHeight, info.height),
        })
      : 0;

    const srt = video.replace(/\.mp4$/i, '.srt');
    const cover = video.replace(/\.mp4$/i, '_cover.jpg');
    const srtExists = files.includes(srt);
    const coverExists = files.includes(cover);
    const srtText = srtExists ? await readFile(srt, 'utf8') : '';
    const expectedCaptions = captions === 'srt' || captions === 'both';

    report.videos = [
      ...(report.videos as unknown[]),
      {
        profile,
        video,
        width: info.width,
        height: info.height,
        durationSec: info.durationSec,
        expectedDurationSec: edl.format.targetDurationSec,
        hasAudio: info.hasAudio,
        lufs: audio.lufs,
        truePeak: audio.truePeak,
        targetLufs: spec.lufs,
        captionFrame: captionOk ? captionFrame : null,
        endFrame: endOk ? endFrame : null,
        captionWhiteFraction: Number(white.toFixed(4)),
        srt: srtExists ? srt : null,
        srtBlocks: srtText.trim().length === 0 ? 0 : srtText.trim().split(/\n\s*\n/).length,
        cover: coverExists ? cover : null,
      },
    ];

    if (Math.abs(info.durationSec - edl.format.targetDurationSec) > 0.1) {
      throw new Error(
        `${profile}: ${info.durationSec.toFixed(3)} s is outside ±0.1 s of ${edl.format.targetDurationSec} s`,
      );
    }
    const expected = expectedSize(spec);
    if (info.width !== expected.width || info.height !== expected.height) {
      throw new Error(
        `${profile}: expected ${expected.width}×${expected.height}, received ${info.width}×${info.height}`,
      );
    }    if (!info.hasAudio) throw new Error(`${profile}: the export has no audio stream.`);
    if (audio.lufs === null || Math.abs(audio.lufs - spec.lufs) > 0.5) {
      throw new Error(`${profile}: ${String(audio.lufs)} LUFS is outside ±0.5 of ${spec.lufs}`);
    }
    if (audio.truePeak === null || audio.truePeak > -1.5) {
      throw new Error(`${profile}: true peak ${String(audio.truePeak)} dBTP is above -1.5`);
    }
    if (expectedCaptions && !srtExists) throw new Error(`${profile}: no .srt beside the MP4.`);
    if (expectedCaptions && srtText.trim().length === 0) {
      throw new Error(`${profile}: the .srt is empty.`);
    }
    if (!coverExists) throw new Error(`${profile}: no cover .jpg was written.`);
    if ((captions === 'burned' || captions === 'both') && white < 0.001) {
      throw new Error(
        `${profile}: no caption text in the sampled frame (white ${(white * 100).toFixed(3)}%).`,
      );
    }
  }

  clearTimeout(watchdog);
  console.log(JSON.stringify(report, null, 2));

  // The watchdog would otherwise wait out its remaining minutes.
  process.exit(0);
}

main().catch((error: unknown) => {
  clearTimeout(watchdog);
  console.error(`[qa] FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  console.error(describeError(error));
  const events = progress.slice(-8).map((event) => `${event.stage} ${String(event.percent)}% ${event.detail ?? ''}`);
  if (events.length > 0) console.error(`[qa] last progress:\n${events.join('\n')}`);
  process.exitCode = 1;
});
