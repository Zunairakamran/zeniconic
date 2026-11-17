/**
 * Persistent per-clip segment cache for the picture pass.
 *
 * A re-render after a chat edit usually changes one or two clips. The timeline
 * is cut-only at this point (the visible crossfades belong to Remotion), so
 * each clip can be normalised — trimmed, speed-changed, framed, graded,
 * effects-lowered, scaled, fps-locked — into its own MP4, and the picture is a
 * lossless concat of those segments. Unchanged clips reuse their MP4; changed
 * clips are encoded again.
 *
 * What is cached: one normalised segment per (source bytes, window, speed,
 * picture chain, canvas, quality). Keys live in `packages/render/src/cache.ts`
 * (`segmentCacheKeyFor`) so a test can prove exactly which edit invalidates
 * what. Nothing here guesses: a key is only reused when the source file's
 * path, size and mtime still match.
 *
 * When the segment path cannot be used — a timeline-wide grade or effect (its
 * `enable` windows are timeline seconds, not clip seconds), or a concat the
 * muxer rejects — the caller gets the ordinary single-pass render instead and
 * a warning, never a broken file.
 *
 * Layout under `<dataDir>/cache/segments`:
 *
 *   <key>.mp4     the normalised clip, yuv420p / profile canvas / profile fps
 *   <key>.json    manifest: key, createdAt, size, probe, source window
 *   <key>.<pid>-<n>.tmp.mp4   encode in progress; renamed onto <key>.mp4
 *
 * Writes are atomic (temp file in the same directory, then `rename`). A read
 * cheaply verifies the manifest and the byte length; the file is probed once
 * when it is written, never on every hit.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Clip, Edl } from '../../packages/edl/src/index';
import { ffmpegPath, probe } from '../../packages/media/src/index';
import {
  buildGraphForRender,
  buildSegmentArgs,
  PROFILES,
  renderProfileFor,
  segmentCacheKeyFor,
  SEGMENT_KEY_VERSION,
} from '../../packages/render/src/index';
import type { ProfileId, Quality } from '../../packages/render/src/index';
import { PipelineError, renderEdl } from './service';

/** Segments older than this are pruned opportunistically. */
export const DEFAULT_SEGMENT_MAX_AGE_DAYS = 14;
/** A temp file left behind by a crashed encode is safe to delete after a day. */
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Both the segment encode and the concat are bounded, never open-ended. */
const SEGMENT_TIMEOUT_MS = 5 * 60_000;

export interface SegmentManifest {
  key: string;
  /** Key schema version, so a bump reads as a miss rather than a wrong hit. */
  version: number;
  createdAt: number;
  sourcePath: string;
  inSec: number;
  outSec: number;
  speed: number;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

export interface SegmentCachePruneReport {
  removed: number;
  /** Segments kept because they are still inside the age window. */
  kept: number;
}

function tempSuffix(): string {
  return `${String(process.pid)}-${createHash('sha1')
    .update(String(Date.now()))
    .update(String(Math.random()))
    .digest('hex')
    .slice(0, 8)}`;
}

/**
 * The on-disk cache. Deliberately small and synchronous-free: the render path
 * awaits `lookup` and `store`, tests drive `prune` directly.
 */
export class SegmentCache {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  videoPath(key: string): string {
    return join(this.dir, `${key}.mp4`);
  }

  manifestPath(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  /** A sibling temp path: `rename` needs the same directory, and same volume. */
  tempPath(key: string): string {
    return join(this.dir, `${key}.${tempSuffix()}.tmp.mp4`);
  }

  /**
   * Returns the cached MP4 when the manifest and a non-empty file agree.
   * No probe: the segment was probed once when written.
   */
  async lookup(key: string): Promise<string | undefined> {
    let manifest: SegmentManifest;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.manifestPath(key), 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      manifest = parsed as SegmentManifest;
    } catch {
      return undefined;
    }

    if (manifest.key !== key || manifest.version !== SEGMENT_KEY_VERSION) return undefined;
    if (!Number.isFinite(manifest.sizeBytes) || manifest.sizeBytes <= 0) return undefined;

    const file = this.videoPath(key);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size !== manifest.sizeBytes || info.size <= 0) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return file;
  }

  /** The manifest for a key, for tests and diagnostics. Never throws. */
  async manifest(key: string): Promise<SegmentManifest | undefined> {
    try {
      return JSON.parse(await readFile(this.manifestPath(key), 'utf8')) as SegmentManifest;
    } catch {
      return undefined;
    }
  }

  /**
   * Moves a finished encode into place and writes its manifest. The video is
   * renamed first: a manifest is only ever visible next to complete bytes.
   */
  async store(
    key: string,
    tempFile: string,
    meta: Omit<SegmentManifest, 'key' | 'version' | 'createdAt' | 'sizeBytes'>,
  ): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const video = this.videoPath(key);

    const sizeBytes = (await stat(tempFile)).size;
    if (sizeBytes <= 0) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw new Error(`The encoded segment for ${key} is empty.`);
    }

    await rename(tempFile, video);
    const manifest: SegmentManifest = {
      ...meta,
      key,
      version: SEGMENT_KEY_VERSION,
      createdAt: Date.now(),
      sizeBytes,
    };
    const manifestTemp = `${this.manifestPath(key)}.${tempSuffix()}.tmp`;
    await writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(manifestTemp, this.manifestPath(key));
    return video;
  }

  /**
   * Deletes segments older than `maxAgeDays` (default 14), plus crashed
   * encodes. Fresh segments — anything whose manifest is inside the window —
   * are never touched. Best-effort: a locked file is skipped, not fatal.
   */
  async prune(options: {
    maxAgeDays?: number;
    now?: number;
  } = {}): Promise<SegmentCachePruneReport> {
    const maxAgeDays = options.maxAgeDays ?? DEFAULT_SEGMENT_MAX_AGE_DAYS;
    const now = options.now ?? Date.now();
    const cutoff = now - Math.max(0, maxAgeDays) * DAY_MS;

    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return { removed: 0, kept: 0 };
    }

    let removed = 0;
    let kept = 0;

    for (const name of names) {
      const file = join(this.dir, name);

      if (name.endsWith('.tmp.mp4') || name.endsWith('.tmp')) {
        try {
          const info = await stat(file);
          if (now - info.mtimeMs > TEMP_MAX_AGE_MS) {
            await rm(file, { force: true });
            removed += 1;
          }
        } catch {
          // A file that vanished between readdir and stat is already gone.
        }
        continue;
      }

      if (!name.endsWith('.json')) continue;
      const key = name.slice(0, -'.json'.length);

      let createdAt: number;
      try {
        const manifest = JSON.parse(await readFile(file, 'utf8')) as SegmentManifest;
        createdAt = Number.isFinite(manifest.createdAt)
          ? manifest.createdAt
          : (await stat(file)).mtimeMs;
        if (createdAt >= cutoff) {
          kept += 1;
          continue;
        }
      } catch {
        // An unreadable manifest cannot justify keeping the bytes.
        try {
          createdAt = (await stat(file)).mtimeMs;
        } catch {
          continue;
        }
        if (createdAt >= cutoff) {
          kept += 1;
          continue;
        }
      }

      await rm(this.videoPath(key), { force: true }).catch(() => undefined);
      await rm(file, { force: true }).catch(() => undefined);
      removed += 1;
    }

    return { removed, kept };
  }
}

// ---------------------------------------------------------------------------
// Segment rendering
// ---------------------------------------------------------------------------

interface FfmpegRun {
  code: number;
  stderr: string[];
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<FfmpegRun> {
  return new Promise<FfmpegRun>((resolvePromise, reject) => {
    const child = spawn(ffmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const lines: string[] = [];
    let partial = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).on('error', () => child.kill());
      } else {
        child.kill('SIGKILL');
      }
    }, Math.max(1, timeoutMs));

    child.stderr.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim().length > 0) lines.push(line);
      }
      if (lines.length > 200) lines.splice(0, lines.length - 200);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (partial.trim().length > 0) lines.push(partial.trim());
      if (timedOut) {
        lines.push(`ffmpeg was stopped after ${String(Math.round(timeoutMs / 1000))} s.`);
      }
      resolvePromise({ code: timedOut ? -2 : (code ?? -1), stderr: lines.slice(-20) });
    });
  });
}

/**
 * A timeline-wide grade or effect is applied after assembly, in timeline
 * seconds. Its windows cannot be baked into a clip segment without moving
 * them, so such a document keeps the single-pass render.
 */
export function hasGlobalPictureEffects(edl: Edl): boolean {
  const effects = (edl.effects ?? []).filter((effect) => effect.enabled !== false);
  return effects.length > 0 || edl.grade !== undefined;
}

/** The key for one clip, from the real source bytes on disk. */
export async function segmentKeyForClip(input: {
  clip: Clip;
  profile: ProfileId;
  quality: Quality;
}): Promise<{ key: string; size: number; mtimeMs: number }> {
  const info = await stat(input.clip.src);
  if (!info.isFile()) {
    throw new Error(`Clip ${input.clip.id} source is not a file: ${input.clip.src}`);
  }
  const spec = PROFILES[input.profile];
  const target = renderProfileFor(spec, input.quality);
  const key = segmentCacheKeyFor({
    sourcePath: resolve(input.clip.src),
    sourceSize: info.size,
    sourceMtimeMs: info.mtimeMs,
    clip: input.clip,
    profile: input.profile,
    width: target.width,
    height: target.height,
    fps: target.fps,
    quality: input.quality,
  });
  return { key, size: info.size, mtimeMs: info.mtimeMs };
}

/** Escape a path for the ffconcat `file '…'` directive. */
function concatEntry(path: string): string {
  return `file '${path.replace(/\\/g, '/').replace(/'/g, "\\'")}'`;
}

export interface SegmentPictureReport {
  output: string;
  /** Clips served from the cache. */
  hits: number;
  /** Clips encoded in this pass. */
  misses: number;
  /** True when the segment path produced the picture. */
  segmented: boolean;
  warnings: string[];
}

/**
 * Renders the cut-only picture for one profile through the segment cache.
 *
 * A hit is a cached MP4 that passes `lookup`; a miss is encoded, probed once
 * and stored. `fresh` forces a cold encode while still refreshing the cache,
 * so a suspected bad segment can be replaced without deleting the directory.
 *
 * Falls back to `renderEdl` (one FFmpeg pass over the sources) when the
 * document has timeline-wide picture effects or when the concat fails; the
 * export then behaves exactly as it did before this cache existed.
 */
export async function renderPictureWithSegments(options: {
  edl: Edl;
  profile: ProfileId;
  quality: Quality;
  output: string;
  cacheDir: string;
  workDir: string;
  timeoutMs?: number;
  fresh?: boolean;
}): Promise<SegmentPictureReport> {
  const timeoutMs = options.timeoutMs ?? SEGMENT_TIMEOUT_MS;

  if (options.edl.clips.length === 0) {
    throw new PipelineError('E_ARGUMENT', 'An EDL needs at least one clip to render.');
  }

  if (hasGlobalPictureEffects(options.edl)) {
    await renderEdl(options.edl, options.profile, options.quality, options.output, {
      timeoutMs,
    });
    return {
      output: options.output,
      hits: 0,
      misses: 0,
      segmented: false,
      warnings: [
        'The timeline has a document-wide grade or effect, so the picture was rendered in one pass; clip segments were not reused.',
      ],
    };
  }

  const spec = PROFILES[options.profile];
  if (spec === undefined) {
    throw new PipelineError('E_ARGUMENT', `Unknown render profile "${options.profile}".`);
  }
  const target = renderProfileFor(spec, options.quality);
  const cache = new SegmentCache(options.cacheDir);
  await mkdir(cache.dir, { recursive: true });
  await mkdir(options.workDir, { recursive: true });
  await mkdir(dirname(options.output), { recursive: true });

  const warnings: string[] = [];
  const segmentFiles: string[] = [];
  let hits = 0;
  let misses = 0;

  for (const clip of options.edl.clips) {
    const { key } = await segmentKeyForClip({
      clip,
      profile: options.profile,
      quality: options.quality,
    });

    const cached = options.fresh === true ? undefined : await cache.lookup(key);
    if (cached !== undefined) {
      hits += 1;
      segmentFiles.push(cached);
      continue;
    }

    // One clip, one graph: exactly the chain the single-pass render would have
    // built for this clip, ending in [outv] through a one-input concat.
    const { graph, durationSec } = buildGraphForRender(
      { ...options.edl, clips: [clip] },
      target,
    );
    if (!(durationSec > 0)) {
      throw new Error(`Clip ${clip.id} produces no picture (${String(durationSec)} s).`);
    }

    const temp = cache.tempPath(key);
    const args = buildSegmentArgs({
      source: clip.src,
      graph,
      durationSec,
      output: temp,
      profile: spec,
      quality: options.quality,
    });

    try {
      const run = await runFfmpeg(args, timeoutMs);
      if (run.code !== 0) {
        throw new Error(
          `segment encode failed for clip ${clip.id}: ${
            run.stderr[run.stderr.length - 1] ?? `ffmpeg exited ${String(run.code)}`
          }`,
        );
      }

      const info = await probe(temp);
      await cache.store(key, temp, {
        sourcePath: resolve(clip.src),
        inSec: clip.inSec,
        outSec: clip.outSec,
        speed: clip.speed,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        codec: info.codec,
      });
      // Prove the bytes are still there as stored; a failed store is a render
      // failure, not a silent fallback to a temp path the caller will delete.
      const stored = await cache.lookup(key);
      if (stored === undefined) {
        throw new Error(`The segment for clip ${clip.id} was written but cannot be read back.`);
      }
      misses += 1;
      segmentFiles.push(stored);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  const listFile = join(options.workDir, 'segments.ffconcat');
  const body = ['ffconcat version 1.0', ...segmentFiles.map(concatEntry)].join('\n');
  await writeFile(listFile, `${body}\n`, 'utf8');

  const concat = await runFfmpeg(
    [
      '-y',
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      options.output,
    ],
    timeoutMs,
  );

  if (concat.code !== 0) {
    warnings.push(
      `The cached segments could not be joined (${concat.stderr[concat.stderr.length - 1] ?? `exit ${String(concat.code)}`}); the picture was rendered in one pass.`,
    );
    await renderEdl(options.edl, options.profile, options.quality, options.output, {
      timeoutMs,
    });
    return { output: options.output, hits, misses, segmented: false, warnings };
  }

  return { output: options.output, hits, misses, segmented: true, warnings };
}

/** Convenience wrapper for callers that only want the opportunistic prune. */
export async function pruneSegments(
  cacheDir: string,
  options: { maxAgeDays?: number; now?: number } = {},
): Promise<SegmentCachePruneReport> {
  return new SegmentCache(cacheDir).prune(options);
}
