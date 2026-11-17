// Shared indexing pipeline: clips → probe → decode → metrics → shots.
// Extracted so the CLI, the pipeline service and the app run exactly the same
// code. Moved here from `scripts/lib/indexer.ts` at the L6 integration step.

import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { probe, readFrames } from '../../packages/media/src/index';
import { analyseFrames, segmentShots } from '../../packages/analysis/src/index';
import type { ShotTags } from '../../packages/tagging/src/index';

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm']);

export interface IndexedShot {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  representativeFrames: number[];
  metrics: {
    blur: number;
    shake: number;
    exposureClipLow: number;
    exposureClipHigh: number;
    motionEnergy: number;
  };
  /**
   * Vision tags from `services/tagging`. Absent until the folder has been
   * tagged, and absent on a shot whose tagging failed: the planner falls back
   * to the filename heuristic for those.
   */
  tags?: ShotTags;
}

export interface IndexedClip {
  id: string;
  file: string;
  name: string;
  sha256: string;
  probe: Awaited<ReturnType<typeof probe>>;
  frameSize: { width: number; height: number };
  decodedFrames: number;
  shots: IndexedShot[];
}

/** One source file as it was when the index was built. */
export interface IndexSourceFile {
  /** File name inside the folder (not a path). */
  name: string;
  sizeBytes: number;
  /** Whole milliseconds: a float mtime is not stable across filesystems. */
  mtimeMs: number;
}

/**
 * Proof that an index describes one specific folder state.
 *
 * The folder path plus a snapshot of every video's size and modification time
 * is cheap to take (no decoding) and enough to answer one question honestly:
 * "is this index still the index of this folder?" Without a signature an index
 * can be persisted but never reused for a *different* run.
 */
export interface IndexSourceSignature {
  /** Absolute folder path, forward slashes, as the indexer sees it. */
  folder: string;
  /** SHA-256 over `{ folder, files }`; equal fingerprints mean equal snapshots. */
  fingerprint: string;
  /** Sorted by name; the snapshot the fingerprint covers. */
  files: IndexSourceFile[];
}

export interface FootageIndex {
  version: 1;
  generatedAt: string;
  frameSampling: {
    fps: number;
    mode: 'per-orientation';
    portrait: { width: number; height: number };
    landscape: { width: number; height: number };
  };
  clips: IndexedClip[];
  /**
   * Present on an index written by the desktop pipeline. A hand-written or
   * legacy index without one is still readable; it just can never be reused.
   */
  sourceSignature?: IndexSourceSignature;
}

export interface IndexOptions {
  frameWidth?: number;
  frameHeight?: number;
  fps?: number;
  maxFramesPerClip?: number;
  onClip?: (name: string, shots: number, frames: number, ms: number) => void;
}

export function collectVideos(inputs: string[]): string[] {
  const files: string[] = [];
  for (const input of inputs) {
    const stat = statSync(input);
    if (stat.isDirectory()) {
      for (const name of readdirSync(input)) {
        const full = join(input, name);
        if (VIDEO_EXTENSIONS.has(extname(name).toLowerCase()) && statSync(full).isFile()) files.push(full);
      }
    } else if (VIDEO_EXTENSIONS.has(extname(input).toLowerCase())) {
      files.push(input);
    }
  }
  return files;
}

const avg = (nums: number[]): number => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * SHA-256 of a file in constant memory.
 *
 * `readFileSync` holds the whole clip in one buffer: a 4K master can exceed
 * Node's buffer limit (and blocks the event loop while it reads). Streaming
 * hashes the same bytes when they arrive, so the digest is identical and a
 * multi-gigabyte file costs one chunk of memory.
 */
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function indexFiles(files: string[], options: IndexOptions = {}): Promise<FootageIndex> {
  const fps = options.fps ?? 10;
  const limit = options.maxFramesPerClip ?? 6000;
  // Analysis runs at the source's orientation: portrait 9:16 is decoded as
  // 90x160, not letterboxed into 160x90. Black bars would dilute blur, shake
  // and exposure, which are all measured per pixel.
  const forced = options.frameWidth && options.frameHeight
    ? { width: options.frameWidth, height: options.frameHeight }
    : null;
  const PORTRAIT = { width: 90, height: 160 };
  const LANDSCAPE = { width: 160, height: 90 };

  const clips: IndexedClip[] = [];
  for (const file of files) {
    const started = Date.now();
    const sha256 = await hashFile(file);
    const id = `s_${sha256.slice(0, 8)}`;

    const info = await probe(file);
    const size = forced ?? (info.orientation === 'portrait' ? PORTRAIT : LANDSCAPE);
    const width = size.width;
    const height = size.height;
    const frames = [];
    for await (const frame of readFrames(file, { width, height, fps })) {
      frames.push(frame);
      if (frames.length >= limit) break;
    }

    const metrics = analyseFrames(frames);
    const shots = segmentShots(metrics);

    clips.push({
      id,
      file: file.replace(/\\/g, '/'),
      name: basename(file),
      sha256,
      probe: info,
      frameSize: { width, height },
      decodedFrames: frames.length,
      shots: shots.map((shot) => {
        const inside = metrics.slice(shot.startIndex, shot.endIndex + 1);
        return {
          id: `${id}_${shot.id}`,
          startSec: shot.startSec,
          endSec: shot.endSec,
          durationSec: r3(shot.endSec - shot.startSec),
          representativeFrames: shot.representativeFrames,
          metrics: {
            blur: r3(avg(inside.map((m) => m.blur))),
            shake: r3(avg(inside.map((m) => m.shake))),
            exposureClipLow: r3(avg(inside.map((m) => m.exposureClipLow))),
            exposureClipHigh: r3(avg(inside.map((m) => m.exposureClipHigh))),
            motionEnergy: r3(avg(inside.map((m) => m.motionEnergy))),
          },
        };
      }),
    });

    options.onClip?.(basename(file), shots.length, frames.length, Date.now() - started);
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    frameSampling: { fps, mode: 'per-orientation', portrait: PORTRAIT, landscape: LANDSCAPE },
    clips,
  };
}
