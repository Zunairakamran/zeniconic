import type { Clip } from '../../edl/src/index';
import type { BeatSnapRationale } from './types';
import { clipTimelineSec, roundSource, roundTime } from './timeline';

function nearestBeat(boundarySec: number, beats: readonly number[]): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const beat of beats) {
    if (!Number.isFinite(beat)) continue;
    const distance = Math.abs(beat - boundarySec);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = beat;
    }
  }
  return best;
}

/**
 * Pulls a cut earlier onto a nearby beat by trimming the outgoing clip and
 * extending the incoming clip by the equivalent source amount. The two moves
 * cancel, so the film keeps its exact runtime. A later beat is refused: moving
 * a cut later would need source past the outgoing clip's known out point.
 */
export function snapCutBoundaries(
  clips: readonly Clip[],
  beatsInput: readonly number[],
  toleranceSec: number,
  minClipSec: number,
): BeatSnapRationale[] {
  const beats = beatsInput.filter((beat) => Number.isFinite(beat)).sort((a, b) => a - b);
  const moves: BeatSnapRationale[] = [];
  if (beats.length === 0 || clips.length < 2) return moves;

  let start = 0;
  for (let index = 0; index + 1 < clips.length; index += 1) {
    const previous = clips[index];
    const next = clips[index + 1];
    if (previous === undefined || next === undefined) break;

    const previousDuration = clipTimelineSec(previous);
    const boundary = start + previousDuration;
    const beat = nearestBeat(boundary, beats);
    start = boundary;

    if (beat === undefined || Math.abs(beat - boundary) > toleranceSec + 1e-9) continue;
    const delta = boundary - beat;

    if (Math.abs(delta) <= 1e-6) {
      moves.push({
        fromSec: roundTime(boundary),
        toSec: roundTime(beat),
        deltaSec: 0,
        applied: true,
        reason: 'cut already sits on the beat',
      });
      continue;
    }

    if (delta < 0) {
      moves.push({
        fromSec: roundTime(boundary),
        toSec: roundTime(beat),
        deltaSec: roundTime(delta),
        applied: false,
        reason: 'beat is later; moving the cut later would need picture past the known out point',
      });
      continue;
    }

    if (previous.speedRamp !== undefined || next.speedRamp !== undefined) {
      moves.push({
        fromSec: roundTime(boundary),
        toSec: roundTime(beat),
        deltaSec: roundTime(delta),
        applied: false,
        reason: 'a speed ramp owns this clip’s timing; the cut is left alone',
      });
      continue;
    }

    if (
      previous.sourceId === next.sourceId &&
      previous.src === next.src &&
      previous.speed !== next.speed
    ) {
      moves.push({
        fromSec: roundTime(boundary),
        toSec: roundTime(beat),
        deltaSec: roundTime(delta),
        applied: false,
        reason: 'adjacent cuts from one source at different speeds would open a gap',
      });
      continue;
    }

    const previousSourceDelta = delta * previous.speed;
    const nextSourceDelta = delta * next.speed;
    const newOut = roundSource(previous.outSec - previousSourceDelta);
    const newIn = roundSource(next.inSec - nextSourceDelta);
    const newPreviousDuration = (newOut - previous.inSec) / previous.speed;

    if (newIn < -1e-9) {
      moves.push({
        fromSec: roundTime(boundary),
        toSec: roundTime(beat),
        deltaSec: roundTime(delta),
        applied: false,
        reason: 'the incoming clip has no source before its in point',
      });
      continue;
    }

    if (!(newPreviousDuration >= minClipSec)) {
      moves.push({
        fromSec: roundTime(boundary),
        toSec: roundTime(beat),
        deltaSec: roundTime(delta),
        applied: false,
        reason: `the outgoing clip would fall under ${minClipSec}s`,
      });
      continue;
    }

    previous.outSec = newOut;
    next.inSec = Math.max(0, newIn);
    start = roundTime(beat);
    moves.push({
      fromSec: roundTime(boundary),
      toSec: roundTime(beat),
      deltaSec: roundTime(delta),
      applied: true,
      reason: 'trimmed the outgoing clip and extended the incoming one; runtime unchanged',
    });
  }

  return moves;
}
