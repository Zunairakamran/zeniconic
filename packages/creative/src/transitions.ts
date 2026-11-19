import type { Clip, Transition, TransitionType } from '../../edl/src/index';
import type { ClipPurpose, TransitionRationale } from './types';
import { roomOf } from './classify';
import { clipTimelineSec, roundTime } from './timeline';

export interface BoundaryInput {
  clips: readonly Clip[];
  purposes: readonly ClipPurpose[];
  beatGrid: readonly number[];
  beatToleranceSec: number;
  addTransitions: boolean;
  borrowHandles: boolean;
  maxTransitionRatio: number;
  preserveExisting: boolean;
  /** Timeline starts of price/CTA overlays: the one graphic beat. */
  priceBoundaries: readonly number[];
}

const CUT: Transition = { type: 'cut', durationSec: 0 };
const MIN_TRANSITION_SEC = 0.18;
const MAX_TRANSITION_SEC = 0.5;

function nearestBeat(atSec: number, beats: readonly number[]): { beatSec?: number; onBeat: boolean } {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const beat of beats) {
    if (!Number.isFinite(beat)) continue;
    const distance = Math.abs(beat - atSec);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = beat;
    }
  }
  if (best === undefined) return { onBeat: false };
  return { beatSec: roundTime(best), onBeat: bestDistance <= 1e-6 };
}

function nearBeat(atSec: number, beats: readonly number[], toleranceSec: number): boolean {
  return beats.some((beat) => Number.isFinite(beat) && Math.abs(beat - atSec) <= toleranceSec + 1e-9);
}

function resolveType(candidates: readonly TransitionType[]): TransitionType {
  return candidates[0] ?? 'cut';
}

function baseDuration(type: TransitionType): number {
  switch (type) {
    case 'whip':
      return 0.2;
    case 'zoom_blur':
      return 0.26;
    case 'dissolve':
      return 0.36;
    case 'luma_wipe':
      return 0.3;
    case 'dip_black':
      return 0.42;
    case 'light_leak':
      return 0.28;
    case 'push_left':
    case 'push_right':
      return 0.3;
    default:
      return 0.25;
  }
}

function fitDuration(type: TransitionType, prevDur: number, nextDur: number): number | undefined {
  const room = Math.min(prevDur, nextDur) - 0.02;
  const maximum = Math.min(MAX_TRANSITION_SEC, room);
  if (maximum < MIN_TRANSITION_SEC) return undefined;
  const wanted = baseDuration(type);
  return roundTime(Math.min(maximum, Math.max(MIN_TRANSITION_SEC, wanted)));
}

function sameRoom(previous: Clip, next: Clip): boolean {
  return roomOf(previous) === roomOf(next);
}

interface Candidate {
  index: number;
  atSec: number;
  type: TransitionType;
  durationSec: number;
  priority: number;
  reason: string;
  beatSec?: number;
  onBeat: boolean;
  forced: boolean;
}

function reasonFor(
  type: TransitionType,
  prevPurpose: ClipPurpose,
  nextPurpose: ClipPurpose,
  kind: string,
): string {
  if (kind === 'hook') return `hard beat out of the hook (${type}): resets the eye before the middle`;
  if (kind === 'close') return `${type} into the close: lets the film settle instead of stopping`;
  if (kind === 'price') return `${type} into the price/CTA window: the one graphic beat`;
  if (kind === 'rest') return `${type} from ${prevPurpose} into rest: the tempo drops`;
  if (kind === 'climax') return `${type} at the midpoint lift: the hardest cut in the film`;
  if (kind === 'craft') return `${type} into the craft beat: marks the turn from space to detail`;
  if (kind === 'existing') return `${type} kept from the marketing beat sheet so the price/CTA windows stay on their cuts`;
  return `${type} at a meaningful purpose change (${prevPurpose} → ${nextPurpose})`;
}

function cutReason(previous: Clip, next: Clip, index: number, lastIndex: number): string {
  if (index === lastIndex) return 'end of film; no outgoing transition';
  if (sameRoom(previous, next)) return 'hard cut inside the same room keeps the energy up';
  if (clipTimelineSec(previous) < 1 || clipTimelineSec(next) < 1) {
    return 'hard cut for the fast beat; a transition would not fit';
  }
  return 'hard cut; this boundary does not carry an emotional shift';
}

/**
 * Places non-cut transitions only at boundaries that earn one, then mirrors
 * each decision onto both neighbours (`transitionIn` is the renderer's source
 * of truth; `transitionOut` is the documented mirror).
 */
export function assignTransitions(input: BoundaryInput): {
  boundary: TransitionRationale[];
  last: TransitionRationale;
} {
  const { clips, purposes, beatGrid, beatToleranceSec } = input;
  const beats = beatGrid.filter((beat) => Number.isFinite(beat)).sort((a, b) => a - b);
  const durations = clips.map((clip) => clipTimelineSec(clip));
  const starts: number[] = [];
  let cursor = 0;
  for (const duration of durations) {
    starts.push(cursor);
    cursor += duration;
  }
  const total = cursor;
  if (clips.length === 0) {
    const fallback: TransitionRationale = {
      atSec: 0,
      fromClipId: '',
      toClipId: '',
      type: 'cut',
      durationSec: 0,
      reason: 'no clips',
    };
    return { boundary: [], last: fallback };
  }

  const candidates: Candidate[] = [];
  let existingCount = 0;

  // The midpoint lift: the boundary closest to 68% through the film, but never
  // the hook out or the close in.
  let climaxIndex = -1;
  let climaxDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < clips.length; index += 1) {
    const atSec = starts[index + 1] ?? 0;
    const nextPurpose = purposes[index + 1];
    const prevPurpose = purposes[index];
    if (prevPurpose === 'hook' || nextPurpose === 'close' || nextPurpose === 'rest') continue;
    const distance = Math.abs(atSec - total * 0.68);
    if (distance < climaxDistance) {
      climaxDistance = distance;
      climaxIndex = index;
    }
  }

  for (let index = 0; index + 1 < clips.length; index += 1) {
    const previous = clips[index];
    const next = clips[index + 1];
    if (previous === undefined || next === undefined) continue;
    const atSec = roundTime(starts[index + 1] ?? 0);
    const prevPurpose = purposes[index] ?? 'space';
    const nextPurpose = purposes[index + 1] ?? 'space';
    const beat = nearestBeat(atSec, beats);
    const onBeat = beats.length === 0 ? true : nearBeat(atSec, beats, beatToleranceSec);
    const prevDur = durations[index] ?? 0;
    const nextDur = durations[index + 1] ?? 0;

    if (!input.addTransitions) continue;

    // Marketing keeps the transitions the beat sheet already put down.
    if (input.preserveExisting) {
      const incoming = next.transitionIn;
      const outgoing = previous.transitionOut;
      const existing =
        incoming !== undefined && incoming.type !== 'cut'
          ? incoming
          : outgoing !== undefined && outgoing.type !== 'cut'
            ? outgoing
            : undefined;
      // A dissolve between two shots of the same room ghosts one over the
      // other. Keep the beat-sheet timing but make that boundary a cut.
      if (existing !== undefined && !(sameRoom(previous, next) && existing.type === 'dissolve')) {
        const durationSec = roundTime(Math.min(existing.durationSec, Math.min(prevDur, nextDur) - 0.02));
        const handle = previous.handleOutSec ?? 0;
        const fitsHandle = input.borrowHandles || handle + 1e-9 >= durationSec;
        if (durationSec >= MIN_TRANSITION_SEC && fitsHandle) {
          existingCount += 1;
          candidates.push({
            index,
            atSec,
            type: existing.type,
            durationSec,
            priority: 1000,
            reason: reasonFor(existing.type, prevPurpose, nextPurpose, 'existing'),
            beatSec: beat.beatSec,
            onBeat,
            forced: true,
          });
        }
        continue;
      }
    }

    if (sameRoom(previous, next) && prevPurpose !== 'hook' && nextPurpose !== 'close') continue;

    const priceNear = input.priceBoundaries.some(
      (boundary) => Math.abs(boundary - atSec) <= 0.12,
    );
    let type: TransitionType = 'cut';
    let priority = 0;
    let kind = '';

    if (prevPurpose === 'hook') {
      type = resolveType(['whip', 'zoom_blur', 'dissolve']);
      priority = 100;
      kind = 'hook';
    } else if (nextPurpose === 'close') {
      type = resolveType(['dissolve', 'dip_black']);
      priority = 90;
      kind = 'close';
    } else if (priceNear) {
      type = resolveType(['luma_wipe', 'dissolve']);
      priority = 85;
      kind = 'price';
    } else if (nextPurpose === 'rest' && prevPurpose !== 'rest') {
      type = resolveType(['dissolve']);
      priority = 70;
      kind = 'rest';
    } else if (index === climaxIndex) {
      type = resolveType(['zoom_blur', 'whip']);
      priority = 60;
      kind = 'climax';
    } else if (
      nextPurpose === 'craft' &&
      (prevPurpose === 'space' || prevPurpose === 'establishing' || prevPurpose === 'lifestyle')
    ) {
      type = resolveType(['zoom_blur']);
      priority = 55;
      kind = 'craft';
    }

    if (type === 'cut') continue;

    // With a grid, a transition lives on a beat. Hook/close/price are strong
    // enough to survive an off-beat boundary after snapping has had its go.
    if (beats.length > 0 && !onBeat && priority < 85) continue;

    const durationSec = fitDuration(type, prevDur, nextDur);
    if (durationSec === undefined) continue;
    if (!input.borrowHandles) {
      const handle = previous.handleOutSec ?? 0;
      if (handle + 1e-9 < durationSec) continue;
    }

    candidates.push({
      index,
      atSec,
      type,
      durationSec,
      priority,
      reason: reasonFor(type, prevPurpose, nextPurpose, kind),
      beatSec: beat.beatSec,
      onBeat,
      forced: false,
    });
  }

  const ratio = Math.min(0.6, Math.max(0.15, input.maxTransitionRatio));
  const limit = Math.max(1, Math.floor((clips.length - 1) * ratio));
  const effectiveLimit = input.preserveExisting
    ? Math.max(limit, existingCount)
    : limit;

  candidates.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.atSec - right.atSec;
  });

  const selected = new Map<number, Candidate>();
  for (const candidate of candidates) {
    if (selected.has(candidate.index)) continue;
    if (!candidate.forced && selected.size >= effectiveLimit) continue;
    if (candidate.forced && selected.size >= effectiveLimit + existingCount) continue;
    selected.set(candidate.index, candidate);
  }

  // Write both sides of every boundary.
  const boundary: TransitionRationale[] = [];
  for (let index = 0; index + 1 < clips.length; index += 1) {
    const previous = clips[index];
    const next = clips[index + 1];
    if (previous === undefined || next === undefined) continue;
    const chosen = selected.get(index);
    const transition: Transition =
      chosen === undefined
        ? { ...CUT }
        : { type: chosen.type, durationSec: chosen.durationSec };

    next.transitionIn = { ...transition };
    previous.transitionOut = { ...transition };
    if (transition.type === 'cut') {
      delete previous.handleOutSec;
    } else {
      previous.handleOutSec = transition.durationSec;
    }

    const atSec = roundTime(starts[index + 1] ?? 0);
    boundary.push({
      atSec,
      fromClipId: previous.id,
      toClipId: next.id,
      type: transition.type,
      durationSec: transition.durationSec,
      reason:
        chosen?.reason ??
        (sameRoom(previous, next)
          ? 'hard cut inside the same room keeps the energy up'
          : cutReason(previous, next, index, clips.length - 1)),
      ...(chosen?.beatSec === undefined ? {} : { beatSec: chosen.beatSec }),
      ...(chosen === undefined ? {} : { onBeat: chosen.onBeat }),
    });
  }

  const first = clips[0];
  if (first !== undefined) first.transitionIn = { ...CUT };
  const last = clips[clips.length - 1];
  if (last !== undefined) {
    last.transitionOut = { ...CUT };
    delete last.handleOutSec;
  }

  return {
    boundary,
    last: {
      atSec: roundTime(total),
      fromClipId: last?.id ?? '',
      toClipId: '',
      type: 'cut',
      durationSec: 0,
      reason: 'end of film; no outgoing transition',
    },
  };
}
