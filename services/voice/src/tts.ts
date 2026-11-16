/**
 * Kokoro-82M, lazily loaded.
 *
 * The model is ~90 MB, so it is imported and instantiated only when a cache
 * miss actually needs a new line. Tests inject a fake engine and never touch
 * this module; the CLI uses it.
 */

import type { GenerateOptions, KokoroTTS } from 'kokoro-js';
import type { TtsEngine } from './types';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const DEFAULT_VOICE = 'af_heart';

/** A voice id from settings; Kokoro's own union only knows its shipped set. */
function asKokoroVoice(voice: string): GenerateOptions['voice'] {
  return voice as GenerateOptions['voice'];
}

export function createKokoroEngine(modelId: string = KOKORO_MODEL_ID): TtsEngine {
  let loading: Promise<KokoroTTS> | null = null;

  const load = async (): Promise<KokoroTTS> => {
    const { KokoroTTS: Kokoro } = await import('kokoro-js');
    return Kokoro.from_pretrained(modelId, { dtype: 'q8', device: 'cpu' });
  };

  return {
    async generate(text, options) {
      loading ??= load();
      const model = await loading;
      const audio = await model.generate(text, { voice: asKokoroVoice(options.voice) });
      return {
        samples: audio.audio as Float32Array,
        sampleRate: audio.sampling_rate ?? 24000,
      };
    },
  };
}
