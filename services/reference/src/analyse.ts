/**
 * Deterministic reference-video analysis.
 *
 * One local file in, one `ReferenceStyleProfile` out. No network, no keys, no
 * model unless the caller injects the optional vision port. Every number is
 * either measured with ffmpeg/ffprobe or derived by a heuristic documented next
 * to the code below.
 *
 * Why these measurements and not "AI watches the video":
 * the planner needs stable guidance (is this a 1.2 s cut or a 4 s hold? is the
 * grade warm?), and style numbers that change between runs make A/B review
 * meaningless. Vision is therefore an enrichment port over the soft fields
 * only; it cannot move a measured number.
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { analyseFrames, segmentShots } from '@zeniconic/analysis';
import type { FrameMetrics } from '@zeniconic/analysis';
import {
  ffmpegPath,
  probe as probeDefault,
  readFrames as readFramesDefault,
} from '@zeniconic/media';
import type { ProbeResult, RawFrame, Runner } from '@zeniconic/media';
import { nodeRunner } from '../../../packages/media/src/runner';
import {
  ReferenceAnalysisError,
  type LoudnessFn,
  type PaletteFn,
  type ReferenceAspect,
  type ReferenceDeps,
  type ReferenceMotionLevel,
  type ReferencePacing,
  type ReferenceSourceNote,
  type ReferenceSources,
  type ReferenceStyleProfile,
  type ReferenceStyleWords,
  type ReferenceTransitionGuess,
  type ReferenceVisionFrame,
  type RgbSample,
} from './types';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Frames decoded long edge, in pixels. Enough for cut structure, cheap on CPU. */
const SAMPLE_LONG_EDGE = 48;

/** Sampling cadence for short references; 10 fps resolves ~0.2 s cuts. */
const MAX_SAMPLE_FPS = 10;

/** Below this cadence a cut shorter than 2 s may be missed (documented). */
const MIN_SAMPLE_FPS = 0.5;

/** Roughly 90 s of analysis per reference at 10 fps, then cadence drops. */
const BUDGETED_FRAMES = 900;

/** Hard ceiling so a mislabelled 4-hour file cannot exhaust memory. */
const MAX_FRAMES = 6000;

/** Cut detection floor, matching `packages/analysis` defaults. */
const ABS_CUT_THRESHOLD = 6;
const MEDIAN_CUT_MULTIPLIER = 3;

/** Shots shorter than this fold into a neighbour. */
const MIN_SHOT_SEC = 0.6;

/** One palette sample per second; 600 keeps a 10-minute reference bounded. */
const PALETTE_FPS = 1;
const MAX_PALETTE_SAMPLES = 600;

/** Palette samples closer than this in RGB space share a bucket (8³ grid). */
const PALETTE_BUCKET = 32;

/** A "cut" whose peak luma jump is below this (20/255) is probably a blend. */
const SOFT_CUT_PEAK = 20 / 255;

/** A frame-diff hump spanning this many samples is treated as a dissolve. */
const SOFT_CUT_SPAN = 3;

/** Pacing boundaries, in seconds. Strictly less-than. */
const FAST_CUT_SEC = 2;
const MEDIUM_CUT_SEC = 3.5;

/** Motion boundaries on the 0..1 mean frame difference. */
const LOW_MOTION = 0.015;
const MEDIUM_MOTION = 0.05;

/* -------------------------------------------------------------------------- */
/* Small numeric helpers                                                      */
/* -------------------------------------------------------------------------- */

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function hexFromRgb(r: number, g: number, b: number): string {
  const channel = (value: number): string =>
    clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function parseHexColour(value: string): RgbSample | undefined {
  const trimmed = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(trimmed)) return undefined;
  return {
    r: Number.parseInt(trimmed.slice(0, 2), 16),
    g: Number.parseInt(trimmed.slice(2, 4), 16),
    b: Number.parseInt(trimmed.slice(4, 6), 16),
  };
}

function lumaOf(sample: RgbSample): number {
  return 0.299 * sample.r + 0.587 * sample.g + 0.114 * sample.b;
}

/* -------------------------------------------------------------------------- */
/* Derivation rules (exported so they can be tested at their boundaries)       */
/* -------------------------------------------------------------------------- */

/**
 * Display aspect from the probe's already-rotated width/height.
 *
 * A 2% tolerance covers codec rounding (e.g. 608×1080 as 9:16). Anything the
 * product's four profiles do not name — Pinterest 2:3, anamorphic, a 4:3
 * source — is honestly `other`.
 */
export function aspectFromDimensions(
  width: number,
  height: number,
): ReferenceAspect {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'other';
  }
  const ratio = width / height;
  const near = (target: number): boolean => Math.abs(ratio - target) <= 0.02;

  if (near(1)) return '1:1';
  if (near(9 / 16)) return '9:16';
  if (near(16 / 9)) return '16:9';
  if (near(4 / 5)) return '4:5';
  return 'other';
}

/**
 * Pacing band. Rule (from the assignment): <2 s fast, <3.5 s medium, else slow.
 * The boundaries are strict, so exactly 2.000 s is medium and 3.500 s is slow.
 */
export function pacingFor(averageShotSec: number): ReferencePacing {
  if (!Number.isFinite(averageShotSec) || averageShotSec <= 0) return 'slow';
  if (averageShotSec < FAST_CUT_SEC) return 'fast';
  if (averageShotSec < MEDIUM_CUT_SEC) return 'medium';
  return 'slow';
}

/**
 * Motion band. `score` is the mean absolute luma difference between consecutive
 * sampled frames divided by 255, ignoring cut frames (a hard cut is an edit, not
 * camera movement). <0.015 low, <0.05 medium, else high.
 */
export function motionLevelFor(score: number): ReferenceMotionLevel {
  if (!Number.isFinite(score) || score <= 0) return 'low';
  if (score < LOW_MOTION) return 'low';
  if (score < MEDIUM_MOTION) return 'medium';
  return 'high';
}

/**
 * The cut threshold `segmentShots` will use: an absolute floor and a multiple of
 * the clip's own median difference. Re-exported so motion scoring can exclude
 * exactly the frames the segmenter called cut boundaries.
 */
export function cutThresholdFor(metrics: readonly FrameMetrics[]): number {
  const baseline = median(metrics.map((metric) => metric.meanAbsDiff));
  return Math.max(ABS_CUT_THRESHOLD, baseline * MEDIAN_CUT_MULTIPLIER);
}

/**
 * Cuts or blends, from picture alone.
 *
 * A hard cut is one frame with a large jump and quiet neighbours. A dissolve or
 * dip-to-colour produces a broad, low hump: several consecutive frames above
 * half the peak, or a peak too small to be a cut at all. If any detected
 * boundary looks like that, the reference is `mixed`; otherwise `cuts`.
 */
export function guessTransitions(
  diffs: readonly number[],
  cutIndices: readonly number[],
): ReferenceTransitionGuess {
  if (cutIndices.length === 0) return 'cuts';

  let soft = 0;
  for (const index of cutIndices) {
    const peak = (diffs[index] ?? 0) / 255;
    if (peak <= 0) continue;

    if (peak < SOFT_CUT_PEAK) {
      soft += 1;
      continue;
    }

    let wide = 0;
    const start = Math.max(1, index - SOFT_CUT_SPAN);
    const end = Math.min(diffs.length - 1, index + SOFT_CUT_SPAN);
    for (let i = start; i <= end; i += 1) {
      if ((diffs[i] ?? 0) / 255 >= peak / 2) wide += 1;
    }
    if (wide >= SOFT_CUT_SPAN + 1) soft += 1;
  }

  return soft > 0 ? 'mixed' : 'cuts';
}

/**
 * Dominant colours by clustering sampled frame averages into an 8³ RGB grid.
 *
 * Buckets are ranked by sample count, ties broken by bucket key so the result is
 * stable across runs. At most `limit` (default 5) buckets are returned. Real
 * footage almost always yields 3-5; a monochrome source can only yield one, and
 * when there are at least three samples but fewer than three buckets we split
 * the samples into three luma groups instead of inventing colours.
 */
export function clusterPalette(
  samples: readonly RgbSample[],
  limit = 5,
): string[] {
  const valid = samples.filter(
    (sample) =>
      Number.isFinite(sample.r) &&
      Number.isFinite(sample.g) &&
      Number.isFinite(sample.b),
  );
  if (valid.length === 0) return [];

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (const sample of valid) {
    const key = [
      Math.floor(clamp(sample.r, 0, 255) / PALETTE_BUCKET),
      Math.floor(clamp(sample.g, 0, 255) / PALETTE_BUCKET),
      Math.floor(clamp(sample.b, 0, 255) / PALETTE_BUCKET),
    ].join('-');
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { count: 1, r: sample.r, g: sample.g, b: sample.b });
    } else {
      bucket.count += 1;
      bucket.r += sample.r;
      bucket.g += sample.g;
      bucket.b += sample.b;
    }
  }

  const ranked = [...buckets.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
  );

  let colours =
    ranked.length >= 3
      ? ranked
          .slice(0, limit)
          .map(([, bucket]) =>
            hexFromRgb(
              bucket.r / bucket.count,
              bucket.g / bucket.count,
              bucket.b / bucket.count,
            ),
          )
      : splitByLuma(valid);

  colours = [...new Set(colours)];
  return colours.slice(0, Math.max(3, Math.min(limit, colours.length)));
}

/** Fallback for flat images: three equal luma groups, averaged. */
function splitByLuma(samples: readonly RgbSample[]): string[] {
  const sorted = [...samples].sort((a, b) => lumaOf(a) - lumaOf(b));
  const groups = Math.min(3, sorted.length);
  const out: string[] = [];

  for (let group = 0; group < groups; group += 1) {
    const start = Math.floor((group * sorted.length) / groups);
    const end = Math.floor(((group + 1) * sorted.length) / groups);
    const slice = sorted.slice(start, Math.max(end, start + 1));
    const count = slice.length;
    if (count === 0) continue;
    out.push(
      hexFromRgb(
        slice.reduce((sum, pixel) => sum + pixel.r, 0) / count,
        slice.reduce((sum, pixel) => sum + pixel.g, 0) / count,
        slice.reduce((sum, pixel) => sum + pixel.b, 0) / count,
      ),
    );
  }

  return out;
}

/**
 * Palette words for the style object. Temperature is the mean red-minus-blue of
 * the palette (warm above +12, cool below −12); contrast is the luma range
 * across the palette itself (high above 110, low below 45).
 */
export function colourWordsFor(palette: readonly string[]): {
  temperature: string;
  color_style: string;
} {
  const samples = palette
    .map(parseHexColour)
    .filter((sample): sample is RgbSample => sample !== undefined);

  if (samples.length === 0) {
    return { temperature: 'neutral', color_style: 'neutral' };
  }

  const meanR = samples.reduce((sum, sample) => sum + sample.r, 0) / samples.length;
  const meanB = samples.reduce((sum, sample) => sum + sample.b, 0) / samples.length;
  const delta = meanR - meanB;

  const lumas = samples.map(lumaOf);
  const spread = Math.max(...lumas) - Math.min(...lumas);

  const temperature = delta > 12 ? 'warm' : delta < -12 ? 'cool' : 'neutral';
  const contrast = spread > 110 ? 'high-contrast' : spread < 45 ? 'low-contrast' : 'balanced';

  return { temperature, color_style: `${temperature} ${contrast}` };
}

/**
 * Confidence in the profile, 0..1.
 *
 * Base 0.4. Add 0.2 when at least two shots were visible (otherwise there is no
 * edit structure to describe), 0.15 when 3+ palette colours were measured, 0.15
 * when integrated loudness was measured, 0.05 for a transcript and 0.05 for
 * vision enrichment. Capped at 0.95: a picture-only profile is never certain
 * about captions, graphics or intent.
 */
export function confidenceFor(parts: {
  shotCount: number;
  paletteSize: number;
  hasLoudness: boolean;
  hasTranscript: boolean;
  hasVision: boolean;
}): number {
  let score = 0.4;
  if (parts.shotCount >= 2) score += 0.2;
  if (parts.paletteSize >= 3) score += 0.15;
  if (parts.hasLoudness) score += 0.15;
  if (parts.hasTranscript) score += 0.05;
  if (parts.hasVision) score += 0.05;
  return round(clamp(score, 0, 0.95), 2);
}

/** One-line and per-key style words derived from measured values. */
export function deriveStyleWords(input: {
  pacing: ReferencePacing;
  aspect: ReferenceAspect;
  transitionsGuess: ReferenceTransitionGuess;
  motion: ReferenceMotionLevel;
  palette: readonly string[];
}): ReferenceStyleWords {
  const { temperature, color_style } = colourWordsFor(input.palette);

  const camera_style =
    input.motion === 'high'
      ? 'handheld or in-motion'
      : input.motion === 'medium'
        ? 'mixed handheld and locked-off'
        : 'locked-off or tripod';

  return {
    style: `${input.pacing}-paced ${input.aspect} ${temperature} edit`,
    pacing: input.pacing,
    transition_style:
      input.transitionsGuess === 'cuts' ? 'hard cuts' : 'mixed cuts and dissolves',
    // Picture-only analysis cannot read on-screen text; say so instead of guessing.
    caption_style: 'unknown',
    color_style,
    camera_style,
    motion_graphics: 'none-detected',
  };
}

/* -------------------------------------------------------------------------- */
/* Local ffmpeg measurements (defaults; injectable for tests)                  */
/* -------------------------------------------------------------------------- */

/**
 * Integrated loudness through `ebur128`. Returns null when ffmpeg printed no
 * summary (a silent or malformed audio stream). The caller decides whether that
 * is a failure; for a reference it is only a missing enrichment.
 */
export function createLoudnessMeasurer(
  runner: Runner = nodeRunner,
  bin: string = ffmpegPath(),
): LoudnessFn {
  return async (file) => {
    const result = await runner.run(bin, [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-af',
      'ebur128',
      '-f',
      'null',
      '-',
    ]);

    if (result.code !== 0) {
      const detail = result.stderr.trim().split(/\r?\n/).slice(-4).join(' ');
      throw new Error(`ebur128 failed (exit ${result.code}): ${detail}`);
    }

    const matches = [
      ...`${result.stdout}\n${result.stderr}`.matchAll(
        /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g,
      ),
    ];
    const last_ = matches.at(-1);
    if (last_ === undefined) return null;
    const value = Number(last_[1]);
    return Number.isFinite(value) ? round(value, 1) : null;
  };
}

/**
 * Palette samples: one average colour per second, produced by scaling every
 * sampled frame to 1×1 (`fps=1,scale=1:1:flags=area`). Raw rgb24 comes back on
 * stdout, three bytes per sample; no temp files and no image encoder.
 */
export function createPaletteSampler(options: {
  bin?: string;
  fps?: number;
  maxSamples?: number;
} = {}): PaletteFn {
  const bin = options.bin ?? ffmpegPath();
  const fps = options.fps ?? PALETTE_FPS;
  const maxSamples = options.maxSamples ?? MAX_PALETTE_SAMPLES;

  return (file) =>
    new Promise<RgbSample[]>((resolve, reject) => {
      const child = spawn(
        bin,
        [
          '-v',
          'error',
          '-nostdin',
          '-i',
          file,
          '-an',
          '-vf',
          `fps=${fps},scale=1:1:flags=area`,
          '-frames:v',
          String(maxSamples),
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          'pipe:1',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );

      const chunks: Buffer[] = [];
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      child.once('error', (error) => reject(error));
      child.once('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Palette scan failed (exit ${code}): ${stderr.trim().slice(0, 400)}`,
            ),
          );
          return;
        }
        const raw = Buffer.concat(chunks);
        const samples: RgbSample[] = [];
        for (let i = 0; i + 2 < raw.length; i += 3) {
          samples.push({ r: raw[i] ?? 0, g: raw[i + 1] ?? 0, b: raw[i + 2] ?? 0 });
        }
        resolve(samples);
      });
    });
}

/* -------------------------------------------------------------------------- */
/* Input validation                                                           */
/* -------------------------------------------------------------------------- */

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Accepts a local path or `{ file }`. A URL is refused with a typed error rather
 * than silently downloaded: media stays local (SPEC §8.6, NFR-20).
 */
export function resolveLocalFile(input: string | { file: string }): string {
  const file = typeof input === 'string' ? input : input?.file;
  if (typeof file !== 'string' || file.trim() === '') {
    throw new ReferenceAnalysisError(
      'E_NOT_A_FILE',
      'Reference analysis needs a local video file path.',
    );
  }

  const trimmed = file.trim();
  const scheme = SCHEME_PATTERN.exec(trimmed);
  if (scheme !== null && !/^[a-z]:[\\/]/i.test(trimmed)) {
    throw new ReferenceAnalysisError(
      'E_URL_NOT_ALLOWED',
      'Reference analysis is local-only: pass a file path, not a URL (' +
        `${scheme[1]}://…). Nothing is downloaded.`,
    );
  }

  if (!existsSync(trimmed)) {
    throw new ReferenceAnalysisError(
      'E_NOT_A_FILE',
      `Reference file does not exist: "${trimmed}".`,
    );
  }

  const stat = statSync(trimmed);
  if (!stat.isFile()) {
    throw new ReferenceAnalysisError(
      'E_NOT_A_FILE',
      `Reference input is not a file: "${trimmed}".`,
    );
  }

  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* Vision merge                                                               */
/* -------------------------------------------------------------------------- */

const VISION_STYLE_KEYS = [
  'style',
  'transition_style',
  'caption_style',
  'color_style',
  'camera_style',
  'motion_graphics',
] as const;

/**
 * Applies a vision partial over the soft fields. Deterministic measurements
 * (duration, aspect, shots, pacing, motion score, loudness) always win; a vision
 * response can only add what picture-only analysis cannot see.
 */
function applyVision(
  profile: ReferenceStyleProfile,
  partial: Partial<ReferenceStyleProfile>,
  applied: string[],
): void {
  if (partial.style !== undefined && typeof partial.style === 'object') {
    for (const key of VISION_STYLE_KEYS) {
      const value = (partial.style as unknown as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim() !== '') {
        profile.style[key] = value;
        applied.push(`style.${key}`);
      }
    }
  }

  if (Array.isArray(partial.palette)) {
    const colours = partial.palette
      .filter((colour): colour is string => typeof colour === 'string')
      .map((colour) => parseHexColour(colour))
      .filter((sample): sample is RgbSample => sample !== undefined)
      .map((sample) => hexFromRgb(sample.r, sample.g, sample.b));

    const unique = [...new Set(colours)].slice(0, 5);
    if (unique.length >= 3) {
      profile.palette = unique;
      applied.push('palette');
    }
  }

  if (
    partial.transitionsGuess === 'cuts' ||
    partial.transitionsGuess === 'mixed'
  ) {
    profile.transitionsGuess = partial.transitionsGuess;
    profile.style.transition_style =
      partial.transitionsGuess === 'cuts'
        ? 'hard cuts'
        : 'mixed cuts and dissolves';
    applied.push('transitionsGuess');
  }

  if (typeof partial.hasVoice === 'boolean' && profile.hasVoice === undefined) {
    profile.hasVoice = partial.hasVoice;
    applied.push('hasVoice');
  }
}

/* -------------------------------------------------------------------------- */
/* Analysis                                                                   */
/* -------------------------------------------------------------------------- */

function note(
  method: ReferenceSourceNote['method'],
  detail?: string,
): ReferenceSourceNote {
  return detail === undefined ? { method } : { method, detail };
}

/** Frames handed to the vision port: up to 12, evenly spaced, first and last. */
function visionFrames(frames: readonly RawFrame[], limit = 12): ReferenceVisionFrame[] {
  if (frames.length === 0) return [];
  if (frames.length <= limit) {
    return frames.map((frame) => ({
      t: round(frame.t),
      width: frame.width,
      height: frame.height,
      gray: frame.gray,
    }));
  }

  const picked: ReferenceVisionFrame[] = [];
  for (let i = 0; i < limit; i += 1) {
    const index = Math.round((i * (frames.length - 1)) / (limit - 1));
    const frame = frames[index];
    if (frame === undefined) continue;
    picked.push({
      t: round(frame.t),
      width: frame.width,
      height: frame.height,
      gray: frame.gray,
    });
  }
  return picked;
}

/**
 * Analyse one local reference video.
 *
 * Order of work: validate path → probe → decode a small luma stream once →
 * segment shots → measure loudness (only if an audio stream exists) → sample the
 * palette → derive the profile → optional transcript → optional vision.
 *
 * The only required dependency is a real file. All ports are injectable and
 * tests use fakes, so no suite ever spawns ffmpeg or reaches a model.
 */
export async function analyseReference(
  input: string | { file: string },
  deps: ReferenceDeps = {},
): Promise<ReferenceStyleProfile> {
  const file = resolveLocalFile(input);

  const probe = deps.probe ?? probeDefault;
  const readFrames = deps.readFrames ?? readFramesDefault;
  const measureLoudness = deps.measureLoudness ?? createLoudnessMeasurer();
  const samplePalette = deps.samplePalette ?? createPaletteSampler();

  let info: ProbeResult;
  try {
    info = await probe(file);
  } catch (cause) {
    if (cause instanceof ReferenceAnalysisError) throw cause;
    throw new ReferenceAnalysisError(
      'E_PROBE_FAILED',
      `ffprobe could not read the reference video "${file}".`,
      { cause },
    );
  }

  const aspect = aspectFromDimensions(info.width, info.height);

  // Long references get a lower cadence rather than an unbounded decode.
  const sampleFps = clamp(BUDGETED_FRAMES / Math.max(info.durationSec, 1), MIN_SAMPLE_FPS, MAX_SAMPLE_FPS);
  const sampleHeight = clamp(
    Math.round((SAMPLE_LONG_EDGE * info.height) / Math.max(info.width, 1)),
    8,
    SAMPLE_LONG_EDGE * 2,
  );

  const decoded: RawFrame[] = [];
  let truncated = false;
  try {
    for await (const frame of readFrames(file, {
      width: SAMPLE_LONG_EDGE,
      height: sampleHeight,
      fps: sampleFps,
      limit: MAX_FRAMES,
    })) {
      decoded.push(frame);
    }
    truncated = decoded.length >= MAX_FRAMES;
  } catch (cause) {
    throw new ReferenceAnalysisError(
      'E_ANALYSIS_FAILED',
      `Could not decode frames from the reference video "${file}".`,
      { cause },
    );
  }

  if (decoded.length === 0) {
    throw new ReferenceAnalysisError(
      'E_ANALYSIS_FAILED',
      `The reference video "${file}" produced no frames to analyse.`,
    );
  }

  // searchRadius 0: the shake estimate is not part of a style profile and the
  // search is the expensive part of `analyseFrames`.
  const metrics = analyseFrames(decoded, { searchRadius: 0 });
  const diffs = metrics.map((metric) => metric.meanAbsDiff);
  const cutThreshold = cutThresholdFor(metrics);
  const shots = segmentShots(metrics, {
    absThreshold: ABS_CUT_THRESHOLD,
    medianMultiplier: MEDIAN_CUT_MULTIPLIER,
    minShotSec: MIN_SHOT_SEC,
  });

  const starts = shots
    .map((shot) => round(shot.startSec))
    .filter((start) => start < info.durationSec);
  if (starts.length === 0) starts.push(0);

  const shotDurationsSec = starts
    .map((start, index) =>
      round((starts[index + 1] ?? round(info.durationSec)) - start),
    )
    .filter((duration) => duration > 0.001);
  const shotCount = shotDurationsSec.length;
  const totals = shotDurationsSec.reduce((sum, duration) => sum + duration, 0);
  const averageShotSec = shotCount > 0 ? round(totals / shotCount) : 0;
  const medianShotSec = round(median(shotDurationsSec));
  const cutDensityPerMin =
    info.durationSec > 0
      ? round((Math.max(0, shotCount - 1) * 60) / info.durationSec)
      : 0;

  // Motion ignores cut frames: an edit is not a camera move.
  const cutIndices: number[] = [];
  for (let index = 1; index < diffs.length; index += 1) {
    if ((diffs[index] ?? 0) > cutThreshold) cutIndices.push(index);
  }
  const motionSamples = diffs.filter(
    (_diff, index) => index > 0 && !cutIndices.includes(index),
  );
  const motionScore =
    motionSamples.length > 0
      ? round(
          motionSamples.reduce((sum, diff) => sum + diff, 0) /
            motionSamples.length /
            255,
          4,
        )
      : 0;
  const motion = motionLevelFor(motionScore);
  const pacing = pacingFor(averageShotSec);
  const transitionsGuess = guessTransitions(diffs, cutIndices);

  // Palette: a picture failure is fatal because the profile's colour guidance
  // would otherwise be missing without a trace. Audio is enrichment only.
  let samples: readonly RgbSample[];
  try {
    samples = await samplePalette(file);
  } catch (cause) {
    throw new ReferenceAnalysisError(
      'E_ANALYSIS_FAILED',
      `Could not sample the palette of "${file}".`,
      { cause },
    );
  }
  const palette = clusterPalette(samples, 5);

  let loudnessLufs: number | undefined;
  let loudnessSource: ReferenceSourceNote;
  if (!info.hasAudio) {
    loudnessSource = note('unavailable', 'The file has no audio stream.');
  } else {
    try {
      const measured = await measureLoudness(file);
      if (measured === null) {
        loudnessSource = note(
          'unavailable',
          'ebur128 returned no integrated loudness for this audio stream.',
        );
      } else {
        loudnessLufs = measured;
        loudnessSource = note('ebur128', 'Integrated loudness, last I: summary.');
      }
    } catch (cause) {
      loudnessSource = note(
        'unavailable',
        `Loudness measurement failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  let hasVoice: boolean | undefined;
  let transcriptSource: ReferenceSourceNote | undefined;
  if (deps.transcript !== undefined) {
    try {
      const transcript = await deps.transcript(file);
      hasVoice = transcript.hasVoice;
      transcriptSource = note(
        'transcript',
        transcript.hasVoice
          ? 'The transcript port reported speech.'
          : 'The transcript port reported no speech.',
      );
    } catch (cause) {
      transcriptSource = note(
        'unavailable',
        `Transcript port failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  const style = deriveStyleWords({
    pacing,
    aspect,
    transitionsGuess,
    motion,
    palette,
  });

  const samplingDetail =
    `${sampleFps.toFixed(2)} fps at ${SAMPLE_LONG_EDGE}×${sampleHeight} luma` +
    (truncated ? `, truncated at ${MAX_FRAMES} frames` : '');

  const sources: ReferenceSources = {
    durationSec: note('ffprobe', 'Container duration.'),
    width: note('ffprobe', 'Display width after rotation.'),
    height: note('ffprobe', 'Display height after rotation.'),
    fps: note('ffprobe', 'Average frame rate.'),
    aspect: note('derived', 'width:height within a 2% tolerance of 9:16, 16:9, 1:1 or 4:5.'),
    shotCount: note(
      'frame-diff',
      `${samplingDetail}; ${shotCount} shots at >${ABS_CUT_THRESHOLD} ` +
        `and >${MEDIAN_CUT_MULTIPLIER}× median luma difference.`,
    ),
    averageShotSec: note('derived', 'Sum of shot durations divided by shot count.'),
    medianShotSec: note('derived', 'Median of shotDurationsSec.'),
    cutDensityPerMin: note(
      'derived',
      '(shotCount − 1) cuts per minute of full reference duration.',
    ),
    shotDurationsSec: note(
      'frame-diff',
      'Shot starts from the segmenter; the last shot ends at the file duration.',
    ),
    pacing: note(
      'derived',
      `averageShotSec < ${FAST_CUT_SEC} fast, < ${MEDIUM_CUT_SEC} medium, else slow.`,
    ),
    motion: note(
      'derived',
      `motionScore < ${LOW_MOTION} low, < ${MEDIUM_MOTION} medium, else high.`,
    ),
    motionScore: note(
      'frame-diff',
      'Mean |luma difference| between adjacent samples, cut frames excluded, /255.',
    ),
    palette: note(
      'palette-scan',
      `fps=${PALETTE_FPS}, scale=1:1 (area), clustered on a ${PALETTE_BUCKET}-level RGB grid.`,
    ),
    loudnessLufs: loudnessSource,
    hasVoice: transcriptSource ?? note(
      'unavailable',
      'No transcript port was supplied; hasVoice is omitted.',
    ),
    transitionsGuess: note(
      'frame-diff',
      `Cuts unless a boundary peak is below ${Math.round(SOFT_CUT_PEAK * 255)}/255 ` +
        `or spans ${SOFT_CUT_SPAN}+ samples above half its peak.`,
    ),
    style: note(
      'derived',
      'Words composed from pacing, aspect, palette temperature, motion and transitions.',
    ),
    confidence: note(
      'derived',
      'Base 0.4 + 0.2 shots + 0.15 palette + 0.15 loudness + 0.05 transcript + 0.05 vision, cap 0.95.',
    ),
  };

  if (transcriptSource !== undefined) sources.transcript = transcriptSource;

  const profile: ReferenceStyleProfile = {
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    fps: info.fps,
    aspect,
    shotCount,
    averageShotSec,
    medianShotSec,
    cutDensityPerMin,
    shotDurationsSec,
    pacing,
    motion,
    motionScore,
    palette,
    transitionsGuess,
    style,
    confidence: 0,
    sources,
  };

  if (loudnessLufs !== undefined) profile.loudnessLufs = loudnessLufs;
  if (hasVoice !== undefined) profile.hasVoice = hasVoice;

  let visionApplied = false;

  if (deps.vision !== undefined) {
    try {
      const partial = await deps.vision({
        file,
        durationSec: info.durationSec,
        aspect,
        shots: starts.map((startSec, index) => ({
          startSec,
          endSec: round(starts[index + 1] ?? info.durationSec),
        })),
        palette,
        frames: visionFrames(decoded),
      });

      const applied: string[] = [];
      applyVision(profile, partial, applied);
      visionApplied = applied.length > 0;
      sources.vision = visionApplied
        ? note('vision', `Enriched: ${applied.join(', ')}.`)
        : note('vision', 'Vision returned nothing usable; deterministic values kept.');
    } catch (cause) {
      sources.vision = note(
        'unavailable',
        `Vision port failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  profile.confidence = confidenceFor({
    shotCount,
    paletteSize: profile.palette.length,
    hasLoudness: profile.loudnessLufs !== undefined,
    hasTranscript: sources.transcript?.method === 'transcript',
    hasVision: visionApplied,
  });

  return profile;
}
