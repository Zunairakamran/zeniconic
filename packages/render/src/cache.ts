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
import { clipEffectFilters } from './effects';
import type { Quality } from './args';
import type { ProfileId } from './profiles';

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

// ---------------------------------------------------------------------------
// Persistent segment keys (v2)
// ---------------------------------------------------------------------------

/**
 * Schema version of the persisted segment key. Bump it whenever the encoder
 * ladder or the per-clip filter chain changes shape: every old segment then
 * becomes a miss instead of being reused for different pixels.
 */
export const SEGMENT_KEY_VERSION = 2;

/** Everything that can change the pixels of one normalised clip segment. */
export interface SegmentKeyInput {
  /** Absolute source path; the same bytes under another name are another key. */
  sourcePath: string;
  /** Byte length from `stat`. */
  sourceSize: number;
  /** `stat.mtimeMs`; catches a re-export or a re-download under the same name. */
  sourceMtimeMs: number;
  clip: Clip;
  /** The canvas the segment is normalised to, after the quality ladder. */
  profile: ProfileId;
  width: number;
  height: number;
  fps: number;
  quality: Quality;
}

/**
 * THE FIELDS THE RENDERER ACTUALLY READS.
 *
 * Not the whole clip: `id`, `sourceId`, `room`, `reason`, `scoreAtSelection`,
 * `motionAtSelection`, `volumeDb` and the transitions are metadata or belong to
 * the assembly layer, so changing them must keep the segment. What is left is
 * the source window, its speed (scalar or ramp), the transition handle
 * (extends the trim), the framing mode and the exact effect/grade filters
 * `clipEffectFilters` lowers. Using the filters rather than the raw effect JSON
 * means an `enabled: false` effect, a renamed effect id or a preset that lowers
 * to the same chain does not invalidate a segment with the same pixels.
 *
 * `transform.focus` and `transform.path` are deliberately absent: the current
 * graph centres the cover crop and does not consume either. If a renderer
 * starts using them, `SEGMENT_KEY_VERSION` must be bumped.
 */
function pictureSignature(clip: Clip): Record<string, unknown> {
  let filters: string[];
  try {
    filters = clipEffectFilters(clip);
  } catch {
    // An unsupported effect makes the render fail anyway; fall back to the raw
    // payload so the key is still deterministic rather than throwing here.
    filters = [`raw:${canonicalJson({ effects: clip.effects ?? [], grade: clip.grade ?? null })}`];
  }

  return {
    inSec: clip.inSec,
    outSec: clip.outSec,
    speed: clip.speed,
    ...(clip.speedRamp === undefined ? {} : { speedRamp: clip.speedRamp }),
    handleOutSec: clip.handleOutSec ?? 0,
    transformMode: clip.transform.mode,
    filters,
  };
}

/**
 * Key for one persisted, normalised segment. Covers the source bytes (path,
 * size, mtime), the selected window and speed, the framing/effects/grade chain
 * and the exact output canvas and quality ladder. Profile is included because
 * two profiles can share width/height/fps yet encode at different bitrates.
 */
export function segmentCacheKeyFor(input: SegmentKeyInput): string {
  return `seg2_${sha256Hex({
    v: SEGMENT_KEY_VERSION,
    source: {
      path: input.sourcePath,
      size: input.sourceSize,
      mtimeMs: input.sourceMtimeMs,
    },
    picture: pictureSignature(input.clip),
    profile: input.profile,
    quality: input.quality,
    canvas: { width: input.width, height: input.height, fps: input.fps },
  })}`;
}
