import { roundTime, totalDuration } from '@zeniconic/core';
import { EDL_VERSION, assertEdl } from '@zeniconic/edl';
import type { Clip, Edl, Overlay, Profile, Transform } from '@zeniconic/edl';
import type { Facts, PlanRequest, PlannedClip, SequenceSpec } from './types';
import {
  MAX_SHOT_SEC,
  MIN_SHOT_SEC,
  ROOM_ORDER,
  planSequence,
} from './sequence';

const PIPELINE_VERSION = '0.1.0';
const PLANNING_MODEL = 'local-planner';
const PLANNING_PROMPT = 'planner-v1';

const MAX_OVERLAY_TEXT = 90;
const MAX_REASON_TEXT = 160;

const ADDRESS_IN_SEC = 0.4;
const ADDRESS_OUT_SEC = 4.4;
const PRICE_WINDOW_SEC = 5.2;

const CLIP_VOLUME_DB = -18;
const TRUE_PEAK_DBTP = -1.5;

/** The sequence budget a format gets. 30s is the default every format starts from. */
export function sequenceSpecFor(targetDurationSec: number): SequenceSpec {
  return {
    targetDurationSec,
    minShotSec: MIN_SHOT_SEC,
    maxShotSec: MAX_SHOT_SEC,
    roomOrder: [...ROOM_ORDER],
  };
}

function clipId(index: number): string {
  return `c${String(index + 1).padStart(2, '0')}`;
}

function overlayId(index: number): string {
  return `o${String(index + 1).padStart(2, '0')}`;
}

/** Fits text inside the schema's maxLength without silently emptying it. */
function clampText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Cover crop with a gentle push. The renderer may refine the focal point from
 * saliency; this is the deterministic default.
 */
function defaultTransform(): Transform {
  return {
    mode: 'cover',
    focus: 'saliency',
    path: [
      { t: 0, x: 0.5, y: 0.5, scale: 1.04 },
      { t: 1, x: 0.5, y: 0.5, scale: 1.08 },
    ],
  };
}

function toClip(planned: PlannedClip, index: number): Clip {
  const reason = planned.reason.trim() || `Best ${planned.room} shot in the pool.`;
  return {
    id: clipId(index),
    sourceId: planned.sourceId,
    src: planned.src,
    inSec: roundTime(planned.inSec),
    outSec: roundTime(planned.inSec + planned.durationSec),
    speed: 1,
    volumeDb: CLIP_VOLUME_DB,
    room: planned.room,
    transform: defaultTransform(),
    transitionIn: { type: 'cut', durationSec: 0 },
    transitionOut: { type: 'cut', durationSec: 0 },
    reason: clampText(reason, MAX_REASON_TEXT),
    scoreAtSelection: roundTime(Math.min(1, Math.max(0, planned.score))),
  };
}

function specSubtext(facts: Facts): string | undefined {
  const parts: string[] = [];
  if (facts.beds !== undefined) parts.push(`${facts.beds} bed`);
  if (facts.baths !== undefined) parts.push(`${facts.baths} bath`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Address tag over the hook, then the price card and logo over the last 5.2s.
 * Nothing is invented: a missing fact simply omits its overlay.
 */
function buildOverlays(facts: Facts, durationSec: number): Overlay[] {
  const overlays: Overlay[] = [];

  const address = facts.address.trim();
  if (address) {
    const outSec = roundTime(Math.min(ADDRESS_OUT_SEC, durationSec));
    const inSec = roundTime(Math.min(ADDRESS_IN_SEC, Math.max(0, outSec - 0.1)));
    if (outSec > inSec) {
      overlays.push({
        id: overlayId(overlays.length),
        kind: 'address',
        text: clampText(address, MAX_OVERLAY_TEXT),
        inSec,
        outSec,
        anchor: 'bottom_left',
        style: 'address_tag',
        maxWidthPct: 72,
        opacity: 1,
        animation: 'rise',
      });
    }
  }

  const price = facts.price?.trim();
  if (price) {
    const outSec = roundTime(durationSec);
    const inSec = roundTime(Math.max(0, durationSec - PRICE_WINDOW_SEC));
    if (outSec > inSec) {
      const subtext = specSubtext(facts);
      overlays.push({
        id: overlayId(overlays.length),
        kind: 'price',
        text: clampText(price, MAX_OVERLAY_TEXT),
        ...(subtext ? { subtext: clampText(subtext, MAX_OVERLAY_TEXT) } : {}),
        inSec,
        outSec,
        anchor: 'bottom_center',
        style: 'price_lower',
        maxWidthPct: 84,
        opacity: 1,
        animation: 'count_up',
      });
      overlays.push({
        id: overlayId(overlays.length),
        kind: 'logo',
        inSec,
        outSec,
        anchor: 'top_left',
        style: 'logo_corner',
        maxWidthPct: 34,
        opacity: 0.9,
        animation: 'fade',
      });
    }
  }

  return overlays;
}

function lufsFor(profile: Profile): number {
  return profile === 'landscape' ? -16 : -14;
}

/**
 * Deterministic variant planner: same request + seed + now gives the same EDL.
 * The seed only settles equal-score ties outside the hook; the hook itself is
 * always the top score with ties broken by shot id.
 */
export function planVariant(request: PlanRequest): Edl {
  const spec = sequenceSpecFor(request.format.targetDurationSec);
  const planned = planSequence(
    request.candidates,
    spec,
    request.look.id,
    request.music.beatGrid,
    request.seed,
  );

  const clips = planned.map((clip, index) => toClip(clip, index));
  const duration = totalDuration(clips);

  const edl: Edl = {
    edlVersion: EDL_VERSION,
    id: `edl_${request.format.id.replace(/_/g, '-')}_v1`,
    listingId: request.listingId,
    createdAt: request.now,
    format: {
      id: request.format.id,
      label: request.format.label,
      targetDurationSec: request.format.targetDurationSec,
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
    overlays: buildOverlays(request.facts, duration),
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
    captions: { mode: 'none' },
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
