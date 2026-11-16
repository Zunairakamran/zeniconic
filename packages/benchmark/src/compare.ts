/**
 * Score a candidate cut against a reference.
 *
 * The weights encode an editorial judgement, stated once here: pace and rhythm
 * are what make an edit feel professional, so they carry half the score; grade
 * comes next; raw motion last. Duration is *not* scored — the brief fixes the
 * candidate at 30 s against a longer reference, so length only feeds the
 * targets, never the penalty.
 */

import type { Comparison, StyleProfile, StyleTargets } from './types';

/** Maximum points each dimension can lose. The weights sum to 100. */
const WEIGHT_PACE = 32;
const WEIGHT_RHYTHM = 23;
const WEIGHT_BRIGHTNESS = 9;
const WEIGHT_CONTRAST = 9;
const WEIGHT_SATURATION = 5;
const WEIGHT_STATIC = 9;
const WEIGHT_MOTION = 13;

/**
 * Pace is asymmetric. Being slower than the reference loses credit quickly:
 * 35% slower or worse gives up the whole pace weight. Being faster is a good
 * thing up to a point, then over-cutting fragments the property tour, so it is
 * only mildly penalised and never beyond 40% of the pace weight.
 */
const PACE_SLOW_RANGE = 0.35;
const PACE_FAST_FREE = 0.25;
const PACE_FAST_RANGE = 0.75;
const PACE_FAST_SHARE = 0.4;

/** A coefficient-of-variation difference this large is a completely different rhythm. */
const RHYTHM_CV_RANGE = 0.6;

/** Mean-luma or std-dev differences this large are a visibly different grade. */
const GRADE_RANGE = 0.25;
const SATURATION_RANGE = 0.3;

/** Half the shots static versus none is the full static penalty. */
const STATIC_RANGE = 0.5;

/** Mean motion differing by 0.15 of the full 0..1 range is a different edit. */
const MOTION_RANGE = 0.15;

/** Half a point of 100: below that the score cannot express the difference. */
const ADVICE_POINTS_FLOOR = 0.5;

const MIN_TARGET_SHOT_SEC = 1.2;
const MAX_TARGET_SHOT_SEC = 4.5;

type PenaltyKey =
  | 'pace'
  | 'rhythm'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'static'
  | 'motion';

interface Penalty {
  key: PenaltyKey;
  points: number;
}

/**
 * Compares two profiles.
 *
 * `deltas` is candidate minus reference. Rate-like dimensions (duration, shot
 * count, cuts per minute, average shot) are relative to the reference, so +0.5
 * means "half as much again"; grades and ratios are already 0..1, so their
 * delta is an absolute difference. `rhythm` is the signed difference in
 * shot-length coefficient of variation.
 */
export function compareProfiles(candidate: StyleProfile, reference: StyleProfile): Comparison {
  const candidateCv = rhythmVariation(candidate.cutRhythm);
  const referenceCv = rhythmVariation(reference.cutRhythm);
  // A single-shot profile has no rhythm to match; its coefficient of variation
  // is undefined, not zero.
  const rhythmComparable = candidate.cutRhythm.length >= 2 && reference.cutRhythm.length >= 2;

  const deltas: Record<string, number> = {
    durationSec: relativeDelta(candidate.durationSec, reference.durationSec),
    shotCount: relativeDelta(candidate.shotCount, reference.shotCount),
    cutsPerMinute: relativeDelta(candidate.cutsPerMinute, reference.cutsPerMinute),
    avgShotSec: relativeDelta(candidate.avgShotSec, reference.avgShotSec),
    brightness: round3(candidate.brightness - reference.brightness),
    contrast: round3(candidate.contrast - reference.contrast),
    saturation: round3(candidate.saturation - reference.saturation),
    motionEnergy: round3(candidate.motionEnergy - reference.motionEnergy),
    staticRatio: round3(candidate.staticRatio - reference.staticRatio),
    rhythm: round3(candidateCv - referenceCv),
  };

  const penalties: Penalty[] = [
    { key: 'pace', points: pacePenalty(candidate, reference) },
    { key: 'rhythm', points: rhythmComparable ? rhythmPenalty(candidateCv, referenceCv) : 0 },
    {
      key: 'brightness',
      points: WEIGHT_BRIGHTNESS * scaledDistance(candidate.brightness, reference.brightness, GRADE_RANGE),
    },
    {
      key: 'contrast',
      points: WEIGHT_CONTRAST * scaledDistance(candidate.contrast, reference.contrast, GRADE_RANGE),
    },
    {
      key: 'saturation',
      points:
        WEIGHT_SATURATION * scaledDistance(candidate.saturation, reference.saturation, SATURATION_RANGE),
    },
    {
      key: 'static',
      points: WEIGHT_STATIC * scaledDistance(candidate.staticRatio, reference.staticRatio, STATIC_RANGE),
    },
    {
      key: 'motion',
      points: WEIGHT_MOTION * scaledDistance(candidate.motionEnergy, reference.motionEnergy, MOTION_RANGE),
    },
  ];

  const lost = penalties.reduce((sum, penalty) => sum + penalty.points, 0);
  const score = round1(clamp(100 - lost, 0, 100));

  return {
    score,
    deltas,
    strengths: buildStrengths(candidate, reference, candidateCv, referenceCv),
    weaknesses: buildWeaknesses(candidate, reference, candidateCv, referenceCv),
    advice: buildAdvice(candidate, reference, penalties),
  };
}

/**
 * Shot budgets for a cut of `targetDurationSec` using the reference's own
 * proportions. Shot lengths scale with the runtime: a 60 s reference paced at
 * 2 s per shot asks for 1 s shots in a 30 s cut, lifted to the 1.2 s floor.
 * Scaling rather than dropping shots is what makes the shorter cut beat the
 * reference on cut pace instead of merely copying it.
 *
 * Shot lengths are clamped to 1.2–4.5 s: below 1.2 s a room never registers,
 * above 4.5 s the tour drags. The shot count is chosen so
 * `targetDurationSec / shotCount` itself lands inside the clamp, not just the
 * pre-rounded average.
 */
export function targetsFromReference(
  reference: StyleProfile,
  targetDurationSec: number,
): StyleTargets {
  if (!Number.isFinite(targetDurationSec) || targetDurationSec <= 0) {
    throw new RangeError(`targetDurationSec must be positive, received ${targetDurationSec}.`);
  }

  const referenceDuration = Math.max(reference.durationSec, 0.001);
  const ratio = targetDurationSec / referenceDuration;
  const referenceShotSec =
    reference.avgShotSec > 0
      ? reference.avgShotSec
      : referenceDuration / Math.max(reference.shotCount, 1);
  const wantedAverage = clamp(referenceShotSec * ratio, MIN_TARGET_SHOT_SEC, MAX_TARGET_SHOT_SEC);

  const mostShots = Math.max(1, Math.floor(targetDurationSec / MIN_TARGET_SHOT_SEC));
  const fewestShots = Math.max(1, Math.ceil(targetDurationSec / MAX_TARGET_SHOT_SEC));
  let shotCount = Math.max(1, Math.round(targetDurationSec / wantedAverage));
  shotCount = Math.min(shotCount, mostShots);
  shotCount = Math.max(shotCount, fewestShots);

  const avgShotSec = round3(targetDurationSec / shotCount);
  const minShotSec = round3(
    Math.min(avgShotSec, clamp(reference.minShotSec * ratio, MIN_TARGET_SHOT_SEC, MAX_TARGET_SHOT_SEC)),
  );
  const maxShotSec = round3(
    Math.max(avgShotSec, clamp(reference.maxShotSec * ratio, MIN_TARGET_SHOT_SEC, MAX_TARGET_SHOT_SEC)),
  );

  return {
    shotCount,
    avgShotSec,
    cutsPerMinute: round3(shotCount < 2 ? 0 : ((shotCount - 1) / targetDurationSec) * 60),
    minShotSec,
    maxShotSec,
  };
}

function pacePenalty(candidate: StyleProfile, reference: StyleProfile): number {
  // A reference with no cuts has no pace to match; a candidate with none is not
  // "slower", it is a different format.
  if (reference.cutsPerMinute <= 0) return 0;

  const difference = (candidate.cutsPerMinute - reference.cutsPerMinute) / reference.cutsPerMinute;
  if (difference < 0) {
    return WEIGHT_PACE * clamp01(-difference / PACE_SLOW_RANGE);
  }
  if (difference <= PACE_FAST_FREE) return 0;
  return WEIGHT_PACE * PACE_FAST_SHARE * clamp01((difference - PACE_FAST_FREE) / PACE_FAST_RANGE);
}

function rhythmPenalty(candidateCv: number, referenceCv: number): number {
  return WEIGHT_RHYTHM * clamp01(Math.abs(candidateCv - referenceCv) / RHYTHM_CV_RANGE);
}

/**
 * Strengths and weaknesses are reporting filters, not score inputs. The gaps
 * here are the smallest a viewer would name: 15% on pace, 0.1 on rhythm, 0.15
 * on static share, 0.1 luma or contrast, a fifth more or less motion (with a
 * 0.01 absolute floor so a near-still reference does not produce noise). The
 * score uses its own, tighter ranges above.
 */
function buildStrengths(
  candidate: StyleProfile,
  reference: StyleProfile,
  candidateCv: number,
  referenceCv: number,
): string[] {
  const strengths: string[] = [];
  const paceRatio = reference.cutsPerMinute > 0 ? candidate.cutsPerMinute / reference.cutsPerMinute : 1;

  if (paceRatio >= 1.15) {
    strengths.push(
      `Cuts ${percent(paceRatio - 1)} faster than the reference (${format1(candidate.cutsPerMinute)} against ${format1(reference.cutsPerMinute)} cuts per minute).`,
    );
  }
  if (candidateCv >= referenceCv + 0.1) {
    strengths.push(
      `More varied shot lengths than the reference (CV ${format2(candidateCv)} against ${format2(referenceCv)}).`,
    );
  }
  if (candidate.staticRatio <= reference.staticRatio - 0.1) {
    strengths.push(
      `${percent(reference.staticRatio - candidate.staticRatio)} fewer static shots than the reference.`,
    );
  }
  if (
    candidate.motionEnergy >= reference.motionEnergy * 1.2 &&
    candidate.motionEnergy - reference.motionEnergy > 0.01
  ) {
    strengths.push(
      `More movement in frame (${format2(candidate.motionEnergy)} against ${format2(reference.motionEnergy)} motion energy).`,
    );
  }

  return strengths.slice(0, 3);
}

function buildWeaknesses(
  candidate: StyleProfile,
  reference: StyleProfile,
  candidateCv: number,
  referenceCv: number,
): string[] {
  const weaknesses: string[] = [];
  const paceRatio = reference.cutsPerMinute > 0 ? candidate.cutsPerMinute / reference.cutsPerMinute : 1;

  if (paceRatio <= 0.85) {
    weaknesses.push(
      `Slower cuts than the reference: ${format1(candidate.cutsPerMinute)} against ${format1(reference.cutsPerMinute)} per minute.`,
    );
  }
  if (candidateCv <= referenceCv - 0.1) {
    weaknesses.push(
      `Flatter rhythm than the reference: shot lengths vary by CV ${format2(candidateCv)} against ${format2(referenceCv)}.`,
    );
  }
  if (Math.abs(candidate.brightness - reference.brightness) > 0.1) {
    weaknesses.push(
      `${candidate.brightness < reference.brightness ? 'Darker' : 'Brighter'} grade than the reference by ${format2(Math.abs(candidate.brightness - reference.brightness))} mean luma.`,
    );
  }
  if (Math.abs(candidate.contrast - reference.contrast) > 0.1) {
    weaknesses.push(
      `${candidate.contrast < reference.contrast ? 'Flatter' : 'Punchier'} contrast than the reference by ${format2(Math.abs(candidate.contrast - reference.contrast))}.`,
    );
  }
  if (candidate.staticRatio >= reference.staticRatio + 0.15) {
    weaknesses.push(
      `More static shots than the reference: ${percent(candidate.staticRatio)} against ${percent(reference.staticRatio)}.`,
    );
  }
  if (candidate.motionEnergy <= reference.motionEnergy * 0.8 && reference.motionEnergy - candidate.motionEnergy > 0.01) {
    weaknesses.push(
      `Less movement in frame: ${format2(candidate.motionEnergy)} against ${format2(reference.motionEnergy)} motion energy.`,
    );
  }

  return weaknesses.slice(0, 3);
}

/**
 * At most four lines, ordered by how many points each dimension is losing, so
 * the planner fixes the biggest gap first. Every line names a number to hit and
 * the reference value it comes from.
 */
function buildAdvice(
  candidate: StyleProfile,
  reference: StyleProfile,
  penalties: readonly Penalty[],
): string[] {
  const targets = targetsFromReference(reference, Math.max(candidate.durationSec, 1));
  const ranked = [...penalties].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const advice: string[] = [];
  for (const penalty of ranked) {
    if (advice.length >= 4) break;
    if (penalty.points < ADVICE_POINTS_FLOOR) continue;
    advice.push(adviceFor(penalty.key, candidate, reference, targets));
  }
  return advice;
}

function adviceFor(
  key: PenaltyKey,
  candidate: StyleProfile,
  reference: StyleProfile,
  targets: StyleTargets,
): string {
  switch (key) {
    case 'pace':
      return candidate.cutsPerMinute < reference.cutsPerMinute
        ? `Target ${format1(targets.avgShotSec)} s per shot; the reference averages ${format1(reference.avgShotSec)} s and the candidate ${format1(candidate.avgShotSec)} s.`
        : `Hold the pace near ${format1(targets.avgShotSec)} s per shot; the reference averages ${format1(reference.avgShotSec)} s and the candidate ${format1(candidate.avgShotSec)} s.`;
    case 'rhythm':
      return rhythmVariation(candidate.cutRhythm) < rhythmVariation(reference.cutRhythm)
        ? `Vary shot lengths more: aim for CV ${format2(rhythmVariation(reference.cutRhythm))}, the candidate sits at ${format2(rhythmVariation(candidate.cutRhythm))}.`
        : `Even out the cut rhythm: aim for CV ${format2(rhythmVariation(reference.cutRhythm))}, the candidate sits at ${format2(rhythmVariation(candidate.cutRhythm))}.`;
    case 'brightness':
      return `Bring brightness ${candidate.brightness < reference.brightness ? 'up' : 'down'} ${format2(Math.abs(candidate.brightness - reference.brightness))} toward the reference's ${format2(reference.brightness)}.`;
    case 'contrast':
      return `${candidate.contrast < reference.contrast ? 'Raise' : 'Lower'} contrast ${format2(Math.abs(candidate.contrast - reference.contrast))} toward the reference's ${format2(reference.contrast)}.`;
    case 'saturation':
      return `${candidate.saturation < reference.saturation ? 'Raise' : 'Lower'} saturation ${format2(Math.abs(candidate.saturation - reference.saturation))} toward the reference's ${format2(reference.saturation)}.`;
    case 'static':
      return candidate.staticRatio > reference.staticRatio
        ? `Cut static shots from ${percent(candidate.staticRatio)} to about ${percent(reference.staticRatio)} of the edit; prefer moving takes or add a slow push.`
        : `Add a few held shots: the candidate is ${percent(candidate.staticRatio)} static against ${percent(reference.staticRatio)} in the reference.`;
    case 'motion':
      return candidate.motionEnergy < reference.motionEnergy
        ? `Raise motion energy from ${format2(candidate.motionEnergy)} to about ${format2(reference.motionEnergy)}; prefer takes with a push, pan or walk-through.`
        : `Calm the motion from ${format2(candidate.motionEnergy)} to about ${format2(reference.motionEnergy)}; hold the camera stiller between moves.`;
  }
}

/**
 * Coefficient of variation of the shot durations: standard deviation over mean.
 * It is scale-free, so a 30 s cut and a 60 s reference can be compared even
 * though their shot durations differ.
 */
function rhythmVariation(rhythm: readonly number[]): number {
  if (rhythm.length < 2) return 0;

  let sum = 0;
  for (const value of rhythm) sum += value;
  const mean = sum / rhythm.length;
  if (mean <= 0) return 0;

  let squares = 0;
  for (const value of rhythm) {
    const delta = value - mean;
    squares += delta * delta;
  }

  return Math.sqrt(squares / rhythm.length) / mean;
}

function relativeDelta(candidate: number, reference: number): number {
  // A zero reference rate has no ratio to normalise against; the raw difference
  // is the only honest value (for example 20 cuts per minute against a
  // single-shot reference is +20, not +20,000).
  if (Math.abs(reference) < 0.001) return round3(candidate - reference);
  return round3((candidate - reference) / Math.abs(reference));
}

/** Distance capped at `range`, expressed as 0..1 for the weight to multiply. */
function scaledDistance(candidate: number, reference: number, range: number): number {
  return clamp01(Math.abs(candidate - reference) / range);
}

function percent(fraction: number): string {
  return `${Math.round(Math.abs(fraction) * 100)}%`;
}

function format1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function format2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  if (value <= low) return low;
  if (value >= high) return high;
  return value;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
