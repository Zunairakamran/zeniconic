import { describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '@zeniconic/edl';
import type { Edl, Room } from '@zeniconic/edl';
import {
  MARKETING_DURATION_SEC,
  MARKETING_FORMAT_ID,
  MARKETING_VARIANT_ID,
  MARKETING_BEATS,
  PLANNED_VARIANTS,
  planRequest,
  planVariant,
} from '../src/index';
import type { Candidate, PlanRequest, PlannedVariantSpec } from '../src/index';

const NOW = '2026-11-17T09:00:00.000Z';
const BEAT_GRID = Array.from({ length: 80 }, (_, index) => Math.round(index * 0.5 * 1000) / 1000);

interface ShotDef {
  room: Room;
  durationSec: number;
  score: number;
  motion: number;
}

/** A pool a 38-second campaign can actually carry: 18 shots, every beat room. */
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

function candidates(shots: readonly ShotDef[] = SHOTS): Candidate[] {
  return shots.map((shot, index) => {
    const inSec = Math.round((0.5 + index * 0.25) * 1000) / 1000;
    return {
      shotId: `sh_var_${String(index).padStart(3, '0')}`,
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

/** The request the desktop pipeline builds for one catalogue entry. */
function requestFor(spec: PlannedVariantSpec, overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    listingId: 'marina-gate-variants',
    format: { id: spec.format, label: spec.label, targetDurationSec: spec.targetDurationSec },
    look: { id: spec.look === 'marketing' ? 'social' : spec.look, label: spec.label },
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

function planFor(spec: PlannedVariantSpec): Edl {
  return planRequest(requestFor(spec));
}

const MARKETING = PLANNED_VARIANTS.find((spec) => spec.id === MARKETING_VARIANT_ID);

describe('the planned variant catalogue', () => {
  it('offers the three 30-second looks unchanged plus the marketing cut', () => {
    expect(PLANNED_VARIANTS.map((spec) => spec.id)).toEqual([
      'calm',
      'walkthrough',
      'social',
      MARKETING_VARIANT_ID,
    ]);
    expect(MARKETING_VARIANT_ID).toBe('marketing38');
    // The id is also the EDL file name, so it must survive the IPC slug rule.
    expect(MARKETING_VARIANT_ID).toMatch(/^[a-z0-9][a-z0-9-]*$/);

    for (const spec of PLANNED_VARIANTS.slice(0, 3)) {
      expect(spec.id).toBe(spec.look);
      expect(spec.format).toBe('cinematic_hero');
      expect(spec.targetDurationSec).toBe(30);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  it('declares the marketing cut as its own 38-second format with a clear label', () => {
    expect(MARKETING).toBeDefined();
    expect(MARKETING?.format).toBe(MARKETING_FORMAT_ID);
    expect(MARKETING?.format).toBe('marketing_38');
    expect(MARKETING?.targetDurationSec).toBe(MARKETING_DURATION_SEC);
    expect(MARKETING?.targetDurationSec).toBe(38);
    expect(MARKETING?.label).toBe('Marketing 38');
    expect(MARKETING?.look).toBe('marketing');
  });

  it('gives every variant a distinct id', () => {
    const ids = PLANNED_VARIANTS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the fourth variant is a real, exportable EDL', () => {
  it('validates against the EDL schema and assembles exactly 38 seconds', () => {
    if (MARKETING === undefined) throw new Error('no marketing variant in the catalogue');
    const edl = planFor(MARKETING);
    const check = validateEdl(edl);

    expect(check.issues).toEqual([]);
    expect(check.valid).toBe(true);
    expect(edl.format.id).toBe('marketing_38');
    expect(edl.format.targetDurationSec).toBe(38);
    expect(durationSec(edl)).toBeCloseTo(38, 2);
    expect(edl.clips.length).toBeGreaterThanOrEqual(12);
  });

  it('walks the marketing beat sheet rather than a room tour', () => {
    if (MARKETING === undefined) throw new Error('no marketing variant in the catalogue');
    const edl = planFor(MARKETING);

    // Every clip's reason names its beat, in sheet order.
    const seen = edl.clips.map((clip) => {
      const beat = MARKETING_BEATS.find((entry) => clip.reason.startsWith(`${entry.label} beat:`));
      return beat?.id;
    });
    expect(seen.every((id) => id !== undefined)).toBe(true);
    expect(seen[0]).toBe('hook');
    expect(seen.at(-1)).toBe('close');
    expect(seen.indexOf('price')).toBeGreaterThan(seen.indexOf('space'));
    expect(seen.indexOf('close')).toBeGreaterThan(seen.indexOf('price'));
    expect(MARKETING_BEATS).toHaveLength(8);

    // The hook is never a detail room.
    expect(['bedroom', 'bathroom', 'kitchen']).not.toContain(edl.clips[0]?.room);
  });

  it('holds the price until the late beat and the address until the close', () => {
    if (MARKETING === undefined) throw new Error('no marketing variant in the catalogue');
    const edl = planFor(MARKETING);

    const price = edl.overlays.find((overlay) => overlay.kind === 'price');
    expect(price).toBeDefined();
    expect(price?.text).toBe('AED 1,850,000');
    // The price beat is 28.5–33.5 s on a 38 s film: nothing may show earlier.
    expect(price?.inSec).toBeGreaterThanOrEqual(28.5 - 0.1);
    expect(price?.inSec).toBeGreaterThan(30 - 5.2);

    const address = edl.overlays.find((overlay) => overlay.kind === 'address');
    expect(address).toBeDefined();
    expect(address?.inSec).toBeGreaterThanOrEqual(33.5 - 0.1);

    const cta = edl.overlays.find((overlay) => overlay.kind === 'cta');
    expect(cta?.inSec).toBeGreaterThanOrEqual(33.5 - 0.1);

    const spec = edl.overlays.find((overlay) => overlay.kind === 'spec_row');
    expect(spec?.text).toBe('3 bed · 2 bath');
  });

  it('is deterministic', () => {
    if (MARKETING === undefined) throw new Error('no marketing variant in the catalogue');
    expect(planFor(MARKETING)).toEqual(planFor(MARKETING));
  });
});

describe('the three existing variants are unaffected', () => {
  it('routes each look through the room-order planner it always used', () => {
    for (const spec of PLANNED_VARIANTS.slice(0, 3)) {
      const request = requestFor(spec);
      const edl = planRequest(request);

      // Byte-for-byte the old assembly: the format is still cinematic hero and
      // the EDL id is still derived from it.
      expect(edl).toEqual(planVariant(request));
      expect(edl.format.id).toBe('cinematic_hero');
      expect(edl.format.targetDurationSec).toBe(30);
      expect(edl.id).toBe('edl_cinematic-hero_v1');
      expect(validateEdl(edl).valid).toBe(true);
      expect(Math.abs(durationSec(edl) - 30)).toBeLessThanOrEqual(0.5);
      expect(edl.overlays.some((overlay) => overlay.kind === 'spec_row' || overlay.kind === 'cta')).toBe(
        false,
      );
    }
  });

  it('keeps ids and looks stable for projects planned before the marketing cut existed', () => {
    const legacy = PLANNED_VARIANTS.filter((spec) => spec.format === 'cinematic_hero');
    expect(legacy.map((spec) => spec.id)).toEqual(['calm', 'walkthrough', 'social']);
    expect(legacy.map((spec) => spec.look)).toEqual(['calm', 'walkthrough', 'social']);
    expect(legacy.every((spec) => spec.targetDurationSec === 30)).toBe(true);
  });
});

describe('several shots inside one source file', () => {
  /**
   * Real folders put three shots in one clip; the planner trims each to its beat
   * window, so the previous clip's planned out is earlier than its shot's out.
   * Following it with the next window of the same file used to produce
   * `E_CLIP_GAP` ("no gap marker"), which failed the whole render.
   */
  const ROOMS: Room[] = ['living', 'kitchen', 'bedroom', 'bathroom', 'balcony', 'dining', 'entry', 'living'];

  function multiShotCandidates(): Candidate[] {
    const out: Candidate[] = [];
    for (const [fileIndex, room] of ROOMS.entries()) {
      for (let window = 0; window < 3; window += 1) {
        const index = fileIndex * 3 + window;
        const inSec = window * 3;
        out.push({
          shotId: `sh_file_${String(index).padStart(3, '0')}`,
          sourceId: `s_${String(fileIndex).padStart(8, '0')}`,
          src: `raw/${room}_${String(fileIndex).padStart(2, '0')}.mp4`,
          room,
          score: 0.9 - index * 0.01,
          motion: Math.max(0.02, 0.3 - index * 0.01),
          inSec,
          outSec: inSec + 3,
          reason: `window ${window + 1} of ${room}`,
        });
      }
    }
    return out;
  }

  it('never leaves an unmarked gap when a trimmed clip is followed by the same file', () => {
    if (MARKETING === undefined) throw new Error('no marketing variant in the catalogue');
    const edl = planRequest(requestFor(MARKETING, { candidates: multiShotCandidates() }));
    const check = validateEdl(edl);

    expect(check.issues.filter((issue) => issue.code === 'E_CLIP_GAP')).toEqual([]);
    expect(check.valid).toBe(true);
    expect(durationSec(edl)).toBeCloseTo(38, 2);

    for (let index = 1; index < edl.clips.length; index += 1) {
      const previous = edl.clips[index - 1];
      const clip = edl.clips[index];
      if (previous === undefined || clip === undefined) continue;
      if (previous.src !== clip.src) continue;
      expect(clip.inSec).toBeLessThanOrEqual(previous.outSec + 1e-6);
    }
  });
});

describe('an impossible marketing pool fails honestly', () => {
  it('refuses to build a 38-second cut from detail rooms only', () => {
    if (MARKETING === undefined) throw new Error('no marketing variant in the catalogue');
    const detailPool = candidates(
      Array.from({ length: 18 }, (_, index) => ({
        room: (['kitchen', 'bathroom', 'bedroom'] as const)[index % 3] ?? 'kitchen',
        durationSec: 4,
        score: 0.8,
        motion: 0.1,
      })),
    );

    expect(() => planRequest(requestFor(MARKETING, { candidates: detailPool }))).toThrow(RangeError);
    expect(() => planRequest(requestFor(MARKETING, { candidates: detailPool }))).toThrow(/hook/i);

    // The same pool still plans a normal look, which is why the pipeline skips
    // only the marketing variant instead of failing the whole analysis.
    const calm = PLANNED_VARIANTS[0];
    if (calm === undefined) throw new Error('no calm variant in the catalogue');
    const edl = planRequest({
      ...requestFor(calm, { candidates: detailPool }),
      format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 15 },
    });
    expect(validateEdl(edl).valid).toBe(true);
  });

  it('refuses a pool too small to carry the beat sheet', () => {
    if (MARKETING === undefined) throw new Error('no marketing variant in the catalogue');
    const tiny = candidates(SHOTS.slice(0, 4));

    expect(() => planRequest(requestFor(MARKETING, { candidates: tiny }))).toThrow(/cannot carry/);
  });
});
