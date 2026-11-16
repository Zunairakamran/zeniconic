/**
 * The 38-second marketing cut.
 *
 * This is deliberately not a room-order tour. The client rejected the
 * "hook, address, price" walkthrough because it read as a catalogue rather than
 * a campaign. The marketing sheet sells an idea of living: a moving hook, the
 * light, a daily ritual, the craft of the place, the space, the way in, then the
 * price and the close.
 *
 * Everything here is deterministic: the same request, candidate pool and seed
 * produce the same EDL byte for byte. Time and ids are injected.
 *
 * Two rules shape the assembly:
 *
 * 1. Beat boundaries come first. The eight beats have fixed windows that sum to
 *    exactly 38.000 s; music may pull an interior boundary by at most 80 ms, so
 *    a cut is always on the beat grid when the track has one.
 * 2. Transition handles are explicit. An `xfade` normally shortens the film by
 *    its overlap; `handleOutSec` borrows that much source picture past the
 *    clip's nominal out point, so the FFmpeg graph assembles to exactly 38 s.
 */

import { roundTime, snapToBeat } from '@zeniconic/core';
import { EDL_VERSION, assertEdl } from '@zeniconic/edl';
import type {
  CaptionWord,
  Clip,
  Edl,
  Overlay,
  Room,
  Transform,
  Transition,
  TransitionType,
} from '@zeniconic/edl';
import type { Candidate, Facts, PlanRequest } from './types';

export const MARKETING_FORMAT_ID = 'marketing_38';
export const MARKETING_LABEL = 'Marketing 38';
export const MARKETING_DURATION_SEC = 38;

/** The house ceiling for a single marketing clip. */
export const MARKETING_MIN_SHOT_SEC = 1.2;
export const MARKETING_MAX_SHOT_SEC = 4.5;
/** Average shot length that makes a marketing cut feel like a campaign. */
export const MARKETING_AVERAGE_SHOT_SEC = 2.4;
/** Music may pull a beat boundary this far; it never moves the hook or close. */
export const MARKETING_BEAT_TOLERANCE_SEC = 0.08;

const CLIP_VOLUME_DB = -18;
const TRUE_PEAK_DBTP = -1.5;
const PIPELINE_VERSION = '0.1.0';
const PLANNING_MODEL = 'local-planner';
const PLANNING_PROMPT = 'planner-marketing-v1';
const MAX_OVERLAY_TEXT = 90;
const MAX_REASON_TEXT = 160;
const EPS = 1e-6;

export type MarketingBeatId =
  | 'hook'
  | 'light'
  | 'ritual'
  | 'craft'
  | 'space'
  | 'entrance'
  | 'price'
  | 'close';

export interface MarketingBeat {
  id: MarketingBeatId;
  label: string;
  /** Seconds on the assembled timeline. */
  startSec: number;
  endSec: number;
  /** Rooms this beat wants, best first. */
  rooms: Room[];
  /** The claim the caption carries. `{spec}`, `{price}` and `{address}` fill from facts. */
  claim: string;
}

/**
 * The sheet. Windows are the brief's numbers and sum to exactly 38.000 s:
 * 2.2 + 4.3 + 5.5 + 6 + 5 + 5.5 + 5 + 4.5.
 */
export const MARKETING_BEATS: readonly MarketingBeat[] = [
  {
    id: 'hook',
    label: 'Hook',
    startSec: 0,
    endSec: 2.2,
    // Living is the hero room. Exterior/building/amenity/view can carry it when
    // the listing has no living shot, but the entry and bathroom never open.
    rooms: ['living', 'exterior', 'building', 'amenity', 'view'],
    claim: 'Come inside',
  },
  {
    id: 'light',
    label: 'Light',
    startSec: 2.2,
    endSec: 6.5,
    rooms: ['living', 'bedroom', 'balcony', 'view', 'dining'],
    claim: 'Light, from the first hour',
  },
  {
    id: 'ritual',
    label: 'Ritual',
    startSec: 6.5,
    endSec: 12,
    rooms: ['kitchen', 'dining', 'living'],
    claim: 'Slow mornings start here',
  },
  {
    id: 'craft',
    label: 'Craft',
    startSec: 12,
    endSec: 18,
    rooms: ['kitchen', 'bathroom', 'living'],
    claim: 'Built to be lived in',
  },
  {
    id: 'space',
    label: 'Space and spec',
    startSec: 18,
    endSec: 23,
    rooms: ['living', 'bedroom', 'dining', 'kitchen'],
    claim: '{spec}',
  },
  {
    id: 'entrance',
    label: 'Entrance',
    startSec: 23,
    endSec: 28.5,
    // The door first, then the hall/living sightline. The reveal is the one
    // place the cut is allowed to shout.
    rooms: ['entry', 'living', 'bedroom'],
    claim: 'Your own way in',
  },
  {
    id: 'price',
    label: 'Price',
    startSec: 28.5,
    endSec: 33.5,
    rooms: ['living', 'bedroom', 'view', 'exterior', 'balcony'],
    claim: '{price}',
  },
  {
    id: 'close',
    label: 'Close',
    startSec: 33.5,
    endSec: 38,
    rooms: ['bedroom', 'living', 'balcony', 'view', 'exterior'],
    claim: '{address}',
  },
];

/** The beat a timeline second belongs to, or the last beat past the end. */
export function marketingBeatAt(second: number): MarketingBeat {
  const beat = MARKETING_BEATS.find(
    (entry) => second >= entry.startSec - 1e-9 && second < entry.endSec - 1e-9,
  );
  return beat ?? MARKETING_BEATS[MARKETING_BEATS.length - 1]!;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

interface TransitionPlan {
  /** Seconds on the assembled timeline where the cut sits. */
  atSec: number;
  type: TransitionType;
  durationSec: number;
}

/**
 * The transition sheet. One loud transition (the entrance reveal), one light
 * leak landing on 12 s, a zoom-blur into the first craft detail, a luma wipe
 * into the price and a single whip in. Everything else is a hard cut.
 */
export const MARKETING_TRANSITIONS: readonly TransitionPlan[] = [
  { atSec: 2.2, type: 'whip', durationSec: 0.2 },
  { atSec: 12, type: 'light_leak', durationSec: 0.3 },
  { atSec: 23, type: 'zoom_blur', durationSec: 0.6 },
  { atSec: 28.5, type: 'luma_wipe', durationSec: 0.35 },
];

const CRAFT_ZOOM_BLUR_SEC = 0.25;

const CUT: Transition = { type: 'cut', durationSec: 0 };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clampText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function marketingTransform(): Transform {
  return {
    mode: 'cover',
    focus: 'saliency',
    path: [
      { t: 0, x: 0.5, y: 0.5, scale: 1.05 },
      { t: 1, x: 0.5, y: 0.5, scale: 1.11 },
    ],
  };
}

function clipId(index: number): string {
  return `c${String(index + 1).padStart(2, '0')}`;
}

function overlayId(index: number): string {
  return `o${String(index + 1).padStart(2, '0')}`;
}

function lufsFor(profile: PlanRequest['profile']): number {
  return profile === 'landscape' ? -16 : -14;
}

/** `AED 1,850,000`: the confirmed string, with the currency only if absent. */
export function marketingPrice(facts: Facts): string | undefined {
  const raw = facts.price?.trim() ?? '';
  if (raw.length === 0) return undefined;
  if (/[A-Za-z]{2,}/.test(raw)) return raw;
  const currency = facts.currency.trim().toUpperCase();
  return currency.length > 0 ? `${currency} ${raw}` : raw;
}

function marketingSpec(facts: Facts): string | undefined {
  const parts: string[] = [];
  if (facts.beds !== undefined) parts.push(`${String(facts.beds)} bed`);
  if (facts.baths !== undefined) parts.push(`${String(facts.baths)} bath`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

interface PoolEntry {
  candidate: Candidate;
  /** Source seconds available. */
  available: number;
  score: number;
  motion?: number;
  sellingPoints?: string[];
}

/** Hero score: movement first, then measured quality. */
function heroScore(entry: PoolEntry): number {
  const motion = entry.motion ?? 0;
  return 0.55 * motion + 0.45 * entry.score;
}

function roomRank(rooms: readonly Room[], room: Room): number {
  const index = rooms.indexOf(room);
  return index === -1 ? rooms.length : index;
}

/**
 * `validateEdl` treats a forward jump inside one source as an unmarked gap.
 * Avoid cutting from an early timecode of a file to a later one back to back.
 */
function canFollow(previous: Candidate | undefined, next: Candidate): boolean {
  if (previous === undefined) return true;
  const sameSource = previous.sourceId === next.sourceId || previous.src === next.src;
  if (!sameSource) return true;
  return next.inSec - previous.outSec <= 0.001;
}

function makePool(candidates: readonly Candidate[]): PoolEntry[] {
  const seen = new Set<string>();
  const pool: PoolEntry[] = [];

  const sorted = [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.shotId < right.shotId ? -1 : left.shotId > right.shotId ? 1 : 0;
  });

  for (const candidate of sorted) {
    if (seen.has(candidate.shotId)) continue;
    seen.add(candidate.shotId);
    const available = candidate.outSec - candidate.inSec;
    if (!Number.isFinite(candidate.score)) continue;
    if (!Number.isFinite(available)) continue;
    if (available + EPS < MARKETING_MIN_SHOT_SEC) continue;
    pool.push({
      candidate,
      available,
      score: clamp01(candidate.score),
      ...(candidate.motion === undefined || !Number.isFinite(candidate.motion)
        ? {}
        : { motion: clamp01(candidate.motion) }),
      ...(candidate.sellingPoints === undefined
        ? {}
        : { sellingPoints: [...candidate.sellingPoints] }),
    });
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Hook selection
// ---------------------------------------------------------------------------

/** A hook may never open on a detail room. */
const HOOK_FORBIDDEN_ROOMS: ReadonlySet<Room> = new Set(['bedroom', 'bathroom', 'kitchen']);

/** Rooms that can carry a hero when the listing has no living shot. */
const HOOK_FALLBACK_ROOMS: readonly Room[] = [
  'view',
  'exterior',
  'balcony',
  'amenity',
  'building',
];

/** Tags that read as light or outlook; a hero with one wins near-ties. */
const WINDOW_TAGS: ReadonlySet<string> = new Set([
  'natural_light',
  'view_skyline',
  'view_water',
  'balcony_access',
  'floor_to_ceiling_windows',
  'garden',
  'pool',
]);

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function windowBonus(entry: PoolEntry): number {
  return entry.sellingPoints?.some((tag) => WINDOW_TAGS.has(tag)) === true ? 0.05 : 0;
}

/**
 * Slot 0.
 *
 * A living (or second hall) shot only. The hook must be above the pool's median
 * motion — a static wide is an establishing shot, not a hook — and ties go to a
 * shot whose tags mention light, a view or a balcony. When nothing clears the
 * gate, fall back to the *widest* legal shot, never the highest raw score: a
 * sharper detail shot is still the wrong opening.
 *
 * Entry shots are reserved for the entrance reveal; the hook will only use one
 * when the listing has at least two doors.
 */
function pickHook(pool: readonly PoolEntry[], requiredSec: number): PoolEntry {
  const entryShots = pool.filter((entry) => entry.candidate.room === 'entry');
  const living = pool.filter((entry) => entry.candidate.room === 'living');
  const hallAllowed = entryShots.length > 1;

  let heroPool = living.length > 0 ? living : hallAllowed ? entryShots : [];
  const canCarry = (entry: PoolEntry): boolean => entry.available + EPS >= requiredSec;

  if (heroPool.length === 0 || !heroPool.some(canCarry)) {
    heroPool = pool.filter(
      (entry) =>
        !HOOK_FORBIDDEN_ROOMS.has(entry.candidate.room) &&
        entry.candidate.room !== 'entry' &&
        HOOK_FALLBACK_ROOMS.includes(entry.candidate.room),
    );
  }

  if (heroPool.length === 0) {
    throw new RangeError(
      'The marketing hook needs a living, hall, view or exterior shot; the pool has only detail rooms',
    );
  }

  const usable = heroPool.filter(canCarry);
  if (usable.length === 0) {
    throw new RangeError(
      `The marketing hook needs a hero shot at least ${requiredSec.toFixed(2)}s long`,
    );
  }

  const medianMotion = median(
    pool
      .map((entry) => entry.motion)
      .filter((motion): motion is number => motion !== undefined),
  );

  const qualified =
    medianMotion === undefined
      ? []
      : usable.filter((entry) => entry.motion !== undefined && entry.motion > medianMotion);

  const ranked = (qualified.length > 0 ? qualified : usable).sort((left, right) => {
    if (qualified.length > 0) {
      const delta = heroScore(right) + windowBonus(right) - (heroScore(left) + windowBonus(left));
      if (Math.abs(delta) > 1e-9) return delta;
    }
    // No shot clears the motion gate: the widest legal shot wins, then score.
    if (right.available !== left.available) return right.available - left.available;
    if (right.score !== left.score) return right.score - left.score;
    return left.candidate.shotId < right.candidate.shotId ? -1 : 1;
  });

  const chosen = ranked[0];
  if (chosen === undefined) {
    throw new RangeError('The candidate pool has no usable hook shot');
  }
  if (HOOK_FORBIDDEN_ROOMS.has(chosen.candidate.room)) {
    throw new RangeError(
      `The marketing hook resolved to a ${chosen.candidate.room} shot, which is never allowed`,
    );
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Beat windows
// ---------------------------------------------------------------------------

function baseBoundaries(): number[] {
  return MARKETING_BEATS.map((beat) => beat.startSec).concat(
    MARKETING_BEATS[MARKETING_BEATS.length - 1]?.endSec ?? MARKETING_DURATION_SEC,
  );
}

/**
 * Beat boundaries after the music pulls interior cuts. The hook always starts
 * at 0, the close always ends at 38, and a pull is capped at 80 ms per boundary
 * so the sheet survives a track whose grid does not land on the half-second.
 */
export function marketingBoundaries(beatGrid: readonly number[]): number[] {
  const base = baseBoundaries();
  const beats = beatGrid.filter((beat) => Number.isFinite(beat));
  const out = base.map((value, index) => {
    if (index === 0 || index === base.length - 1) return roundTime(value);
    return beats.length === 0
      ? roundTime(value)
      : snapToBeat(value, [...beats], MARKETING_BEAT_TOLERANCE_SEC);
  });

  // Snapping two neighbours toward each other can never invert the sheet with
  // an 80 ms pull, but guard the arithmetic anyway.
  for (let index = 1; index < out.length; index += 1) {
    const previous = out[index - 1] ?? 0;
    const current = out[index] ?? previous;
    if (current <= previous + MARKETING_MIN_SHOT_SEC) out[index] = roundTime(previous + 0.1);
  }
  return out;
}

/** Equal split of a window, rounded to milliseconds with the drift on the last. */
function splitEven(windowSec: number, count: number): number[] {
  const share = Math.floor((windowSec * 1000) / count) / 1000;
  const durations = Array.from({ length: count }, () => share);
  const drift = roundTime(windowSec - share * count);
  const last = durations.length - 1;
  if (last >= 0) durations[last] = roundTime((durations[last] ?? 0) + drift);
  return durations;
}

// ---------------------------------------------------------------------------
// Shot assignment
// ---------------------------------------------------------------------------

interface Slot {
  beatIndex: number;
  beat: MarketingBeat;
  /** Index inside the beat. */
  position: number;
  durationSec: number;
  /** Source seconds the outgoing clip must lend its transition. */
  handleOutSec: number;
  /** Duration of the transition entering this slot (0 for a cut). */
  transitionInSec: number;
  transitionInType: TransitionType;
}

function transitionAt(boundarySec: number): TransitionPlan | undefined {
  return MARKETING_TRANSITIONS.find(
    (entry) => Math.abs(entry.atSec - boundarySec) <= MARKETING_BEAT_TOLERANCE_SEC + 0.02,
  );
}

/**
 * The transition entering a slot. Beat starts use the sheet; the first internal
 * craft cut gets the zoom-blur that puts the detail beat in motion.
 */
function entryTransition(
  beatIndex: number,
  position: number,
  boundaries: readonly number[],
): { type: TransitionType; durationSec: number } {
  if (position === 0) {
    const start = boundaries[beatIndex] ?? 0;
    const planned = transitionAt(start);
    if (planned !== undefined) return { type: planned.type, durationSec: planned.durationSec };
    return { ...CUT };
  }
  const beat = MARKETING_BEATS[beatIndex];
  if (beat?.id === 'craft' && position === 1) {
    return { type: 'zoom_blur', durationSec: CRAFT_ZOOM_BLUR_SEC };
  }
  return { ...CUT };
}

interface BeatLayout {
  beatIndex: number;
  count: number;
  durations: number[];
}

function slotsFor(layout: BeatLayout, boundaries: readonly number[]): Slot[] {
  const beat = MARKETING_BEATS[layout.beatIndex];
  if (beat === undefined) return [];
  return layout.durations.map((durationSec, position) => {
    const incoming = entryTransition(layout.beatIndex, position, boundaries);
    const outgoing =
      position === layout.durations.length - 1
        ? (transitionAt(boundaries[layout.beatIndex + 1] ?? beat.endSec) ?? undefined)
        : position + 1 < layout.durations.length
          ? entryTransition(layout.beatIndex, position + 1, boundaries)
          : undefined;
    return {
      beatIndex: layout.beatIndex,
      beat,
      position,
      durationSec,
      transitionInSec: incoming.durationSec,
      transitionInType: incoming.type,
      handleOutSec:
        outgoing === undefined || outgoing.durationSec <= 0 ? 0 : roundTime(outgoing.durationSec),
    };
  });
}

interface Assignment {
  slot: Slot;
  entry: PoolEntry;
}

function sortForSlot(
  entries: readonly PoolEntry[],
  slot: Slot,
  previous: PoolEntry | undefined,
  hook: boolean,
): PoolEntry[] {
  return [...entries].sort((left, right) => {
    if (hook) {
      const delta = heroScore(right) - heroScore(left);
      if (Math.abs(delta) > 1e-9) return delta;
    }
    const rankDelta = roomRank(slot.beat.rooms, left.candidate.room) - roomRank(slot.beat.rooms, right.candidate.room);
    if (rankDelta !== 0) return rankDelta;

    const sameRoomLeft = previous !== undefined && previous.candidate.room === left.candidate.room;
    const sameRoomRight = previous !== undefined && previous.candidate.room === right.candidate.room;
    if (sameRoomLeft !== sameRoomRight) return sameRoomLeft ? 1 : -1;

    if (right.score !== left.score) return right.score - left.score;
    if (left.candidate.shotId === right.candidate.shotId) return 0;
    return left.candidate.shotId < right.candidate.shotId ? -1 : 1;
  });
}

/**
 * Greedy, deterministic assignment for one beat. A slot only accepts a shot
 * that can carry its duration *and* the transition handle it must lend, so the
 * assembled film can never come up short.
 *
 * Two marketing rules override the ranking:
 *   - the entrance beat's first slot must be the door shot when one exists;
 *   - the reserved door shot is never spent on any other beat, so it is still
 *     there at 23 s.
 */
function assignBeat(
  slots: readonly Slot[],
  pool: readonly PoolEntry[],
  used: ReadonlySet<string>,
  previous: PoolEntry | undefined,
  options: { forcedFirst?: PoolEntry; reservedEntryId?: string } = {},
): Assignment[] | undefined {
  const taken = new Set(used);
  const result: Assignment[] = [];
  let last = previous;

  for (const slot of slots) {
    const required = roundTime(slot.durationSec + slot.handleOutSec);
    const fits = (entry: PoolEntry): boolean =>
      !taken.has(entry.candidate.shotId) &&
      entry.available + EPS >= required &&
      canFollow(last?.candidate, entry.candidate);

    const forceFirst = result.length === 0 && options.forcedFirst !== undefined;

    let eligible = pool.filter(fits);

    if (forceFirst) {
      const forced = options.forcedFirst;
      eligible = forced !== undefined && fits(forced) ? [forced] : [];
    } else if (options.reservedEntryId !== undefined) {
      // The door shot is reserved for the entrance reveal; no other beat may
      // spend it, so it is still there at 23 s.
      eligible = eligible.filter((entry) => entry.candidate.shotId !== options.reservedEntryId);
    }

    const chosen = sortForSlot(eligible, slot, last, slot.beat.id === 'hook')[0];
    if (chosen === undefined) return undefined;
    taken.add(chosen.candidate.shotId);
    result.push({ slot, entry: chosen });
    last = chosen;
  }

  return result;
}

/**
 * Tries the beat's natural clip count, then the nearest alternatives. A poor
 * pool (all short shots) needs more clips; a rich pool of long shots needs
 * fewer. The result is stable because the order is fixed.
 */
function layoutBeat(
  beatIndex: number,
  boundaries: readonly number[],
  pool: readonly PoolEntry[],
  used: ReadonlySet<string>,
  previous: PoolEntry | undefined,
  options: { forcedFirst?: PoolEntry; reservedEntryId?: string } = {},
): Assignment[] | undefined {
  const start = boundaries[beatIndex] ?? 0;
  const end = boundaries[beatIndex + 1] ?? start;
  const windowSec = roundTime(end - start);
  if (windowSec < MARKETING_MIN_SHOT_SEC) return undefined;

  const natural = Math.max(
    1,
    Math.round(windowSec / MARKETING_AVERAGE_SHOT_SEC),
    Math.ceil((windowSec - EPS) / MARKETING_MAX_SHOT_SEC),
  );
  const maxCount = Math.max(1, Math.floor(windowSec / MARKETING_MIN_SHOT_SEC));
  const available = pool.filter((entry) => !used.has(entry.candidate.shotId)).length;
  const ceiling = Math.max(1, Math.min(maxCount, available));

  const order: number[] = [];
  const push = (count: number): void => {
    if (count >= 1 && count <= ceiling && !order.includes(count)) order.push(count);
  };
  push(natural);
  for (let delta = 1; delta <= Math.max(natural, ceiling); delta += 1) {
    push(natural - delta);
    push(natural + delta);
  }

  const attempt = (attemptOptions: { forcedFirst?: PoolEntry; reservedEntryId?: string }):
    | Assignment[]
    | undefined => {
    for (const count of order) {
      const durations = splitEven(windowSec, count);
      if (durations.some((duration) => duration + EPS < MARKETING_MIN_SHOT_SEC)) continue;
      if (durations.some((duration) => duration - EPS > MARKETING_MAX_SHOT_SEC)) continue;
      const layout: BeatLayout = { beatIndex, count, durations };
      const slots = slotsFor(layout, boundaries);
      const assignment = assignBeat(slots, pool, used, previous, attemptOptions);
      if (assignment !== undefined) return assignment;
    }
    return undefined;
  };

  const strict = attempt(options);
  if (strict !== undefined) return strict;

  // A forced door that cannot carry any layout is the only reason to fall
  // back — a real door shot always fits one of the counts above.
  if (options.forcedFirst !== undefined) {
    return attempt({
      ...(options.reservedEntryId === undefined
        ? {}
        : { reservedEntryId: options.reservedEntryId }),
    });
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

const MAX_CAPTION_WORDS_PER_LINE = 6;
const MAX_CAPTION_LINES = 2;

function wordsOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

function claimFor(beat: MarketingBeat, facts: Facts): string {
  const spec = marketingSpec(facts);
  const price = marketingPrice(facts);
  switch (beat.id) {
    case 'space':
      return spec ?? 'Room to breathe';
    case 'price':
      return price ?? '';
    case 'close':
      return facts.address.trim().length > 0 ? facts.address.trim() : 'Book a viewing';
    default:
      return beat.claim;
  }
}

/**
 * One cue per beat, at most six words per line and two lines. Word timings are
 * proportional to word length inside the cue window, so the burn-in path and
 * the sidecar agree and no cue ever crosses a beat boundary.
 */
export function marketingCaptionWords(
  facts: Facts,
  beatGrid: readonly number[],
): CaptionWord[] {
  const boundaries = marketingBoundaries(beatGrid);
  const words: CaptionWord[] = [];
  let previousEnd = 0;

  MARKETING_BEATS.forEach((beat, index) => {
    const start = boundaries[index] ?? beat.startSec;
    const end = boundaries[index + 1] ?? beat.endSec;
    const text = claimFor(beat, facts);
    if (text.trim().length === 0) return;

    const windowStart = roundTime(start + 0.15);
    const windowEnd = roundTime(Math.min(end - 0.1, windowStart + 2.6));
    if (windowEnd <= windowStart) return;
    const cueStart = Math.max(windowStart, previousEnd);
    if (cueStart >= windowEnd) return;

    const cues = wordsOf(text);
    if (cues.length === 0) return;
    const totalChars = cues.reduce((sum, word) => sum + word.length + 1, 0);
    let cursor = cueStart;

    for (const word of cues) {
      const share = ((word.length + 1) / totalChars) * (windowEnd - cueStart);
      const wordStart = roundTime(cursor);
      const wordEnd = roundTime(Math.min(windowEnd, cursor + share));
      if (wordEnd > wordStart) {
        words.push({ text: word, startSec: wordStart, endSec: wordEnd });
        previousEnd = wordEnd;
      }
      cursor += share;
    }
  });

  return words;
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

function overlaysFor(facts: Facts, boundaries: readonly number[]): Overlay[] {
  const overlays: Overlay[] = [];
  const at = (beat: MarketingBeatId, edge: 'start' | 'end'): number => {
    const index = MARKETING_BEATS.findIndex((entry) => entry.id === beat);
    if (index < 0) return 0;
    return boundaries[edge === 'start' ? index : index + 1] ?? 0;
  };

  const spec = marketingSpec(facts);
  if (spec !== undefined) {
    overlays.push({
      id: overlayId(overlays.length),
      kind: 'spec_row',
      text: clampText(spec, MAX_OVERLAY_TEXT),
      inSec: roundTime(at('space', 'start') + 0.2),
      outSec: roundTime(at('space', 'end') - 0.1),
      anchor: 'bottom_center',
      style: 'spec_pill',
      maxWidthPct: 76,
      opacity: 0.94,
      animation: 'rise',
    });
  }

  overlays.push({
    id: overlayId(overlays.length),
    kind: 'lower_third',
    text: 'Your own way in',
    inSec: roundTime(at('entrance', 'start') + 0.4),
    outSec: roundTime(at('entrance', 'end') - 0.4),
    anchor: 'bottom_left',
    style: 'caption',
    maxWidthPct: 78,
    opacity: 0.96,
    animation: 'slide_in',
  });

  const price = marketingPrice(facts);
  if (price !== undefined) {
    overlays.push({
      id: overlayId(overlays.length),
      kind: 'price',
      text: clampText(price, MAX_OVERLAY_TEXT),
      ...(spec === undefined ? {} : { subtext: clampText(spec, MAX_OVERLAY_TEXT) }),
      inSec: at('price', 'start'),
      outSec: at('price', 'end'),
      anchor: 'bottom_center',
      style: 'price_lower',
      maxWidthPct: 84,
      opacity: 1,
      animation: 'count_up',
    });
    overlays.push({
      id: overlayId(overlays.length),
      kind: 'logo',
      inSec: at('price', 'start'),
      outSec: at('close', 'end'),
      anchor: 'top_left',
      style: 'logo_corner',
      maxWidthPct: 34,
      opacity: 0.9,
      animation: 'fade',
    });
  }

  const address = facts.address.trim();
  if (address.length > 0) {
    overlays.push({
      id: overlayId(overlays.length),
      kind: 'address',
      text: clampText(address, MAX_OVERLAY_TEXT),
      // The brief forbids the address before 30 s; the close beat starts at
      // 33.5 s, so this can never leak into the hook or the price card.
      inSec: at('close', 'start'),
      outSec: at('close', 'end'),
      anchor: 'bottom_left',
      style: 'address_tag',
      maxWidthPct: 72,
      opacity: 1,
      animation: 'rise',
    });
  }

  overlays.push({
    id: overlayId(overlays.length),
    kind: 'cta',
    text: 'Book a viewing',
    inSec: at('close', 'start'),
    outSec: at('close', 'end'),
    anchor: 'bottom_center',
    style: 'cta_card',
    maxWidthPct: 80,
    opacity: 1,
    animation: 'fade',
  });

  return overlays;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function toClip(assignment: Assignment, index: number): Clip {
  const { slot, entry } = assignment;
  const { candidate } = entry;
  const duration = slot.durationSec;
  const handle = slot.handleOutSec;
  const transitionIn: Transition =
    slot.transitionInType === 'cut' || slot.transitionInSec <= 0
      ? { ...CUT }
      : { type: slot.transitionInType, durationSec: roundTime(slot.transitionInSec) };

  const reason =
    `${slot.beat.label} beat: ${candidate.room} shot ${slot.position + 1} of ${slot.beat.id}` +
    (handle > 0 ? ` with a ${handle.toFixed(2)}s handle.` : '.');

  return {
    id: clipId(index),
    sourceId: candidate.sourceId,
    src: candidate.src,
    inSec: roundTime(candidate.inSec),
    outSec: roundTime(candidate.inSec + duration),
    speed: 1,
    volumeDb: CLIP_VOLUME_DB,
    room: candidate.room,
    transform: marketingTransform(),
    transitionIn,
    transitionOut: { ...CUT },
    ...(handle > 0 ? { handleOutSec: roundTime(handle) } : {}),
    ...(entry.motion === undefined ? {} : { motionAtSelection: roundTime(entry.motion) }),
    reason: clampText(reason, MAX_REASON_TEXT),
    scoreAtSelection: roundTime(entry.score),
  };
}

/**
 * Plans the 38-second marketing cut. Throws a `RangeError` when the pool cannot
 * carry the sheet; it never silently produces a shorter film.
 */
export function planMarketing(request: PlanRequest): Edl {
  const pool = makePool(request.candidates);
  if (pool.length === 0) {
    throw new RangeError(
      `No usable candidates: every shot is shorter than the ${MARKETING_MIN_SHOT_SEC}s minimum clip`,
    );
  }

  const boundaries = marketingBoundaries(request.music.beatGrid);
  const assignments: Assignment[] = [];
  const used = new Set<string>();
  let previous: PoolEntry | undefined;

  // The hook is chosen up front, never by the per-slot greedy pass, so a detail
  // room can never win slot 0 on a high score.
  const hookWindow = roundTime((boundaries[1] ?? MARKETING_BEATS[0]!.endSec) - (boundaries[0] ?? 0));
  const hookHandle = transitionAt(boundaries[1] ?? 2.2)?.durationSec ?? 0;
  const hook = pickHook(pool, roundTime(hookWindow + hookHandle));

  // One door shot is reserved for the entrance reveal. The best-scoring door
  // wins; if the listing has none, the entrance falls back to a hall/living.
  const entryShots = pool
    .filter((entry) => entry.candidate.room === 'entry')
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.available !== left.available) return right.available - left.available;
      return left.candidate.shotId < right.candidate.shotId ? -1 : 1;
    });
  const reservedEntry = entryShots[0];

  for (let index = 0; index < MARKETING_BEATS.length; index += 1) {
    const beat = MARKETING_BEATS[index];
    if (beat === undefined) continue;
    const assignment = layoutBeat(index, boundaries, pool, used, previous, {
      ...(index === 0 ? { forcedFirst: hook } : {}),
      ...(reservedEntry === undefined ? {} : { reservedEntryId: reservedEntry.candidate.shotId }),
      ...(beat.id === 'entrance' && reservedEntry !== undefined
        ? { forcedFirst: reservedEntry }
        : {}),
    });
    if (assignment === undefined) {
      throw new RangeError(
        `The candidate pool cannot carry the ${beat.label.toLowerCase()} beat (${beat.startSec}-${beat.endSec}s)`,
      );
    }
    for (const entry of assignment) {
      used.add(entry.entry.candidate.shotId);
      assignments.push(entry);
    }
    previous = assignment[assignment.length - 1]?.entry;
  }

  // Defensive: a detail room at slot 0 is the exact fault this sheet forbids.
  const firstRoom = assignments[0]?.entry.candidate.room;
  if (firstRoom === undefined || HOOK_FORBIDDEN_ROOMS.has(firstRoom)) {
    throw new RangeError('The marketing hook resolved to a detail room, which is never allowed');
  }

  const clips = assignments.map(toClip);

  // Mirror the outgoing transition so the EDL is self-consistent for any
  // renderer that reads `transitionOut` instead of the next `transitionIn`.
  clips.forEach((clip, index) => {
    const next = clips[index + 1];
    if (next === undefined) return;
    if (next.transitionIn.type !== 'cut' && next.transitionIn.durationSec > 0) {
      clip.transitionOut = { ...next.transitionIn };
    }
  });

  const captions = marketingCaptionWords(request.facts, request.music.beatGrid).map((word) => ({
    ...word,
  }));
  const overlays = overlaysFor(request.facts, boundaries);

  const edl: Edl = {
    edlVersion: EDL_VERSION,
    id: `edl_${MARKETING_FORMAT_ID.replace(/_/g, '-')}_v1`,
    listingId: request.listingId,
    createdAt: request.now,
    format: {
      id: MARKETING_FORMAT_ID,
      label: MARKETING_LABEL,
      targetDurationSec: MARKETING_DURATION_SEC,
    },
    look: { id: request.look.id, label: request.look.label },
    canvas: {
      profile: request.profile,
      width: request.canvas.width,
      height: request.canvas.height,
      fps: request.canvas.fps,
      safeArea: { ...request.canvas.safeArea },
    },
    clips,
    overlays,
    audio: {
      music: {
        trackId: request.music.trackId,
        src: request.music.src,
        gainDb: request.music.gainDb,
        duckUnderVoiceDb: request.music.duckUnderVoiceDb,
        beatGrid: [...request.music.beatGrid],
      },
      voice: { mode: 'keep' },
      mix: { lufs: lufsFor(request.profile), truePeakDbtp: TRUE_PEAK_DBTP },
    },
    captions: {
      mode: 'burn',
      style: 'social_bold',
      language: 'en-GB',
      ...(captions.length === 0 ? {} : { words: captions }),
    },
    provenance: {
      pipelineVersion: PIPELINE_VERSION,
      models: { tagging: 'n/a', planning: PLANNING_MODEL },
      promptVersions: { tagging: 'n/a', planning: PLANNING_PROMPT },
      costUsd: 0,
    },
  };

  assertEdl(edl);
  return edl;
}

/** Re-exported so the review layer and tests share one caption contract. */
export const MARKETING_CAPTION_LIMITS = {
  maxWordsPerLine: MAX_CAPTION_WORDS_PER_LINE,
  maxLines: MAX_CAPTION_LINES,
} as const;
