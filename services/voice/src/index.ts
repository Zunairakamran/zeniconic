/**
 * Public surface of the voice stage.
 *
 * The desktop should call `buildVoiceTrack`; everything else is exported for
 * tests, diagnostics and the CLI.
 */

export { DEFAULT_MUSIC_PATH, buildVoiceTrack, presenterWindowsFor, scriptCues } from './service';
export { extractPresenterSpeech, longestSpeechRegion } from './presenter';
export type { PresenterSpeechEntry, PresenterWord, PresenterExtractionResult } from './presenter';
export { buildHybridCues, hasPresenterWindow, overlapsPresenter } from './hybrid';
export type { HybridCueInput } from './hybrid';

export {
  buildVoicePlan,
  monotonicCaptions,
  presenterWindowForCue,
} from './plan';
export type {
  BuildVoicePlanInput,
  PresenterWindow,
  ScriptCue,
  TtsLine,
  VoicePlan,
} from './plan';

export { VOICE_CACHE_VERSION, voiceLineKey, voiceLinePath } from './cache';
export type { VoiceCacheTag } from './cache';

export { DEFAULT_VOICE, KOKORO_MODEL_ID, createKokoroEngine } from './tts';
export type { KokoroEngineOptions } from './tts';

export {
  STUDIO_CACHE_TAG,
  STUDIO_MODEL_ID,
  STUDIO_SAMPLE_RATE,
  STUDIO_SPEECH_ENDPOINT,
  STUDIO_TIMEOUT_MS,
  STUDIO_USD_PER_CHAR,
  StudioVoiceError,
  configureStudioVoice,
  createStudioEngine,
  selectVoiceEngine,
  studioVoiceConfig,
  studioVoiceReady,
} from './studio-tts';
export type {
  SelectVoiceEngineOptions,
  StudioEngineOptions,
  StudioVoiceConfig,
  StudioVoiceErrorCode,
  VoiceEngineSelection,
  VoiceProvider,
} from './studio-tts';

export {
  CURATED_VOICE_IDS,
  DEFAULT_VOICE_ID,
  SAMPLE_LINE,
  VOICE_CATALOG,
  VOICE_IDS,
  isCuratedVoice,
  isVoiceId,
  voiceById,
} from './voices';
export type { VoiceGender, VoiceMeta } from './voices';

export { MAX_SAMPLE_BYTES, VOICES_MANIFEST, createVoiceGallery } from './gallery';
export type { VoiceSampleEntry } from './gallery';

export {
  KOKORO_FILES,
  KOKORO_REPO,
  KOKORO_TOTAL_BYTES,
  KokoroModelDownloader,
  hasPartial,
  modelFilesComplete,
  modelInstalled,
  modelPath,
  modelRoot,
  presentBytes,
  voiceModelStatus,
} from './model';
export type {
  DownloadOptions,
  ModelFile,
  VoiceModelPhase,
  VoiceModelStatus,
} from './model';

export { createFfmpegMixer } from './mixer';

export {
  readWavMono16,
  trimEdgeSilence,
  wavDurationSec,
  wavIsIntact,
  writeWavMono16,
} from './wav';
export type { MonoWav } from './wav';

export type {
  AssembleInput,
  MasterInput,
  PresenterClipInput,
  TtsAudio,
  TtsEngine,
  VoiceCaption,
  VoiceMixer,
  VoiceSegment,
  VoiceTrackInput,
  VoiceTrackResult,
} from './types';
