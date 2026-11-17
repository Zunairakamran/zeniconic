/**
 * Segment cache integration: real FFmpeg, real files.
 *
 * Two proofs matter and neither can be faked:
 *
 *  1. `SegmentCache` round-trips a segment, invalidates it when the file is
 *     missing/truncated, and prunes only what is older than the window.
 *  2. Rendering the same EDL twice hits the cache the second time and produces
 *     the same duration, while the cached files' mtimes stay untouched. A
 *     changed clip re-encodes exactly that clip.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { Edl } from '../../../packages/edl/src/index';
import { probe } from '../../../packages/media/src/index';
import {
  DEFAULT_SEGMENT_MAX_AGE_DAYS,
  SegmentCache,
  renderPictureWithSegments,
  segmentKeyForClip,
} from '../segment-cache';

const CLIP_SEC = 0.96;
const CLIP_COUNT = 2;
const EDL_DURATION_SEC = CLIP_SEC * CLIP_COUNT;

function ffmpeg(args: string[]): void {
  if (typeof ffmpegStatic !== 'string' || ffmpegStatic.length === 0) {
    throw new Error('ffmpeg-static did not resolve; run "npm install".');
  }
  const result = spawnSync(ffmpegStatic, args, { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${String(result.status)}): ${result.stderr ?? ''}`);
  }
}

function makeClip(path: string, colour: string): void {
  ffmpeg([
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${colour}:s=160x284:r=30:d=1.2`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

/** A minimal cut-only document; the cache path never validates the schema. */
function buildEdl(sources: readonly string[]): Edl {
  return {
    edlVersion: '2.0.0',
    id: 'edl_segment-cache-fixture_v1',
    listingId: 'segment-cache-fixture',
    createdAt: '2026-11-17T10:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 5 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips: sources.slice(0, CLIP_COUNT).map((src, index) => ({
      id: `c0${String(index + 1)}`,
      sourceId: `s_0000000${String(index)}`,
      src,
      inSec: 0,
      outSec: CLIP_SEC,
      speed: 1,
      volumeDb: 0,
      room: index === 0 ? ('exterior' as const) : ('living' as const),
      transform: {
        mode: 'cover' as const,
        focus: 'center' as const,
        path: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }],
      },
      transitionIn: { type: 'cut' as const, durationSec: 0 },
      reason: `segment cache fixture ${String(index + 1)}`,
    })),
    overlays: [],
    audio: {
      music: { trackId: 'none', src: '', gainDb: 0, duckUnderVoiceDb: 0, beatGrid: [] },
      voice: { mode: 'mute' },
      mix: { lufs: -14 },
    },
    captions: { mode: 'none', language: 'en-GB', words: [] },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'test', planning: 'test' },
      promptVersions: { tagging: 'test', planning: 'test' },
      costUsd: 0,
    },
  };
}

async function segmentFiles(cacheDir: string): Promise<string[]> {
  return (await readdir(cacheDir).catch(() => []))
    .filter((name) => name.endsWith('.mp4'))
    .sort();
}

let root = '';
let cacheDir = '';
let workDir = '';
let sources: string[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zeniconic-segments-'));
  cacheDir = join(root, 'cache', 'segments');
  workDir = join(root, 'work');
  const a = join(root, 'living.mp4');
  const b = join(root, 'kitchen.mp4');
  makeClip(a, '0x335577');
  makeClip(b, '0x775533');
  sources = [a, b];
}, 60_000);

afterAll(async () => {
  if (root.length > 0) await rm(root, { recursive: true, force: true });
});

describe('SegmentCache', () => {
  it('stores, reads back and reports the manifest', async () => {
    const dir = join(root, 'unit-cache');
    const cache = new SegmentCache(dir);
    await mkdir(dir, { recursive: true });
    const key = 'seg2_unit-roundtrip';
    const temp = cache.tempPath(key);
    await writeFile(temp, Buffer.alloc(4096, 7));

    const stored = await cache.store(key, temp, {
      sourcePath: 'D:\\footage\\x.mp4',
      inSec: 1,
      outSec: 2.5,
      speed: 1,
      durationSec: 1.5,
      width: 1080,
      height: 1920,
      fps: 30,
      codec: 'h264',
    });

    expect(stored).toBe(cache.videoPath(key));
    expect(await cache.lookup(key)).toBe(stored);
    const manifest = await cache.manifest(key);
    expect(manifest?.key).toBe(key);
    expect(manifest?.version).toBe(2);
    expect(manifest?.sizeBytes).toBe(4096);
    expect(manifest?.durationSec).toBe(1.5);
    // No temp files survive a successful store.
    expect((await readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('invalidates a hit when the file is gone or truncated', async () => {
    const dir = join(root, 'unit-invalidate');
    const cache = new SegmentCache(dir);
    await mkdir(dir, { recursive: true });
    const key = 'seg2_unit-invalidate';
    const temp = cache.tempPath(key);
    await writeFile(temp, Buffer.alloc(2048, 3));
    await cache.store(key, temp, {
      sourcePath: 'D:\\footage\\x.mp4',
      inSec: 0,
      outSec: 1,
      speed: 1,
      durationSec: 1,
      width: 540,
      height: 960,
      fps: 30,
      codec: 'h264',
    });
    expect(await cache.lookup(key)).toBeDefined();

    // A truncated file is not a cache hit: the byte length no longer matches.
    await truncate(cache.videoPath(key), 10);
    expect(await cache.lookup(key)).toBeUndefined();

    await rm(cache.videoPath(key), { force: true });
    expect(await cache.lookup(key)).toBeUndefined();
  });

  it('prunes old segments and keeps fresh ones', async () => {
    const dir = join(root, 'unit-prune');
    const cache = new SegmentCache(dir);
    await mkdir(dir, { recursive: true });
    const meta = {
      sourcePath: 'D:\\footage\\x.mp4',
      inSec: 0,
      outSec: 1,
      speed: 1,
      durationSec: 1,
      width: 540,
      height: 960,
      fps: 30,
      codec: 'h264',
    } as const;

    const oldKey = 'seg2_unit-old';
    const newKey = 'seg2_unit-new';
    for (const key of [oldKey, newKey]) {
      const temp = cache.tempPath(key);
      await writeFile(temp, Buffer.alloc(1024, 1));
      await cache.store(key, temp, meta);
    }

    // Backdate the old manifest by one day past the default window.
    const oldManifest = JSON.parse(await readFile(cache.manifestPath(oldKey), 'utf8')) as {
      createdAt: number;
    };
    oldManifest.createdAt =
      Date.now() - (DEFAULT_SEGMENT_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000;
    await writeFile(cache.manifestPath(oldKey), `${JSON.stringify(oldManifest)}\n`, 'utf8');

    const report = await cache.prune();
    expect(report.removed).toBe(1);
    expect(report.kept).toBe(1);
    expect(await cache.lookup(oldKey)).toBeUndefined();
    expect(await cache.lookup(newKey)).toBeDefined();
    expect((await stat(cache.videoPath(oldKey)).catch(() => undefined))).toBeUndefined();
  });
});

describe('renderPictureWithSegments', () => {
  it('reuses unchanged segments on a second render', async () => {
    const edl = buildEdl(sources);
    const first = join(root, 'out', 'first.mp4');
    const second = join(root, 'out', 'second.mp4');

    const a = await renderPictureWithSegments({
      edl,
      profile: 'vertical-social',
      quality: 'draft',
      output: first,
      cacheDir,
      workDir: join(workDir, 'first'),
    });
    expect(a.segmented).toBe(true);
    expect(a.hits).toBe(0);
    expect(a.misses).toBe(CLIP_COUNT);

    const files = await segmentFiles(cacheDir);
    expect(files).toHaveLength(CLIP_COUNT);
    const mtimes = new Map<string, number>();
    for (const name of files) {
      mtimes.set(name, (await stat(join(cacheDir, name))).mtimeMs);
    }

    const b = await renderPictureWithSegments({
      edl: structuredClone(edl),
      profile: 'vertical-social',
      quality: 'draft',
      output: second,
      cacheDir,
      workDir: join(workDir, 'second'),
    });
    expect(b.segmented).toBe(true);
    expect(b.hits).toBe(CLIP_COUNT);
    expect(b.misses).toBe(0);
    expect(b.warnings).toEqual([]);

    // A hit did not touch the cached bytes.
    for (const [name, before] of mtimes) {
      expect((await stat(join(cacheDir, name))).mtimeMs).toBe(before);
    }

    const [firstInfo, secondInfo] = await Promise.all([probe(first), probe(second)]);
    expect(secondInfo.width).toBe(firstInfo.width);
    expect(secondInfo.height).toBe(firstInfo.height);
    expect(Math.abs(secondInfo.durationSec - firstInfo.durationSec)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(secondInfo.durationSec - EDL_DURATION_SEC)).toBeLessThanOrEqual(0.15);
  }, 120_000);

  it('re-encodes only the clip whose window changed', async () => {
    const edl = buildEdl(sources);
    // Same first clip, a shorter second clip.
    const changed = structuredClone(edl);
    const second = changed.clips[1];
    if (second === undefined) throw new Error('fixture has no second clip');
    second.outSec = CLIP_SEC - 0.2;

    const report = await renderPictureWithSegments({
      edl: changed,
      profile: 'vertical-social',
      quality: 'draft',
      output: join(root, 'out', 'changed.mp4'),
      cacheDir,
      workDir: join(workDir, 'changed'),
    });

    expect(report.hits).toBe(1);
    expect(report.misses).toBe(1);
    expect(report.segmented).toBe(true);
    expect(await segmentFiles(cacheDir)).toHaveLength(CLIP_COUNT + 1);
  }, 120_000);

  it('forces a cold encode but keeps the cache warm', async () => {
    const edl = buildEdl(sources);
    const before = await segmentFiles(cacheDir);

    const report = await renderPictureWithSegments({
      edl,
      profile: 'vertical-social',
      quality: 'draft',
      output: join(root, 'out', 'fresh.mp4'),
      cacheDir,
      workDir: join(workDir, 'fresh'),
      fresh: true,
    });

    expect(report.hits).toBe(0);
    expect(report.misses).toBe(CLIP_COUNT);
    // Same keys: the refresh replaced the files in place, it did not duplicate.
    expect(await segmentFiles(cacheDir)).toEqual(before);
  }, 120_000);

  it('keys honest enough to notice a source file changed underneath', async () => {
    const source = join(root, 'mutating.mp4');
    makeClip(source, '0x112233');
    const edl = buildEdl([source, sources[1] ?? source]);
    const first = edl.clips[0];
    if (first === undefined) throw new Error('fixture has no first clip');

    const before = await segmentKeyForClip({
      clip: first,
      profile: 'vertical-social',
      quality: 'draft',
    });

    // Rewrite the source with different pixels; size and/or mtime must move.
    makeClip(source, '0x445566');
    const after = await segmentKeyForClip({
      clip: first,
      profile: 'vertical-social',
      quality: 'draft',
    });

    expect(after.key).not.toBe(before.key);
  }, 60_000);
});
