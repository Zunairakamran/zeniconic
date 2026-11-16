/**
 * Three deterministic ordering presets for re-editing an imported video.
 *
 * A preset is a creative argument, not a randomiser: it maps tagged shots onto
 * narrative beats, picks one unused shot per beat, and returns a target length
 * for each slot. The caller turns those slots into candidates for the planner;
 * this module never touches the EDL.
 */

import { roundTime } from '@zeniconic/core';
import type { Room } from '@zeniconic/edl';
import type { Facts } from '@zeniconic/planner';

export type PresetId = 'marketing' | 'original' | 'price_led';

export type TimelineBeat =
  | 'hook'
  | 'light'
  | 'ritual'
  | 'craft'
  | 'space'
  | 'entrance'
  | 'price'
  | 'close'
  | 'price_question'
  | 'flat_reveal'
  | 'entrance_late'
  | 'original';

/** The subset of shot metadata the presets read. */
export interface TaggedShot {
  id: string;
  room: Room;
  /** Source seconds. */
  startSec: number;
  /** Source seconds. */
  endSec: number;
  /** 0..1; missing shots are treated as 0.5. */
  score?: number;
  /** Optional tagger labels, e.g. `hook`, `light`, `window`, `detail`. */
  tags?: readonly string[];
}

export interface PresetOptions {
  /** Timeline seconds to aim for. Defaults: 30 for marketing/price-led, full source for original. */
  targetDurationSec?: number;
  /** Defaults to 1.2s, matching the planner. */
  minShotSec?: number;
  /** Defaults to 4.5s, matching the planner. */
  maxShotSec?: number;
}

export interface TimelineSlot {
  order: number;
  beat: TimelineBeat;
  shotId: string;
  room: Room;
  /** Full available source window. */
  inSec: number;
  outSec: number;
  /** Seconds this slot should contribute to the timeline. */
  targetSec: number;
  reason: string;
}

export const DEFAULT_PRESET_TARGET_SEC = 30;
export const DEFAULT_PRESET_MIN_SHOT_SEC = 1.2;
export const DEFAULT_PRESET_MAX_SHOT_SEC = 4.5;

const EPS = 1e-6;

interface BeatSpec {
  beat: TimelineBeat;
  rooms: readonly Room[];
  tags: readonly string[];
}

interface DraftSlot {
  beat: TimelineBeat;
  shot: TaggedShot;
  capSec: number;
  intent: string;
}

interface ResolvedOptions {
  targetDurationSec: number | undefined;
  minShotSec: number;
  maxShotSec: number;
}

/**
 * Marketing: the argument from the listing video, in the order the creative
 * guide uses. Price sits second-to-last so the close can land on the property.
 */
const MARKETING_BEATS: readonly BeatSpec[] = Object.freeze([
  { beat: 'hook', rooms: ['exterior', 'building', 'view', 'amenity'], tags: ['hook', 'establishing'] },
  { beat: 'light', rooms: ['living', 'balcony', 'view', 'bedroom'], tags: ['light', 'window'] },
  { beat: 'ritual', rooms: ['kitchen', 'dining'], tags: ['ritual', 'kitchen', 'coffee'] },
  { beat: 'craft', rooms: ['bathroom', 'kitchen', 'building', 'amenity'], tags: ['craft', 'detail'] },
  { beat: 'space', rooms: ['living', 'dining', 'bedroom'], tags: ['space', 'wide'] },
  { beat: 'entrance', rooms: ['entry', 'building'], tags: ['entrance', 'entry'] },
  { beat: 'price', rooms: ['living', 'dining', 'kitchen', 'bedroom', 'view'], tags: ['price', 'value'] },
  { beat: 'close', rooms: ['exterior', 'building', 'view', 'balcony', 'amenity'], tags: ['close', 'hero'] },
]);

/**
 * Price-led: ask the price question first, reveal the flat before the number,
 * and hold the entrance until the value is clear.
 */
const PRICE_LED_BEATS: readonly BeatSpec[] = Object.freeze([
  { beat: 'price_question', rooms: ['exterior', 'building', 'view'], tags: ['price', 'question', 'hook'] },
  { beat: 'flat_reveal', rooms: ['living', 'kitchen', 'dining'], tags: ['reveal', 'living'] },
  { beat: 'light', rooms: ['living', 'balcony', 'view', 'bedroom'], tags: ['light', 'window'] },
  { beat: 'ritual', rooms: ['kitchen', 'dining'], tags: ['ritual', 'kitchen'] },
  { beat: 'craft', rooms: ['bathroom', 'kitchen', 'building'], tags: ['craft', 'detail'] },
  { beat: 'space', rooms: ['living', 'dining', 'bedroom'], tags: ['space', 'wide'] },
  { beat: 'entrance_late', rooms: ['entry', 'building'], tags: ['entrance', 'entry'] },
  { beat: 'price', rooms: ['living', 'dining', 'kitchen', 'bedroom', 'view'], tags: ['price', 'value'] },
  { beat: 'close', rooms: ['exterior', 'building', 'view', 'balcony', 'amenity'], tags: ['close', 'hero'] },
]);

const BEAT_ALIASES: Readonly<Record<TimelineBeat, readonly string[]>> = Object.freeze({
  hook: ['hook', 'establishing'],
  light: ['light', 'window', 'sun'],
  ritual: ['ritual', 'kitchen', 'coffee', 'dining'],
  craft: ['craft', 'detail', 'joinery'],
  space: ['space', 'wide', 'room'],
  entrance: ['entrance', 'entry', 'door'],
  price: ['price', 'value', 'number'],
  close: ['close', 'hero', 'bookend'],
  price_question: ['price', 'question', 'hook'],
  flat_reveal: ['reveal', 'flat', 'living'],
  entrance_late: ['entrance', 'entry', 'late'],
  original: [],
});

function positiveOption(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${value}`);
  }
  return value;
}

function resolveOptions(options: PresetOptions, fallbackTarget?: number): ResolvedOptions {
  const minShotSec = positiveOption(
    options.minShotSec ?? DEFAULT_PRESET_MIN_SHOT_SEC,
    'minShotSec',
  );
  const maxShotSec = positiveOption(
    options.maxShotSec ?? DEFAULT_PRESET_MAX_SHOT_SEC,
    'maxShotSec',
  );
  if (minShotSec > maxShotSec) {
    throw new RangeError(`minShotSec (${minShotSec}) must not exceed maxShotSec (${maxShotSec})`);
  }

  const target = options.targetDurationSec ?? fallbackTarget;
  if (target !== undefined) positiveOption(target, 'targetDurationSec');

  return { targetDurationSec: target, minShotSec, maxShotSec };
}

function scoreOf(shot: TaggedShot): number {
  if (shot.score === undefined || !Number.isFinite(shot.score)) return 0.5;
  return Math.min(1, Math.max(0, shot.score));
}

function shotDuration(shot: TaggedShot): number {
  return shot.endSec - shot.startSec;
}

function tagMatches(shot: TaggedShot, beat: TimelineBeat): boolean {
  const tags = new Set((shot.tags ?? []).map((tag) => tag.trim().toLowerCase()));
  return BEAT_ALIASES[beat].some((alias) => tags.has(alias));
}

/** Drops malformed and too-short shots, dedupes ids and orders by source time. */
function usableShots(shots: readonly TaggedShot[], minShotSec: number): TaggedShot[] {
  const sorted = [...shots].sort(
    (a, b) =>
      a.startSec - b.startSec ||
      a.endSec - b.endSec ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const seen = new Set<string>();
  const usable: TaggedShot[] = [];

  for (const shot of sorted) {
    if (shot.id.trim().length === 0) continue;
    if (seen.has(shot.id)) continue;
    if (!Number.isFinite(shot.startSec) || !Number.isFinite(shot.endSec)) continue;
    if (shot.endSec - shot.startSec + EPS < minShotSec) continue;

    seen.add(shot.id);
    usable.push(shot);
  }

  return usable;
}

function betterShot(
  candidate: TaggedShot,
  current: TaggedShot,
  beat: TimelineBeat,
  previousRoom: Room | undefined,
): boolean {
  const candidateTag = tagMatches(candidate, beat);
  const currentTag = tagMatches(current, beat);
  if (candidateTag !== currentTag) return candidateTag;

  const candidateScore = scoreOf(candidate);
  const currentScore = scoreOf(current);
  if (Math.abs(candidateScore - currentScore) > EPS) return candidateScore > currentScore;

  if (previousRoom !== undefined) {
    const candidateRepeat = candidate.room === previousRoom;
    const currentRepeat = current.room === previousRoom;
    if (candidateRepeat !== currentRepeat) return !candidateRepeat;
  }

  if (candidate.startSec !== current.startSec) return candidate.startSec < current.startSec;
  return candidate.id < current.id;
}

function pickForBeat(
  shots: readonly TaggedShot[],
  spec: BeatSpec,
  used: ReadonlySet<string>,
  previousRoom: Room | undefined,
): TaggedShot | undefined {
  const unused = shots.filter((shot) => !used.has(shot.id));
  if (unused.length === 0) return undefined;

  const roomMatches = unused.filter((shot) => spec.rooms.includes(shot.room));
  // A tag can rescue a shot whose room is ambiguous, so prefer tagged shots
  // first, then fall back to the room preference, then to any unused shot.
  const tagged = unused.filter((shot) => tagMatches(shot, spec.beat));
  const pool = tagged.length > 0 ? tagged : roomMatches.length > 0 ? roomMatches : unused;

  let best: TaggedShot | undefined;
  for (const shot of pool) {
    if (!best || betterShot(shot, best, spec.beat, previousRoom)) best = shot;
  }
  return best;
}

function sec(value: number): string {
  return `${roundTime(value)}s`;
}

function specSuffix(facts: Facts): string {
  const parts: string[] = [];
  if (facts.beds !== undefined) parts.push(`${facts.beds} bed`);
  if (facts.baths !== undefined) parts.push(`${facts.baths} bath`);
  return parts.length > 0 ? ` (${parts.join(' · ')})` : '';
}

function marketingReason(
  draft: DraftSlot,
  facts: Facts,
  targetSec: number,
): string {
  const length = sec(targetSec);
  const room = draft.shot.room;

  switch (draft.beat) {
    case 'hook':
      return `Hook: open on the ${room}${facts.address.trim() ? ` at ${facts.address.trim()}` : ''}; ${length}.`;
    case 'light':
      return `Light: ${room} carries the first interior beat; ${length}.`;
    case 'ritual':
      return `Ritual: ${room} shows how the home is lived in; ${length}.`;
    case 'craft':
      return `Craft: a ${room} detail proves the finish; ${length}.`;
    case 'space':
      return `Space: ${room} gives the scale beat; ${length}.`;
    case 'entrance':
      return `Entrance: arrive after the rooms, not before them; ${length}.`;
    case 'price':
      return facts.price?.trim()
        ? `Price: the ${facts.price.trim()} card lands here; ${length}.`
        : `Price beat: no price supplied, so the shot stands without a card; ${length}.`;
    case 'close':
      return `Close: return to ${room}${specSuffix(facts)}; ${length}.`;
    default:
      return `${draft.intent}: ${room}; ${length}.`;
  }
}

function priceLedReason(
  draft: DraftSlot,
  facts: Facts,
  targetSec: number,
): string {
  const length = sec(targetSec);
  const room = draft.shot.room;
  const price = facts.price?.trim();

  switch (draft.beat) {
    case 'price_question':
      return `Price question: open on ${room}${price ? ` before the ${price} answer` : ''}; ${length}.`;
    case 'flat_reveal':
      return `Reveal the flat in ${room} before naming the number; ${length}.`;
    case 'light':
      return `Light: ${room} keeps the reveal warm; ${length}.`;
    case 'ritual':
      return `Ritual: ${room} makes the flat feel lived in; ${length}.`;
    case 'craft':
      return `Craft: ${room} detail carries the value argument; ${length}.`;
    case 'space':
      return `Space: ${room} shows what the price buys; ${length}.`;
    case 'entrance_late':
      return `Entrance held late: ${room} arrives after the value is clear; ${length}.`;
    case 'price':
      return price
        ? `Price answer: the ${price} card lands here; ${length}.`
        : `Price answer: no price supplied, so this beat holds the reveal; ${length}.`;
    case 'close':
      return `Close: leave on ${room}${specSuffix(facts)}; ${length}.`;
    default:
      return `${draft.intent}: ${room}; ${length}.`;
  }
}

/**
 * Distributes a target across slots without randomness. Each slot starts at
 * the minimum (or its full length if shorter) and open slots share the rest
 * evenly until every cap is reached.
 */
function allocateTargets(
  drafts: readonly DraftSlot[],
  targetSec: number,
  minShotSec: number,
): number[] {
  if (drafts.length === 0) return [];

  const caps = drafts.map((draft) => draft.capSec);
  const floors = caps.map((cap) => Math.min(cap, minShotSec));

  // When the target cannot cover every floor, keep the earlier narrative slots
  // and drop from the tail. The caller filters zero-length results.
  let count = drafts.length;
  let floorSum = roundTime(floors.reduce((sum, value) => sum + value, 0));
  while (count > 1 && floorSum > targetSec + EPS) {
    count -= 1;
    floorSum = roundTime(floorSum - (floors[count] ?? 0));
  }

  const activeCaps = caps.slice(0, count);
  const out = floors.slice(0, count);
  const capSum = roundTime(activeCaps.reduce((sum, value) => sum + value, 0));

  if (targetSec >= capSum - EPS) {
    out.splice(0, out.length, ...activeCaps);
  } else {
    let remaining = roundTime(targetSec - floorSum);
    for (let pass = 0; pass < 16 && remaining > EPS; pass += 1) {
      const open: number[] = [];
      for (let index = 0; index < out.length; index += 1) {
        if ((out[index] ?? 0) < (activeCaps[index] ?? 0) - EPS) open.push(index);
      }
      if (open.length === 0) break;

      const share = remaining / open.length;
      let moved = 0;
      for (const index of open) {
        const cap = activeCaps[index] ?? 0;
        const current = out[index] ?? 0;
        const add = Math.min(share, cap - current);
        if (add <= EPS) continue;
        out[index] = current + add;
        moved += add;
      }
      remaining = roundTime(remaining - moved);
      if (moved <= EPS) break;
    }
  }

  const rounded = out.map(roundTime);
  let delta = roundTime(targetSec - rounded.reduce((sum, value) => sum + value, 0));

  for (let index = rounded.length - 1; index >= 0 && Math.abs(delta) > EPS; index -= 1) {
    const cap = activeCaps[index] ?? 0;
    const current = rounded[index] ?? 0;
    if (delta > 0) {
      const give = Math.min(delta, Math.max(0, cap - current));
      rounded[index] = roundTime(current + give);
      delta = roundTime(delta - give);
    } else {
      const take = Math.min(-delta, Math.max(0, current));
      rounded[index] = roundTime(current - take);
      delta = roundTime(delta + take);
    }
  }

  return rounded;
}

function finalise(
  drafts: readonly DraftSlot[],
  targets: readonly number[],
  reasonFor: (draft: DraftSlot, targetSec: number) => string,
): TimelineSlot[] {
  const slots: TimelineSlot[] = [];

  drafts.forEach((draft, index) => {
    const targetSec = roundTime(targets[index] ?? 0);
    if (targetSec <= 0) return;

    slots.push({
      order: slots.length,
      beat: draft.beat,
      shotId: draft.shot.id,
      room: draft.shot.room,
      inSec: roundTime(draft.shot.startSec),
      outSec: roundTime(draft.shot.endSec),
      targetSec,
      reason: reasonFor(draft, targetSec),
    });
  });

  return slots;
}

function draftMarketing(
  shots: readonly TaggedShot[],
  options: ResolvedOptions,
): DraftSlot[] {
  const drafts: DraftSlot[] = [];
  const used = new Set<string>();
  let previousRoom: Room | undefined;

  for (const spec of MARKETING_BEATS) {
    const shot = pickForBeat(shots, spec, used, previousRoom);
    if (!shot) continue;

    used.add(shot.id);
    previousRoom = shot.room;
    drafts.push({
      beat: spec.beat,
      shot,
      capSec: roundTime(Math.min(options.maxShotSec, shotDuration(shot))),
      intent: `Marketing ${spec.beat} beat`,
    });
  }

  return drafts;
}

function draftPriceLed(
  shots: readonly TaggedShot[],
  options: ResolvedOptions,
): DraftSlot[] {
  const drafts: DraftSlot[] = [];
  const used = new Set<string>();
  let previousRoom: Room | undefined;

  for (const spec of PRICE_LED_BEATS) {
    const shot = pickForBeat(shots, spec, used, previousRoom);
    if (!shot) continue;

    used.add(shot.id);
    previousRoom = shot.room;
    drafts.push({
      beat: spec.beat,
      shot,
      capSec: roundTime(Math.min(options.maxShotSec, shotDuration(shot))),
      intent: `Price-led ${spec.beat} beat`,
    });
  }

  return drafts;
}

/** Hook → light → ritual → craft → space → entrance → price → close. */
export function buildMarketingOrder(
  shots: readonly TaggedShot[],
  facts: Facts,
  options: PresetOptions = {},
): TimelineSlot[] {
  const resolved = resolveOptions(options, DEFAULT_PRESET_TARGET_SEC);
  const usable = usableShots(shots, resolved.minShotSec);
  const drafts = draftMarketing(usable, resolved);
  if (drafts.length === 0) return [];

  const targets = allocateTargets(
    drafts,
    resolved.targetDurationSec ?? DEFAULT_PRESET_TARGET_SEC,
    resolved.minShotSec,
  );
  return finalise(drafts, targets, (draft, targetSec) => marketingReason(draft, facts, targetSec));
}

/**
 * Keeps the source order exactly and only repairs pacing: too-short shots are
 * dropped, long shots are capped, and an explicit target trims from the tail.
 */
export function buildOriginalOrder(
  shots: readonly TaggedShot[],
  facts: Facts,
  options: PresetOptions = {},
): TimelineSlot[] {
  const resolved = resolveOptions(options);
  const usable = usableShots(shots, resolved.minShotSec);
  if (usable.length === 0) return [];

  const drafts: DraftSlot[] = usable.map((shot) => ({
    beat: 'original',
    shot,
    capSec: roundTime(Math.min(resolved.maxShotSec, shotDuration(shot))),
    intent: 'Source-order shot',
  }));

  const fullLength = roundTime(drafts.reduce((sum, draft) => sum + draft.capSec, 0));
  const targets = allocateTargets(
    drafts,
    resolved.targetDurationSec ?? fullLength,
    resolved.minShotSec,
  );

  return finalise(drafts, targets, (draft, targetSec) => {
    const duration = shotDuration(draft.shot);
    const trimmed = targetSec < duration - 0.05;
    const room = draft.shot.room === 'unknown' ? 'shot' : `${draft.shot.room} shot`;
    return trimmed
      ? `Source order: kept the ${room} at ${sec(targetSec)} from ${sec(duration)} to repair pacing.`
      : `Source order: kept the ${room} at ${sec(targetSec)}.`;
  });
}

/** Price question → flat reveal → light → ritual → craft → space → late entrance → price → close. */
export function buildPriceLedOrder(
  shots: readonly TaggedShot[],
  facts: Facts,
  options: PresetOptions = {},
): TimelineSlot[] {
  const resolved = resolveOptions(options, DEFAULT_PRESET_TARGET_SEC);
  const usable = usableShots(shots, resolved.minShotSec);
  const drafts = draftPriceLed(usable, resolved);
  if (drafts.length === 0) return [];

  const targets = allocateTargets(
    drafts,
    resolved.targetDurationSec ?? DEFAULT_PRESET_TARGET_SEC,
    resolved.minShotSec,
  );
  return finalise(drafts, targets, (draft, targetSec) => priceLedReason(draft, facts, targetSec));
}

/** Dispatches to the pure preset function named by `preset`. */
export function orderForPreset(
  preset: PresetId,
  shots: readonly TaggedShot[],
  facts: Facts,
  options: PresetOptions = {},
): TimelineSlot[] {
  switch (preset) {
    case 'marketing':
      return buildMarketingOrder(shots, facts, options);
    case 'price_led':
      return buildPriceLedOrder(shots, facts, options);
    case 'original':
      return buildOriginalOrder(shots, facts, options);
    default: {
      const exhaustive: never = preset;
      throw new RangeError(`Unknown preset "${String(exhaustive)}".`);
    }
  }
}
