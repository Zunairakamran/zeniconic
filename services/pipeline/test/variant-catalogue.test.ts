import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '@zeniconic/edl';
import type { Edl, Room } from '@zeniconic/edl';
import {
  MARKETING_VARIANT_ID,
  PLANNED_VARIANTS,
  planRequest,
} from '@zeniconic/planner';
import type { Candidate } from '@zeniconic/planner';
import type { VariantSummary } from '../../../packages/ipc/src/index';
import {
  VARIANT_LOOKS,
  readVariantEdl,
  readVariants,
  resolveVariantEdlPath,
  saveVariants,
  scoreForEdl,
  setVariantApproval,
} from '../../../apps/desktop/variants';

const NOW = '2026-11-17T09:00:00.000Z';
const BEAT_GRID = Array.from({ length: 80 }, (_, index) => Math.round(index * 0.5 * 1000) / 1000);

const SHOTS: Array<{ room: Room; durationSec: number; score: number; motion: number }> = [
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
      shotId: `sh_cat_${String(index).padStart(3, '0')}`,
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

/** Mirrors `DesktopPipeline.planVariants` without the Electron/store wiring. */
function plansForCatalogue(): Array<{ summary: VariantSummary; edl: Edl }> {
  return PLANNED_VARIANTS.map((spec) => {
    const edl = planRequest({
      listingId: 'catalogue-listing',
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
    });

    return {
      summary: {
        id: spec.id,
        look: spec.look,
        format: edl.format.id,
        targetDurationSec: edl.format.targetDurationSec,
        clipCount: edl.clips.length,
        score: scoreForEdl(edl),
        edlPath: '',
        approved: false,
      },
      edl,
    };
  });
}

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zeniconic-variant-catalogue-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

describe('the fourth variant through the real variant store', () => {
  it('persists and reads back as an exportable 38-second EDL', async () => {
    const listingDir = await tempDir();
    const saved = await saveVariants(listingDir, plansForCatalogue());

    expect(saved.map((variant) => variant.id)).toEqual([
      'calm',
      'walkthrough',
      'social',
      MARKETING_VARIANT_ID,
    ]);

    const marketing = saved.find((variant) => variant.id === MARKETING_VARIANT_ID);
    expect(marketing).toMatchObject({
      look: 'marketing',
      format: 'marketing_38',
      targetDurationSec: 38,
      approved: false,
    });
    expect(marketing?.edlPath).toBe('variants/marketing38.json');
    expect(existsSync(join(listingDir, 'variants', 'marketing38.json'))).toBe(true);

    // The social variant keeps its own file: same look, different cut.
    const social = saved.find((variant) => variant.id === 'social');
    expect(social?.edlPath).toBe('variants/social.json');
    expect(social?.targetDurationSec).toBe(30);

    const socialEdl = await readVariantEdl(listingDir, 'social');
    const marketingEdl = await readVariantEdl(listingDir, MARKETING_VARIANT_ID);

    expect(socialEdl.format.id).toBe('cinematic_hero');
    expect(validateEdl(socialEdl).valid).toBe(true);
    expect(Math.abs(durationSec(socialEdl) - 30)).toBeLessThanOrEqual(0.5);

    expect(marketingEdl.format.id).toBe('marketing_38');
    expect(validateEdl(marketingEdl).valid).toBe(true);
    expect(durationSec(marketingEdl)).toBeCloseTo(38, 2);
    expect(marketingEdl.overlays.some((overlay) => overlay.kind === 'price')).toBe(true);
  });

  it('never overwrites an approved edit when the listing is planned again', async () => {
    const listingDir = await tempDir();
    await saveVariants(listingDir, plansForCatalogue());
    const before = await readFile(join(listingDir, 'variants', 'marketing38.json'), 'utf8');

    await setVariantApproval(listingDir, MARKETING_VARIANT_ID, true);
    const replanned = await saveVariants(listingDir, plansForCatalogue());

    const marketing = replanned.find((variant) => variant.id === MARKETING_VARIANT_ID);
    expect(marketing?.approved).toBe(true);
    expect(await readFile(join(listingDir, 'variants', 'marketing38.json'), 'utf8')).toBe(before);
    // Unapproved variants are refreshed, approved ones survive.
    expect(replanned.find((variant) => variant.id === 'social')?.approved).toBe(false);
  });

  it('resolves old projects by their look id without moving any file', async () => {
    const listingDir = await tempDir();
    await saveVariants(listingDir, plansForCatalogue());

    const variants = await readVariants(listingDir);
    const legacy = variants.find((variant) => variant.id === 'calm');
    if (legacy === undefined) throw new Error('calm variant missing');

    // A pre-marketing project has id === look; resolution must be unchanged.
    expect(await resolveVariantEdlPath(listingDir, legacy)).toBe(
      join(listingDir, 'variants', 'calm.json'),
    );
    expect(VARIANT_LOOKS).toEqual(['calm', 'walkthrough', 'social', 'marketing']);
  });

  it('reports four variants, not three, to the review screen', async () => {
    const listingDir = await tempDir();
    await saveVariants(listingDir, plansForCatalogue());
    const variants = await readVariants(listingDir);

    expect(variants).toHaveLength(4);
    expect(variants.filter((variant) => variant.look === 'social')).toHaveLength(1);
    expect(variants.filter((variant) => variant.look === 'marketing')).toHaveLength(1);
    for (const variant of variants) {
      const edl = await readVariantEdl(listingDir, variant.id);
      expect(validateEdl(edl).valid, variant.id).toBe(true);
    }
  });
});
