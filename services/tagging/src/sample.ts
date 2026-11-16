/**
 * Where in a shot the six contact-sheet frames come from.
 *
 * Six is the number of tiles in the 3x2 sheet the tagger was calibrated on and
 * the number the prompt promises. The first and last 5% are skipped because a
 * shot boundary is a suggestion: the first frame is often mid-motion from the
 * previous shot and the last often lands on a cut.
 */

export const SAMPLE_COUNT = 6;

/** Fraction of the shot ignored at each end. */
const EDGE_FRACTION = 0.05;

/**
 * `count` distinct, ascending timestamps inside `(startSec, endSec)`, evenly
 * spaced across the interior after trimming the 5% edges.
 *
 * Pure and side-effect free so the cache key and the UI can both call it.
 * Every value is clamped into the shot so float drift or an extreme window can
 * never ask ffmpeg for a frame outside the source. A window with no duration
 * is a caller bug, not an empty sheet: throw.
 */
export function sampleTimes(
  startSec: number,
  endSec: number,
  count: number = SAMPLE_COUNT,
): number[] {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    throw new RangeError(
      `A shot needs a finite, positive duration, got start=${startSec} and end=${endSec}.`,
    );
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`Sample count must be a positive integer, got ${count}.`);
  }

  const span = endSec - startSec;
  const low = startSec + span * EDGE_FRACTION;
  const high = endSec - span * EDGE_FRACTION;

  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    const time = low + (high - low) * ratio;
    times.push(Math.min(endSec, Math.max(startSec, time)));
  }
  return times;
}

/**
 * The six timestamps for a shot, chosen from the clip's real frame timestamps.
 *
 * Prefers frames in the 5% interior so a sheet is not six frames of a cut; if
 * the shot is too short for six interior frames, the whole shot is fair game.
 * Returns `undefined` when no probed frame lands inside the shot, so the caller
 * can fall back to {@link sheetTimes}.
 *
 * When fewer than `count` matchable frames exist (a very short shot, or an NTSC
 * timebase that only exposes one exact millisecond per second) frames are
 * repeated rather than dropped: ffmpeg still writes a sheet, and a repeated
 * frame is a smaller lie than a black tile.
 */
export function probedSheetTimes(
  startSec: number,
  endSec: number,
  frames: readonly number[],
  count: number = SAMPLE_COUNT,
): number[] | undefined {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`Sample count must be a positive integer, got ${count}.`);
  }

  const inside = frames.filter((time) => time > startSec && time < endSec);
  if (inside.length === 0) return undefined;

  const span = endSec - startSec;
  const interior = inside.filter(
    (time) => time >= startSec + span * EDGE_FRACTION && time <= endSec - span * EDGE_FRACTION,
  );
  const pool = interior.length >= count ? interior : inside;

  return Array.from({ length: count }, (_, index) => {
    const chosen =
      count === 1 || pool.length === 1
        ? 0
        : Math.round((index * (pool.length - 1)) / (count - 1));
    return pool[chosen] ?? pool[0] ?? startSec;
  });
}

function gcd(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/**
 * The time step whose multiples are both frame times at this nominal rate and
 * numbers writable with the three decimals `buildContactSheetArgs` formats.
 *
 * That builder selects frames with `eq(t\,<seconds>)`, an exact double
 * comparison, so a time that is one microsecond from every frame timestamp
 * matches nothing and ffmpeg writes no file at all. For integer rates the step
 * is `1/gcd(fps, 1000)` seconds: 0.1 at 30 fps, 0.125 at 24, 0.04 at 25,
 * 0.05 at 60.
 *
 * This is only a fallback for when the clip's real frame timestamps cannot be
 * read: quantising a nominal grid still cannot promise that `pts * time_base`
 * lands on the same double as the decimal. `frames.ts` is the authoritative
 * path. Returns `undefined` for a rate with no such grid (29.97 and friends).
 */
export function frameGridStep(fps: number): number | undefined {
  if (!Number.isFinite(fps) || fps <= 0) return undefined;
  const rounded = Math.round(fps);
  if (Math.abs(fps - rounded) > 1e-6) return undefined;
  return 1 / gcd(rounded, 1000);
}

/**
 * {@link sampleTimes} quantised onto the clip's {@link frameGridStep}.
 *
 * The fallback used when the clip cannot be probed. It cannot guarantee that
 * every timestamp matches a frame (double rounding, and real phone clips are
 * often variable-rate), so a shot may produce a partial sheet. Prefer
 * {@link probedSheetTimes}, which reads the actual frame times.
 */
export function sheetTimes(
  startSec: number,
  endSec: number,
  fps: number,
  count: number = SAMPLE_COUNT,
): number[] {
  const base = sampleTimes(startSec, endSec, count);
  const step = frameGridStep(fps);
  if (step === undefined) return base;

  const span = endSec - startSec;
  const low = startSec + span * EDGE_FRACTION;
  const high = endSec - span * EDGE_FRACTION;
  const epsilon = 1e-6;
  const first = Math.ceil(low / step - epsilon);
  const last = Math.floor(high / step + epsilon);
  if (last < first) return base;

  const slots = last - first + 1;
  return Array.from({ length: count }, (_, index) => {
    const offset =
      count === 1 || slots === 1 ? 0 : Math.round((index * (slots - 1)) / (count - 1));
    const exact = (first + offset) * step;
    // Drop the 0.30000000000000004 dust so the value written into the filter is
    // the same decimal ffmpeg parses back.
    return Math.round(exact * 1000) / 1000;
  });
}
