/**
 * The TTS line cache.
 *
 * A line's identity is its text plus the voice that spoke it. Changing either
 * creates a new file; editing any other line in the script leaves this one
 * untouched. That is the rule docs/AUDIO-VOICE.md asks for: re-rendering a
 * variant on a script tweak must not re-synthesise the lines that did not
 * change.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Bump when the engine, model or post-processing changes. Old cached lines
 * stop matching instead of being silently reused with a different sound.
 */
export const VOICE_CACHE_VERSION = 'kokoro-af-v1';

/** Stable, short hash of text + voice, used as the cache key. */
export function voiceLineKey(text: string, voice: string): string {
  return createHash('sha256')
    .update(`${VOICE_CACHE_VERSION}\n${voice}\n${text}`)
    .digest('hex')
    .slice(0, 16);
}

function safeVoice(voice: string): string {
  return voice.replace(/[^a-z0-9_-]/gi, '') || 'voice';
}

/** `data/voice/line-af_heart-<hash>.wav`. */
export function voiceLinePath(cacheDir: string, text: string, voice: string): string {
  return join(cacheDir, `line-${safeVoice(voice)}-${voiceLineKey(text, voice)}.wav`);
}
