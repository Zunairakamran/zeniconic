import type { Clip, Edl, FormatRef, Overlay, Room } from '../../edl/src/index';

export interface ClipSpec {
  room: Room;
  seconds: number;
  inSec?: number;
  speed?: number;
  score?: number;
  motion?: number;
  /** Optional pre-existing outgoing transition (marketing tests). */
  transitionOut?: { type: 'cut' | 'whip' | 'dissolve' | 'zoom_blur' | 'luma_wipe'; durationSec: number };
  handleOutSec?: number;
}

export interface EdlSpec {
  clips: ClipSpec[];
  format?: FormatRef;
  lookId?: 'calm' | 'social' | 'walkthrough' | 'editorial';
  overlays?: Overlay[];
  beatGrid?: number[];
}

const CUT = { type: 'cut' as const, durationSec: 0 };

function sourceId(index: number): string {
  return `s_${(index + 1).toString(16).padStart(8, '0')}`;
}

function clipId(index: number): string {
  return `c${String(index + 1).padStart(2, '0')}`;
}

/**
 * A schema-valid fixture. The default transform is the bland 1.04→1.08 push
 * the creative pass is meant to replace.
 */
export function makeEdl(spec: EdlSpec): Edl {
  const clips: Clip[] = spec.clips.map((entry, index) => {
    const inSec = entry.inSec ?? 1;
    const outSec = inSec + entry.seconds * (entry.speed ?? 1);
    return {
      id: clipId(index),
      sourceId: sourceId(index),
      src: `raw/${entry.room}_${index + 1}.mp4`,
      inSec,
      outSec,
      speed: entry.speed ?? 1,
      volumeDb: -18,
      room: entry.room,
      transform: {
        mode: 'cover',
        focus: 'saliency',
        path: [
          { t: 0, x: 0.5, y: 0.5, scale: 1.04 },
          { t: 1, x: 0.5, y: 0.5, scale: 1.08 },
        ],
      },
      transitionIn: { ...CUT },
      ...(entry.transitionOut === undefined ? { transitionOut: { ...CUT } } : { transitionOut: entry.transitionOut }),
      ...(entry.handleOutSec === undefined ? {} : { handleOutSec: entry.handleOutSec }),
      reason: 'fixture shot',
      ...(entry.score === undefined ? { scoreAtSelection: 0.8 } : { scoreAtSelection: entry.score }),
      ...(entry.motion === undefined ? {} : { motionAtSelection: entry.motion }),
    };
  });

  const total = Math.round(spec.clips.reduce((sum, entry) => sum + entry.seconds, 0) * 1000) / 1000;

  return {
    edlVersion: '1.0.0',
    id: 'edl_creative-fixture_v1',
    listingId: 'fixture-listing',
    createdAt: '2026-01-01T00:00:00.000Z',
    format: spec.format ?? {
      id: 'cinematic_hero',
      label: 'Cinematic hero',
      targetDurationSec: total,
    },
    look: { id: spec.lookId ?? 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips,
    overlays: spec.overlays ?? [],
    audio: {
      music: {
        trackId: 'none',
        src: '',
        gainDb: -18,
        duckUnderVoiceDb: -12,
        beatGrid: spec.beatGrid ?? [],
      },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: { mode: 'none' },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'local-planner' },
      promptVersions: { tagging: 'n/a', planning: 'fixture-v1' },
      costUsd: 0,
    },
  };
}

/** A varied nine-shot tour: two living rooms, two bedrooms, view, balcony. */
export function narrativeFixture(): Edl {
  return makeEdl({
    clips: [
      { room: 'living', seconds: 3.8, score: 0.85 },
      { room: 'living', seconds: 2.4, score: 0.82 },
      { room: 'entry', seconds: 2.6, score: 0.78 },
      { room: 'kitchen', seconds: 2.0, score: 0.84 },
      { room: 'bathroom', seconds: 2.2, score: 0.8 },
      { room: 'bedroom', seconds: 3.6, score: 0.86 },
      { room: 'bedroom', seconds: 3.4, score: 0.83 },
      { room: 'view', seconds: 3.0, score: 0.9 },
      { room: 'balcony', seconds: 2.4, score: 0.79 },
    ],
  });
}

/** Hook choice: the longer living shot is the trap, the shorter one should win. */
export function hookFixture(): Edl {
  return makeEdl({
    clips: [
      { room: 'living', seconds: 4.0, score: 0.85 },
      { room: 'living', seconds: 2.5, score: 0.85 },
      { room: 'entry', seconds: 2.0, score: 0.7 },
      { room: 'bedroom', seconds: 3.0, score: 0.8 },
      { room: 'bathroom', seconds: 2.0, score: 0.75 },
    ],
  });
}

/** A cut 50 ms after a beat, used to prove boundary snapping. */
export function beatFixture(): Edl {
  return makeEdl({
    clips: [
      { room: 'living', seconds: 4.05, score: 0.9 },
      { room: 'entry', seconds: 2.5, score: 0.8 },
      { room: 'bedroom', seconds: 3.0, score: 0.8 },
      { room: 'bedroom', seconds: 3.0, score: 0.8 },
    ],
  });
}

/**
 * The real marketing_38 shot distribution: 6 living, 5 kitchen, 4 bedroom and
 * 1 entry, grouped by room the way the planner emits them. Durations sum to
 * 38 s and are ordered so the storyboard template maps them one-to-one; the
 * 10 clips before the entry run 23.3 s, so the entry retime has to move 0.3 s.
 * Scores descend inside each room so "best remaining clip of that room" picks
 * in fixture order.
 */
export function marketingDistributionFixture(): Edl {
  return makeEdl({
    format: { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 38 },
    clips: [
      { room: 'living', seconds: 2.4, score: 0.9 },
      { room: 'living', seconds: 2.2, score: 0.88 },
      { room: 'living', seconds: 2.6, score: 0.86 },
      { room: 'living', seconds: 2.6, score: 0.84 },
      { room: 'living', seconds: 2.4, score: 0.82 },
      { room: 'living', seconds: 2.9, score: 0.8 },
      { room: 'kitchen', seconds: 2.2, score: 0.86 },
      { room: 'kitchen', seconds: 2.2, score: 0.84 },
      { room: 'kitchen', seconds: 2.0, score: 0.82 },
      { room: 'kitchen', seconds: 2.2, score: 0.8 },
      { room: 'kitchen', seconds: 2.2, score: 0.78 },
      { room: 'bedroom', seconds: 2.4, score: 0.84 },
      { room: 'bedroom', seconds: 2.5, score: 0.82 },
      { room: 'bedroom', seconds: 2.4, score: 0.8 },
      { room: 'bedroom', seconds: 2.3, score: 0.78 },
      { room: 'entry', seconds: 2.5, score: 0.8 },
    ],
  });
}

/** marketing_38 with an existing dissolve between two living-room shots. */
export function sameRoomDissolveFixture(): Edl {
  return makeEdl({
    format: { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 10 },
    clips: [
      { room: 'living', seconds: 2.4, score: 0.9 },
      {
        room: 'living',
        seconds: 2.5,
        score: 0.85,
        transitionOut: { type: 'dissolve', durationSec: 0.36 },
        handleOutSec: 0.36,
      },
      { room: 'living', seconds: 2.6, score: 0.8 },
      { room: 'kitchen', seconds: 2.5, score: 0.8 },
    ],
  });
}

/** marketing_38 with an existing dissolve between living and kitchen. */
export function crossRoomDissolveFixture(): Edl {
  return makeEdl({
    format: { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 9.9 },
    clips: [
      { room: 'living', seconds: 2.4, score: 0.9 },
      {
        room: 'living',
        seconds: 2.5,
        score: 0.85,
        transitionOut: { type: 'dissolve', durationSec: 0.36 },
        handleOutSec: 0.36,
      },
      { room: 'kitchen', seconds: 2.5, score: 0.8 },
      { room: 'bedroom', seconds: 2.5, score: 0.8 },
    ],
  });
}

/** marketing_38 with its price/CTA windows and one existing whip. */
export function marketingFixture(): Edl {
  return makeEdl({
    format: { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 19.6 },
    clips: [
      { room: 'living', seconds: 2.2, score: 0.9, transitionOut: { type: 'whip', durationSec: 0.2 }, handleOutSec: 0.2 },
      { room: 'living', seconds: 2.15, score: 0.88 },
      { room: 'kitchen', seconds: 2.75, score: 0.86 },
      { room: 'kitchen', seconds: 2.0, score: 0.85 },
      { room: 'entry', seconds: 2.75, score: 0.8 },
      { room: 'living', seconds: 2.75, score: 0.82 },
      { room: 'bedroom', seconds: 2.5, score: 0.84 },
      { room: 'bedroom', seconds: 2.5, score: 0.83 },
    ],
    overlays: [
      {
        id: 'o01',
        kind: 'price',
        text: 'AED 1,400,000',
        inSec: 14,
        outSec: 17,
        anchor: 'bottom_center',
        style: 'price_lower',
        animation: 'count_up',
      },
      {
        id: 'o02',
        kind: 'cta',
        text: 'Book a viewing',
        inSec: 17,
        outSec: 19.6,
        anchor: 'center',
        style: 'cta_card',
        animation: 'fade',
      },
    ],
  });
}
