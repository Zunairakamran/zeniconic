/**
 * Hybrid voice plan: presenter windows plus AI lines in the gaps.
 *
 * Presenter windows are authoritative. AI lines are placed outside every
 * window; a line that would collide is moved after the window rather than
 * talked over. Captions for the presenter are the transcript of his own WAV;
 * captions for the AI lines are the script text.
 */

import type { Edl } from '../../../packages/edl/src/index';
import type { PresenterWindow, ScriptCue } from './plan';

export interface HybridCueInput {
  edl: Edl;
  windows: readonly PresenterWindow[];
  /** AI lines in narrative order, e.g. address, bedroom, price. */
  lines: readonly string[];
}

function windowEnd(window: PresenterWindow): number {
  return window.startSec + Math.max(0, window.trimEndSec - window.trimStartSec);
}

function insideWindow(atSec: number, windows: readonly PresenterWindow[]): PresenterWindow | undefined {
  return windows.find(
    (window) => atSec >= window.startSec - 0.05 && atSec < windowEnd(window),
  );
}

function moveOutside(
  atSec: number,
  durationSec: number,
  windows: readonly PresenterWindow[],
  totalSec: number,
): number {
  let start = Math.max(0, atSec);
  for (const window of windows) {
    const end = windowEnd(window);
    if (start + durationSec <= window.startSec || start >= end) continue;
    start = end + 0.12;
  }
  return Math.min(Math.max(0, totalSec - durationSec), start);
}

function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0).length;
  return Math.max(1.4, Math.min(5.5, words / 2.7));
}

/**
 * Builds the cue list the voice planner consumes. One presenter cue per window
 * carries the presenter's actual transcript; AI cues fill the other beats.
 */
export function buildHybridCues(input: HybridCueInput): ScriptCue[] {
  const totalSec = input.edl.format.targetDurationSec;
  const cues: ScriptCue[] = [];

  for (const window of input.windows) {
    const transcript = window.transcript?.trim();
    if (transcript === undefined || transcript.length === 0) continue;
    const duration = Math.max(0.5, Math.min(windowEnd(window) - window.startSec, totalSec - window.startSec));
    if (duration <= 0.5) continue;
    cues.push({
      text: transcript,
      startSec: Math.max(0, window.startSec),
      endSec: Math.min(totalSec, window.startSec + duration),
    });
  }

  // The first AI line usually carries the address; the last carries the price.
  const first = input.lines[0];
  const last = input.lines[input.lines.length - 1];
  const middle = input.lines.slice(1, -1);

  if (first !== undefined && first.trim().length > 0) {
    const duration = estimateDuration(first);
    const start = moveOutside(0.2, duration, input.windows, totalSec);
    cues.push({ text: first.trim(), startSec: start, endSec: Math.min(totalSec, start + duration) });
  }
  if (last !== undefined && last.trim().length > 0) {
    const duration = estimateDuration(last);
    const wanted = Math.max(0, totalSec - duration - 0.6);
    const start = moveOutside(wanted, duration, input.windows, totalSec);
    cues.push({ text: last.trim(), startSec: start, endSec: Math.min(totalSec, start + duration) });
  }
  // Middle lines are placed after the first AI cue, in order.
  let cursor = cues.find((cue) => cue.text === first?.trim())?.endSec ?? 0.2;
  for (const line of middle) {
    const text = line.trim();
    if (text.length === 0) continue;
    const duration = estimateDuration(text);
    const start = moveOutside(cursor + 0.18, duration, input.windows, totalSec);
    cues.push({ text, startSec: start, endSec: Math.min(totalSec, start + duration) });
    cursor = start + duration;
  }

  return cues
    .filter((cue) => cue.endSec > cue.startSec && cue.startSec < totalSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

/** True when the EDL/plan has at least one usable presenter window. */
export function hasPresenterWindow(windows: readonly PresenterWindow[]): boolean {
  return windows.some(
    (window) =>
      window.transcript !== undefined &&
      window.transcript.trim().length > 0 &&
      window.trimEndSec > window.trimStartSec &&
      windowEnd(window) > window.startSec,
  );
}

/** Convenience for a window collision diagnostic. */
export function overlapsPresenter(atSec: number, windows: readonly PresenterWindow[]): boolean {
  return insideWindow(atSec, windows) !== undefined;
}
