import { describe, expect, it } from 'vitest';
import type { Clip, Edl, Overlay, Room } from '@zeniconic/edl';
import {
  MARKETING_HOOK_MOTION_MIN,
  MARKETING_MAX_SEC,
  MARKETING_MIN_SEC,
  checkMarketingBeats,
  checkRoomOrder,
  reviewRender,
} from '../src/index';
import { FACTS, PROFILE, makeDeps } from './fixtures';

const NOW = '2026-11-16T09:00:00.000Z';

/** Beat windows: 2.2 / 4.3 / 5.5 / 6 / 5 / 5.5 / 5 / 4.5 = 38. */
const DURATIONS = [2.2, 2.15, 2.15, 2.75, 2.75, 2, 2, 2, 2.5, 2.5, 2.75, 2.75, 2.5, 2.5, 2.25, 2.25];
const ROOMS: Room[] = [
  'living',
  'living',
  'bedroom',
  'kitchen',
  'kitchen',
  'kitchen',
  'kitchen',
  'living',
  'living',
  'bedroom',
  'entry',
  'entry',
  'living',
  'bedroom',
  'bedroom',
  'living',
];

function overlay(kind: Overlay['kind'], inSec: number, outSec: number, text?: string): Overlay {
  return {
    id: `o_${kind}`,
    kind,
    ...(text === undefined ? {} : { text }),
    inSec,
    outSec,
    anchor: 'bottom_center',
    style: kind === 'price' ? 'price_lower' : kind === 'cta' ? 'cta_card' : 'caption',
    maxWidthPct: 80,
    opacity: 1,
    animation: 'fade',
  };
}

function buildMarketingEdl(overrides: Partial<Edl> = {}): Edl {
  const clips: Clip[] = DURATIONS.map((duration, index) => {
    const inSec = Math.round(index * 4 * 1000) / 1000;
    const clip: Clip = {
      id: `c${String(index + 1).padStart(2, '0')}`,
      sourceId: `s_${String(index).padStart(8, '0')}`,
      src: `raw/shot_${String(index).padStart(2, '0')}.mp4`,
      inSec,
      outSec: Math.round((inSec + duration) * 1000) / 1000,
      speed: 1,
      volumeDb: -18,
      room: ROOMS[index] ?? 'living',
      transform: {
        mode: 'cover',
        focus: 'saliency',
        path: [
          { t: 0, x: 0.5, y: 0.5, scale: 1.05 },
          { t: 1, x: 0.5, y: 0.5, scale: 1.11 },
        ],
      },
      transitionIn: { type: 'cut', durationSec: 0 },
      reason: `marketing beat ${String(index + 1)}`,
      scoreAtSelection: 0.8,
      ...(index === 0 ? { motionAtSelection: 0.55 } : {}),
    };
    return clip;
  });

  return {
    edlVersion: '1.0.0',
    id: 'edl_marketing-38_v1',
    listingId: 'marina-gate-1',
    createdAt: NOW,
    format: { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 38 },
    look: { id: 'social', label: 'Social' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips,
    overlays: [
      overlay('spec_row', 18.2, 22.9, '3 bed · 2 bath'),
      overlay('lower_third', 23.4, 28.1, 'Your own way in'),
      overlay('price', 28.5, 33.5, '£845,000'),
      overlay('logo', 28.5, 38),
      overlay('address', 33.5, 38, FACTS.address ?? ''),
      overlay('cta', 33.5, 38, 'Book a viewing'),
    ],
    audio: {
      music: {
        trackId: 'catchy_120',
        src: 'data/assets/music/catchy-120.m4a',
        gainDb: -3.5,
        duckUnderVoiceDb: -18,
        beatGrid: [],
      },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: { mode: 'burn', style: 'social_bold', language: 'en-GB' },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'local-planner' },
      promptVersions: { tagging: 'n/a', planning: 'planner-marketing-v1' },
      costUsd: 0,
    },
    ...overrides,
  };
}

describe('checkMarketingBeats', () => {
  it('passes a cut that follows the sheet', () => {
    const result = checkMarketingBeats(buildMarketingEdl());
    expect(result).toMatchObject({ id: 'marketing_beats', passed: true });
    expect(result?.detail).toContain('Marketing sheet holds');
  });

  it('is undefined for every other format, so their check list is unchanged', () => {
    const edl = buildMarketingEdl();
    edl.format = { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 38 };
    expect(checkMarketingBeats(edl)).toBeUndefined();
  });

  it('fails a price that arrives before 28.5 s', () => {
    const edl = buildMarketingEdl();
    const price = edl.overlays.find((entry) => entry.kind === 'price');
    if (price === undefined) throw new Error('fixture has no price');
    price.inSec = 20;

    const result = checkMarketingBeats(edl);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain('before 28.5 s');
  });

  it('fails a hook with no measured motion', () => {
    const edl = buildMarketingEdl();
    const hook = edl.clips[0];
    if (hook === undefined) throw new Error('fixture has no hook');
    delete hook.motionAtSelection;

    const result = checkMarketingBeats(edl);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain('no measured motion');
  });

  it('fails a hook that barely moves', () => {
    const edl = buildMarketingEdl();
    const hook = edl.clips[0];
    if (hook === undefined) throw new Error('fixture has no hook');
    hook.motionAtSelection = MARKETING_HOOK_MOTION_MIN / 4;

    const result = checkMarketingBeats(edl);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain('the hook moves at');
  });

  it('fails a run outside 36-39 s', () => {
    const edl = buildMarketingEdl();
    // Shorten the last two clips so the cut runs 35.5 s.
    for (const index of [edl.clips.length - 2, edl.clips.length - 1]) {
      const clip = edl.clips[index];
      if (clip === undefined) throw new Error('fixture is too short');
      clip.outSec = clip.inSec + 1;
    }

    const result = checkMarketingBeats(edl);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain(`${String(MARKETING_MIN_SEC)}-${String(MARKETING_MAX_SEC)}`);
  });

  it('does not fail the marketing cut on room order', () => {
    const edl = buildMarketingEdl();
    // Two living shots back to back, which is legal in a campaign.
    edl.clips[0]!.room = 'living';
    edl.clips[1]!.room = 'living';

    expect(checkRoomOrder(edl)).toMatchObject({ id: 'room_order', passed: true });
    expect(checkMarketingBeats(edl)?.passed).toBe(true);
  });
});

describe('reviewRender — marketing', () => {
  it('runs the marketing beat gate alongside the ten file checks', async () => {
    const edl = buildMarketingEdl();
    const result = await reviewRender(
      { output: 'takes/marketing_v1.mp4', edl, profile: PROFILE, facts: FACTS },
      makeDeps({ durationSec: 38 }),
    );

    expect(result.checks.map((check) => check.id)).toEqual([
      'duration',
      'no_black_frames',
      'no_freeze',
      'hook_visible',
      'loudness',
      'text_safe_area',
      'cta_legible',
      'room_order',
      'no_repeated_shot',
      'facts_present',
      'marketing_beats',
    ]);
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
  });

  it('retries a marketing cut whose entrance beat is missing', async () => {
    const edl = buildMarketingEdl();
    // Redistribute time inside the cut so the entrance beat starts late while
    // the total stays 38 s: a creative fault, not a broken encode.
    edl.clips[9]!.outSec += 1.5;
    edl.clips[10]!.outSec -= 1.5;

    const result = await reviewRender(
      { output: 'takes/marketing_v2.mp4', edl, profile: PROFILE, facts: FACTS },
      makeDeps({ durationSec: 38 }),
    );

    expect(result.verdict).toBe('retry');
    expect(result.feedback).toContain('marketing sheet');
  });
});
