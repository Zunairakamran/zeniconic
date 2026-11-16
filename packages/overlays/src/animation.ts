/**
 * Overlay animation timing, in frames.
 *
 * Durations are milliseconds in the spec; they are converted here so the
 * composition never relies on a CSS transition for timing. Nothing animates
 * during the last 200 ms of a video: the end card holds.
 */

export interface AnimationSpec {
  /** Frames over which the entrance runs. Zero for `none`. */
  enterFrames: number;
  /** Pixels of travel; positive means "from the anchor side". */
  travelPx: number;
  /** True when the text should count from zero to its value. */
  countUp: boolean;
}

export const ANIMATION_MS = {
  fade: 240,
  rise: 320,
  slide_in: 280,
  count_up: 600,
} as const;

/** The end card holds: no entrance after this point. */
export const END_CARD_HOLD_MS = 200;

export function animationSpec(animation: string, fps: number, scale: number): AnimationSpec {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`FPS must be a positive number, received ${fps}`);
  }
  if (animation === 'none') return { enterFrames: 0, travelPx: 0, countUp: false };

  const frames = (ms: number): number => Math.max(1, Math.round((ms / 1000) * fps));

  switch (animation) {
    case 'rise':
      return { enterFrames: frames(ANIMATION_MS.rise), travelPx: Math.round(12 * scale), countUp: false };
    case 'slide_in':
      return {
        enterFrames: frames(ANIMATION_MS.slide_in),
        travelPx: Math.round(24 * scale),
        countUp: false,
      };
    case 'count_up':
      return {
        enterFrames: frames(ANIMATION_MS.count_up),
        travelPx: 0,
        countUp: true,
      };
    case 'fade':
      return { enterFrames: frames(ANIMATION_MS.fade), travelPx: 0, countUp: false };
    default:
      return { enterFrames: frames(ANIMATION_MS.fade), travelPx: 0, countUp: false };
  }
}

/** True when an entrance starting at `inFrame` would run into the end card. */
export function isEndCardHold(inFrame: number, totalFrames: number, fps: number): boolean {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return true;
  const holdFrames = Math.round((END_CARD_HOLD_MS / 1000) * Math.max(1, fps));
  return inFrame >= Math.max(0, totalFrames - holdFrames);
}

/**
 * Counts the first numeric run in `text` up from zero.
 *
 * The formatted value keeps the original grouping and decimal places, so
 * "AED 1,850,000" becomes "AED 925,000" at half progress and is returned
 * byte-identical at 1. The prefix and any suffix ("pw", "sq ft") are untouched.
 */
export function countUpText(text: string, progress: number): string {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  if (p >= 1) return text;

  const match = /\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!match) return text;

  const raw = match[0];
  const numeric = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return text;

  const decimals = raw.includes('.') ? (raw.split('.')[1]?.length ?? 0) : 0;
  const value = numeric * p;
  const formatted = decimals > 0 ? value.toFixed(decimals) : groupThousands(Math.round(value));

  return `${text.slice(0, match.index)}${formatted}${text.slice(match.index + raw.length)}`;
}

function groupThousands(value: number): string {
  const digits = Math.abs(Math.trunc(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return value < 0 ? `-${grouped}` : grouped;
}
