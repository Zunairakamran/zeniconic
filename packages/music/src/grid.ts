const SECONDS_PER_MINUTE = 60;
const TIME_SCALE = 1000;
const EPS = 1e-9;

/** Seconds to 3 dp, normalising `-0` to `0`. */
export function roundSec(value: number): number {
  const rounded = Math.round(value * TIME_SCALE) / TIME_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${String(value)}`);
  }
}

/**
 * Beat onsets at `60 / bpm`, starting at `offsetSec` and staying strictly
 * inside the track. A beat landing exactly on `durationSec` is the loop point,
 * not an onset, so it is excluded. Every time is rounded to 3 dp first, which
 * is also what the EDL stores.
 */
export function beatGridFromBpm(bpm: number, durationSec: number, offsetSec = 0): number[] {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`bpm must be a positive finite number, received ${String(bpm)}`);
  }
  if (!Number.isFinite(durationSec) || durationSec < 0) {
    throw new RangeError(
      `durationSec must be a non-negative finite number, received ${String(durationSec)}`,
    );
  }
  if (!Number.isFinite(offsetSec) || offsetSec < 0) {
    throw new RangeError(
      `offsetSec must be a non-negative finite number, received ${String(offsetSec)}`,
    );
  }
  if (offsetSec >= durationSec) return [];

  const interval = SECONDS_PER_MINUTE / bpm;
  const lastIndex = Math.floor((durationSec - offsetSec) / interval + EPS);
  const beats: number[] = [];

  for (let index = 0; index <= lastIndex; index += 1) {
    const beat = roundSec(offsetSec + index * interval);
    if (beat >= durationSec) break;
    beats.push(beat);
  }

  return beats;
}

/** Every fourth beat is a downbeat; the first onset is a downbeat. */
export function downbeats(beats: readonly number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < beats.length; index += 4) {
    const beat = beats[index];
    if (beat !== undefined) out.push(beat);
  }
  return out;
}

/**
 * Nearest beat within `toleranceSec`, preferring the earlier beat on a tie.
 * `floorSec` rejects beats that would make the previous shot too short.
 */
function nearestBeat(
  time: number,
  beats: readonly number[],
  toleranceSec: number,
  floorSec: number,
): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;

  for (const beat of beats) {
    if (!Number.isFinite(beat)) continue;
    if (beat + EPS < floorSec) continue;

    const distance = Math.abs(beat - time);
    if (distance > toleranceSec + EPS) continue;

    const earlier = best !== undefined && beat < best;
    if (distance < bestDistance - EPS || (Math.abs(distance - bestDistance) <= EPS && earlier)) {
      best = beat;
      bestDistance = distance;
    }
  }

  return best;
}

function snap(
  cuts: readonly number[],
  beats: readonly number[],
  toleranceSec: number,
  minShotSec: number | undefined,
): number[] {
  assertFinite(toleranceSec, 'toleranceSec');
  if (toleranceSec < 0) {
    throw new RangeError(`toleranceSec must not be negative, received ${toleranceSec}`);
  }
  if (minShotSec !== undefined) {
    assertFinite(minShotSec, 'minShotSec');
    if (minShotSec < 0) {
      throw new RangeError(`minShotSec must not be negative, received ${minShotSec}`);
    }
  }

  const out: number[] = [];
  const seen = new Set<number>();
  let previous: number | undefined;

  for (const cut of cuts) {
    assertFinite(cut, 'cut');

    const floor = minShotSec === undefined || previous === undefined ? 0 : previous + minShotSec;

    // Two cuts aimed at the same beat are one boundary. Check this before the
    // floor clamp, otherwise the second copy would be pushed to the floor and
    // survive as a separate cut.
    const duplicate = nearestBeat(cut, beats, toleranceSec, 0);
    if (duplicate !== undefined && seen.has(roundSec(duplicate))) continue;

    const beat = nearestBeat(cut, beats, toleranceSec, floor);
    let snapped = roundSec(beat ?? cut);
    if (seen.has(snapped)) continue;

    // A previous snap can move the floor past this cut even when the source
    // cuts were legal. Hold the minimum shot rather than create a 0.4 s flash.
    if (minShotSec !== undefined && snapped + EPS < floor) snapped = roundSec(floor);

    if (seen.has(snapped)) continue;
    seen.add(snapped);
    out.push(snapped);
    previous = snapped;
  }

  return out;
}

/**
 * Moves each cut to the nearest beat inside the tolerance. Cuts keep their
 * input order, and cuts that land on the same beat collapse to one.
 */
export function snapCuts(cuts: number[], beats: number[], toleranceSec: number): number[] {
  return snap(cuts, beats, toleranceSec, undefined);
}

/**
 * Beat snapping with a minimum shot length. A cut may never snap to a beat
 * earlier than `previous + minShotSec`; when no legal beat is close enough the
 * cut stays where it is, and if a previous snap pushed the floor past it, the
 * cut is held at the floor so the shot cannot collapse.
 */
export function snapCutWithFloor(
  cuts: number[],
  beats: number[],
  toleranceSec: number,
  minShotSec: number,
): number[] {
  return snap(cuts, beats, toleranceSec, minShotSec);
}
