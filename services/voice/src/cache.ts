/**
 * The TTS line cache.
 *
 * A line's identity is the provider, the model, the voice and the text.
 * Changing any of them creates a new file; editing another line in the script
 * leaves this one untouched. That is the rule docs/AUDIO-VOICE.md asks for:
 * re-rendering a variant on a script tweak must not re-synthesise the lines
 * that did not change, and a studio retry must not re-bill a line it already
 * paid for.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Bump when the engine, model or post-processing changes. Old cached lines
 * stop matching instead of being silently reused with a different sound.
 */
export const VOICE_CACHE_VERSION = 'voice-lines-v2';

/** Defaults keep the Kokoro call sites and old tests working unchanged. */
export const DEFAULT_CACHE_PROVIDER = 'local';
export const DEFAULT_CACHE_MODEL = 'kokoro-82m';

export interface VoiceCacheTag {
  /** `local` (Kokoro) or `studio` (ElevenLabs through OpenRouter). */
  provider?: string;
  /** Provider model id, e.g. `elevenlabs/eleven-v4`. */
  model?: string;
}

function normaliseTag(tag: VoiceCacheTag = {}): { provider: string; model: string } {
  const provider = tag.provider ?? DEFAULT_CACHE_PROVIDER;
  const model = tag.model ?? DEFAULT_CACHE_MODEL;
  return { provider, model };
}

/** Stable, short hash of provider + model + voice + text. */
export function voiceLineKey(
  text: string,
  voice: string,
  tag: VoiceCacheTag = {},
): string {
  const { provider, model } = normaliseTag(tag);
  return createHash('sha256')
    .update(`${VOICE_CACHE_VERSION}\n${provider}\n${model}\n${voice}\n${text}`)
    .digest('hex')
    .slice(0, 16);
}

function safeVoice(voice: string): string {
  return voice.replace(/[^a-z0-9_-]/gi, '') || 'voice';
}

/** `data/voice/line-af_heart-<hash>.wav`. */
export function voiceLinePath(
  cacheDir: string,
  text: string,
  voice: string,
  tag: VoiceCacheTag = {},
): string {
  return join(
    cacheDir,
    `line-${safeVoice(voice)}-${voiceLineKey(text, voice, tag)}.wav`,
  );
}
