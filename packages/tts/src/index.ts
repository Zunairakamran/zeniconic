export type {
  Engine,
  Language,
  PreviewCache,
  PreviewKeyInput,
  ScriptInput,
  SynthesisRequest,
  SynthesisResult,
  TtsEngine,
  Voice,
} from './types';

export { defaultVoice, ENGINES, VOICES, voicesFor } from './voices';
export { buildScript } from './script';
export {
  countWords,
  DEFAULT_WORDS_PER_SECOND,
  estimateDurationSec,
} from './duration';
export { previewKey } from './preview';
