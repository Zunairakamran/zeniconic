/**
 * Public surface of the reference-video stage.
 *
 * `analyseReference(file, deps)` is the only entry point the orchestrator needs.
 * Everything here is local and deterministic; the optional vision and transcript
 * ports are the only ways a model or a transcript can enter, and neither is used
 * by the default path.
 */

export {
  aspectFromDimensions,
  analyseReference,
  clusterPalette,
  colourWordsFor,
  confidenceFor,
  createLoudnessMeasurer,
  createPaletteSampler,
  cutThresholdFor,
  deriveStyleWords,
  guessTransitions,
  motionLevelFor,
  pacingFor,
  resolveLocalFile,
} from './analyse';

export { ReferenceAnalysisError } from './types';

export {
  clearReferenceProfile,
  readReferenceProfile,
  referenceGuidance,
  REFERENCE_PROFILE_FILE,
  saveReferenceProfile,
} from './store';
export type { StoredReferenceProfile } from './store';
export type {
  LoudnessFn,
  PaletteFn,
  ProbeFn,
  ReadFramesFn,
  ReferenceAspect,
  ReferenceDeps,
  ReferenceErrorCode,
  ReferenceMotionLevel,
  ReferencePacing,
  ReferenceSourceMethod,
  ReferenceSourceNote,
  ReferenceSources,
  ReferenceStyleProfile,
  ReferenceStyleWords,
  ReferenceTranscript,
  ReferenceTranscriptPort,
  ReferenceTransitionGuess,
  ReferenceVisionFrame,
  ReferenceVisionInput,
  ReferenceVisionPort,
  ReferenceVisionShot,
  RgbSample,
} from './types';
