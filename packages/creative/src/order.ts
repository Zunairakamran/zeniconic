import type { Clip, Room } from '../../edl/src/index';
import type { ClipPurpose } from './types';
import { roomOf } from './classify';

interface Entry {
  clip: Clip;
  index: number;
  purpose: ClipPurpose;
}

/** Buckets in narrative order. Within a bucket, cuts may be reordered. */
const BUCKETS: readonly (readonly ClipPurpose[])[] = [
  ['establishing', 'space'],
  ['craft', 'detail'],
  ['rest'],
  ['lifestyle', 'feature'],
];

function bucketOf(purpose: ClipPurpose): number {
  return BUCKETS.findIndex((bucket) => bucket.includes(purpose));
}

function scoreOf(clip: Clip): number {
  const value = clip.scoreAtSelection;
  return value === undefined || !Number.isFinite(value) ? 0.5 : value;
}

function sortPool(pool: Entry[]): Entry[] {
  return [...pool].sort((left, right) => {
    const bucket = bucketOf(left.purpose);
    const rightBucket = bucketOf(right.purpose);
    if (bucket !== rightBucket) return bucket - rightBucket;
    const order = BUCKETS[bucket] ?? [];
    const leftRank = order.indexOf(left.purpose);
    const rightRank = order.indexOf(right.purpose);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const scoreDelta = scoreOf(right.clip) - scoreOf(left.clip);
    if (Math.abs(scoreDelta) > 1e-9) return scoreDelta;
    return left.index - right.index;
  });
}

function takeNext(pool: Entry[], previousRoom: string): Entry | undefined {
  if (pool.length === 0) return undefined;
  const differentRoom = pool.filter((entry) => roomOf(entry.clip) !== previousRoom);
  const usable = differentRoom.length > 0 ? differentRoom : pool;
  const sorted = sortPool(usable);
  const chosen = sorted[0];
  if (chosen === undefined) return undefined;
  pool.splice(pool.indexOf(chosen), 1);
  return chosen;
}

export interface OrderedCut {
  clips: Clip[];
  purposes: ClipPurpose[];
  indices: number[];
}

/**
 * hook → establishing/space → craft/detail → rest → lifestyle/feature → close.
 *
 * Every clip appears exactly once. Within a bucket the picker prefers a room
 * different from the previous shot, so two living-room clips never sit next to
 * each other unless the pool leaves no choice.
 */
export function narrativeOrder(
  clips: readonly Clip[],
  purposes: readonly ClipPurpose[],
  hookIndex: number,
  closeIndex: number,
): OrderedCut {
  const hookClip = clips[hookIndex];
  const closeClip = closeIndex >= 0 ? clips[closeIndex] : undefined;

  if (clips.length === 0) return { clips: [], purposes: [], indices: [] };
  if (hookClip === undefined) {
    return { clips: [...clips], purposes: [...purposes], indices: clips.map((_, index) => index) };
  }

  const middle: Entry[] = [];
  clips.forEach((clip, index) => {
    if (index === hookIndex || index === closeIndex) return;
    const purpose = purposes[index];
    if (purpose !== undefined) middle.push({ clip, index, purpose });
  });

  const ordered: Entry[] = [{ clip: hookClip, index: hookIndex, purpose: 'hook' }];
  let previousRoom = roomOf(hookClip);
  const pool = [...middle];

  for (const bucket of BUCKETS) {
    let remaining = pool.filter((entry) => bucket.includes(entry.purpose));
    while (remaining.length > 0) {
      const next = takeNext(remaining, previousRoom);
      if (next === undefined) break;
      ordered.push(next);
      previousRoom = roomOf(next.clip);
      // `takeNext` spliced its own filtered array, not the master pool.
      const poolIndex = pool.indexOf(next);
      if (poolIndex >= 0) pool.splice(poolIndex, 1);
      remaining = pool.filter((entry) => bucket.includes(entry.purpose));
    }
  }

  // Safety net: a purpose outside the buckets (or a duplicate) still lands in
  // the film exactly once.
  while (pool.length > 0) {
    const next = takeNext(pool, previousRoom);
    if (next === undefined) break;
    ordered.push(next);
    previousRoom = roomOf(next.clip);
  }

  if (closeClip !== undefined && closeIndex !== hookIndex) {
    ordered.push({ clip: closeClip, index: closeIndex, purpose: 'close' });
  }

  return {
    clips: ordered.map((entry) => entry.clip),
    purposes: ordered.map((entry) => entry.purpose),
    indices: ordered.map((entry) => entry.index),
  };
}

export function interleaveByRoom<T extends { clip: Clip }>(entries: readonly T[]): T[] {
  if (entries.length < 3) return [...entries];
  const result: T[] = [entries[0]!];
  const pool = entries.slice(1, -1);
  const last = entries[entries.length - 1]!;
  let previousRoom = roomOf(result[0]!.clip);
  while (pool.length > 0) {
    const different = pool.find((entry) => roomOf(entry.clip) !== previousRoom);
    const chosen = different ?? pool[0]!;
    pool.splice(pool.indexOf(chosen), 1);
    result.push(chosen);
    previousRoom = roomOf(chosen.clip);
  }
  result.push(last);
  return result;
}

/**
 * Marketing beat template: the entrance reveal lands in the 23-28 s window,
 * the price follows it, and the final living shot closes the film. Each room
 * is drawn from the best remaining clip of that room.
 */
export function marketingStoryboard<T extends { clip: Clip }>(entries: readonly T[]): T[] {
  const template: Room[] = [
    'living', 'kitchen', 'living', 'bedroom', 'kitchen', 'living', 'kitchen',
    'bedroom', 'kitchen', 'living', 'entry', 'kitchen', 'bedroom', 'living',
    'bedroom', 'living',
  ];
  const pool = [...entries];
  const result: T[] = [];
  let previousRoom: Room | undefined;
  for (const wanted of template) {
    let chosen =
      pool
        .filter((entry) => roomOf(entry.clip) === wanted)
        .sort(
          (a, b) =>
            (b.clip.scoreAtSelection ?? 0.5) - (a.clip.scoreAtSelection ?? 0.5),
        )[0] ??
      pool.find((entry) => roomOf(entry.clip) !== previousRoom) ??
      pool[0];
    if (chosen === undefined) break;
    pool.splice(pool.indexOf(chosen), 1);
    result.push(chosen);
    previousRoom = roomOf(chosen.clip);
  }
  // Any leftover clips keep a different room from the previous beat.
  while (pool.length > 0) {
    const chosen = pool.find((entry) => roomOf(entry.clip) !== previousRoom) ?? pool[0]!;
    pool.splice(pool.indexOf(chosen), 1);
    result.push(chosen);
    previousRoom = roomOf(chosen.clip);
  }
  return result;
}

export function orderReason(purpose: ClipPurpose): string {
  switch (purpose) {
    case 'hook':
      return 'opens the film';
    case 'establishing':
      return 'establishes the place before details';
    case 'space':
      return 'shows how the rooms connect';
    case 'craft':
      return 'the making of the place';
    case 'detail':
      return 'a close look at the finish';
    case 'rest':
      return 'slows the tempo in the private rooms';
    case 'lifestyle':
      return 'shows the life the place affords';
    case 'feature':
      return 'the feature beat';
    case 'close':
      return 'lands the film';
    default:
      return 'narrative beat';
  }
}
