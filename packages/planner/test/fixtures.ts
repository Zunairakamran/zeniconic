import type { FormatId, LookId, Profile, Room, SafeArea } from '@zeniconic/edl';
import type { Candidate, FormatSpec, LookSpec, PlanRequest } from '../src/index';

export const PROFILES: Profile[] = [
  'vertical-social',
  'feed-portrait',
  'landscape',
  'pin',
];

export const PROFILE_CANVAS: Record<
  Profile,
  { width: number; height: number; safeArea: SafeArea }
> = {
  'vertical-social': {
    width: 1080,
    height: 1920,
    safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
  },
  'feed-portrait': {
    width: 1080,
    height: 1350,
    safeArea: { top: 180, bottom: 220, left: 60, right: 120 },
  },
  landscape: {
    width: 1920,
    height: 1080,
    safeArea: { top: 60, bottom: 80, left: 90, right: 90 },
  },
  pin: {
    width: 1000,
    height: 1500,
    safeArea: { top: 160, bottom: 200, left: 60, right: 60 },
  },
};

const FORMATS: { id: FormatId; label: string }[] = [
  { id: 'cinematic_hero', label: 'Cinematic hero' },
  { id: 'social_hook', label: 'Social hook' },
  { id: 'room_walkthrough', label: 'Room walkthrough' },
  { id: 'just_listed', label: 'Just listed' },
  { id: 'vertical_tour', label: 'Vertical tour' },
  { id: 'drone_hero', label: 'Drone hero' },
];

const LOOKS: { id: LookId; label: string }[] = [
  { id: 'calm', label: 'Calm' },
  { id: 'social', label: 'Social' },
  { id: 'walkthrough', label: 'Walkthrough' },
  { id: 'editorial', label: 'Editorial' },
];

const ROOMS: Room[] = [
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
];

const ADDRESSES = [
  '14 Oak Avenue, Richmond TW9',
  '8 Harbour Walk, Bristol BS1',
  '27 Elm Gardens, Leeds LS6',
  '3 Chapel Lane, Bath BA1',
];

/**
 * Targets sized to what a pool can carry. A 3-shot pool cannot fill 30s at
 * 1.2–4.5s per cut, so the fixture asks for a shorter format instead of
 * handing the planner an impossible request.
 */
function targetForCount(count: number): number {
  if (count <= 4) return 5;
  if (count <= 6) return 8;
  if (count <= 9) return 10;
  if (count <= 12) return 15;
  if (count <= 15) return 20;
  if (count <= 18) return 25;
  return 30;
}

/** mulberry32: small, fast, and identical on every platform. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function sourceHex(seed: number, index: number): string {
  const base = (Math.imul(seed, 0x9e3779b1) >>> 0) + index * 0x85ebca6b;
  return (base >>> 0).toString(16).padStart(8, '0').slice(-8);
}

function shuffle<T>(values: T[], rng: () => number): T[] {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const a = out[index];
    const b = out[swap];
    if (a === undefined || b === undefined) continue;
    out[index] = b;
    out[swap] = a;
  }
  return out;
}

/** The hook the planner must choose: highest score, then lowest shot id. */
export function pickHook(candidates: Candidate[]): Candidate {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.shotId === b.shotId) return 0;
    return a.shotId < b.shotId ? -1 : 1;
  })[0] as Candidate;
}

export interface RequestOptions {
  count?: number;
  rooms?: number;
  targetSec?: number;
  price?: string;
  look?: LookId;
  format?: FormatId;
}

/**
 * Builds one deterministic request. Candidate order is shuffled, source shots
 * are 2.5–5s, and rooms get an even share so a no-repeat sequence is always
 * arrangeable.
 */
export function makeRequest(
  seed: number,
  profile: Profile = 'vertical-social',
  options: RequestOptions = {},
): PlanRequest {
  const rng = makeRng(seed);
  const count = options.count ?? 3 + Math.floor(rng() * 18); // 3..20
  const roomCount = Math.min(
    options.rooms ?? 2 + Math.floor(rng() * 7), // 2..8
    count,
    ROOMS.length,
  );
  const rooms = shuffle(ROOMS, rng).slice(0, roomCount);

  const candidates: Candidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const room = rooms[index % roomCount] ?? 'living';
    const hex = sourceHex(seed, index);
    const start = 1 + rng() * 10;
    const window = 2.5 + rng() * 2.5; // 2.5..5s source shots
    const score = Math.round((0.35 + rng() * 0.6) * 100) / 100;

    candidates.push({
      shotId: `sh_s${hex}_${String(index).padStart(3, '0')}`,
      sourceId: `s_${hex}`,
      src: `raw/${String(index + 1).padStart(2, '0')}_${room}.mp4`,
      room,
      score,
      inSec: round3(start),
      outSec: round3(start + window),
      reason: `Shot ${index + 1}: ${room} at ${round3(start)}s, score ${score}.`,
    });
  }

  const format = FORMATS[Math.floor(rng() * FORMATS.length)] ?? FORMATS[0];
  const look = options.look
    ? (LOOKS.find((entry) => entry.id === options.look) ?? LOOKS[0])
    : (LOOKS[Math.floor(rng() * LOOKS.length)] ?? LOOKS[0]);
  if (!format || !look) throw new Error('fixtures are missing format or look definitions');

  const formatSpec: FormatSpec = {
    id: options.format ?? format.id,
    label: format.label,
    targetDurationSec: options.targetSec ?? targetForCount(count),
  };
  const lookSpec: LookSpec = { id: look.id, label: look.label };

  const canvas = PROFILE_CANVAS[profile];
  const address = ADDRESSES[Math.floor(rng() * ADDRESSES.length)] ?? ADDRESSES[0] ?? '';
  const price = options.price ?? (seed % 2 === 0 ? '£845,000' : undefined);

  return {
    listingId: `${seed % 2 === 0 ? '2026-11-14' : '2026-11-15'}-${seed}-test-listing`,
    format: formatSpec,
    look: lookSpec,
    profile,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      fps: 30,
      safeArea: { ...canvas.safeArea },
    },
    candidates: shuffle(candidates, rng),
    facts: {
      address,
      ...(price === undefined ? {} : { price }),
      beds: 3,
      baths: 2,
      currency: 'GBP',
    },
    music: {
      trackId: 'test_bed_120',
      src: 'music/test/bed_120.m4a',
      beatGrid: Array.from({ length: 180 }, (_, index) => round3(0.25 + index * 0.5)),
      gainDb: -3.5,
      duckUnderVoiceDb: -18,
    },
    seed,
    now: '2026-11-14T16:42:09.000Z',
  };
}

/** 200 stable pool seeds for the property gate. */
export const POOL_SEEDS: number[] = Array.from({ length: 200 }, (_, index) => index + 1);
