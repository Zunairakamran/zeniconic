/**
 * Public surface of the remix stage.
 *
 * This folder only contains pure planning/parsing/transport pieces. The
 * orchestrator owns files, jobs, IPC and the UI wiring; nothing here reads a
 * config file, spawns outside the injected runner, or logs a credential.
 */

export {
  DEFAULT_FPS,
  DEFAULT_SCENE_THRESHOLD,
  FALLBACK_CHUNK_SEC,
  HANDLE_FRAMES,
  MIN_SHOT_SEC,
  SHORT_SHOT_SEC,
  SceneSplitError,
  detectSceneCuts,
  detectScenes,
  fallbackShots,
  parseFfmpegDuration,
  parseShowinfo,
  shotsFromCuts,
  splitScenes,
} from './split';
export type {
  SceneBoundaryOptions,
  SceneDetectOptions,
  SceneDetection,
  SceneSplitErrorCode,
  SceneSplitResult,
  SceneSplitWarning,
  Shot,
  SplitScenesOptions,
} from './split';

export {
  DEFAULT_MAX_CANDIDATES,
  PLACEHOLDER_SCORE,
  buildCandidates,
} from './candidates';
export type {
  CandidateBuildOptions,
  Orientation,
  RemixCandidate,
} from './candidates';

export {
  DEFAULT_TRANSCRIPTION_BASE_URL,
  DEFAULT_TRANSCRIPTION_MODEL,
  MAX_AUDIO_CHUNK_BYTES,
  TRANSCRIPTION_TIMEOUT_MS,
  TranscriptionError,
  chunkAudioBytes,
  createTranscriber,
  transcribeAudio,
} from './transcribe';
export type {
  AudioInput,
  TranscribeOptions,
  Transcriber,
  TranscriptionErrorCode,
  TranscriptionResult,
  TranscriptSegment,
  TranscriptWord,
} from './transcribe';

export {
  DEFAULT_PRESET_MAX_SHOT_SEC,
  DEFAULT_PRESET_MIN_SHOT_SEC,
  DEFAULT_PRESET_TARGET_SEC,
  buildMarketingOrder,
  buildOriginalOrder,
  buildPriceLedOrder,
  orderForPreset,
} from './presets';
export type {
  PresetId,
  PresetOptions,
  TaggedShot,
  TimelineBeat,
  TimelineSlot,
} from './presets';

export { buildRemixEdl } from './edl';
export type { BuildRemixEdlInput, RemixFacts } from './edl';

export { remapWordsToSlots } from './remap';

export {
  clearStoryboard,
  readStoryboard,
  REMIX_STORYBOARD_FILE,
  saveStoryboard,
  slotToDto,
} from './store';
export type {
  RemixShotDto,
  RemixSlotDto,
  RemixStoryboard,
  RemixTranscriptionDto,
} from './store';

export {
  MAX_REMIX_ORDER,
  RemixEditError,
  asRoom,
  reorderSlots,
  requireRoom,
  setSlotRoom,
} from './edit';
export type { RemixEditErrorCode } from './edit';

export { REMIX_ROOMS, isRemixRoom } from './rooms';
export type { RemixRoom } from './rooms';

export {
  DEFAULT_FILLERS,
  MAX_LINES_PER_CUE,
  MAX_WORDS_PER_LINE,
  cleanCaptions,
} from './captions';
export type {
  CaptionCleanerOptions,
  CleanedCaptionCue,
} from './captions';
