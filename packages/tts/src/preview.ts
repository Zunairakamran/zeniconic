import { createHash } from 'node:crypto';
import type { PreviewKeyInput } from './types';

/**
 * Content-addressed preview key.
 *
 * `voiceId` keeps voices apart, `text` keeps audition lines apart, and
 * `engineVersion` deliberately invalidates every cached preview when the engine
 * is upgraded. The preview cache itself is an interface so this package never
 * writes to disk.
 */
export function previewKey(input: PreviewKeyInput): string {
  const { voiceId, engineVersion, text } = input;
  return createHash('sha256')
    .update(`${voiceId}|${engineVersion}|${text}`, 'utf8')
    .digest('hex');
}
