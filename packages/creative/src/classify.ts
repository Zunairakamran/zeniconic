import type { Clip, Room } from '../../edl/src/index';
import type { ClipPurpose } from './types';
import { clipTimelineSec } from './timeline';

const ROOM_ORDER: readonly Room[] = [
  'view',
  'exterior',
  'balcony',
  'living',
  'bedroom',
  'dining',
  'amenity',
  'building',
  'kitchen',
  'bathroom',
  'entry',
  'unknown',
];

export function roomOf(clip: Clip): Room {
  return clip.room ?? 'unknown';
}

/**
 * The raw narrative job of a shot, before hook/close are assigned. The rules
 * use only data the planner already put on the clip: `room`, the shot's
 * timeline length relative to the rest of the cut, and the existing score.
 */
export function classifyPurpose(clip: Clip, maxDurationSec: number): ClipPurpose {
  const room = roomOf(clip);
  const duration = clipTimelineSec(clip);
  const long = maxDurationSec > 0 ? duration >= maxDurationSec * 0.75 : false;

  switch (room) {
    case 'view':
      return 'feature';
    case 'exterior':
    case 'building':
      return 'establishing';
    case 'entry':
      return 'space';
    case 'living':
      // The longest living shot is the room's wide/establishing view; a
      // shorter one is a lived-in moment.
      return long ? 'establishing' : 'lifestyle';
    case 'kitchen':
      return duration <= 2.2 ? 'detail' : 'craft';
    case 'dining':
      return 'lifestyle';
    case 'bedroom':
      return 'rest';
    case 'bathroom':
      return 'detail';
    case 'balcony':
      return 'lifestyle';
    case 'amenity':
      return 'feature';
    case 'unknown':
      return duration <= 2.5 ? 'detail' : 'space';
    default:
      return 'space';
  }
}

const PURPOSE_WORDING: Record<ClipPurpose, string> = {
  hook: 'hook',
  establishing: 'establishing wide',
  space: 'space and circulation',
  craft: 'craft',
  detail: 'detail',
  rest: 'rest',
  lifestyle: 'lifestyle',
  feature: 'feature',
  close: 'close',
};

export function purposeReason(clip: Clip, purpose: ClipPurpose): string {
  const room = roomOf(clip);
  const seconds = clipTimelineSec(clip).toFixed(2);
  return `${room} shot, ${seconds}s: ${PURPOSE_WORDING[purpose]}`;
}

/** Rooms that can open a film. Detail rooms never do. */
const HOOK_ROOM_VALUE: Record<Room, number> = {
  view: 1,
  exterior: 0.95,
  living: 0.92,
  balcony: 0.82,
  amenity: 0.78,
  building: 0.7,
  dining: 0.5,
  kitchen: 0.28,
  entry: 0.2,
  bedroom: 0.15,
  bathroom: 0.1,
  unknown: 0.25,
};

const HOOKABLE: ReadonlySet<Room> = new Set<Room>([
  'view',
  'exterior',
  'living',
  'balcony',
  'amenity',
  'building',
]);

function clamp01(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** True when the existing transform still has room to push in. */
export function canPushIn(clip: Clip): boolean {
  const path = clip.transform?.path;
  if (!Array.isArray(path) || path.length === 0) return true;
  const last = path[path.length - 1];
  if (last === undefined || !Number.isFinite(last.scale)) return true;
  return clip.transform.mode === 'cover' && last.scale < 2.3;
}

export interface HookCandidate {
  clip: Clip;
  index: number;
  purpose: ClipPurpose;
  score: number;
  reason: string;
}

/**
 * Slot 0. Value the room first (view/exterior/living), then measured score and
 * motion, then two tie-breakers from the brief: a shot that is not the
 * longest, and one whose transform can still push in.
 */
export function rankHookCandidates(
  clips: readonly Clip[],
  purposes: readonly ClipPurpose[],
): HookCandidate[] {
  const durations = clips.map((clip) => clipTimelineSec(clip));
  const maxDuration = durations.reduce((max, value) => Math.max(max, value), 0);

  const candidates: HookCandidate[] = [];
  clips.forEach((clip, index) => {
    const room = roomOf(clip);
    if (!HOOKABLE.has(room)) return;
    const duration = durations[index] ?? 0;
    const purpose = purposes[index] ?? classifyPurpose(clip, maxDuration);
    const isLongest = maxDuration > 0 && duration >= maxDuration - 1e-6;
    const score = Math.min(
      1,
      HOOK_ROOM_VALUE[room] * 0.6 +
        clamp01(clip.scoreAtSelection, 0.5) * 0.15 +
        clamp01(clip.motionAtSelection, 0) * 0.2 +
        (isLongest ? 0 : 0.15) +
        (canPushIn(clip) ? 0.1 : 0),
    );

    const parts = [
      `${room} ranks ${HOOK_ROOM_VALUE[room].toFixed(2)} as an opener`,
      isLongest ? 'but it is the longest shot' : 'and is not the longest shot',
      canPushIn(clip) ? 'with room to push in' : 'with no push-in headroom',
    ];
    candidates.push({
      clip,
      index,
      purpose,
      score: Math.round(score * 1000) / 1000,
      reason: parts.join(', '),
    });
  });

  return candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.index - right.index;
  });
}

export interface CloseCandidate {
  clip: Clip;
  index: number;
  purpose: ClipPurpose;
  roomRank: number;
}

/**
 * The last shot. A view/exterior/balcony/living ending lets the film exhale;
 * a bathroom or entry never closes. Ties go to the better measured shot, then
 * to the earlier clip for determinism.
 */
export function rankCloseCandidates(
  clips: readonly Clip[],
  purposes: readonly ClipPurpose[],
  excludeIndex: number,
): CloseCandidate[] {
  const durations = clips.map((clip) => clipTimelineSec(clip));
  const maxDuration = durations.reduce((max, value) => Math.max(max, value), 0);
  const candidates: CloseCandidate[] = [];

  clips.forEach((clip, index) => {
    if (index === excludeIndex) return;
    const room = roomOf(clip);
    const roomRank = ROOM_ORDER.indexOf(room) === -1 ? ROOM_ORDER.length : ROOM_ORDER.indexOf(room);
    candidates.push({
      clip,
      index,
      purpose: purposes[index] ?? classifyPurpose(clip, maxDuration),
      roomRank,
    });
  });

  return candidates.sort((left, right) => {
    if (left.roomRank !== right.roomRank) return left.roomRank - right.roomRank;
    // Within a room, a shot with real movement is a better close than a
    // locked-off frame that the freeze check will reject.
    const motionDelta =
      clamp01(right.clip.motionAtSelection, 0) - clamp01(left.clip.motionAtSelection, 0);
    if (Math.abs(motionDelta) > 0.06) return motionDelta;
    const leftScore = clamp01(left.clip.scoreAtSelection, 0.5);
    const rightScore = clamp01(right.clip.scoreAtSelection, 0.5);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.index - right.index;
  });
}

export function closeReason(clip: Clip): string {
  const room = roomOf(clip);
  return `${room} ending: ${ROOM_ORDER.indexOf(room) <= 3 ? 'an outlook/living room lets the film settle' : 'the best remaining candidate; no view or living shot closes better'}`;
}
