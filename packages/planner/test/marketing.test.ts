import { describe, expect, it } from 'vitest';
import { validateEdl } from '@zeniconic/edl';
import type { Clip, Edl, Room } from '@zeniconic/edl';
import {
  MARKETING_BEATS,
  MARKETING_DURATION_SEC,
  marketingBoundaries,
  planMarketing,
} from '../src/index';
import type { Candidate, PlanRequest } from '../src/index';

const NOW = '2026-11-16T09:00:00.000Z';
/** The shipped bed's half-second grid; 2.2 s is off it and must stay put. */
const BEAT_GRID = Array.from({ length: 80 }, (_, index) => Math.round(index * 0.5 * 1000) / 1000);
/** A quarter-note grid, used to prove an interior boundary can be pulled. */
const QUARTER_GRID = Array.from({ length: 160 }, (_, index) => Math.round(index * 0.25 * 1000) / 1000);

interface ShotDef {
  room: Room;
  durationSec: number;
  score: number;
  motion: number;
}

/** Eighteen shots across the rooms the sheet asks for, longest first per room. */
const SHOTS: ShotDef[] = [
  { room: 'living', durationSec: 5.5, score: 0.9, motion: 0.12 },
  { room: 'living', durationSec: 4.5, score: 0.82, motion: 0.09 },
  { room: 'living', durationSec: 5, score: 0.8, motion: 0.07 },
  { room: 'living', durationSec: 4, score: 0.78, motion: 0.06 },
  { room: 'living', durationSec: 6, score: 0.75, motion: 0.05 },
  { room: 'living', durationSec: 3.5, score: 0.7, motion: 0.04 },
  { room: 'kitchen', durationSec: 5, score: 0.86, motion: 0.08 },
  { room: 'kitchen', durationSec: 4.5, score: 0.8, motion: 0.06 },
  { room: 'kitchen', durationSec: 4, score: 0.74, motion: 0.05 },
  { room: 'kitchen', durationSec: 3.5, score: 0.7, motion: 0.03 },
  { room: 'bedroom', durationSec: 5, score: 0.84, motion: 0.07 },
  { room: 'bedroom', durationSec: 4.5, score: 0.8, motion: 0.05 },
  { room: 'bedroom', durationSec: 4, score: 0.76, motion: 0.04 },
  { room: 'bedroom', durationSec: 3.5, score: 0.72, motion: 0.03 },
  { room: 'entry', durationSec: 4.5, score: 0.55, motion: 0.02 },
  { room: 'dining', durationSec: 2.5, score: 0.66, motion: 0.03 },
  { room: 'bathroom', durationSec: 4, score: 0.72, motion: 0.02 },
  { room: 'balcony', durationSec: 4, score: 0.8, motion: 0.04 },
];

function candidates(): Candidate[] {
  return SHOTS.map((shot, index) => {
    const inSec = Math.round((0.5 + index * 0.25) * 1000) / 1000;
    return {
      shotId: `sh_mkt_${String(index).padStart(3, '0')}`,
      sourceId: `s_${String(index).padStart(8, '0')}`,
      src: `raw/${shot.room}_${String(index).padStart(2, '0')}.mp4`,
      room: shot.room,
      score: shot.score,
      motion: shot.motion,
      inSec,
      outSec: Math.round((inSec + shot.durationSec) * 1000) / 1000,
      reason: `test ${shot.room} shot`,
    };
  });
}

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    listingId: 'marina-gate-1',
    format: { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 38 },
    look: { id: 'social', label: 'Social' },
    profile: 'vertical-social',
    canvas: {
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    candidates: candidates(),
    facts: {
      address: 'Marina Gate 1, Dubai Marina',
      price: '1,850,000',
      beds: 3,
      baths: 2,
      currency: 'AED',
    },
    music: {
      trackId: 'catchy_120',
      src: 'data/assets/music/catchy-120.m4a',
      beatGrid: BEAT_GRID,
      gainDb: -3.5,
      duckUnderVoiceDb: -18,
    },
    seed: 7,
    now: NOW,
    ...overrides,
  };
}

function starts(edl: Edl): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const clip of edl.clips) {
    out.push(Math.round(cursor * 1000) / 1000);
    cursor += (clip.outSec - clip.inSec) / clip.speed;
  }
  return out;
}

function clipAt(edl: Edl, second: number): Clip {
  const list = starts(edl);
  const index = list.findIndex((start) => Math.abs(start - second) <= 0.01);
  const clip = edl.clips[index];
  if (clip === undefined) throw new Error(`no clip starts at ${String(second)}`);
  return clip;
}

function total(edl: Edl): number {
  return Math.round(
    edl.clips.reduce((sum, clip) => sum + (clip.outSec - clip.inSec) / clip.speed, 0) * 1000,
  ) / 1000;
}

describe('marina-gate-1 fixture', () => {
  /**
   * The tagged marina-gate-1 pool, copied from
   * `data/listings/marina-gate-1/footage_index.tagged.json`. Motion is the
   * normalised 0..1 value `buildCandidates` stores; score is the tag / 100.
   * The point of the copy is that the regression is reproducible without
   * reading a listing folder from a package test.
   */
  interface MarinaShot {
    source: string;
    room: Room;
    inSec: number;
    durationSec: number;
    score: number;
    motion: number;
    sellingPoints: string[];
  }

  const MARINA: MarinaShot[] = [
    { source: 's_3c051edc', room: 'kitchen', inSec: 0, durationSec: 2, score: 0.72, motion: 0.14, sellingPoints: ['renovated', 'built_in_appliances'] },
    { source: 's_adeb9157', room: 'kitchen', inSec: 0, durationSec: 7.1, score: 0.78, motion: 0.233, sellingPoints: ['open_plan', 'island_bench', 'furnished', 'renovated'] },
    { source: 's_ee267360', room: 'entry', inSec: 0, durationSec: 4, score: 0.3, motion: 0.04, sellingPoints: ['entry_foyer'] },
    { source: 's_69917c17', room: 'dining', inSec: 0, durationSec: 2.2, score: 0.72, motion: 0.367, sellingPoints: ['open_plan', 'furnished', 'balcony_access'] },
    { source: 's_58630572', room: 'bathroom', inSec: 0, durationSec: 4.2, score: 0.78, motion: 0.18, sellingPoints: ['renovated', 'ensuite'] },
    { source: 's_72043e61', room: 'kitchen', inSec: 0, durationSec: 3.5, score: 0.75, motion: 0.093, sellingPoints: ['renovated', 'marble_countertop', 'integrated_appliances'] },
    { source: 's_399b4456', room: 'bedroom', inSec: 0, durationSec: 3.8, score: 0.75, motion: 0.233, sellingPoints: ['furnished', 'built_in_robes', 'high_ceiling'] },
    { source: 's_d3df6d80', room: 'bedroom', inSec: 0, durationSec: 4, score: 0.72, motion: 0.253, sellingPoints: ['furnished', 'balcony_access'] },
    { source: 's_b6a79bdf', room: 'living', inSec: 0, durationSec: 5.5, score: 0.75, motion: 0.227, sellingPoints: ['open_plan', 'furnished'] },
    { source: 's_75ae2076', room: 'bedroom', inSec: 0, durationSec: 4.4, score: 0.75, motion: 0.22, sellingPoints: ['furnished', 'high_ceiling'] },
    { source: 's_0fbd4ebc', room: 'living', inSec: 0, durationSec: 6, score: 0.65, motion: 0.38, sellingPoints: ['open_plan', 'furnished', 'high_ceiling'] },
    { source: 's_4b50559d', room: 'living', inSec: 0, durationSec: 6.3, score: 0.78, motion: 0.353, sellingPoints: ['furnished', 'balcony_access'] },
    { source: 's_0038c16f', room: 'living', inSec: 0, durationSec: 7.8, score: 0.78, motion: 0.32, sellingPoints: ['open_plan', 'furnished', 'renovated'] },
    { source: 's_b4e09798', room: 'bedroom', inSec: 0, durationSec: 4.4, score: 0.25, motion: 0.02, sellingPoints: ['furnished', 'balcony_access'] },
    { source: 's_e09c460f', room: 'kitchen', inSec: 0, durationSec: 3.1, score: 0.4, motion: 0.133, sellingPoints: ['renovated'] },
    { source: 's_fd90561a', room: 'living', inSec: 0, durationSec: 3.8, score: 0.72, motion: 0.333, sellingPoints: ['furnished', 'balcony_access'] },
    { source: 's_995a1168', room: 'living', inSec: 0, durationSec: 7.7, score: 0.35, motion: 0.167, sellingPoints: ['open_plan', 'furnished'] },
    { source: 's_995a1168', room: 'kitchen', inSec: 7.8, durationSec: 1.9, score: 0.25, motion: 0.727, sellingPoints: ['island_bench', 'renovated', 'open_plan'] },
    { source: 's_995a1168', room: 'living', inSec: 9.8, durationSec: 2.4, score: 0.4, motion: 0.22, sellingPoints: ['open_plan', 'furnished'] },
    { source: 's_eab4993a', room: 'unknown', inSec: 0, durationSec: 5.3, score: 0.3, motion: 0.14, sellingPoints: ['natural_light', 'furnished'] },
    { source: 's_eab4993a', room: 'living', inSec: 5.4, durationSec: 1.3, score: 0.2, motion: 0.813, sellingPoints: ['natural_light', 'furnished'] },
    { source: 's_eab4993a', room: 'living', inSec: 6.8, durationSec: 1.9, score: 0.38, motion: 0.353, sellingPoints: ['furnished'] },
    { source: 's_2a3578c7', room: 'bedroom', inSec: 0, durationSec: 6.6, score: 0.3, motion: 0.2, sellingPoints: ['furnished'] },
    { source: 's_2a3578c7', room: 'bedroom', inSec: 6.7, durationSec: 1, score: 0.2, motion: 0.227, sellingPoints: ['furnished'] },
  ];

  function marinaCandidates(): Candidate[] {
    return MARINA.filter((shot) => shot.durationSec >= 1.2).map((shot, index) => ({
      shotId: `sh_marina_${String(index).padStart(3, '0')}`,
      sourceId: shot.source,
      src: `raw/${shot.source}.mp4`,
      room: shot.room,
      score: shot.score,
      motion: shot.motion,
      sellingPoints: shot.sellingPoints,
      inSec: shot.inSec,
      outSec: Math.round((shot.inSec + shot.durationSec) * 1000) / 1000,
      reason: `marina ${shot.room}`,
    }));
  }

  it('never opens on a bedroom, bathroom or kitchen detail', () => {
    const candidates = marinaCandidates();
    const edl = planMarketing(request({ candidates }));
    const hook = edl.clips[0];

    expect(['bedroom', 'bathroom', 'kitchen']).not.toContain(hook?.room);
    expect(hook?.room).toBe('living');

    const motions = candidates
      .map((candidate) => candidate.motion)
      .filter((motion): motion is number => motion !== undefined)
      .sort((left, right) => left - right);
    const median =
      ((motions[Math.floor(motions.length / 2) - 1] ?? 0) + (motions[Math.floor(motions.length / 2)] ?? 0)) / 2;
    expect(hook?.motionAtSelection ?? 0).toBeGreaterThan(median);
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('puts the entry door on the 23 s entrance slot, even with a lower score', () => {
    const edl = planMarketing(request({ candidates: marinaCandidates() }));

    const entrance = clipAt(edl, 23);
    expect(entrance.room).toBe('entry');
    expect(entrance.sourceId).toBe('s_ee267360');
    // The door's raw score really is lower than the living/bedroom options.
    expect(entrance.scoreAtSelection).toBeLessThan(0.5);
    expect(validateEdl(edl).valid).toBe(true);
  });
});

describe('marketing beat sheet', () => {
  it('sums to exactly 38 s', () => {
    expect(MARKETING_DURATION_SEC).toBe(38);
    const sum = Math.round(
      MARKETING_BEATS.reduce((acc, beat) => acc + (beat.endSec - beat.startSec), 0) * 1000,
    ) / 1000;
    expect(sum).toBe(38);
    expect(MARKETING_BEATS.map((beat) => beat.id)).toEqual([
      'hook',
      'light',
      'ritual',
      'craft',
      'space',
      'entrance',
      'price',
      'close',
    ]);
  });

  it('pulls an interior boundary onto the music grid by at most 80 ms', () => {
    const boundaries = marketingBoundaries(QUARTER_GRID);
    expect(boundaries[0]).toBe(0);
    expect(boundaries[boundaries.length - 1]).toBe(38);
    // 2.2 is 50 ms from the 2.25 grid line; 23 is already on it.
    expect(boundaries[1]).toBe(2.25);
    expect(boundaries[5]).toBe(23);
    expect(boundaries[6]).toBe(28.5);
    // A half-second grid leaves 2.2 alone: it is 200 ms from 2.0 and 300 ms
    // from 2.5, far outside the 80 ms pull.
    expect(marketingBoundaries(BEAT_GRID)[1]).toBe(2.2);
  });

  it('leaves the sheet alone when no grid is supplied', () => {
    expect(marketingBoundaries([])).toEqual([0, 2.2, 6.5, 12, 18, 23, 28.5, 33.5, 38]);
  });
});

describe('planMarketing', () => {
  it('is deterministic for the same request and ignores the tie-break seed', () => {
    const left = planMarketing(request());
    const right = planMarketing(request());
    const reseeded = planMarketing(request({ seed: 991 }));

    expect(right).toEqual(left);
    expect(reseeded).toEqual(left);
  });

  it('produces a schema-valid 38 s EDL', () => {
    const edl = planMarketing(request());

    expect(edl.format).toEqual({
      id: 'marketing_38',
      label: 'Marketing 38',
      targetDurationSec: 38,
    });
    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
    expect(total(edl)).toBeCloseTo(38, 3);
    expect(edl.createdAt).toBe(NOW);
  });

  it('lands clips on the beat windows', () => {
    const edl = planMarketing(request());
    const list = starts(edl).map((start) => Math.round(start * 1000) / 1000);

    for (const boundary of [2.2, 6.5, 12, 18, 23, 28.5, 33.5]) {
      expect(list).toContain(boundary);
    }
  });

  it('opens on the highest-motion living shot, never the address card or entry', () => {
    const edl = planMarketing(request());
    const hook = edl.clips[0];

    expect(hook?.room).toBe('living');
    expect(hook?.sourceId).toBe('s_00000000');
    expect(hook?.motionAtSelection).toBeCloseTo(0.12, 3);
    expect(edl.overlays.some((overlay) => overlay.kind === 'address' && overlay.inSec < 30)).toBe(false);
  });

  it('puts the door shot at 23 s and the price after 28.5 s', () => {
    const edl = planMarketing(request());

    expect(clipAt(edl, 23).room).toBe('entry');

    const price = edl.overlays.find((overlay) => overlay.kind === 'price');
    expect(price?.text).toBe('AED 1,850,000');
    expect(price?.inSec).toBeGreaterThanOrEqual(28.5);
    expect(price?.inSec).toBeCloseTo(28.5, 3);
    expect(price?.outSec).toBeCloseTo(33.5, 3);

    const address = edl.overlays.find((overlay) => overlay.kind === 'address');
    expect(address?.inSec).toBeGreaterThanOrEqual(30);

    const spec = edl.overlays.find((overlay) => overlay.kind === 'spec_row');
    expect(spec?.text).toBe('3 bed · 2 bath');
    expect(spec?.inSec).toBeGreaterThanOrEqual(18);
    expect(spec?.outSec).toBeLessThanOrEqual(23);
  });

  it('uses the sheet’s transitions and hard cuts everywhere else', () => {
    const edl = planMarketing(request());

    expect(clipAt(edl, 2.2).transitionIn).toEqual({ type: 'whip', durationSec: 0.2 });
    expect(clipAt(edl, 12).transitionIn).toEqual({ type: 'light_leak', durationSec: 0.3 });
    expect(clipAt(edl, 23).transitionIn).toEqual({ type: 'zoom_blur', durationSec: 0.6 });
    expect(clipAt(edl, 28.5).transitionIn).toEqual({ type: 'luma_wipe', durationSec: 0.35 });

    // The zoom-blur that puts the craft detail in motion is the first internal
    // craft cut, not the beat entry.
    const craftStart = starts(edl).findIndex((start) => Math.abs(start - 12) <= 0.01);
    const craftSecond = edl.clips[craftStart + 1];
    expect(craftSecond?.transitionIn).toEqual({ type: 'zoom_blur', durationSec: 0.25 });

    const special = new Set([2.2, 12, 23, 28.5]);
    for (const [index, clip] of edl.clips.entries()) {
      if (index === 0) continue;
      const start = starts(edl)[index] ?? 0;
      if (special.has(start) || index === craftStart + 1) continue;
      expect(clip.transitionIn, `clip ${clip.id} at ${String(start)}`).toEqual({
        type: 'cut',
        durationSec: 0,
      });
    }
  });

  it('lends a transition handle so the assembled timeline stays 38 s', () => {
    const edl = planMarketing(request());

    edl.clips.forEach((clip, index) => {
      const next = edl.clips[index + 1];
      const expected =
        next !== undefined && next.transitionIn.type !== 'cut' ? next.transitionIn.durationSec : 0;
      expect(clip.handleOutSec ?? 0, `clip ${clip.id}`).toBeCloseTo(expected, 3);
    });
  });

  it('writes one claim per beat, six words a line, two lines, no room labels', () => {
    const edl = planMarketing(request());
    const words = edl.captions.words ?? [];
    expect(words.length).toBeGreaterThan(0);

    const cues: string[][] = [];
    let current: string[] = [];
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const word of words) {
      if (current.length > 0 && word.startSec - previousEnd > 0.01) {
        cues.push(current);
        current = [];
      }
      current.push(word.text);
      previousEnd = word.endSec;
    }
    if (current.length > 0) cues.push(current);

    expect(cues).toHaveLength(MARKETING_BEATS.length);
    for (const cue of cues) {
      expect(cue.length).toBeLessThanOrEqual(6);
    }

    const beforeThirty = words
      .filter((word) => word.startSec < 30)
      .map((word) => word.text.toLowerCase());
    for (const token of ['marina', 'gate', 'dubai', 'kitchen', 'living', 'bedroom', 'bathroom', 'entry']) {
      expect(beforeThirty).not.toContain(token);
    }
  });

  it('omits invented facts when the record has none', () => {
    const edl = planMarketing(
      request({
        facts: { address: '', currency: 'AED' },
      }),
    );

    expect(edl.overlays.some((overlay) => overlay.kind === 'price')).toBe(false);
    expect(edl.overlays.some((overlay) => overlay.kind === 'address')).toBe(false);
    expect(edl.overlays.some((overlay) => overlay.kind === 'spec_row')).toBe(false);
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('falls back to a hall or living reveal when there is no door shot', () => {
    const noDoor = request().candidates.filter((candidate) => candidate.room !== 'entry');
    const edl = planMarketing(request({ candidates: noDoor }));
    expect(['living', 'bedroom']).toContain(clipAt(edl, 23).room);
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('refuses a pool that cannot carry the sheet', () => {
    const tooSmall = request().candidates.slice(0, 4);
    expect(() => planMarketing(request({ candidates: tooSmall }))).toThrow(/beat/);
  });
});
