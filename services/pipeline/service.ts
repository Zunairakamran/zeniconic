// The pipeline seam: one module that ties indexing, candidate building,
// planning and rendering together. The CLI scripts and (later) the Electron
// main process call this instead of re-implementing the glue.
//
// Everything here is deterministic given its inputs: no wall clock, no network,
// no hidden randomness. Time and ids are injected by the caller.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ffmpegPath } from '../../packages/media/src/index';
import { buildRenderArgs, PROFILES } from '../../packages/render/src/index';
import type { ProfileId, Quality } from '../../packages/render/src/index';
import { planVariant } from '../../packages/planner/src/index';
import type { Candidate, Facts, PlanRequest } from '../../packages/planner/src/index';
import type { Edl, LookId, Room, SafeArea } from '../../packages/edl/src/index';
import { collectVideos, indexFiles } from './indexer';
import type { FootageIndex, IndexedShot } from './indexer';

export type { FootageIndex } from './indexer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyseResult {
  index: FootageIndex;
  candidates: Candidate[];
}

export interface AnalyseProgress {
  stage: string;
  /** 0..100 */
  percent: number;
  detail?: string;
}

export interface AnalyseOptions {
  onProgress?: (progress: AnalyseProgress) => void;
}

/** The music bed a plan needs. Kept separate so callers pass only five fields. */
export interface MusicInput {
  trackId: string;
  src: string;
  beatGrid: number[];
  gainDb: number;
  duckUnderVoiceDb: number;
}

export interface BuildRequestInput {
  listingId: string;
  candidates: Candidate[];
  facts: Facts;
  music: MusicInput;
  profile: ProfileId;
  targetSec: number;
  /** Creative direction; defaults to `calm`. */
  look?: LookId;
  /** Stable tie-break seed; defaults to one derived from the listing id. */
  seed?: number;
  /** ISO timestamp, injected for determinism. */
  now: string;
}

export interface CanvasSpec {
  width: number;
  height: number;
  fps: number;
  safeArea: SafeArea;
}

export type PipelineErrorCode = 'E01' | 'E02' | 'E_ARGUMENT' | 'E_RENDER';

/**
 * A failure that maps onto the error taxonomy in `docs/SPEC.md` §10. Codes are
 * for logs and QA; `message` is the sentence a screen may show.
 */
export class PipelineError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PipelineError';
    this.code = code;
  }
}

/** A non-zero ffmpeg exit, carrying the tail of stderr for the job log. */
export class RenderError extends PipelineError {
  readonly exitCode: number;
  /** The last 20 non-empty stderr lines, oldest first. */
  readonly stderr: string[];

  constructor(exitCode: number, stderr: string[]) {
    const tail = stderr[stderr.length - 1];
    super(
      'E_RENDER',
      `ffmpeg exited with code ${exitCode}${tail ? `: ${tail}` : '.'}`,
    );
    this.name = 'RenderError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/**
 * Safe areas from `docs/CONVENTIONS.md` and §FR-39. Vertical is the
 * intersection of TikTok, Reels and Shorts; the others follow the same logic.
 * Landscape and pin keep a tight 60 px margin so text is not lost on crop.
 */
const SAFE_AREAS: Record<ProfileId, SafeArea> = {
  'vertical-social': { top: 250, bottom: 340, left: 60, right: 120 },
  'feed-portrait': { top: 180, bottom: 220, left: 60, right: 60 },
  landscape: { top: 60, bottom: 90, left: 60, right: 60 },
  pin: { top: 60, bottom: 90, left: 60, right: 60 },
};

export function defaultCanvas(profile: ProfileId): CanvasSpec {
  const spec = PROFILES[profile];
  if (!spec) throw new PipelineError('E_ARGUMENT', `Unknown render profile "${profile}".`);
  return {
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    safeArea: { ...SAFE_AREAS[profile] },
  };
}

// ---------------------------------------------------------------------------
// Analysis and candidates
// ---------------------------------------------------------------------------

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Indexes every video directly inside `folder` and scores its shots. Progress
 * is reported per clip; the final event is 100% with the candidate count.
 */
export async function analyseFolder(
  folder: string,
  opts: AnalyseOptions = {},
): Promise<AnalyseResult> {
  let files: string[];
  try {
    files = collectVideos([folder]);
  } catch (error) {
    throw new PipelineError('E01', `Could not read the folder "${folder}": ${messageOf(error)}`);
  }
  if (files.length === 0) {
    throw new PipelineError('E01', `There are no videos in "${folder}".`);
  }

  const report = opts.onProgress;
  const total = files.length;
  let done = 0;
  report?.({ stage: 'index', percent: 0, detail: `${total} clip${total === 1 ? '' : 's'} to index` });

  let index: FootageIndex;
  try {
    index = await indexFiles(files, {
      onClip: (name, shots, frames, ms) => {
        done += 1;
        report?.({
          stage: 'index',
          percent: Math.round((done / total) * 100),
          detail: `${done} of ${total}: ${name} — ${shots} shots, ${frames} frames, ${ms}ms`,
        });
      },
    });
  } catch (error) {
    // E02: an unreadable or truncated clip, not a bug in the caller's input.
    throw new PipelineError(
      'E02',
      `Could not read a clip in "${folder}": ${messageOf(error)}`,
      { cause: error },
    );
  }

  const candidates = buildCandidates(index);
  report?.({ stage: 'index', percent: 100, detail: `${candidates.length} candidates` });
  return { index, candidates };
}

/** Filenames are the only room evidence until vision tagging lands. */
const ROOM_WORDS: Array<[RegExp, Room]> = [
  [/kitchen/i, 'kitchen'],
  [/living|salon|lounge/i, 'living'],
  [/bed|master/i, 'bedroom'],
  [/bath|wc/i, 'bathroom'],
  [/balcon|terrace/i, 'balcony'],
  [/view|marina|sea/i, 'view'],
  [/garden|pool|amenity|gym/i, 'amenity'],
  [/front|exterior|facade|building/i, 'exterior'],
  [/entry|hall|lobby/i, 'entry'],
];

/** Rooms used in order when no filename word matches. */
const FALLBACK_ROOMS: Room[] = ['living', 'kitchen', 'bedroom', 'bathroom', 'balcony', 'exterior'];

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function scoreShot(metrics: IndexedShot['metrics']): number {
  const quality =
    1 -
    0.45 * metrics.blur -
    0.25 * clamp(metrics.shake / 8, 0, 1) -
    0.15 * metrics.exposureClipHigh -
    0.15 * metrics.exposureClipLow;
  return Math.round(clamp(quality, 0.05, 0.99) * 1000) / 1000;
}

/**
 * The heuristic candidate pool: room from the filename, score from blur, shake
 * and exposure clipping. Deterministic for a given index — the fallback room
 * cycles per call, not per module load.
 */
export function buildCandidates(index: FootageIndex): Candidate[] {
  const candidates: Candidate[] = [];
  let fallback = 0;

  for (const clip of index.clips) {
    const matched = ROOM_WORDS.find(([pattern]) => pattern.test(clip.name))?.[1];
    for (const shot of clip.shots) {
      if (!(shot.durationSec > 0)) continue;
      const room = matched ?? FALLBACK_ROOMS[fallback++ % FALLBACK_ROOMS.length] ?? 'unknown';
      candidates.push({
        shotId: shot.id,
        sourceId: clip.id,
        src: clip.file,
        room,
        score: scoreShot(shot.metrics),
        inSec: shot.startSec,
        outSec: shot.endSec,
        reason: `measured: blur ${shot.metrics.blur.toFixed(2)}, shake ${shot.metrics.shake.toFixed(2)}`,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** FNV-1a: stable across platforms and process restarts. */
function seedFor(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 0x7fffffff;
}

/**
 * Assembles a plan request with the default creative pair (cinematic hero,
 * calm) and a seed derived from the listing id, so the same listing plans the
 * same way every time.
 */
export function buildRequest(input: BuildRequestInput): PlanRequest {
  const target = input.targetSec;
  if (!Number.isFinite(target) || target < 5 || target > 90) {
    throw new PipelineError(
      'E_ARGUMENT',
      `Target duration must be between 5 and 90 seconds, not ${String(target)}.`,
    );
  }

  const look = input.look ?? 'calm';
  const lookLabel = look.charAt(0).toUpperCase() + look.slice(1);

  return {
    listingId: input.listingId,
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: target },
    look: { id: look, label: lookLabel },
    profile: input.profile,
    canvas: defaultCanvas(input.profile),
    candidates: input.candidates,
    facts: input.facts,
    music: {
      trackId: input.music.trackId,
      src: input.music.src,
      beatGrid: [...input.music.beatGrid],
      gainDb: input.music.gainDb,
      duckUnderVoiceDb: input.music.duckUnderVoiceDb,
    },
    seed: input.seed ?? seedFor(input.listingId),
    now: input.now,
  };
}

/** Plans one deterministic variant; the planner asserts the EDL invariants. */
export function planEdl(request: PlanRequest): Edl {
  return planVariant(request);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface FfmpegResult {
  code: number;
  stderr: string[];
}

const MAX_STDERR_LINES = 200;
const REPORTED_STDERR_LINES = 20;

function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  const bin = ffmpegPath();
  return new Promise<FfmpegResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const lines: string[] = [];
    let partial = '';

    child.stderr.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim().length > 0) lines.push(line);
      }
      if (lines.length > MAX_STDERR_LINES) lines.splice(0, lines.length - MAX_STDERR_LINES);
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (partial.trim().length > 0) lines.push(partial.trim());
      resolve({ code: code ?? -1, stderr: lines.slice(-REPORTED_STDERR_LINES) });
    });
  });
}

/**
 * Renders one EDL for one profile. The output directory is created if missing;
 * a non-zero ffmpeg exit becomes a `RenderError` carrying the last 20 lines of
 * stderr, which is what the job log shows.
 */
export async function renderEdl(
  edl: Edl,
  profile: ProfileId,
  quality: Quality,
  output: string,
): Promise<void> {
  const spec = PROFILES[profile];
  if (!spec) throw new PipelineError('E_ARGUMENT', `Unknown render profile "${profile}".`);
  if (output.trim().length === 0) {
    throw new PipelineError('E_ARGUMENT', 'A render needs an output path.');
  }

  await mkdir(dirname(output), { recursive: true });
  const args = buildRenderArgs(edl, spec, { quality, output });
  const result = await runFfmpeg(args);
  if (result.code !== 0) throw new RenderError(result.code, result.stderr);
}
