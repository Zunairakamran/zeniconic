/**
 * Converts recovered source scenes into planner-compatible candidates.
 *
 * A finished video yields one `src` for every shot, so the candidate pool is a
 * set of time windows inside that single file. Room and score are placeholders
 * until the vision tagger and the scorer run; the shape already satisfies the
 * planner's `Candidate` contract so the two can be wired without a translation
 * layer.
 */

import { roundTime } from '@zeniconic/core';
import type { Room } from '@zeniconic/edl';
import type { Candidate } from '@zeniconic/planner';
import type { Shot } from './split';

export type Orientation = 'landscape' | 'portrait' | 'square';

/**
 * `Candidate` plus the two fields the remix flow needs. Structured extras are
 * fine: a `RemixCandidate` is assignable wherever a planner `Candidate` is
 * accepted.
 */
export interface RemixCandidate extends Candidate {
  /** Stable alias of `shotId`, convenient for UI keys and logs. */
  id: string;
  /** Display orientation of the imported source. */
  orientation: Orientation;
}

export interface CandidateBuildOptions {
  /** One logical source, even though every candidate points at the same file. */
  sourceId: string;
  /** The imported MP4/MOV as an app-relative path. */
  src: string;
  orientation: Orientation;
  /** Placeholder until the tagger labels the shot. Defaults to `unknown`. */
  room?: Room;
  /** Placeholder until the scorer runs. Defaults to 0.5. */
  score?: number;
  /** Hard cap after deduplication. Defaults to {@link DEFAULT_MAX_CANDIDATES}. */
  maxCandidates?: number;
}

export const DEFAULT_MAX_CANDIDATES = 60;
export const PLACEHOLDER_SCORE = 0.5;

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RangeError(`${name} must be a non-empty string.`);
  }
  return trimmed;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Maps shots to pseudo-clips in source order. Identical in/out pairs are
 * dropped (scene detection can emit the same cut twice) and the result is
 * capped, so a long import cannot flood the planner.
 *
 * No frame is invented: `inSec`/`outSec` come straight from the shot window.
 */
export function buildCandidates(
  shots: readonly Shot[],
  options: CandidateBuildOptions,
): RemixCandidate[] {
  const sourceId = requireText(options.sourceId, 'sourceId');
  const src = requireText(options.src, 'src');

  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) {
    throw new RangeError(`maxCandidates must be a positive integer, received ${maxCandidates}`);
  }

  const score = options.score ?? PLACEHOLDER_SCORE;
  if (!Number.isFinite(score)) {
    throw new RangeError(`score must be a finite number, received ${score}`);
  }

  const room: Room = options.room ?? 'unknown';
  const orientation = options.orientation;
  if (orientation !== 'landscape' && orientation !== 'portrait' && orientation !== 'square') {
    throw new RangeError(`Unknown orientation "${String(orientation)}".`);
  }

  const sorted = [...shots].sort((a, b) => a.startSec - b.startSec || a.index - b.index);
  const seen = new Set<string>();
  const candidates: RemixCandidate[] = [];

  for (const shot of sorted) {
    if (candidates.length >= maxCandidates) break;
    if (!Number.isFinite(shot.startSec) || !Number.isFinite(shot.endSec)) continue;

    const inSec = roundTime(shot.startSec);
    const outSec = roundTime(shot.endSec);
    if (outSec - inSec <= 0) continue;

    const key = `${inSec}:${outSec}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const durationSec = roundTime(outSec - inSec);
    const shotId = `${sourceId}_s${String(shot.index + 1).padStart(3, '0')}`;

    candidates.push({
      id: shotId,
      shotId,
      sourceId,
      src,
      room,
      score: clamp01(score),
      inSec,
      outSec,
      orientation,
      reason: room === 'unknown'
        ? `Scene ${shot.index + 1}: ${durationSec}s window recovered from the imported video; awaiting a room tag.`
        : `Scene ${shot.index + 1}: ${durationSec}s ${room} window recovered from the imported video.`,
    });
  }

  return candidates;
}
