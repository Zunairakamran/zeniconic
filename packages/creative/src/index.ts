/**
 * `@zeniconic/creative` — a deterministic creative-director pass over a
 * planned EDL.
 *
 * ```ts
 * const { edl, rationale } = direct(planned, { beatGrid, gradePreset: 'luxury' });
 * ```
 *
 * The returned `edl` is validated, keeps every clip exactly once, and keeps the
 * input runtime. The rationale explains every purpose, motion, transition,
 * grade and effect decision.
 */

export { direct, CREATIVE_PIPELINE_VERSION } from './direct';
export { CreativeError } from './types';
export type {
  BeatSnapRationale,
  ClipPlanRationale,
  ClipPurpose,
  DirectOptions,
  DirectRationale,
  DirectResult,
  MotionKind,
  MotionRationale,
  TransitionRationale,
} from './types';

// Exposed for callers that want to show the decision before rendering.
export { classifyPurpose, rankHookCandidates, rankCloseCandidates, roomOf } from './classify';
export { narrativeOrder, interleaveByRoom, marketingStoryboard } from './order';
export { assignMotion, chooseGrade, chooseEffects } from './style';
export { assignTransitions } from './transitions';
export { snapCutBoundaries } from './beat';
export { clipTimelineSec, windowsOf } from './timeline';
