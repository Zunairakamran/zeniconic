import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryTaggingCache, cacheKey } from '../src/index';
import { MODEL, PROMPT_VERSION, validTags } from './helpers';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('cacheKey', () => {
  it('is a stable 64-character sha256 hex digest', () => {
    const first = cacheKey(BYTES, MODEL, PROMPT_VERSION);
    const second = cacheKey(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), MODEL, PROMPT_VERSION);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('hashes with the documented field order and separators', () => {
    const expected = createHash('sha256')
      .update(BYTES)
      .update('\u0000')
      .update(MODEL, 'utf8')
      .update('\u0000')
      .update(PROMPT_VERSION, 'utf8')
      .digest('hex');
    expect(cacheKey(BYTES, MODEL, PROMPT_VERSION)).toBe(expected);
  });

  it('changes with the sheet bytes', () => {
    const changed = cacheKey(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), MODEL, PROMPT_VERSION);
    expect(changed).not.toBe(cacheKey(BYTES, MODEL, PROMPT_VERSION));
  });

  it('changes with the model', () => {
    const changed = cacheKey(BYTES, 'google/gemini-3.8-flash', PROMPT_VERSION);
    expect(changed).not.toBe(cacheKey(BYTES, MODEL, PROMPT_VERSION));
  });

  it('changes with the prompt version', () => {
    const changed = cacheKey(BYTES, MODEL, 'tag-1.3.1');
    expect(changed).not.toBe(cacheKey(BYTES, MODEL, PROMPT_VERSION));
  });

  it('cannot be fooled by shifting a character between fields', () => {
    expect(cacheKey(BYTES, 'ab', 'c')).not.toBe(cacheKey(BYTES, 'a', 'bc'));
  });
});

describe('MemoryTaggingCache', () => {
  it('stores and returns a record by key', () => {
    const cache = new MemoryTaggingCache();
    const tags = validTags();
    expect(cache.get('missing')).toBeUndefined();

    cache.put('key', tags);
    expect(cache.get('key')).toEqual(tags);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.get('key')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
