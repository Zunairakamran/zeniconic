import { roundTime, snapToBeat } from '@zeniconic/core';
import type { LookId, Room, ValidationIssue } from '@zeniconic/edl';
import type { Candidate, PlannedClip, SequenceSpec } from './types';

/**
 * The walking order from `real-estate-creative/references/room-order.md`.
 * `unknown` sits last: it is a real tag, just never a deliberate beat.
 */
export const ROOM_ORDER: readonly Room[] = [
  'exterior',
  'building',
  'entry',
  'living',
  'kitchen',
  'dining',
  'bedroom',
  'bathroom',
  'balcony',
  'view',
  'amenity',
  'unknown',
];

export const MIN_SHOT_SEC = 1.2;
export const MAX_SHOT_SEC = 4.5;
export const DURATION_TOLERANCE_SEC = 0.5;

/** How close a cut must be to a beat before it is worth moving. */
export const BEAT_TOLERANCE_SEC = 0.25;

/** Plans aim well inside the EDL's ±0.5s gate. */
const AIM_TOLERANCE_SEC = 0.3;
const MAX_CLIPS = 40;
const EPS = 1e-6;

/** Average shot length per look, used to pick a clip count before allocation. */
const LOOK_AVERAGE_SHOT_SEC: Record<LookId, number> = {
  calm: 3.6,
  editorial: 3.3,
  walkthrough: 2.7,
  social: 2.0,
};

interface Slot {
  candidate: Candidate;
  /** Longest legal clip from this shot, floored to 3 dp so it never overruns. */
  maxSec: number;
}

function floorTime(value: number): number {
  return Math.floor(value * 1000 + 1e-6) / 1000;
}

function roomRank(room: Room): number {
  const index = ROOM_ORDER.indexOf(room);
  return index === -1 ? ROOM_ORDER.length : index;
}

function compareScore(a: Slot, b: Slot): number {
  if (b.candidate.score !== a.candidate.score) return b.candidate.score - a.candidate.score;
  if (a.candidate.shotId === b.candidate.shotId) return 0;
  return a.candidate.shotId < b.candidate.shotId ? -1 : 1;
}

/** FNV-1a over the shot id, salted with the request seed. */
function seededRank(seed: number, shotId: string): number {
  let hash = (seed >>> 0) ^ 0x811c9dc5;
  for (let index = 0; index < shotId.length; index += 1) {
    hash ^= shotId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Score first. Equal scores are settled by the seed, then by room order and
 * shot id, so a reseeded request can only move a tie, never the hook.
 */
function comparePreference(a: Slot, b: Slot, seed: number): number {
  if (b.candidate.score !== a.candidate.score) return b.candidate.score - a.candidate.score;
  const rankA = seededRank(seed, a.candidate.shotId);
  const rankB = seededRank(seed, b.candidate.shotId);
  if (rankA !== rankB) return rankA - rankB;
  const byRoom = roomRank(a.candidate.room) - roomRank(b.candidate.room);
  if (byRoom !== 0) return byRoom;
  if (a.candidate.shotId === b.candidate.shotId) return 0;
  return a.candidate.shotId < b.candidate.shotId ? -1 : 1;
}

/**
 * Drops malformed shots, duplicate shot ids and shots too short to become a
 * clip. The result is ordered by score then shot id, so the head is the hook
 * regardless of the input array's order.
 */
function usableSlots(candidates: Candidate[], spec: SequenceSpec): Slot[] {
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.shotId !== b.shotId) return a.shotId < b.shotId ? -1 : 1;
    return a.inSec - b.inSec;
  });

  const seen = new Set<string>();
  const slots: Slot[] = [];

  for (const candidate of sorted) {
    if (seen.has(candidate.shotId)) continue;
    seen.add(candidate.shotId);

    const available = candidate.outSec - candidate.inSec;
    if (!Number.isFinite(candidate.score)) continue;
    if (!Number.isFinite(available)) continue;
    if (available + EPS < spec.minShotSec) continue;

    slots.push({ candidate, maxSec: floorTime(Math.min(spec.maxShotSec, available)) });
  }

  return slots;
}

/**
 * `validateEdl` treats a forward jump inside one source as an unmarked gap.
 * Avoid cutting from an early timecode of a file to a later one back to back.
 */
function canFollow(previous: Slot | undefined, next: Slot): boolean {
  if (!previous) return true;
  const sameSource =
    previous.candidate.sourceId === next.candidate.sourceId ||
    previous.candidate.src === next.candidate.src;
  if (!sameSource) return true;
  return next.candidate.inSec - previous.candidate.outSec <= 0.001;
}

/**
 * Picks the next filler shot. A room is never used twice in a row; when one
 * room holds more than half of what is left, it is forced early so the rest of
 * the queue stays arrangeable.
 */
function pickNext(
  remaining: Slot[],
  last: Slot | undefined,
  seed: number,
): Slot | undefined {
  const lastRoom = last?.candidate.room;
  const eligible = remaining.filter(
    (slot) => slot.candidate.room !== lastRoom && canFollow(last, slot),
  );
  if (eligible.length === 0) return undefined;

  const counts = new Map<Room, number>();
  for (const slot of remaining) {
    counts.set(slot.candidate.room, (counts.get(slot.candidate.room) ?? 0) + 1);
  }

  const limit = (remaining.length + 1) / 2;
  let forcedRoom: Room | undefined;
  let forcedCount = 0;
  for (const [room, count] of counts) {
    if (room !== lastRoom && count > limit && count > forcedCount) {
      forcedRoom = room;
      forcedCount = count;
    }
  }

  const pool = forcedRoom
    ? eligible.filter((slot) => slot.candidate.room === forcedRoom)
    : eligible;

  let best: Slot | undefined;
  for (const slot of pool) {
    if (!best || comparePreference(slot, best, seed) < 0) best = slot;
  }
  return best;
}

/**
 * The bookend: another shot of the hook's room, preferably from the hook's own
 * source file at a different timecode. Only appended when one exists.
 */
function findReturn(
  slots: Slot[],
  used: Set<string>,
  hook: Slot,
  tail: Slot,
): Slot | undefined {
  let best: Slot | undefined;
  let bestIsSameSource = false;

  for (const slot of slots) {
    if (used.has(slot.candidate.shotId)) continue;
    if (slot.candidate.room !== hook.candidate.room) continue;
    if (slot.candidate.shotId === hook.candidate.shotId) continue;
    if (!canFollow(tail, slot)) continue;

    const sameSource = slot.candidate.sourceId === hook.candidate.sourceId;
    if (!best) {
      best = slot;
      bestIsSameSource = sameSource;
      continue;
    }
    if (sameSource !== bestIsSameSource) {
      if (sameSource) {
        best = slot;
        bestIsSameSource = true;
      }
      continue;
    }
    if (compareScore(slot, best) < 0) best = slot;
  }

  return best;
}

/**
 * Hook first, then one shot per room in spatial order, then fillers that keep
 * the no-consecutive-room rule. The final bookend is appended when available.
 */
function buildOrder(slots: Slot[], spec: SequenceSpec, seed: number): Slot[] {
  const hook = slots[0];
  if (!hook) {
    throw new RangeError(
      `No usable candidates: every shot is shorter than the ${spec.minShotSec}s minimum clip`,
    );
  }

  const order: Slot[] = [hook];
  const used = new Set<string>([hook.candidate.shotId]);
  const last = (): Slot | undefined => order[order.length - 1];

  const takeBest = (accept: (slot: Slot) => boolean): Slot | undefined => {
    let best: Slot | undefined;
    for (const slot of slots) {
      if (used.has(slot.candidate.shotId)) continue;
      if (!accept(slot) || !canFollow(last(), slot)) continue;
      if (!best || compareScore(slot, best) < 0) best = slot;
    }
    if (best) used.add(best.candidate.shotId);
    return best;
  };

  for (const room of spec.roomOrder) {
    if (room === hook.candidate.room) continue;
    const pick = takeBest((slot) => slot.candidate.room === room);
    if (pick) order.push(pick);
  }

  const remaining = slots.filter((slot) => !used.has(slot.candidate.shotId));
  while (remaining.length > 0 && order.length < MAX_CLIPS) {
    const next = pickNext(remaining, last(), seed);
    if (!next) break;
    order.push(next);
    used.add(next.candidate.shotId);
    const index = remaining.indexOf(next);
    if (index >= 0) remaining.splice(index, 1);
  }

  const tail = last();
  if (tail && tail.candidate.room !== hook.candidate.room) {
    const bookend = findReturn(slots, used, hook, tail);
    if (bookend) order.push(bookend);
  }

  return order;
}

/**
 * Trims the preference order to the count the look implies, promotes the
 * bookend to the last slot, and grows the list only if it cannot fill the
 * target otherwise.
 */
function chooseSlots(
  order: Slot[],
  spec: SequenceSpec,
  look: LookId,
  averageShotSec?: number,
): Slot[] {
  const hook = order[0];
  if (!hook) throw new RangeError('Cannot plan a sequence without a hook shot');

  const lookAverage = LOOK_AVERAGE_SHOT_SEC[look] ?? 3;
  const average =
    averageShotSec !== undefined && Number.isFinite(averageShotSec)
      ? Math.min(spec.maxShotSec, Math.max(spec.minShotSec, averageShotSec))
      : lookAverage;
  let count = Math.min(order.length, Math.max(1, Math.round(spec.targetDurationSec / average)));
  while (count > 1 && count * spec.minShotSec > spec.targetDurationSec + AIM_TOLERANCE_SEC) {
    count -= 1;
  }

  // One clip can never carry more than maxShotSec: 5s needs two 2.5s clips.
  const shortestCount = Math.max(
    1,
    Math.ceil((spec.targetDurationSec - AIM_TOLERANCE_SEC) / spec.maxShotSec),
  );
  count = Math.max(count, Math.min(order.length, shortestCount));

  const chosen = order.slice(0, count);
  const minimum = roundTime(spec.targetDurationSec - AIM_TOLERANCE_SEC);
  const capacity = (list: Slot[]): number =>
    roundTime(list.reduce((sum, slot) => sum + slot.maxSec, 0));

  const reserved = order[order.length - 1];
  if (
    reserved &&
    chosen.length > 1 &&
    !chosen.includes(reserved) &&
    reserved.candidate.room === hook.candidate.room
  ) {
    const previous = chosen[chosen.length - 2];
    if (
      previous &&
      previous.candidate.room !== reserved.candidate.room &&
      canFollow(previous, reserved)
    ) {
      chosen[chosen.length - 1] = reserved;
    }
  }

  if (capacity(chosen) + EPS < minimum) {
    for (const slot of order) {
      if (chosen.includes(slot) || chosen.length >= MAX_CLIPS) continue;
      const previous = chosen[chosen.length - 1];
      if (previous && previous.candidate.room === slot.candidate.room) continue;
      if (!canFollow(previous, slot)) continue;
      chosen.push(slot);
      if (capacity(chosen) + EPS >= minimum) break;
    }
  }

  // A high-scoring short shot can crowd out a longer one from the same room.
  // Swap in the longer take where the neighbours still allow it.
  if (capacity(chosen) + EPS < minimum) {
    for (let index = chosen.length - 1; index >= 0; index -= 1) {
      const current = chosen[index];
      if (!current) continue;
      const previous = index > 0 ? chosen[index - 1] : undefined;
      const next = index + 1 < chosen.length ? chosen[index + 1] : undefined;

      let replacement: Slot | undefined;
      for (const slot of order) {
        if (chosen.includes(slot) || slot.candidate.room !== current.candidate.room) continue;
        if (slot.maxSec <= current.maxSec + EPS) continue;
        if (previous && (previous.candidate.room === slot.candidate.room || !canFollow(previous, slot))) {
          continue;
        }
        if (next && (next.candidate.room === slot.candidate.room || !canFollow(slot, next))) {
          continue;
        }
        if (!replacement || slot.maxSec > replacement.maxSec) replacement = slot;
      }

      if (replacement) {
        chosen[index] = replacement;
        if (capacity(chosen) + EPS >= minimum) break;
      }
    }
  }

  if (capacity(chosen) + EPS < minimum) {
    throw new RangeError(
      `Candidate pool can fill at most ${capacity(chosen)}s, but ${spec.targetDurationSec}s was requested`,
    );
  }

  return chosen;
}

/**
 * Distributes the target across clips by score, bounded by each shot's length.
 * Excess is redistributed until every clip is at its cap or the target is met.
 */
function allocate(slots: Slot[], spec: SequenceSpec): number[] {
  const maxes = slots.map((slot) => roundTime(Math.min(spec.maxShotSec, slot.maxSec)));
  const min = spec.minShotSec;
  const totalMin = roundTime(min * slots.length);
  const totalMax = roundTime(maxes.reduce((sum, value) => sum + value, 0));
  const goal = roundTime(Math.min(Math.max(spec.targetDurationSec, totalMin), totalMax));

  if (goal + AIM_TOLERANCE_SEC < spec.targetDurationSec) {
    throw new RangeError(
      `Cannot reach ${spec.targetDurationSec}s: the longest legal cut is ${goal}s`,
    );
  }

  const durations = slots.map(() => min);
  const weights = slots.map((slot) => 0.5 + Math.min(1, Math.max(0, slot.candidate.score)));
  let remaining = roundTime(goal - totalMin);

  for (let pass = 0; pass < 16 && remaining > EPS; pass += 1) {
    let weightSum = 0;
    for (let index = 0; index < slots.length; index += 1) {
      const current = durations[index] ?? min;
      const cap = maxes[index] ?? min;
      if (current < cap - EPS) weightSum += weights[index] ?? 0;
    }
    if (weightSum <= EPS) break;

    let moved = 0;
    for (let index = 0; index < slots.length; index += 1) {
      const current = durations[index] ?? min;
      const cap = maxes[index] ?? min;
      if (current >= cap - EPS) continue;
      const share = remaining * ((weights[index] ?? 0) / weightSum);
      const add = Math.min(share, cap - current);
      if (add <= 0) continue;
      durations[index] = current + add;
      moved += add;
    }

    remaining = Math.max(0, remaining - moved);
    if (moved <= EPS) break;
  }

  return rebalance(durations, maxes, min, goal);
}

/**
 * Rounds to milliseconds and repairs the drift on the last clips, walking
 * backwards, while respecting every shot's bounds.
 */
function rebalance(durations: number[], maxes: number[], min: number, goal: number): number[] {
  const out = durations.map(roundTime);
  let delta = roundTime(goal - out.reduce((sum, value) => sum + value, 0));

  for (let index = out.length - 1; index >= 0 && delta < -EPS; index -= 1) {
    const current = out[index] ?? min;
    const take = Math.min(-delta, Math.max(0, current - min));
    if (take <= 0) continue;
    out[index] = roundTime(current - take);
    delta = roundTime(delta + take);
  }

  for (let index = out.length - 1; index >= 0 && delta > EPS; index -= 1) {
    const current = out[index] ?? min;
    const cap = maxes[index] ?? min;
    const give = Math.min(delta, Math.max(0, cap - current));
    if (give <= 0) continue;
    out[index] = roundTime(current + give);
    delta = roundTime(delta - give);
  }

  return out;
}

/**
 * Moves internal cuts onto nearby beats by shifting time between the two
 * neighbouring clips, so the timeline total never drifts.
 */
function snapDurations(
  durations: number[],
  maxes: number[],
  min: number,
  beats: number[],
): number[] {
  if (beats.length === 0) return durations.map(roundTime);

  const out = durations.map(roundTime);
  let start = 0;

  for (let index = 0; index < out.length - 1; index += 1) {
    const boundary = roundTime(start + (out[index] ?? min));
    const snapped = snapToBeat(boundary, beats, BEAT_TOLERANCE_SEC);
    const delta = roundTime(snapped - boundary);

    if (delta !== 0) {
      const head = roundTime((out[index] ?? min) + delta);
      const tail = roundTime((out[index + 1] ?? min) - delta);
      const headCap = maxes[index] ?? min;
      const tailCap = maxes[index + 1] ?? min;
      if (head >= min - EPS && head <= headCap + EPS && tail >= min - EPS && tail <= tailCap + EPS) {
        out[index] = head;
        out[index + 1] = tail;
      }
    }

    start = roundTime(start + (out[index] ?? min));
  }

  return out;
}

/**
 * Turns candidates into a timeline segment list. Deterministic: the inputs are
 * the candidates, the spec, the look, the beat grid and the seed.
 */
export function planSequence(
  candidates: Candidate[],
  spec: SequenceSpec,
  look: LookId,
  beatGrid: readonly number[],
  seed = 0,
  averageShotSec?: number,
): PlannedClip[] {
  const slots = usableSlots(candidates, spec);
  const order = buildOrder(slots, spec, seed);
  const chosen = chooseSlots(order, spec, look, averageShotSec);
  const maxes = chosen.map((slot) => roundTime(Math.min(spec.maxShotSec, slot.maxSec)));
  const allocated = allocate(chosen, spec);
  const goal = roundTime(allocated.reduce((sum, value) => sum + value, 0));
  const snapped = snapDurations(allocated, maxes, spec.minShotSec, [...beatGrid]);
  const durations = rebalance(snapped, maxes, spec.minShotSec, goal);

  const hook = chosen[0];
  if (!hook) throw new RangeError('Cannot plan a sequence without a hook shot');

  const planned: PlannedClip[] = chosen.map((slot, index) => ({
    shotId: slot.candidate.shotId,
    sourceId: slot.candidate.sourceId,
    src: slot.candidate.src,
    room: slot.candidate.room,
    score: roundTime(slot.candidate.score),
    inSec: roundTime(slot.candidate.inSec),
    outSec: roundTime(slot.candidate.outSec),
    durationSec: durations[index] ?? spec.minShotSec,
    reason: slot.candidate.reason,
    isReturn:
      index === chosen.length - 1 &&
      slot.candidate.room === hook.candidate.room &&
      slot.candidate.shotId !== hook.candidate.shotId,
  }));

  const issues = validateSequence(planned, spec);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(
      `Planner produced an invalid sequence: ${first?.code ?? 'unknown'} at ${first?.path ?? '/'}: ${first?.message ?? ''}`,
    );
  }

  return planned;
}

/**
 * Structural checks for a planned sequence. Codes are distinct per rule:
 * duration, min shot, max shot, source window, room repeat, shot repeat.
 */
export function validateSequence(clips: PlannedClip[], spec: SequenceSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (clips.length === 0) {
    issues.push({
      path: '/clips',
      code: 'E_SEQUENCE_EMPTY',
      message: 'A sequence needs at least one clip',
    });
    return issues;
  }

  clips.forEach((clip, index) => {
    const duration = clip.durationSec;
    const previous = index > 0 ? clips[index - 1] : undefined;

    if (!Number.isFinite(duration) || duration + EPS < spec.minShotSec) {
      issues.push({
        path: `/clips/${index}/durationSec`,
        code: 'E_SEQUENCE_MIN_SHOT',
        message: `Clip ${clip.shotId} runs ${duration}s; the minimum is ${spec.minShotSec}s`,
      });
    }

    if (duration - EPS > spec.maxShotSec) {
      issues.push({
        path: `/clips/${index}/durationSec`,
        code: 'E_SEQUENCE_MAX_SHOT',
        message: `Clip ${clip.shotId} runs ${duration}s; the maximum is ${spec.maxShotSec}s`,
      });
    }

    if (duration - EPS > clip.outSec - clip.inSec) {
      issues.push({
        path: `/clips/${index}/durationSec`,
        code: 'E_SEQUENCE_SOURCE_WINDOW',
        message: `Clip ${clip.shotId} asks for ${duration}s from a ${roundTime(clip.outSec - clip.inSec)}s shot`,
      });
    }

    if (!spec.roomOrder.includes(clip.room)) {
      issues.push({
        path: `/clips/${index}/room`,
        code: 'E_SEQUENCE_ROOM_UNKNOWN',
        message: `Room "${clip.room}" is not part of this sequence's room order`,
      });
    }

    if (previous && previous.room === clip.room) {
      issues.push({
        path: `/clips/${index}/room`,
        code: 'E_SEQUENCE_ROOM_REPEAT',
        message: `Clip ${clip.shotId} repeats ${clip.room} straight after clip ${previous.shotId}`,
      });
    }

    if (previous) {
      const earlier = clips.find(
        (other, otherIndex) => otherIndex < index && other.shotId === clip.shotId,
      );
      if (earlier) {
        const differentTimecode = earlier.inSec !== clip.inSec;
        if (!(clip.isReturn === true && differentTimecode)) {
          issues.push({
            path: `/clips/${index}/shotId`,
            code: 'E_SEQUENCE_SHOT_REPEAT',
            message: `Shot ${clip.shotId} is used twice without an explicit different-timecode return`,
          });
        }
      }
    }
  });

  const total = roundTime(clips.reduce((sum, clip) => sum + clip.durationSec, 0));
  if (Math.abs(total - spec.targetDurationSec) > DURATION_TOLERANCE_SEC + EPS) {
    issues.push({
      path: '/targetDurationSec',
      code: 'E_SEQUENCE_DURATION',
      message: `Sequence runs ${total}s; target is ${spec.targetDurationSec}s±${DURATION_TOLERANCE_SEC}s`,
    });
  }

  return issues;
}
