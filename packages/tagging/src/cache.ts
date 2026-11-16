import { createHash } from 'node:crypto';
import type { ShotTags } from './types';

/**
 * Content-addressed tag storage. The pipeline backs this with the listing's
 * index; tests and single runs use `MemoryTaggingCache`.
 */
export interface TaggingCache {
  get(key: string): ShotTags | undefined;
  put(key: string, value: ShotTags): void;
}

/**
 * `sha256(sheet bytes + model + promptVersion)` as lowercase hex.
 *
 * Editing a shot's in/out rebuilds its sheet and therefore its tags; editing the
 * EDL does not. Separators are NUL so `("ab","c")` and `("a","bc")` cannot
 * collide.
 */
export function cacheKey(sheetBytes: Uint8Array, model: string, promptVersion: string): string {
  const hash = createHash('sha256');
  hash.update(sheetBytes);
  hash.update('\u0000');
  hash.update(model, 'utf8');
  hash.update('\u0000');
  hash.update(promptVersion, 'utf8');
  return hash.digest('hex');
}

/** Process-local cache; the caller owns its lifetime. */
export class MemoryTaggingCache implements TaggingCache {
  private readonly entries = new Map<string, ShotTags>();

  get(key: string): ShotTags | undefined {
    return this.entries.get(key);
  }

  put(key: string, value: ShotTags): void {
    this.entries.set(key, value);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
