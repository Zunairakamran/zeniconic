/**
 * The measurable shape of one edit.
 *
 * A profile is deliberately small and JSON-safe: it is what the benchmark
 * stores, prints and compares, so a review of "did we beat the reference?" is
 * a comparison of numbers rather than an opinion.
 */
export interface StyleProfile {
  /** Container duration from ffprobe, 3 dp. */
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  orientation: 'portrait' | 'landscape' | 'square';

  shotCount: number;
  /** Mean of the kept shot durations; shots below 0.4 s are ignored. */
  avgShotSec: number;
  medianShotSec: number;
  minShotSec: number;
  maxShotSec: number;
  /** Cuts per minute: `(shotCount - 1) / durationSec * 60`, 3 dp. */
  cutsPerMinute: number;
  /** Shot durations in playback order, in seconds. */
  cutRhythm: number[];

  /** Mean of frame mean luma, 0..1. */
  brightness: number;
  /** Mean of per-frame luma standard deviation, 0..1. */
  contrast: number;
  /** Mean HSV saturation, 0..1. Zero when the decoder yields no colour. */
  saturation: number;
  /** Mean frame-to-frame luma change, 0..1. */
  motionEnergy: number;
  /** Fraction of shots whose mean motion energy is below 0.05. */
  staticRatio: number;
}

/**
 * Candidate versus reference. `score` is 0..100 where 100 means the candidate
 * matches every dimension the scorer weights; `deltas` is candidate minus
 * reference with each dimension normalised (see compareProfiles).
 */
export interface Comparison {
  score: number;
  deltas: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  /** At most four concrete planner adjustments. */
  advice: string[];
}

/** Shot-level budgets for a cut of a given length, derived from a reference. */
export interface StyleTargets {
  shotCount: number;
  avgShotSec: number;
  cutsPerMinute: number;
  minShotSec: number;
  maxShotSec: number;
}
