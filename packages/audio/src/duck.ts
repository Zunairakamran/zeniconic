/**
 * Deterministic music-ducking envelope.
 *
 * The envelope is built from the EDL's voice clip times, not from a detector:
 * the bed must already be down before the first consonant, and a causal
 * compressor cannot lead an onset. `amultiply` applies these points; the
 * renderer may cache them because the function is pure.
 *
 * Defaults: 200 ms pre-roll, 120 ms attack, 400 ms release, −18 dB under the
 * voice. The attack completes 80 ms before the first word, which is the point
 * of the pre-roll.
 */

import { assertFiniteNumber, roundTo } from './format';

export interface VoiceRange {
  startSec: number;
  endSec: number;
}

export interface DuckEnvelopeOptions {
  preRollMs?: number;
  attackMs?: number;
  releaseMs?: number;
  duckDb?: number;
}

export interface DuckPoint {
  t: number;
  gainDb: number;
}

const DEFAULT_PRE_ROLL_MS = 200;
const DEFAULT_ATTACK_MS = 120;
const DEFAULT_RELEASE_MS = 400;
const DEFAULT_DUCK_DB = -18;

/** Times land in the EDL at 3 decimals; gains at 2. */
const TIME_DECIMALS = 3;
const GAIN_DECIMALS = 2;

export function buildDuckEnvelope(
  ranges: VoiceRange[],
  opts: DuckEnvelopeOptions = {},
): DuckPoint[] {
  const preRollMs = opts.preRollMs ?? DEFAULT_PRE_ROLL_MS;
  const attackMs = opts.attackMs ?? DEFAULT_ATTACK_MS;
  const releaseMs = opts.releaseMs ?? DEFAULT_RELEASE_MS;
  const duckDb = opts.duckDb ?? DEFAULT_DUCK_DB;

  assertMilliseconds('preRollMs', preRollMs);
  assertMilliseconds('attackMs', attackMs);
  assertMilliseconds('releaseMs', releaseMs);
  assertFiniteNumber('duckDb', duckDb);
  if (duckDb > 0) {
    throw new RangeError(`duckDb must be zero or negative, received ${duckDb}.`);
  }

  const preRollSec = preRollMs / 1000;
  const attackSec = attackMs / 1000;
  const releaseSec = releaseMs / 1000;

  // A release tail and the next pre-roll overlap when the gap is shorter than
  // their sum. The reference merges gaps under 400 ms; adding the 200 ms
  // pre-roll gives the overlap-safe threshold. Merging stops the bed popping
  // back up between short sentences.
  const mergeGapSec = preRollSec + releaseSec;
  const merged = mergeRanges(normaliseRanges(ranges), mergeGapSec);

  const points: DuckPoint[] = [{ t: 0, gainDb: 0 }];
  const push = (time: number, gainDb: number): void => {
    const t = roundTo(Math.max(0, time), TIME_DECIMALS);
    const last = points[points.length - 1];
    // Duplicate timestamps are not points; keep the first value so the
    // envelope always starts at 0 s / 0 dB.
    if (last !== undefined && t <= last.t) return;
    points.push({ t, gainDb: roundTo(gainDb, GAIN_DECIMALS) });
  };

  for (const range of merged) {
    const leadAt = Math.max(0, range.startSec - preRollSec);
    // The ramp starts at the pre-roll point and is complete before the word.
    const duckAt = Math.min(range.endSec, leadAt + attackSec);
    const releaseAt = range.endSec + releaseSec;

    if (attackSec === 0) {
      // A zero-length attack is a step, so the lead point already carries the
      // ducked gain; two points at the same timestamp are not allowed.
      push(leadAt, duckDb);
    } else {
      push(leadAt, 0);
      push(duckAt, duckDb);
    }
    push(range.endSec, duckDb);
    push(releaseAt, 0);
  }

  return points;
}

function assertMilliseconds(name: string, value: number): void {
  assertFiniteNumber(name, value);
  if (value < 0) {
    throw new RangeError(`${name} must be zero or positive, received ${value}.`);
  }
}

function normaliseRanges(ranges: VoiceRange[]): VoiceRange[] {
  return ranges.map((range, index) => {
    assertFiniteNumber(`ranges[${index}].startSec`, range.startSec);
    assertFiniteNumber(`ranges[${index}].endSec`, range.endSec);
    if (range.startSec < 0) {
      throw new RangeError(
        `ranges[${index}].startSec must be zero or positive, received ${range.startSec}.`,
      );
    }
    if (range.endSec <= range.startSec) {
      throw new RangeError(
        `ranges[${index}].endSec (${range.endSec}) must be greater than startSec (${range.startSec}).`,
      );
    }
    return { startSec: range.startSec, endSec: range.endSec };
  });
}

function mergeRanges(ranges: VoiceRange[], mergeGapSec: number): VoiceRange[] {
  const sorted = [...ranges].sort(
    (a, b) => a.startSec - b.startSec || a.endSec - b.endSec,
  );
  const merged: VoiceRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.startSec - last.endSec <= mergeGapSec + 1e-9) {
      if (range.endSec > last.endSec) last.endSec = range.endSec;
      continue;
    }
    merged.push({ startSec: range.startSec, endSec: range.endSec });
  }

  return merged;
}
