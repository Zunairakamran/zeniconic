/**
 * Shot segmentation.
 *
 * A shot is a contiguous run of frames inside one source clip, split where the
 * frame-to-frame difference jumps far above the clip's own baseline. Pure: metrics
 * in, shots out.
 */

import type { FrameMetrics } from './metrics';

export interface Shot {
  id: string;
  startIndex: number;
  endIndex: number;
  /** Time of the first frame, 3 dp. */
  startSec: number;
  /** Time of the last frame, 3 dp. */
  endSec: number;
  /** Frame indices spread across the shot, first and last included. */
  representativeFrames: number[];
}

export interface SegmentOpts {
  /** Minimum difference, in luma, for any boundary. Default 6. */
  absThreshold?: number;
  /** How many times the clip's median difference also qualifies a boundary. Default 3. */
  medianMultiplier?: number;
  /** Shots shorter than this merge into a neighbour. Default 0.6. */
  minShotSec?: number;
  /** Frames sampled per shot. Default 3. */
  representativeCount?: number;
}

const DEFAULT_ABS_THRESHOLD = 6;
const DEFAULT_MEDIAN_MULTIPLIER = 3;
const DEFAULT_MIN_SHOT_SEC = 0.6;
const DEFAULT_REPRESENTATIVE_COUNT = 3;

const TIME_SCALE = 1000;

interface ResolvedOptions {
  absThreshold: number;
  medianMultiplier: number;
  minShotSec: number;
  representativeCount: number;
}

interface Run {
  startIndex: number;
  endIndex: number;
}

export function segmentShots(metrics: FrameMetrics[], opts: SegmentOpts = {}): Shot[] {
  const options = resolveOptions(opts);
  if (metrics.length === 0) return [];

  // A cut must clear an absolute floor and the clip's own noise floor, so a
  // handheld source with a high median difference does not shatter into shots.
  const baseline = median(metrics.map((metric) => metric.meanAbsDiff));
  const threshold = Math.max(
    options.absThreshold,
    baseline * options.medianMultiplier,
  );

  const runs: Run[] = [];
  let startIndex = 0;
  for (let i = 1; i < metrics.length; i += 1) {
    const metric = metrics[i];
    if (metric === undefined) continue;
    if (metric.meanAbsDiff > threshold) {
      runs.push({ startIndex, endIndex: i - 1 });
      startIndex = i;
    }
  }
  runs.push({ startIndex, endIndex: metrics.length - 1 });

  // Short shots are usually the tail of a transition, not a real cut: fold each
  // one into whichever neighbour loses less time.
  const merged = mergeShortRuns(runs, metrics, options.minShotSec);

  return merged.map((run, ordinal) => ({
    id: `sh_${String(ordinal + 1).padStart(3, '0')}`,
    startIndex: run.startIndex,
    endIndex: run.endIndex,
    startSec: roundTime(metricAt(metrics, run.startIndex).t),
    endSec: roundTime(metricAt(metrics, run.endIndex).t),
    representativeFrames: pickRepresentativeFrames(
      run.startIndex,
      run.endIndex,
      options.representativeCount,
    ),
  }));
}

function mergeShortRuns(runs: readonly Run[], metrics: FrameMetrics[], minShotSec: number): Run[] {
  const result = runs.map((run) => ({ ...run }));

  while (result.length > 1) {
    let shortestIndex = -1;
    let shortestDuration = Number.POSITIVE_INFINITY;

    for (let i = 0; i < result.length; i += 1) {
      const run = result[i];
      if (run === undefined) continue;
      const duration = runDuration(run, metrics);
      if (duration < minShotSec && duration < shortestDuration) {
        shortestIndex = i;
        shortestDuration = duration;
      }
    }

    if (shortestIndex < 0) break;

    const previous = result[shortestIndex - 1];
    const next = result[shortestIndex + 1];
    if (previous === undefined && next === undefined) break;

    let target: number;
    if (previous === undefined) {
      target = shortestIndex + 1;
    } else if (next === undefined) {
      target = shortestIndex - 1;
    } else {
      // Equal neighbours: fold backwards so the merge order is deterministic.
      target = runDuration(previous, metrics) <= runDuration(next, metrics)
        ? shortestIndex - 1
        : shortestIndex + 1;
    }

    const first = result[Math.min(shortestIndex, target)];
    const last = result[Math.max(shortestIndex, target)];
    if (first === undefined || last === undefined) break;

    result.splice(Math.min(shortestIndex, target), 2, {
      startIndex: first.startIndex,
      endIndex: last.endIndex,
    });
  }

  return result;
}

function runDuration(run: Run, metrics: FrameMetrics[]): number {
  return metricAt(metrics, run.endIndex).t - metricAt(metrics, run.startIndex).t;
}

/**
 * Evenly spaced indices across the shot, always including the first and last frame.
 * When the shot has no more frames than requested, every frame is representative.
 */
function pickRepresentativeFrames(startIndex: number, endIndex: number, count: number): number[] {
  const frames = endIndex - startIndex + 1;
  if (frames <= count) {
    const all: number[] = [];
    for (let i = startIndex; i <= endIndex; i += 1) all.push(i);
    return all;
  }
  if (count === 1) return [startIndex];

  const picked: number[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(startIndex + Math.round((i * (frames - 1)) / (count - 1)));
  }
  return picked;
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

function metricAt(metrics: FrameMetrics[], index: number): FrameMetrics {
  const metric = metrics[index];
  if (metric === undefined) {
    throw new RangeError(`No frame metrics at index ${index}`);
  }
  return metric;
}

function roundTime(value: number): number {
  const rounded = Math.round(value * TIME_SCALE) / TIME_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function resolveOptions(opts: SegmentOpts): ResolvedOptions {
  const absThreshold = opts.absThreshold ?? DEFAULT_ABS_THRESHOLD;
  if (!Number.isFinite(absThreshold) || absThreshold < 0) {
    throw new RangeError(
      `absThreshold must be a non-negative number, received ${String(opts.absThreshold)}`,
    );
  }

  const medianMultiplier = opts.medianMultiplier ?? DEFAULT_MEDIAN_MULTIPLIER;
  if (!Number.isFinite(medianMultiplier) || medianMultiplier < 0) {
    throw new RangeError(
      `medianMultiplier must be a non-negative number, received ${String(opts.medianMultiplier)}`,
    );
  }

  const minShotSec = opts.minShotSec ?? DEFAULT_MIN_SHOT_SEC;
  if (!Number.isFinite(minShotSec) || minShotSec < 0) {
    throw new RangeError(
      `minShotSec must be a non-negative number, received ${String(opts.minShotSec)}`,
    );
  }

  const representativeCount = opts.representativeCount ?? DEFAULT_REPRESENTATIVE_COUNT;
  if (!Number.isInteger(representativeCount) || representativeCount < 1) {
    throw new RangeError(
      `representativeCount must be a positive integer, received ${String(opts.representativeCount)}`,
    );
  }

  return { absThreshold, medianMultiplier, minShotSec, representativeCount };
}
