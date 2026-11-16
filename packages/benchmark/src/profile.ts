/**
 * Profile a video: one decode pass at approximately 160x90 and 10 fps, then a
 * handful of deterministic summary statistics.
 *
 * The module reuses the media package for probing and decoding and the analysis
 * package for frame metrics and shot segmentation, so a reference video and a
 * candidate are measured by exactly the same code.
 */

import { analyseFrames, segmentShots, type Frame, type FrameMetrics, type Shot } from '@zeniconic/analysis';
import { probe, readFrames } from '@zeniconic/media';

import type { StyleProfile } from './types';

/** Decode rate for profiling. 10 fps is enough for cuts and grade, and cheap. */
const ANALYSIS_FPS = 10;

/**
 * The decoder box, in pixels. Landscape sources fit in 160x90, portrait
 * sources in 90x160; the same pixel budget either way.
 */
const FRAME_BOX_LONG = 160;
const FRAME_BOX_SHORT = 90;

/**
 * Shots shorter than this are ignored when averaging. Cuts inside a flash or a
 * whip-pan are detection noise, not edit decisions.
 */
const MIN_SHOT_SEC = 0.4;

/** A shot below this mean motion reads as a still frame. */
const STATIC_MOTION = 0.05;

const TIME_SCALE = 1000;

interface Size {
  width: number;
  height: number;
}

interface LumaStats {
  mean: number;
  stdDev: number;
}

/** Profiles one file. Throws only when the file cannot be probed or decoded. */
export async function profileVideo(file: string): Promise<StyleProfile> {
  const info = await probe(file);
  const size = analysisSize(info.width, info.height);

  const frames: Frame[] = [];
  let brightnessSum = 0;
  let contrastSum = 0;
  let saturationSum = 0;

  for await (const raw of readFrames(file, {
    width: size.width,
    height: size.height,
    fps: ANALYSIS_FPS,
  })) {
    frames.push(raw);

    const luma = lumaStats(raw.gray);
    brightnessSum += luma.mean;
    contrastSum += luma.stdDev;
    saturationSum += saturationOf(raw);
  }

  if (frames.length === 0) {
    throw new Error(`Cannot profile "${file}": no frames were decoded.`);
  }

  // Shake is not part of a style profile (and costs a 49-shift search per
  // frame), so radius 0 skips it. Motion, exposure and segmentation are
  // unchanged, which is all the profile uses.
  const metrics = analyseFrames(frames, { searchRadius: 0 });
  const shots = segmentShots(metrics);
  const kept = keepProfileShots(shots, metrics, info.durationSec);

  // A file shorter than the minimum shot still has one shot: report the whole
  // container rather than an empty rhythm.
  const cutRhythm =
    kept.length === 0 ? [round3(info.durationSec)] : kept.map((shot) => shot.durationSec);

  const frameCount = frames.length;
  const motion =
    kept.length === 0
      ? wholeClipMotion(metrics, frameCount)
      : shotMotionSummary(kept);
  const shotDurations = cutRhythm;
  const shotCount = shotDurations.length;

  return {
    durationSec: round3(info.durationSec),
    width: info.width,
    height: info.height,
    fps: round3(info.fps),
    orientation: info.orientation,

    shotCount,
    avgShotSec: round3(mean(shotDurations)),
    medianShotSec: round3(median(shotDurations)),
    minShotSec: round3(Math.min(...shotDurations)),
    maxShotSec: round3(Math.max(...shotDurations)),
    cutsPerMinute: round3(cutsPerMinute(shotCount, info.durationSec)),
    cutRhythm: shotDurations.map(round3),

    brightness: round3(brightnessSum / frameCount),
    contrast: round3(contrastSum / frameCount),
    saturation: round3(saturationSum / frameCount),
    motionEnergy: round3(motion.mean),
    staticRatio: round3(motion.staticRatio),
  };
}

interface ProfileShot {
  startIndex: number;
  endIndex: number;
  durationSec: number;
  motionEnergy: number;
}

/**
 * Turns segments into shot durations. The decoder emits frames at a fixed
 * 10 fps, so a run from frame i to frame j lasts `j - i + 1` frame intervals.
 * The last shot is clipped to the container duration: `-r` can round the final
 * frame past the true end of the file.
 */
function keepProfileShots(
  shots: readonly Shot[],
  metrics: readonly FrameMetrics[],
  durationSec: number,
): ProfileShot[] {
  const kept: ProfileShot[] = [];

  for (const shot of shots) {
    const startSec = shot.startIndex / ANALYSIS_FPS;
    const endSec = Math.min((shot.endIndex + 1) / ANALYSIS_FPS, durationSec);
    const shotDuration = endSec - startSec;

    if (shotDuration < MIN_SHOT_SEC) continue;

    // A shot's first frame differs from the previous shot by definition of the
    // cut, so it is excluded from that shot's own motion. Otherwise every cut
    // would look like camera movement and a hard-cut reference would report
    // high motion.
    let motionSum = 0;
    let motionCount = 0;
    for (let i = shot.startIndex + 1; i <= shot.endIndex; i += 1) {
      const metric = metrics[i];
      if (metric === undefined) continue;
      motionSum += metric.motionEnergy;
      motionCount += 1;
    }

    kept.push({
      startIndex: shot.startIndex,
      endIndex: shot.endIndex,
      durationSec: shotDuration,
      motionEnergy: motionCount === 0 ? 0 : motionSum / motionCount,
    });
  }

  return kept;
}

interface MotionSummary {
  /** Mean per-frame motion energy across the programme, 0..1. */
  mean: number;
  /** Fraction of shots whose mean motion is below STATIC_MOTION. */
  staticRatio: number;
}

/**
 * Programme motion uses the per-frame mean over non-cut frames, so a long
 * locked-off shot does not outvote a short moving one. `staticRatio` counts
 * shots instead: it answers "how much of this edit is still photography?".
 */
function shotMotionSummary(shots: readonly ProfileShot[]): MotionSummary {
  if (shots.length === 0) return { mean: 0, staticRatio: 0 };

  let sum = 0;
  let count = 0;
  let staticShots = 0;

  for (const shot of shots) {
    if (shot.motionEnergy < STATIC_MOTION) staticShots += 1;
    const frames = Math.max(0, shot.endIndex - shot.startIndex);
    sum += shot.motionEnergy * frames;
    count += frames;
  }

  return {
    mean: count === 0 ? 0 : sum / count,
    staticRatio: staticShots / shots.length,
  };
}

/** Fallback for a clip too short to contain one kept shot. */
function wholeClipMotion(metrics: readonly FrameMetrics[], frameCount: number): MotionSummary {
  let sum = 0;
  let count = 0;

  for (let i = 1; i < frameCount; i += 1) {
    const metric = metrics[i];
    if (metric === undefined) continue;
    sum += metric.motionEnergy;
    count += 1;
  }

  const mean = count === 0 ? 0 : sum / count;
  return { mean, staticRatio: mean < STATIC_MOTION ? 1 : 0 };
}

/** Mean HSV saturation over the pixels of one frame, 0..1. */
function saturationOf(frame: Frame): number {
  const colour = frame.colour;
  // `readFrames` currently emits luma only, so this is always 0 with the media
  // package as it stands. The branch keeps the metric honest if colour decoding
  // is added later, and the profile field stays in the contract either way.
  if (colour === undefined) return 0;

  const pixelCount = frame.width * frame.height;
  let sum = 0;
  for (let p = 0, i = 0; p < pixelCount; p += 1, i += 3) {
    const r = colour[i] ?? 0;
    const g = colour[i + 1] ?? 0;
    const b = colour[i + 2] ?? 0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 0) sum += (max - min) / max;
  }
  return sum / pixelCount;
}

function lumaStats(gray: Uint8Array): LumaStats {
  let sum = 0;
  let sumSquares = 0;

  for (let p = 0; p < gray.length; p += 1) {
    const value = gray[p] ?? 0;
    sum += value;
    sumSquares += value * value;
  }

  const count = Math.max(gray.length, 1);
  const meanByte = sum / count;
  const variance = Math.max(0, sumSquares / count - meanByte * meanByte);

  return { mean: meanByte / 255, stdDev: Math.sqrt(variance) / 255 };
}

/**
 * Picks decode dimensions whose aspect ratio is exactly the source's.
 *
 * This matters: the media decoder asks ffmpeg to scale into the requested box
 * with `force_original_aspect_ratio=decrease`, then reads exactly
 * `width * height` bytes per frame. If the requested box is 16:9 and the source
 * is 4:3, ffmpeg emits a smaller buffer and every frame after the first is
 * misaligned. Using an integer multiple of the reduced aspect ratio guarantees
 * the box and the source agree, while staying inside the analysis budget.
 */
function analysisSize(width: number, height: number): Size {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Cannot choose analysis size for ${width}x${height}.`);
  }

  const divisor = gcd(Math.round(width), Math.round(height));
  const aspectWidth = Math.round(width) / divisor;
  const aspectHeight = Math.round(height) / divisor;

  const landscape = aspectWidth >= aspectHeight;
  const boxWidth = landscape ? FRAME_BOX_LONG : FRAME_BOX_SHORT;
  const boxHeight = landscape ? FRAME_BOX_SHORT : FRAME_BOX_LONG;

  const scale = Math.min(
    Math.floor(boxWidth / aspectWidth),
    Math.floor(boxHeight / aspectHeight),
  );

  // A degenerate aspect (thousands to one) has no exact reduced size inside the
  // box. Fall back to the nominal box; such files are not real listings.
  if (scale < 1) return { width: boxWidth, height: boxHeight };

  return { width: aspectWidth * scale, height: aspectHeight * scale };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0 ? 1 : x;
}

/** `(shotCount - 1) / durationSec * 60`: each shot after the first implies one cut. */
function cutsPerMinute(shotCount: number, durationSec: number): number {
  if (shotCount < 2 || durationSec <= 0) return 0;
  return ((shotCount - 1) / durationSec) * 60;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? 0;
  const upper = sorted[middle] ?? 0;
  return (lower + upper) / 2;
}

function round3(value: number): number {
  const rounded = Math.round(value * TIME_SCALE) / TIME_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}
