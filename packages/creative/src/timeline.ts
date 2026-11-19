import type { Clip } from '../../edl/src/index';

/** Same source-time to timeline conversion the validator uses. */
export function clipTimelineSec(clip: Clip): number {
  const sourceLength = clip.outSec - clip.inSec;
  const ramp = Array.isArray(clip.speedRamp) ? clip.speedRamp : undefined;
  if (ramp !== undefined && ramp.length >= 2) {
    let total = 0;
    let usable = true;
    for (let index = 0; index + 1 < ramp.length; index += 1) {
      const from = ramp[index];
      const to = ramp[index + 1];
      if (from === undefined || to === undefined || !(from.speed > 0)) {
        usable = false;
        break;
      }
      total += ((to.t - from.t) * sourceLength) / from.speed;
    }
    if (usable && Number.isFinite(total) && total > 0) return total;
  }
  const duration = sourceLength / clip.speed;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export interface ClipWindow {
  clip: Clip;
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export function windowsOf(clips: readonly Clip[]): ClipWindow[] {
  let cursor = 0;
  const windows: ClipWindow[] = [];
  clips.forEach((clip, index) => {
    const durationSec = clipTimelineSec(clip);
    windows.push({ clip, index, startSec: cursor, endSec: cursor + durationSec, durationSec });
    cursor += durationSec;
  });
  return windows;
}

export function totalOf(windows: readonly ClipWindow[]): number {
  const last = windows[windows.length - 1];
  return last === undefined ? 0 : last.endSec;
}

/** 6-decimal source-time rounding; smaller than a frame at 60 fps. */
export function roundSource(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 3-decimal timeline rounding, matching `durationSec` in the EDL package. */
export function roundTime(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
