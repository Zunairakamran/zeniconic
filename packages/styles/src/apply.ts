import type { LookId } from '@zeniconic/edl';
import type { PlanRequest } from '@zeniconic/planner';
import type { StylePack, StylePacing, StyleTransitions } from './types';

/** The legal pacing envelope for any format, per the style contract. */
export const MIN_SHOT_SEC = 1.0;
export const MAX_SHOT_SEC = 6.0;

/** Transitions shorter than this are not readable; longer than this is a scene. */
export const MIN_TRANSITION_SEC = 0.2;
export const MAX_TRANSITION_SEC = 1.0;

export const MAX_EVERY_NTH_CUT = 16;

/** The applied copy of a pack. Its pacing and transition timing are clamped. */
export type AppliedStyle = StylePack;

/** A request with the resolved style attached, without changing the planner. */
export interface StyledPlanRequest extends PlanRequest {
  style: AppliedStyle;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function roundSec(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * The only bounds a `PlanRequest` carries are the format's target runtime and
 * the package's legal shot envelope. A single shot cannot outrun the whole
 * film, so the target is the ceiling; the 1.0 s floor is the format floor.
 */
function formatPacingBounds(targetDurationSec: number): { min: number; max: number } {
  const target =
    Number.isFinite(targetDurationSec) && targetDurationSec > 0
      ? targetDurationSec
      : MAX_SHOT_SEC;
  return { min: MIN_SHOT_SEC, max: clamp(target, MIN_SHOT_SEC, MAX_SHOT_SEC) };
}

/**
 * Clamps pacing into the format envelope. An inverted pair or a non-finite
 * value is a broken pack, not a creative choice, so it falls back to the full
 * format bounds.
 */
export function resolvePacing(
  pacing: StylePacing,
  targetDurationSec: number,
): StylePacing {
  const bounds = formatPacingBounds(targetDurationSec);

  let minShotSec = clamp(finiteOr(pacing.minShotSec, bounds.min), bounds.min, bounds.max);
  let maxShotSec = clamp(finiteOr(pacing.maxShotSec, bounds.max), bounds.min, bounds.max);

  if (minShotSec > maxShotSec) {
    minShotSec = bounds.min;
    maxShotSec = bounds.max;
  }

  const fallbackAverage = (minShotSec + maxShotSec) / 2;
  const targetAvgShotSec = clamp(
    finiteOr(pacing.targetAvgShotSec, fallbackAverage),
    minShotSec,
    maxShotSec,
  );

  return {
    minShotSec: roundSec(minShotSec),
    maxShotSec: roundSec(maxShotSec),
    targetAvgShotSec: roundSec(targetAvgShotSec),
  };
}

/** Transition timing is clamped independently of the style's raw request. */
export function resolveTransitions(transitions: StyleTransitions): StyleTransitions {
  return {
    in: transitions.in,
    out: transitions.out,
    durationSec: roundSec(
      clamp(
        finiteOr(transitions.durationSec, MIN_TRANSITION_SEC),
        MIN_TRANSITION_SEC,
        MAX_TRANSITION_SEC,
      ),
    ),
    everyNthCut: clamp(
      Math.round(finiteOr(transitions.everyNthCut, 1)),
      1,
      MAX_EVERY_NTH_CUT,
    ),
  };
}

/**
 * Applies a pack to a plan request without mutating it.
 *
 * The result changes the look identity and injects the resolved `style` block:
 * pacing, transitions, overlays, captions, music character and colour. The
 * format keeps its own label and target duration; the style never rewrites the
 * creative template. Every nested value the planner may mutate is copied.
 */
export function applyStyle(request: PlanRequest, style: StylePack): StyledPlanRequest {
  return {
    ...request,
    format: { ...request.format },
    // Style ids are the EDL look ids by contract; the loader validates every
    // shipped pack, and the test suite asserts the ids are in the look enum.
    look: { id: style.id as LookId, label: style.label },
    canvas: {
      ...request.canvas,
      safeArea: { ...request.canvas.safeArea },
    },
    candidates: request.candidates.map((candidate) => ({ ...candidate })),
    facts: { ...request.facts },
    music: {
      ...request.music,
      beatGrid: [...request.music.beatGrid],
    },
    style: {
      version: 1,
      id: style.id,
      label: style.label,
      pacing: resolvePacing(style.pacing, request.format.targetDurationSec),
      transitions: resolveTransitions(style.transitions),
      overlays: { ...style.overlays },
      captions: { ...style.captions },
      music: { ...style.music },
      color: { ...style.color },
    },
  };
}
