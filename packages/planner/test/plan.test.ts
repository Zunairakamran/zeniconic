import { describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '@zeniconic/edl';
import type { Edl, Profile } from '@zeniconic/edl';
import { planVariant } from '../src/index';
import type { PlanRequest } from '../src/index';
import { POOL_SEEDS, PROFILES, makeRequest, pickHook } from './fixtures';

interface PlanCase {
  seed: number;
  profile: Profile;
  request: PlanRequest;
  edl?: Edl;
  error?: unknown;
}

const CASES: PlanCase[] = [];

for (const seed of POOL_SEEDS) {
  for (const profile of PROFILES) {
    const request = makeRequest(seed, profile);
    try {
      CASES.push({ seed, profile, request, edl: planVariant(request) });
    } catch (error) {
      CASES.push({ seed, profile, request, error });
    }
  }
}

function requireEdl(plan: PlanCase): Edl {
  if (!plan.edl) throw plan.error;
  return plan.edl;
}

describe('planVariant property gate', () => {
  it('returns a schema-valid EDL for 200 pools in all four profiles', () => {
    const failures: string[] = [];

    for (const plan of CASES) {
      if (!plan.edl) {
        failures.push(`${plan.seed}/${plan.profile}: planning threw ${String(plan.error)}`);
        continue;
      }
      const result = validateEdl(plan.edl);
      if (!result.valid) {
        for (const issue of result.issues.slice(0, 2)) {
          failures.push(
            `${plan.seed}/${plan.profile}: ${issue.code} at ${issue.path}: ${issue.message}`,
          );
        }
      }
    }

    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('lands inside half a second of every format target', () => {
    for (const plan of CASES) {
      const edl = requireEdl(plan);
      const drift = Math.abs(durationSec(edl) - plan.request.format.targetDurationSec);
      expect(drift, `${plan.seed}/${plan.profile}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('never places the same room twice in a row', () => {
    for (const plan of CASES) {
      const edl = requireEdl(plan);
      for (let index = 1; index < edl.clips.length; index += 1) {
        const previous = edl.clips[index - 1];
        const clip = edl.clips[index];
        expect(clip?.room, `${plan.seed}/${plan.profile} clip ${index}`).not.toBe(previous?.room);
      }
    }
  });

  it('opens on the highest-scoring candidate, with ties settled by shotId', () => {
    for (const plan of CASES) {
      const edl = requireEdl(plan);
      const hook = pickHook(plan.request.candidates);
      const first = edl.clips[0];
      expect(first?.sourceId, `${plan.seed}/${plan.profile}`).toBe(hook.sourceId);
      expect(first?.src, `${plan.seed}/${plan.profile}`).toBe(hook.src);
    }
  });

  it('uses every shot at most once, except a last-clip return at a new timecode', () => {
    for (const plan of CASES) {
      const edl = requireEdl(plan);
      const firstUse = new Map<string, { inSec: number; index: number }>();

      edl.clips.forEach((clip, index) => {
        const key = `${clip.sourceId}|${clip.src}`;
        const seen = firstUse.get(key);
        if (!seen) {
          firstUse.set(key, { inSec: clip.inSec, index });
          return;
        }
        expect(index, `${plan.seed}/${plan.profile} reuses ${key}`).toBe(edl.clips.length - 1);
        expect(clip.inSec, `${plan.seed}/${plan.profile} return needs a new timecode`).not.toBe(
          seen.inSec,
        );
      });
    }
  });

  it('is deterministic for a request and stays valid when the seed changes', () => {
    for (const plan of CASES.slice(0, 50)) {
      const edl = requireEdl(plan);
      expect(planVariant(plan.request)).toEqual(edl);

      const reseeded = { ...plan.request, seed: plan.request.seed + 1009 };
      const result = validateEdl(planVariant(reseeded));
      expect(result.valid, `${plan.seed}/${plan.profile} reseeded`).toBe(true);
    }
  });
});

describe('planVariant assembly', () => {
  it('writes the expected identity, provenance and canvas', () => {
    const request = makeRequest(42, 'landscape');
    const edl = planVariant(request);

    expect(edl.edlVersion).toBe('1.0.0');
    expect(edl.id).toMatch(/^edl_[a-z0-9-]+_v1$/);
    expect(edl.id).toBe(`edl_${request.format.id.replace(/_/g, '-')}_v1`);
    expect(edl.listingId).toBe(request.listingId);
    expect(edl.createdAt).toBe(request.now);
    expect(edl.canvas).toEqual({
      profile: 'landscape',
      width: request.canvas.width,
      height: request.canvas.height,
      fps: request.canvas.fps,
      safeArea: request.canvas.safeArea,
    });
    expect(edl.provenance).toEqual({
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'local-planner' },
      promptVersions: { tagging: 'n/a', planning: 'planner-v1' },
      costUsd: 0,
    });
    expect(edl.review).toBeUndefined();
  });

  it('passes music through and sets mix loudness by profile', () => {
    const request = makeRequest(43, 'vertical-social');
    const edl = planVariant(request);

    expect(edl.audio.music).toEqual({
      trackId: request.music.trackId,
      src: request.music.src,
      gainDb: request.music.gainDb,
      duckUnderVoiceDb: request.music.duckUnderVoiceDb,
      beatGrid: request.music.beatGrid,
    });
    expect(edl.audio.voice.mode).toBe('keep');
    expect(edl.audio.mix).toEqual({ lufs: -14, truePeakDbtp: -1.5 });
    expect(planVariant({ ...request, profile: 'landscape' }).audio.mix.lufs).toBe(-16);
    expect(planVariant({ ...request, profile: 'pin' }).audio.mix.lufs).toBe(-14);
  });

  it('never invents captions and uses a slow cover push on every clip', () => {
    const edl = planVariant(makeRequest(44, 'feed-portrait'));

    expect(edl.captions).toEqual({ mode: 'none' });
    for (const clip of edl.clips) {
      expect(clip.transform.mode).toBe('cover');
      expect(clip.transform.focus).toBe('saliency');
      expect(clip.transform.path).toHaveLength(2);
      expect(clip.transform.path[0]?.scale).toBe(1.04);
      expect(clip.transform.path[1]?.scale).toBe(1.08);
      expect(clip.transitionIn).toEqual({ type: 'cut', durationSec: 0 });
    }
  });

  it('tags the hook with the address and ends the price card on the last frame', () => {
    const base = makeRequest(45, 'vertical-social', { price: '£845,000' });
    const edl = planVariant(base);
    const duration = durationSec(edl);

    const address = edl.overlays.find((overlay) => overlay.kind === 'address');
    expect(address).toMatchObject({
      inSec: 0.4,
      outSec: 4.4,
      anchor: 'bottom_left',
      style: 'address_tag',
    });
    expect(address?.text).toBe(base.facts.address);

    const price = edl.overlays.find((overlay) => overlay.kind === 'price');
    expect(price?.text).toBe('£845,000');
    expect(price?.outSec).toBe(duration);
    expect(price?.inSec).toBe(
      Math.max(0, Math.round((duration - 5.2) * 1000) / 1000),
    );

    const logo = edl.overlays.find((overlay) => overlay.kind === 'logo');
    expect(logo?.inSec).toBe(price?.inSec);
    expect(logo?.outSec).toBe(duration);

    for (const overlay of edl.overlays) {
      expect((overlay.text ?? '').length).toBeLessThanOrEqual(90);
      expect((overlay.subtext ?? '').length).toBeLessThanOrEqual(90);
    }
  });

  it('omits the price card and logo when no price is known', () => {
    const request = makeRequest(45, 'vertical-social');
    const edl = planVariant({ ...request, facts: { ...request.facts, price: undefined } });

    expect(edl.overlays.some((overlay) => overlay.kind === 'price')).toBe(false);
    expect(edl.overlays.some((overlay) => overlay.kind === 'logo')).toBe(false);
  });

  it('hits the 30s default with a rich pool', () => {
    const request = makeRequest(77, 'vertical-social', {
      count: 14,
      rooms: 6,
      targetSec: 30,
      look: 'calm',
    });
    const edl = planVariant(request);

    expect(validateEdl(edl).valid).toBe(true);
    expect(Math.abs(durationSec(edl) - 30)).toBeLessThanOrEqual(0.3);
    for (const clip of edl.clips) {
      expect(clip.outSec - clip.inSec).toBeGreaterThanOrEqual(1.2 - 1e-9);
      expect(clip.outSec - clip.inSec).toBeLessThanOrEqual(4.5 + 1e-9);
    }
  });

  it('keeps an over-long address inside the schema text limit', () => {
    const base = makeRequest(46, 'landscape');
    const edl = planVariant({
      ...base,
      facts: { ...base.facts, address: `${'A very long address line '.repeat(8)}TW9` },
    });

    const address = edl.overlays.find((overlay) => overlay.kind === 'address');
    expect(address?.text?.length ?? 0).toBeLessThanOrEqual(90);
    expect(validateEdl(edl).valid).toBe(true);
  });
});
