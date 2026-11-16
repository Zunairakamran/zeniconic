/**
 * Kokoro-82M, lazily loaded.
 *
 * The q8 model is ~92 MB, so it is imported and instantiated only when a cache
 * miss actually needs a new line. Tests inject a fake engine and never touch
 * this module; the CLI uses it.
 *
 * `modelDir` is the downloader's cache root (`<data>/models/kokoro`). When it
 * is supplied the library reads the verified files from disk instead of
 * fetching from Hugging Face, and remote fetching is switched off: a missing
 * file fails with a sentence that points at Settings instead of quietly
 * spending 92 MB of someone's connection mid-export. Without `modelDir`,
 * development still works: the library falls back to its own cache and the
 * network.
 */

import { env } from '@huggingface/transformers';
import type { GenerateOptions, KokoroTTS } from 'kokoro-js';
import { modelFilesComplete } from './model';
import type { TtsEngine } from './types';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const DEFAULT_VOICE = 'af_heart';

/** A voice id from settings; Kokoro's own union only knows its shipped set. */
function asKokoroVoice(voice: string): GenerateOptions['voice'] {
  return voice as GenerateOptions['voice'];
}

export interface KokoroEngineOptions {
  /** Filesystem cache root the Settings download writes into. */
  modelDir?: string;
  /** Test seam: the local-files check. */
  filesComplete?: (root: string) => Promise<boolean>;
}

export function createKokoroEngine(
  modelId: string = KOKORO_MODEL_ID,
  options: KokoroEngineOptions = {},
): TtsEngine {
  let loading: Promise<KokoroTTS> | null = null;
  const complete = options.filesComplete ?? ((root: string) => modelFilesComplete(root));

  const load = async (): Promise<KokoroTTS> => {
    // The library shares one `env`; set it before the first request so a
    // verified local file wins over a fresh network fetch.
    if (options.modelDir !== undefined && options.modelDir.length > 0) {
      env.cacheDir = options.modelDir;
      // The export must never trigger the download. Settings owns that.
      env.allowRemoteModels = false;
      if (!(await complete(options.modelDir))) {
        throw new Error(
          'The Kokoro voice model is not installed. Open Settings → Voice model to download it (92 MB), then export again.',
        );
      }
    }
    const { KokoroTTS: Kokoro } = await import('kokoro-js');
    return Kokoro.from_pretrained(modelId, { dtype: 'q8', device: 'cpu' });
  };

  return {
    async generate(text, options_) {
      // A failed load must not be remembered forever: the user may install the
      // model and re-export without restarting the app.
      loading ??= load();
      let model: KokoroTTS;
      try {
        model = await loading;
      } catch (error) {
        loading = null;
        throw error;
      }
      const audio = await model.generate(text, { voice: asKokoroVoice(options_.voice) });
      return {
        samples: audio.audio as Float32Array,
        sampleRate: audio.sampling_rate ?? 24000,
      };
    },
  };
}
