// Persistence seam for the footage index.
//
// The analysis stage builds a `FootageIndex` in memory. Until this module the
// desktop pipeline kept it in a `Map` and never wrote it, so after a restart the
// renderer, the chat refine path and the agent had no shots to talk about: they
// re-read a file that did not exist. This module is the only writer and the only
// reader for that file; it knows nothing about tagging, planning or rendering.
//
// File shape (`<listing>/footage_index.json`, or the tagged twin):
//
//   {
//     "version": 1,
//     "savedAt": "2026-11-17T10:00:00.000Z",  // when this copy was written
//     "generatedAt": "2026-11-17T09:58:12.000Z", // when analysis ran
//     "frameSampling": { ... },                // from `indexFiles`
//     "sourceSignature": { folder, fingerprint, files }, // the folder it describes
//     "clips": [ { id, file, name, sha256, probe, frameSize, decodedFrames, shots } ]
//   }
//
// `version` and `savedAt` sit at the top level next to the `FootageIndex`
// fields; `clips` is stored as analysed, including `shot.tags` when the folder
// has been tagged. A reader that only needs shots can ignore everything else.
//
// `sourceSignature` is the resume contract: the absolute folder plus a hash of
// every video's name, size and mtime. A later run compares its own snapshot of
// the folder against it and reuses the index only on an exact match, so a
// resumed plan stage never re-probes footage that has not changed — and never
// reuses an index of footage that has.
//
// Writes are atomic: a temporary sibling is written, fsynced and renamed over
// the target, so a crash mid-write leaves the previous index intact rather than
// a half-written file that the planner would refuse. Reads are tolerant by
// design: a corrupt or half-written file is `undefined`, and a malformed clip or
// shot inside an otherwise good file is dropped instead of failing the load.
// `E_INDEX_INVALID` is reserved for the one case where silence would be worse:
// the caller asking us to persist something that is not an index at all.

import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { VIDEO_EXTENSIONS } from './indexer';
import type {
  FootageIndex,
  IndexSourceFile,
  IndexSourceSignature,
  IndexedClip,
  IndexedShot,
} from './indexer';

export type { IndexSourceFile, IndexSourceSignature } from './indexer';
export type { FootageIndex } from './indexer';

/** Untagged index: what analysis produced, before any vision tagging. */
export const FOOTAGE_INDEX_FILE = 'footage_index.json';

/** Tagged index: the same analysis with `shot.tags` filled in. */
export const TAGGED_INDEX_FILE = 'footage_index.tagged.json';

/** On-disk schema version. Kept in step with `FootageIndex['version']`. */
export const INDEX_FILE_VERSION = 1;

export type IndexStoreErrorCode = 'E_INDEX_INVALID';

/**
 * The caller handed us something that is not a footage index. This is a bug in
 * the pipeline, not bad user data, so it is loud: writing it would produce a
 * file every later stage silently ignores.
 */
export class IndexStoreError extends Error {
  readonly code: IndexStoreErrorCode;

  constructor(code: IndexStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IndexStoreError';
    this.code = code;
  }
}

/** The object actually written to disk: a `FootageIndex` plus its save stamp. */
export interface FootageIndexFile extends FootageIndex {
  /** ISO timestamp of this write, not of the analysis. */
  savedAt: string;
}

export interface IndexFileOptions {
  /**
   * `true` selects `footage_index.tagged.json`. It never changes what is in the
   * file — tagging is another module's job — only which name is written/read.
   */
  tagged?: boolean;
}

/**
 * One flat shot, as the agent context and the chat guardrail want it.
 *
 * `score` is normalised to 0..1 (`shot.tags.score / 100`) and only present on a
 * tagged shot, matching `ShotSummary` and `buildCandidates`. `src` is the clip's
 * stored path, which may be absolute or listing-relative; a consumer resolves it
 * the same way the EDL's `clip.src` is resolved.
 */
export interface IndexShotRow {
  shotId: string;
  sourceId: string;
  room: string;
  startSec: number;
  endSec: number;
  score?: number;
  src: string;
}

/** The indexer's defaults, used only when a hand-written file omits the block. */
const DEFAULT_FRAME_SAMPLING: FootageIndex['frameSampling'] = {
  fps: 10,
  mode: 'per-orientation',
  portrait: { width: 90, height: 160 },
  landscape: { width: 160, height: 90 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The absolute path for the requested flavour of the index. */
export function footageIndexPath(listingDir: string, opts: IndexFileOptions = {}): string {
  return join(listingDir, opts.tagged === true ? TAGGED_INDEX_FILE : FOOTAGE_INDEX_FILE);
}

// ---------------------------------------------------------------------------
// Source signature: is this index still the index of this folder?
// ---------------------------------------------------------------------------

/** Forward slashes, absolute, so a saved path compares the same on a re-run. */
function normaliseFolder(folder: string): string {
  return resolve(folder).replace(/\\/g, '/');
}

/**
 * Windows paths are case-insensitive; POSIX ones are not. Comparing folders the
 * way the filesystem does is what stops `D:/Footage` and `d:/footage` from
 * looking like two different folders on a resume.
 */
export function sameSourceFolder(left: string, right: string): boolean {
  const a = normaliseFolder(left);
  const b = normaliseFolder(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function fingerprintOf(folder: string, files: readonly IndexSourceFile[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ folder, files }))
    .digest('hex');
}

/**
 * Snapshot of a folder's videos: name, size and whole-millisecond mtime.
 *
 * Returns `undefined` when the folder cannot be read, when a file vanishes
 * mid-scan, or when the folder holds no videos: in all three cases there is no
 * trustworthy claim to make, and the caller must index rather than reuse.
 */
export async function folderSignature(folder: string): Promise<IndexSourceSignature | undefined> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return undefined;
  }

  const files: IndexSourceFile[] = [];
  for (const name of names) {
    if (!VIDEO_EXTENSIONS.has(extname(name).toLowerCase())) continue;
    try {
      const info = await stat(join(folder, name));
      if (!info.isFile()) continue;
      files.push({ name, sizeBytes: info.size, mtimeMs: Math.round(info.mtimeMs) });
    } catch {
      // A file that disappeared between readdir and stat makes the snapshot a
      // half-truth; refuse to sign it.
      return undefined;
    }
  }

  if (files.length === 0) return undefined;
  files.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const normalised = normaliseFolder(folder);
  return {
    folder: normalised,
    fingerprint: fingerprintOf(normalised, files),
    files,
  };
}

/**
 * True only when `index` carries a signature that equals `signature` (same
 * folder, same file snapshot). An index without a signature is never a match,
 * so an older or hand-written file always triggers a real index.
 */
export function indexMatchesSignature(
  index: FootageIndex | undefined,
  signature: IndexSourceSignature | undefined,
): boolean {
  if (index === undefined || signature === undefined) return false;
  const stored = index.sourceSignature;
  if (stored === undefined) return false;
  if (stored.fingerprint !== signature.fingerprint) return false;
  if (stored.files.length !== signature.files.length) return false;
  return sameSourceFolder(stored.folder, signature.folder);
}

function invalid(message: string, options?: { cause?: unknown }): IndexStoreError {
  return new IndexStoreError('E_INDEX_INVALID', message, options);
}

/**
 * Rejects an index that no later stage could use: no `clips`, a clip without an
 * id or file, a shot whose window is not a window. Deliberately shallow — the
 * metrics and probe are the indexer's business, and re-validating them here
 * would duplicate `packages/media`.
 */
function assertValidIndex(index: FootageIndex): void {
  if (!isRecord(index)) {
    throw invalid('The footage index must be an object.');
  }
  if (index.version !== INDEX_FILE_VERSION) {
    throw invalid(
      `The footage index is version ${String(index.version)}, but this build writes version ${String(INDEX_FILE_VERSION)}.`,
    );
  }
  if (!Array.isArray(index.clips)) {
    throw invalid('The footage index has no clips array.');
  }

  const clipIds = new Set<string>();
  for (const [clipIndex, clip] of index.clips.entries()) {
    if (!isRecord(clip)) throw invalid(`Clip ${String(clipIndex)} is not an object.`);
    const id = text(clip.id);
    if (id.length === 0) throw invalid(`Clip ${String(clipIndex)} has no id.`);
    if (clipIds.has(id)) throw invalid(`Clip "${id}" appears more than once.`);
    clipIds.add(id);
    if (text(clip.file).length === 0) throw invalid(`Clip "${id}" has no file.`);
    if (!Array.isArray(clip.shots)) throw invalid(`Clip "${id}" has no shots array.`);

    for (const [shotIndex, shot] of clip.shots.entries()) {
      if (!isRecord(shot)) {
        throw invalid(`Shot ${String(shotIndex)} of clip "${id}" is not an object.`);
      }
      assertShotWindow(shot, `Shot ${String(shotIndex)} of clip "${id}"`);
    }
  }
}

function assertShotWindow(shot: Record<string, unknown>, label: string): void {
  if (text(shot.id).length === 0) throw invalid(`${label} has no id.`);
  const start = shot.startSec;
  const end = shot.endSec;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
    throw invalid(`${label} has no usable startSec.`);
  }
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= start) {
    throw invalid(`${label} ends at ${String(end)}s, which is not after its start.`);
  }
}

/**
 * Writes the index for one listing and returns the path written.
 *
 * The directory is created if missing. A tagged write only chooses the tagged
 * filename; it does not tag anything and it does not touch the untagged file, so
 * the two can legitimately hold different analyses.
 */
export async function writeFootageIndex(
  listingDir: string,
  index: FootageIndex,
  opts: IndexFileOptions = {},
): Promise<string> {
  assertValidIndex(index);

  const path = footageIndexPath(listingDir, opts);
  // `version` and `savedAt` are stamped last so a stale copy on the object
  // cannot claim a schema version this build does not write.
  const payload: FootageIndexFile = {
    ...index,
    version: INDEX_FILE_VERSION,
    savedAt: new Date().toISOString(),
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const temp = `${path}.tmp`;

  await mkdir(listingDir, { recursive: true });

  try {
    // Open, write, fsync, close, then rename. The sync is what makes the rename
    // safe on a power cut: without it Windows can commit the name before the
    // bytes, leaving a zero-length index behind a valid filename.
    const handle = await open(temp, 'w');
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }

  return path;
}

/**
 * Reads the index back, or `undefined` when there is nothing usable to read.
 *
 * Tolerant on purpose: a missing file, invalid JSON, a missing `clips` array or
 * a clip without an id all mean "no index", never a thrown error. Within a good
 * file, clips and shots that fail the same checks are dropped so one bad record
 * does not cost the caller the whole listing.
 *
 * Fidelity note: the result feeds the agent's context and the chat guardrail,
 * not a render. Heavy fields (`probe`, `sha256`) are passed through when the
 * file has them, but they are not invented when it does not.
 */
export async function readFootageIndex(
  listingDir: string,
  opts: IndexFileOptions = {},
): Promise<FootageIndex | undefined> {
  const path = footageIndexPath(listingDir, opts);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return normaliseIndex(parsed);
}

function normaliseIndex(value: unknown): FootageIndex | undefined {
  if (!isRecord(value) || !Array.isArray(value.clips)) return undefined;

  const clips: IndexedClip[] = [];
  for (const raw of value.clips) {
    if (!isRecord(raw)) continue;

    const id = text(raw.id);
    const file = text(raw.file) || text(raw.name);
    if (id.length === 0 || file.length === 0 || !Array.isArray(raw.shots)) continue;

    const shots: IndexedShot[] = [];
    for (const candidate of raw.shots) {
      const shot = normaliseShot(candidate);
      if (shot !== undefined) shots.push(shot);
    }

    // Every stored field is kept, including the ones this module does not read,
    // so a round-trip never loses `probe` or `sha256`.
    clips.push({
      ...(raw as unknown as IndexedClip),
      id,
      file,
      name: text(raw.name) || basename(file),
      shots,
    });
  }

  const savedAt = text(value.savedAt);
  const generatedAt = text(value.generatedAt) || savedAt;
  const sourceSignature = normaliseSourceSignature(value.sourceSignature);

  return {
    version: INDEX_FILE_VERSION,
    generatedAt,
    frameSampling: normaliseFrameSampling(value.frameSampling),
    clips,
    ...(sourceSignature === undefined ? {} : { sourceSignature }),
  };
}

/**
 * The signature is only trusted when every field is present and well typed: a
 * half-written signature must never be able to claim "unchanged".
 */
function normaliseSourceSignature(value: unknown): IndexSourceSignature | undefined {
  if (!isRecord(value)) return undefined;
  const folder = text(value.folder);
  const fingerprint = text(value.fingerprint);
  if (folder.length === 0 || fingerprint.length === 0) return undefined;
  if (!Array.isArray(value.files) || value.files.length === 0) return undefined;

  const files: IndexSourceFile[] = [];
  for (const entry of value.files) {
    if (!isRecord(entry)) return undefined;
    const name = text(entry.name);
    const sizeBytes = entry.sizeBytes;
    const mtimeMs = entry.mtimeMs;
    if (name.length === 0) return undefined;
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
      return undefined;
    }
    if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return undefined;
    files.push({ name, sizeBytes, mtimeMs });
  }

  return { folder, fingerprint, files };
}

function normaliseShot(value: unknown): IndexedShot | undefined {
  if (!isRecord(value)) return undefined;

  const id = text(value.id);
  const startSec = value.startSec;
  const endSec = value.endSec;
  if (id.length === 0) return undefined;
  if (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0) return undefined;
  if (typeof endSec !== 'number' || !Number.isFinite(endSec) || endSec <= startSec) return undefined;

  const storedDuration = value.durationSec;
  const durationSec =
    typeof storedDuration === 'number' && Number.isFinite(storedDuration) && storedDuration > 0
      ? storedDuration
      : round3(endSec - startSec);

  return {
    ...(value as unknown as IndexedShot),
    id,
    startSec,
    endSec,
    durationSec,
  };
}

function normaliseFrameSampling(value: unknown): FootageIndex['frameSampling'] {
  if (!isRecord(value)) return { ...DEFAULT_FRAME_SAMPLING };
  const size = (candidate: unknown, fallback: { width: number; height: number }) => {
    if (!isRecord(candidate)) return { ...fallback };
    const width = candidate.width;
    const height = candidate.height;
    return typeof width === 'number' && Number.isFinite(width) && width > 0 &&
      typeof height === 'number' && Number.isFinite(height) && height > 0
      ? { width, height }
      : { ...fallback };
  };
  const fps = value.fps;
  return {
    fps: typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FRAME_SAMPLING.fps,
    mode: 'per-orientation',
    portrait: size(value.portrait, DEFAULT_FRAME_SAMPLING.portrait),
    landscape: size(value.landscape, DEFAULT_FRAME_SAMPLING.landscape),
  };
}

/**
 * Flattens an index into one row per shot for the agent context.
 *
 * A shot without tags keeps `room: 'unknown'` and no `score`: the agent should
 * see that the room is unknown rather than a filename guess dressed up as a tag.
 * Rows follow clip order, then shot order, so a listing renders the same list
 * twice from the same file.
 */
export function indexShotRows(index: FootageIndex): IndexShotRow[] {
  const rows: IndexShotRow[] = [];

  for (const clip of index.clips ?? []) {
    const src = text(clip.file) || text(clip.name);
    for (const shot of clip.shots ?? []) {
      const tags = isRecord(shot.tags) ? shot.tags : undefined;
      const room = text(tags?.room) || 'unknown';
      const taggedScore = tags?.score;
      const score =
        typeof taggedScore === 'number' && Number.isFinite(taggedScore)
          ? round3(clamp01(taggedScore / 100))
          : undefined;

      rows.push({
        shotId: shot.id,
        sourceId: clip.id,
        room,
        startSec: shot.startSec,
        endSec: shot.endSec,
        ...(score === undefined ? {} : { score }),
        src,
      });
    }
  }

  return rows;
}
