/**
 * Scene splitting for an already-finished marketing video.
 *
 * The input is one MP4/MOV, not a folder of raw clips, so the shot list has to
 * be recovered from the picture. ffmpeg does the detection; this module only
 * turns its `showinfo` log into source-time windows. Every process goes through
 * the shared {@link Runner} seam, so tests never spawn ffmpeg.
 */

import { ffmpegPath, ffprobePath } from '@zeniconic/media';
import { nodeRunner } from '../../../packages/media/src/runner';
import type { Runner } from '../../../packages/media/src/runner';

/** Default `scene` score above which a frame counts as a cut. */
export const DEFAULT_SCENE_THRESHOLD = 0.3;

/** Shots shorter than this are folded into a neighbour. */
export const SHORT_SHOT_SEC = 0.8;

/** No shot is trimmed below this length by the handle inset. */
export const MIN_SHOT_SEC = 0.8;

/** Fallback cadence when the source has no detectable scene changes. */
export const FALLBACK_CHUNK_SEC = 4;

/** Handles kept on each side of an internal cut, expressed in frames. */
export const HANDLE_FRAMES = 2;

/** Frame rate assumed when the caller does not supply one. */
export const DEFAULT_FPS = 30;

const EPS = 1e-6;
const MAX_STDERR_EXCERPT = 240;

export type SceneSplitErrorCode = 'E_PROBE' | 'E_FFMPEG' | 'E_NO_SCENES';

/** Typed failure for the two ways detection can go wrong. */
export class SceneSplitError extends Error {
  readonly code: SceneSplitErrorCode;

  constructor(code: SceneSplitErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SceneSplitError';
    this.code = code;
  }
}

/** One source-time window recovered from the finished video. */
export interface Shot {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface SceneDetectOptions {
  /** 0..1; defaults to {@link DEFAULT_SCENE_THRESHOLD}. */
  threshold?: number;
  runner?: Runner;
  /** Test seam; production uses ffmpeg-static. */
  ffmpegBin?: string;
}

export interface SceneDetection {
  cuts: number[];
  durationSec: number | undefined;
}

export interface SceneBoundaryOptions {
  /** Minimum window length. Defaults to {@link MIN_SHOT_SEC}. */
  minShotSec?: number;
  /** Merge threshold. Defaults to {@link SHORT_SHOT_SEC}. */
  mergeBelowSec?: number;
  /** Frames of handle kept on each side of an internal cut. */
  handleFrames?: number;
  /** Frame rate used to convert handles to seconds. */
  fps?: number;
}

export interface SplitScenesOptions extends SceneDetectOptions, SceneBoundaryOptions {
  /** Known runtime; when omitted it is parsed from ffmpeg or probed. */
  durationSec?: number;
  /** Fallback cadence. Defaults to {@link FALLBACK_CHUNK_SEC}. */
  fallbackChunkSec?: number;
}

export interface SceneSplitWarning {
  code: 'W_NO_SCENES';
  message: string;
}

export interface SceneSplitResult {
  shots: Shot[];
  method: 'scene' | 'fallback';
  warnings: SceneSplitWarning[];
  threshold: number;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function excerpt(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_STDERR_EXCERPT) return trimmed;
  return `${trimmed.slice(0, MAX_STDERR_EXCERPT)}…`;
}

function positiveOption(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${value}`);
  }
  return value;
}

/**
 * Extracts every `pts_time:` that appears on a `showinfo` line. ffmpeg prints
 * the same frame more than once at info level, so duplicates are collapsed.
 */
export function parseShowinfo(output: string): number[] {
  const seen = new Set<number>();
  const cuts: number[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('showinfo')) continue;

    const pattern = /pts_time:\s*(-?\d+(?:\.\d+)?)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value < 0) continue;

      const key = Math.round(value * 1_000_000) / 1_000_000;
      if (seen.has(key)) continue;
      seen.add(key);
      cuts.push(key);
    }
  }

  return cuts.sort((a, b) => a - b);
}

/** Reads ffmpeg's `Duration: HH:MM:SS.mmm` banner. Returns undefined for N/A. */
export function parseFfmpegDuration(output: string): number | undefined {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return undefined;
  }

  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? round3(total) : undefined;
}

interface Segment {
  startSec: number;
  endSec: number;
}

function mergeShortSegments(segments: Segment[], mergeBelowSec: number): Segment[] {
  const out = segments
    .filter((segment) => segment.endSec - segment.startSec > EPS)
    .map((segment) => ({ ...segment }));

  let changed = true;
  while (changed && out.length > 1) {
    changed = false;

    for (let index = 0; index < out.length; index += 1) {
      const segment = out[index];
      if (!segment) continue;
      if (segment.endSec - segment.startSec + EPS >= mergeBelowSec) continue;

      // Prefer folding into the previous shot: it keeps the following cut where
      // the detector put it. The first shot can only be folded forward.
      if (index > 0) {
        const previous = out[index - 1];
        if (previous) previous.endSec = segment.endSec;
      } else {
        const next = out[index + 1];
        if (next) next.startSec = segment.startSec;
      }

      out.splice(index, 1);
      changed = true;
      break;
    }
  }

  return out;
}

function applyHandles(
  segments: Segment[],
  handleFrames: number,
  fps: number,
  minShotSec: number,
): Segment[] {
  const handleSec = handleFrames / fps;
  if (handleSec <= 0 || segments.length < 2) {
    return segments.map((segment) => ({ ...segment }));
  }

  return segments.map((segment, index) => {
    const duration = segment.endSec - segment.startSec;
    // Leave the two-frame handle at an internal edge when the shot can spare
    // it; a shot never contracts below the minimum.
    const spare = Math.max(0, duration - minShotSec);
    const inset = Math.min(handleSec, spare / 2);

    return {
      startSec: index > 0 ? segment.startSec + inset : segment.startSec,
      endSec: index < segments.length - 1 ? segment.endSec - inset : segment.endSec,
    };
  });
}

function toShots(segments: Segment[]): Shot[] {
  return segments
    .map((segment) => {
      const startSec = round3(segment.startSec);
      const endSec = round3(segment.endSec);
      return {
        startSec,
        endSec,
        durationSec: round3(Math.max(0, endSec - startSec)),
      };
    })
    .filter((shot) => shot.durationSec > 0)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
    .map((shot, index) => ({ index, ...shot }));
}

/**
 * Turns absolute cut points into non-overlapping shots, folds short shots into
 * a neighbour and insets a two-frame handle on each internal edge.
 *
 * The handle is material the editor may use for a transition: it is not part of
 * the shot window, so neighbouring shots never overlap.
 */
export function shotsFromCuts(
  cuts: readonly number[],
  durationSec: number,
  options: SceneBoundaryOptions = {},
): Shot[] {
  positiveOption(durationSec, 'durationSec');

  const minShotSec = positiveOption(options.minShotSec ?? MIN_SHOT_SEC, 'minShotSec');
  const mergeBelowSec = positiveOption(
    Math.max(options.mergeBelowSec ?? SHORT_SHOT_SEC, minShotSec),
    'mergeBelowSec',
  );
  const handleFrames = options.handleFrames ?? HANDLE_FRAMES;
  if (!Number.isFinite(handleFrames) || handleFrames < 0) {
    throw new RangeError(`handleFrames must be a non-negative finite number, received ${handleFrames}`);
  }
  const fps = positiveOption(options.fps ?? DEFAULT_FPS, 'fps');

  const unique = [...new Set(
    cuts
      .filter((cut) => Number.isFinite(cut) && cut > EPS && cut < durationSec - EPS)
      .map((cut) => round3(cut)),
  )].sort((a, b) => a - b);

  const boundaries = [0, ...unique, round3(durationSec)];
  const segments: Segment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startSec = boundaries[index];
    const endSec = boundaries[index + 1];
    if (startSec === undefined || endSec === undefined) continue;
    if (endSec - startSec > EPS) segments.push({ startSec, endSec });
  }

  const merged = mergeShortSegments(segments, mergeBelowSec);
  return toShots(applyHandles(merged, handleFrames, fps, minShotSec));
}

/**
 * Fixed-length fallback used when the source has no usable scene change. The
 * tail is merged into the previous chunk when it would be shorter than the
 * minimum; handles are not applied because the chunks are synthetic.
 */
export function fallbackShots(
  durationSec: number,
  chunkSec: number = FALLBACK_CHUNK_SEC,
  options: Pick<SceneBoundaryOptions, 'minShotSec'> = {},
): Shot[] {
  positiveOption(durationSec, 'durationSec');
  positiveOption(chunkSec, 'chunkSec');
  const minShotSec = positiveOption(options.minShotSec ?? MIN_SHOT_SEC, 'minShotSec');

  const segments: Segment[] = [];
  for (let startSec = 0; startSec < durationSec - EPS; startSec += chunkSec) {
    segments.push({
      startSec,
      endSec: Math.min(durationSec, startSec + chunkSec),
    });
  }

  return toShots(mergeShortSegments(segments, minShotSec));
}

async function probeDuration(file: string, runner: Runner): Promise<number> {
  const result = await runner.run(ffprobePath(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);

  if (result.code !== 0) {
    throw new SceneSplitError(
      'E_PROBE',
      `ffprobe could not read the duration of "${file}" (exit ${result.code}): ${excerpt(result.stderr)}`,
    );
  }

  const parsed = Number(result.stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new SceneSplitError(
      'E_PROBE',
      `ffprobe returned no usable duration for "${file}".`,
    );
  }
  return round3(parsed);
}

/**
 * Runs the scene detector and returns raw cut times plus the runtime ffmpeg
 * reported. No cuts is a normal result here; {@link detectSceneCuts} turns it
 * into the typed `E_NO_SCENES` failure.
 */
export async function detectScenes(
  file: string,
  options: SceneDetectOptions = {},
): Promise<SceneDetection> {
  const threshold = options.threshold ?? DEFAULT_SCENE_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new RangeError(`threshold must be in (0, 1], received ${threshold}`);
  }

  const runner = options.runner ?? nodeRunner;
  const bin = options.ffmpegBin ?? ffmpegPath();
  const args = [
    '-hide_banner',
    '-nostdin',
    '-i',
    file,
    '-vf',
    `select='gt(scene,${threshold})',showinfo`,
    '-an',
    '-f',
    'null',
    '-',
  ];

  let result;
  try {
    result = await runner.run(bin, args);
  } catch (cause) {
    throw new SceneSplitError(
      'E_FFMPEG',
      `Could not start ffmpeg scene detection for "${file}".`,
      { cause },
    );
  }

  if (result.code !== 0) {
    throw new SceneSplitError(
      'E_FFMPEG',
      `ffmpeg scene detection failed for "${file}" (exit ${result.code}): ${excerpt(result.stderr)}`,
    );
  }

  return {
    cuts: parseShowinfo(`${result.stdout}\n${result.stderr}`),
    durationSec: parseFfmpegDuration(result.stderr),
  };
}

/** Scene cuts only; throws `E_NO_SCENES` when the detector found none. */
export async function detectSceneCuts(
  file: string,
  options: SceneDetectOptions = {},
): Promise<number[]> {
  const detection = await detectScenes(file, options);
  if (detection.cuts.length === 0) {
    throw new SceneSplitError(
      'E_NO_SCENES',
      `No scene change above ${options.threshold ?? DEFAULT_SCENE_THRESHOLD} was found in "${file}".`,
    );
  }
  return detection.cuts;
}

/**
 * The orchestrator entry point: detect, build shots, or fall back to fixed 4 s
 * chunks with a warning. An ffmpeg/probe failure is a typed error and is not
 * silently replaced with a worse edit.
 */
export async function splitScenes(
  file: string,
  options: SplitScenesOptions = {},
): Promise<SceneSplitResult> {
  const threshold = options.threshold ?? DEFAULT_SCENE_THRESHOLD;
  const runner = options.runner ?? nodeRunner;
  const detection = await detectScenes(file, { ...options, threshold, runner });

  const durationSec =
    options.durationSec ??
    detection.durationSec ??
    (await probeDuration(file, runner));

  if (detection.cuts.length === 0) {
    return {
      shots: fallbackShots(durationSec, options.fallbackChunkSec, options),
      method: 'fallback',
      warnings: [
        {
          code: 'W_NO_SCENES',
          message:
            `No scene change above ${threshold} was found; ` +
            `used fixed ${options.fallbackChunkSec ?? FALLBACK_CHUNK_SEC}s chunks instead.`,
        },
      ],
      threshold,
    };
  }

  return {
    shots: shotsFromCuts(detection.cuts, durationSec, options),
    method: 'scene',
    warnings: [],
    threshold,
  };
}
