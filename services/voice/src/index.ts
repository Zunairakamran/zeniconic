/**
 * Public surface of the voice stage.
 *
 * The desktop should call `buildVoiceTrack`; everything else is exported for
 * tests, diagnostics and the CLI.
 */

export { DEFAULT_MUSIC_PATH, buildVoiceTrack, presenterWindowsFor, scriptCues } from './service';

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

export { DEFAULT_VOICE, KOKORO_MODEL_ID, createKokoroEngine } from './tts';
export type { KokoroEngineOptions } from './tts';

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
