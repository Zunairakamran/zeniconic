/**
 * Timeline maths, computed exactly once.
 *
 * The same formulas are used by the validator (R14) and by the picture
 * renderer: a clip's duration is `(out − in) / speed`, and a non-cut
 * transition pulls the next clip back by its overlap. Doubles are kept during
 * the maths and only rounded when a frame number is needed.
 */

import type { Edl } from '../../edl/src/types';
import type { TimelineSegment } from './types';

/** Maps seconds to frames with a single `Math.round`, as the contract requires. */
export function framesFor(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds)) {
    throw new RangeError(`Seconds must be finite, received ${seconds}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`FPS must be a positive number, received ${fps}`);
  }

  // Negative input can only come from float noise around zero.
  const frames = Math.round(Math.max(0, seconds) * fps);
  return Object.is(frames, -0) ? 0 : frames;
}

function safeSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/**
 * Places every clip on the assembled timeline. A transition overlap is capped
 * at the incoming clip's own duration, so a bad EDL cannot produce a negative
 * segment.
 */
export function timelineSegments(edl: Edl): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let cursor = 0;

  edl.clips.forEach((clip, index) => {
    const durationSec = Math.max(0, (clip.outSec - clip.inSec) / safeSpeed(clip.speed));
    const requested = index === 0 || clip.transitionIn.type === 'cut' ? 0 : clip.transitionIn.durationSec;
    const overlapSec = Math.min(Math.max(0, requested), durationSec);
    const startSec = cursor - overlapSec;
    const endSec = startSec + durationSec;

    segments.push({
      clipId: clip.id,
      index,
      startSec,
      endSec,
      durationSec,
      overlapSec,
    });

    cursor = endSec;
  });

  return segments;
}

/** Length of the assembled picture, before the EDL's target duration is applied. */
export function clipTimelineSec(edl: Edl): number {
  const segments = timelineSegments(edl);
  const last = segments[segments.length - 1];
  return last ? last.endSec : 0;
}

/**
 * The duration the composition is actually cut to: the EDL's target when it is
 * present, otherwise the clip total. This is the single source for
 * `durationInFrames` and for clamping overlay and caption windows.
 */
export function canvasDurationSec(edl: Edl): number {
  const target = edl.format.targetDurationSec;
  if (Number.isFinite(target) && target > 0) return target;
  return clipTimelineSec(edl);
}
