/**
 * Content-addressed cache keys. Pure and synchronous so tests can assert that
 * one changed clip invalidates one segment and nothing else.
 *
 * Canonical JSON = recursively sorted object keys, arrays left in order, no
 * whitespace. `12.4` and `12.400000000000001` are different numbers and stay
 * different keys, which is why the EDL stores three-decimal seconds in the
 * first place.
 */

import { createHash } from 'node:crypto';
import type { Clip, Edl, Transform } from '@zeniconic/edl';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      // Optional EDL fields may be present as `undefined`; JSON would drop
      // them anyway, so skip them uniformly.
      if (entry !== undefined) {
        result[key] = canonicalize(entry);
      }
    }
    return result;
  }

  return value;
}

/** Canonical JSON string with sorted keys and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Key for one rendered segment: a source window plus its framing. Deliberately
 * excludes clip id, order, transitions, overlays, captions and profile — those
 * belong to the chunk/take layers, and including them would miss on a text-only
 * edit. `v` is the key schema version.
 */
export function segmentCacheKey(clip: Clip, transform: Transform): string {
  return `seg_${sha256Hex({
    v: 1,
    sourceId: clip.sourceId,
    inSec: clip.inSec,
    outSec: clip.outSec,
    speed: clip.speed,
    mode: transform.mode,
    focus: transform.focus,
    path: transform.path,
  })}`;
}

/**
 * Hash of the whole EDL, used to compare takes instead of pixels. Key order in
 * memory is irrelevant; a changed clip, overlay or audio field is not.
 */
export function edlHash(edl: Edl): string {
  return `edl_${sha256Hex(edl)}`;
}
