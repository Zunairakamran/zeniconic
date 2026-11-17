/**
 * Turn a remix preset's ordered slots into a valid EDL.
 *
 * Unlike the room-order planner, this preserves the preset's order exactly:
 * the whole point of a remix is the new sequence, so the planner must not
 * re-sort it. Each shot gets its own `sourceId` so the EDL's same-source
 * contiguity rule cannot reject a deliberate jump backwards.
 */

import { EDL_VERSION, assertEdl } from '../../../packages/edl/src/index';
import type { CaptionWord, Clip, Edl, Overlay, Profile } from '../../../packages/edl/src/index';
import type { TimelineSlot } from './presets';

export interface RemixFacts {
  address: string;
  price?: string;
  beds?: number;
  baths?: number;
  currency: 'AED' | 'GBP' | 'USD' | 'EUR';
}

export interface BuildRemixEdlInput {
  listingId: string;
  /** The imported finished video every slot points at. */
  file: string;
  slots: readonly TimelineSlot[];
  facts: RemixFacts;
  /** ISO timestamp, injected for determinism. */
  now: string;
  /** Transcript words already remapped onto this slot order. */
  words?: readonly CaptionWord[];
  profile?: Profile;
  look?: { id: 'social'; label: string };
}

const CANVAS = {
  'vertical-social': { width: 1080, height: 1920, fps: 30, safeArea: { top: 250, bottom: 340, left: 60, right: 120 } },
  landscape: { width: 1920, height: 1080, fps: 30, safeArea: { top: 60, bottom: 90, left: 60, right: 60 } },
  'feed-portrait': { width: 1080, height: 1350, fps: 30, safeArea: { top: 180, bottom: 220, left: 60, right: 60 } },
  pin: { width: 1000, height: 1500, fps: 30, safeArea: { top: 60, bottom: 90, left: 60, right: 60 } },
} as const;

const MIN_DURATION = 5;
const MAX_DURATION = 90;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clipId(index: number): string {
  return `c${String(index + 1).padStart(2, '0')}`;
}

/** The schema wants `s_` + 8 hex; derive one deterministically per shot. */
function sourceIdFor(index: number, shotId: string): string {
  let hash = 0x811c9dc5;
  const value = `${index}:${shotId}`;
  for (let position = 0; position < value.length; position += 1) {
    hash ^= value.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `s_${hash.toString(16).padStart(8, '0').slice(0, 8)}`;
}

export function buildRemixEdl(input: BuildRemixEdlInput): Edl {
  if (input.slots.length === 0) throw new RangeError('A remix needs at least one slot.');

  const profile = input.profile ?? 'vertical-social';
  let cursor = 0;
  const clips: Clip[] = input.slots.map((slot, index) => {
    const start = Math.max(0, round3(slot.inSec));
    const end = round3(Math.min(slot.outSec, start + slot.targetSec));
    if (end <= start) {
      throw new RangeError(`Slot ${slot.shotId} has no usable source window.`);
    }
    cursor = round3(cursor + (end - start));
    return {
      id: clipId(index),
      // One source id per shot: a deliberate jump in one file is not a gap.
      sourceId: sourceIdFor(index, slot.shotId),
      src: input.file,
      inSec: start,
      outSec: end,
      speed: 1,
      volumeDb: -18,
      room: slot.room,
      transform: {
        mode: 'cover',
        focus: 'saliency',
        path: [
          { t: 0, x: 0.5, y: 0.5, scale: 1.04 },
          { t: 1, x: 0.5, y: 0.5, scale: 1.08 },
        ],
      },
      transitionIn: { type: 'cut', durationSec: 0 },
      transitionOut: { type: 'cut', durationSec: 0 },
      reason: slot.reason.slice(0, 160),
      scoreAtSelection: 0.5,
    };
  });

  const duration = round3(clips.reduce((sum, clip) => sum + (clip.outSec - clip.inSec), 0));
  if (duration < MIN_DURATION || duration > MAX_DURATION) {
    throw new RangeError(
      `The remix runs ${duration}s; the EDL supports ${MIN_DURATION}–${MAX_DURATION}s.`,
    );
  }

  const overlays: Overlay[] = [];
  const price = input.facts.price?.trim();
  if (price !== undefined && price.length > 0) {
    const window = Math.min(4, duration);
    overlays.push({
      id: 'o01',
      kind: 'price',
      text: price.slice(0, 90),
      ...(input.facts.beds === undefined && input.facts.baths === undefined
        ? {}
        : {
            subtext: [
              input.facts.beds === undefined ? undefined : `${String(input.facts.beds)} bed`,
              input.facts.baths === undefined ? undefined : `${String(input.facts.baths)} bath`,
            ]
              .filter((part): part is string => part !== undefined)
              .join(' · '),
          }),
      inSec: round3(Math.max(0, duration - window)),
      outSec: duration,
      anchor: 'bottom_center',
      style: 'price_lower',
      maxWidthPct: 84,
      opacity: 1,
      animation: 'count_up',
    });
  }

  const canvas = CANVAS[profile];
  const edl: Edl = {
    edlVersion: EDL_VERSION,
    id: 'edl_remix_v1',
    listingId: input.listingId,
    createdAt: input.now,
    format: { id: 'social_hook', label: 'Social hook', targetDurationSec: duration },
    look: input.look ?? { id: 'social', label: 'Social' },
    canvas: {
      profile,
      width: canvas.width,
      height: canvas.height,
      fps: canvas.fps,
      safeArea: { ...canvas.safeArea },
    },
    clips,
    overlays,
    audio: {
      music: { trackId: 'none', src: '', gainDb: -18, duckUnderVoiceDb: -12, beatGrid: [] },
      voice: { mode: 'keep' },
      mix: { lufs: profile === 'landscape' ? -16 : -14, truePeakDbtp: -1.5 },
    },
    captions:
      input.words === undefined || input.words.length === 0
        ? { mode: 'none' }
        : {
            mode: 'burn',
            style: 'social_bold',
            language: 'en-GB',
            words: input.words.map((word) => ({ ...word })),
          },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'remix-preset' },
      promptVersions: { tagging: 'n/a', planning: 'remix-v1' },
      costUsd: 0,
    },
  };

  assertEdl(edl);
  return edl;
}
