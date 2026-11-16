/**
 * Public surface of the render review package.
 *
 * `reviewRender` is the entry point. The exported constants and helpers exist
 * for the job layer and for tests: they are pure and stable.
 */

export { reviewRender, buildFeedback, scanTimes, CHECK_ORDER, MAX_RETRIES } from './review';

export {
  BLACK_LUMA_LIMIT,
  CTA_MIN_SEC,
  DURATION_TOLERANCE_SEC,
  FREEZE_LIMIT_SEC,
  HOOK_DETAIL_RATIO,
  HOOK_WINDOW_SEC,
  LOUDNESS_TOLERANCE_LU,
  MARKETING_BEAT_SLACK_SEC,
  MARKETING_ENTRANCE_END_SEC,
  MARKETING_ENTRANCE_START_SEC,
  MARKETING_HOOK_MOTION_MIN,
  MARKETING_MAX_SEC,
  MARKETING_MIN_SEC,
  MARKETING_PRICE_START_SEC,
  MAX_FREEZE_SAMPLE_GAP_SEC,
  MIN_MEASURABLE_DETAIL,
  REPEATED_SHOT_TOLERANCE_SEC,
  checkCta,
  checkDuration,
  checkFacts,
  checkFrames,
  checkHook,
  checkLoudness,
  checkMarketingBeats,
  checkNoRepeatedShot,
  checkRoomOrder,
  checkSafeArea,
} from './checks';

export {
  DEFAULT_REVIEW_MODEL,
  VISION_MAX_NOTES,
  VISION_REVIEW_SCHEMA,
  buildVisionMessages,
  meanVisionScore,
  readVisionScores,
  sceneSummary,
  validateVisionScores,
  visionSampleTimes,
} from './vision';
export type { VisionScores } from './vision';

export { jpegStats, meanLumaFromJpeg } from './jpeg';
export type { JpegStats } from './jpeg';

export type {
  CheckId,
  CheckResult,
  FrameSample,
  ReviewDeps,
  ReviewFacts,
  ReviewInput,
  ReviewResult,
} from './types';
