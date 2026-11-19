/**
 * Public types for the creative-director pass.
 *
 * The pass is deliberately additive: it reads a planned `Edl`, reorders the
 * existing clips, and writes motion, transitions, grade and restrained effects
 * back into the same document. It never re-plans, never invents listing facts,
 * and never changes the total runtime.
 */

import type {
  ColorGrade,
  ColorGradePreset,
  Edl,
  EffectType,
  Focus,
  Room,
  TransitionType,
  ValidationIssue,
} from '../../edl/src/index';

/**
 * Why a shot is in the film. `hook` and `close` are assigned to exactly one
 * clip each; the rest describe the narrative job of the shot.
 */
export type ClipPurpose =
  | 'hook'
  | 'establishing'
  | 'space'
  | 'craft'
  | 'detail'
  | 'rest'
  | 'lifestyle'
  | 'feature'
  | 'close';

export type MotionKind =
  | 'push_in'
  | 'pull_out'
  | 'pan_left'
  | 'pan_right'
  | 'hold';

export interface DirectOptions {
  /**
   * Optional music beats, in timeline seconds. When supplied, cuts within
   * `beatToleranceSec` of a beat are pulled onto it, and new transitions are
   * placed only on (or adjacent to) beats.
   */
  beatGrid?: readonly number[];
  /** Maximum pull onto a beat. Default 0.08 s, clamped to 0.02..0.25. */
  beatToleranceSec?: number;
  /**
   * Move cuts onto nearby beats by trimming the outgoing clip and extending
   * the incoming one. Total duration is unchanged. Default: true when a beat
   * grid is supplied.
   */
  snapBoundaries?: boolean;
  /** Override the grade chosen from the look. `'none'` emits no grade. */
  gradePreset?: ColorGradePreset;
  /** 0..1 blend for the grade. Default 0.8. */
  gradeIntensity?: number;
  /** Add restrained vignette/grain/sharpen to a few clips. Default true. */
  addEffects?: boolean;
  /** Assign transitions. Default true. */
  addTransitions?: boolean;
  /** Share of boundaries allowed to carry a non-cut. Default 0.4. */
  maxTransitionRatio?: number;
  /**
   * Borrow `handleOutSec` equal to the transition length so `xfade` does not
   * shorten the film. When false, a transition is only used if the clip
   * already carries a handle long enough for it. Default true.
   */
  borrowHandles?: boolean;
  /**
   * For `marketing_38`, keep the planned clip order and its overlay windows.
   * Default true; only the opening and climax are strengthened.
   */
  preserveMarketingStructure?: boolean;
  /**
   * Re-anchor overlays to the clip that carried them before reordering.
   * Default false: overlays stay on their absolute timeline seconds, which
   * keeps a price card late in the film even when the shot under it changes.
   */
  remapOverlays?: boolean;
  /** Minimum clip length kept when snapping a boundary. Default 0.4 s. */
  minClipSec?: number;
}

export interface MotionRationale {
  kind: MotionKind;
  fromScale: number;
  toScale: number;
  focus: Focus;
  reason: string;
}

export interface TransitionRationale {
  atSec: number;
  fromClipId: string;
  toClipId: string;
  type: TransitionType;
  durationSec: number;
  reason: string;
  /** Nearest beat when a grid was supplied. */
  beatSec?: number;
  /** True when the cut is the nearest boundary to that beat. */
  onBeat?: boolean;
}

export interface ClipPlanRationale {
  clipId: string;
  room: Room;
  purpose: ClipPurpose;
  purposeReason: string;
  isHook: boolean;
  isClose: boolean;
  originalIndex: number;
  orderIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** Only set for hook candidates. */
  hookScore?: number;
  motion: MotionRationale;
  transitionOut: TransitionRationale;
  effects: Array<{ type: EffectType; amount: number; reason: string }>;
}

export interface BeatSnapRationale {
  fromSec: number;
  toSec: number;
  deltaSec: number;
  applied: boolean;
  reason: string;
}

export interface DirectRationale {
  hook: {
    clipId: string;
    room: Room;
    purpose: ClipPurpose;
    score: number;
    reason: string;
  };
  close: {
    clipId: string;
    room: Room;
    purpose: ClipPurpose;
    reason: string;
  };
  narrativeOrder: string[];
  clips: ClipPlanRationale[];
  transitions: TransitionRationale[];
  grade: {
    preset: ColorGradePreset;
    grade?: ColorGrade;
    reason: string;
  };
  effects: Array<{
    clipId: string;
    type: EffectType;
    amount: number;
    reason: string;
  }>;
  beatSnapping: {
    enabled: boolean;
    toleranceSec: number;
    moves: BeatSnapRationale[];
  };
  durationSec: number;
  inputDurationSec: number;
  durationDeltaSec: number;
  targetDurationSec?: number;
  durationWithinTarget: boolean;
  validation: {
    valid: boolean;
    issues: ValidationIssue[];
  };
  marketingStructurePreserved: boolean;
  limitations: string[];
}

export interface DirectResult {
  edl: Edl;
  rationale: DirectRationale;
}

/** Thrown when the input is not a valid EDL, or the output would be invalid. */
export class CreativeError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    const detail =
      issues.length === 0
        ? ''
        : `: ${issues
            .slice(0, 4)
            .map((issue) => `${issue.code} at ${issue.path || '/'}: ${issue.message}`)
            .join('; ')}`;
    super(`${message}${detail}`);
    this.name = 'CreativeError';
    this.issues = issues;
  }
}
