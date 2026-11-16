export type {
  Candidate,
  Facts,
  FormatSpec,
  LookSpec,
  PlanRequest,
  PlannedClip,
  SequenceSpec,
} from './types';

export { planVariant } from './plan';
export { validateSequence } from './sequence';

export {
  MARKETING_AVERAGE_SHOT_SEC,
  MARKETING_BEATS,
  MARKETING_BEAT_TOLERANCE_SEC,
  MARKETING_CAPTION_LIMITS,
  MARKETING_DURATION_SEC,
  MARKETING_FORMAT_ID,
  MARKETING_LABEL,
  MARKETING_MAX_SHOT_SEC,
  MARKETING_MIN_SHOT_SEC,
  MARKETING_TRANSITIONS,
  marketingBeatAt,
  marketingBoundaries,
  marketingCaptionWords,
  marketingPrice,
  planMarketing,
} from './marketing';
export type { MarketingBeat, MarketingBeatId } from './marketing';

import type { Edl } from '@zeniconic/edl';
import { planVariant } from './plan';
import { MARKETING_FORMAT_ID, planMarketing } from './marketing';
import type { PlanRequest } from './types';

/**
 * The planner seam the pipeline calls. `marketing_38` is its own assembly (a
 * campaign, not a room tour); every other format keeps the room-order planner.
 */
export function planRequest(request: PlanRequest): Edl {
  return request.format.id === MARKETING_FORMAT_ID ? planMarketing(request) : planVariant(request);
}
