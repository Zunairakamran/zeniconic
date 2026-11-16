/**
 * Frame windows for the clip layer.
 *
 * The composition mounts every clip in its own `<Sequence>`. A crossfade is
 * only real when both clip layers are mounted at the same frame, so a non-cut
 * transition is built by extending the outgoing clip over the incoming clip's
 * slot boundary. Its content stays anchored to the slot start, which keeps the
 * picture in sync with overlays and captions, and the incoming shot fades in on
 * top of live picture instead of fading from black.
 */

import type { Clip } from '../../../packages/edl/src/types';

export interface SequenceWindow {
  /** Absolute frame where the clip's Sequence starts. */
  from: number;
  /** Frames the clip stays mounted, including the overlap with the next clip. */
  durationInFrames: number;
}

function safeSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/** Frames a clip occupies on its own, after speed and a single rounding. */
export function clipFrames(clip: Clip, fps: number): number {
  const seconds = Math.max(0, clip.outSec - clip.inSec) / safeSpeed(clip.speed);
  return Math.max(1, Math.round(seconds * fps));
}

/**
 * Frames of a clip's incoming transition. A cut and a zero-length transition
 * both produce no overlap; anything else is at least one frame so the incoming
 * shot always has a fade-in to run.
 */
export function transitionFramesFor(clip: Clip, fps: number): number {
  const { type, durationSec } = clip.transitionIn;
  if (type === 'cut' || !(durationSec > 0)) return 0;
  return Math.max(1, Math.round(durationSec * fps));
}

/**
 * Places every clip's sequence on the assembled timeline.
 *
 * A clip's "slot" is its own frame length, and slots are contiguous, so cut-only
 * windows tile exactly: `from[i + 1] === from[i] + durationInFrames[i]`.
 * A non-cut transition begins `transitionFrames` before the incoming clip's
 * slot: the previous window grows by that overlap (capped at the shorter
 * neighbour, matching the validator), so both shots are mounted for the whole
 * fade. Nothing extends the final clip; `totalFrames` (`round(target × fps)`)
 * clamps the end so the timeline can never grow past the EDL.
 */
export function sequenceWindows(
  clips: readonly Clip[],
  fps: number,
  totalFrames?: number,
): SequenceWindow[] {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`FPS must be a positive number, received ${fps}`);
  }
  if (clips.length === 0) return [];

  const durations = clips.map((clip) => clipFrames(clip, fps));
  const slotTotal = durations.reduce((sum, frames) => sum + frames, 0);
  const boundedTotal =
    totalFrames === undefined || !Number.isFinite(totalFrames)
      ? slotTotal
      : Math.max(1, Math.round(totalFrames));

  const windows: SequenceWindow[] = [];
  let slotStart = 0;

  durations.forEach((duration, index) => {
    const next = clips[index + 1];
    const nextDuration = durations[index + 1] ?? 0;

    // Only the outgoing side is extended: a transition longer than either
    // neighbour is trimmed, which is the same defensive cut the ffmpeg graph
    // makes. The final clip has no successor, so its window is never extended.
    const requested = next ? transitionFramesFor(next, fps) : 0;
    const overlap = Math.min(requested, duration, nextDuration);
    const from = slotStart;
    const end = Math.min(slotStart + duration + overlap, boundedTotal);

    windows.push({ from, durationInFrames: Math.max(1, end - from) });
    slotStart += duration;
  });

  return windows;
}
