/**
 * Timeline assembly: pure, deterministic, testable without audio.
 *
 * Input is the script (caption cues from the EDL word timings), the presenter
 * windows that already hold a real voice, and the duration of every generated
 * TTS line. Output is a placed, non-overlapping set of spoken segments plus the
 * captions that follow them.
 *
 * Rules:
 * - Segments never overlap. A line that needs more time than its slot pushes
 *   the next segment later instead of talking over it.
 * - Captions are monotonic and never overlap, so the renderer can draw them
 *   without a "find the latest cue" pass.
 * - A presenter window is emitted once; every cue inside it is captioned at its
 *   word timing, shifted only if the window itself had to move.
 */

import type { VoiceCaption, VoiceSegment } from './types';

export interface ScriptCue {
  text: string;
  startSec: number;
  endSec: number;
}

export interface PresenterWindow {
  sourceId: string;
  /** Where the window starts on the assembled timeline. */
  startSec: number;
  /** Trim range inside `wav`. */
  trimStartSec: number;
  trimEndSec: number;
  wav: string;
  transcript?: string;
}

export interface TtsLine {
  wav: string;
  durationSec: number;
}

export interface BuildVoicePlanInput {
  cues: readonly ScriptCue[];
  windows: readonly PresenterWindow[];
  lines: ReadonlyMap<string, TtsLine>;
  totalSec: number;
}

export interface VoicePlan {
  segments: VoiceSegment[];
  captions: VoiceCaption[];
}

const MIN_SEGMENT_SEC = 0.01;
const MIN_CAPTION_SEC = 0.001;
/** A cue this close to a presenter window still belongs to the presenter. */
const WINDOW_LEAD_SEC = 0.25;

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** The window whose speech covers this cue's start, if any. */
export function presenterWindowForCue(
  cue: ScriptCue,
  windows: readonly PresenterWindow[],
): PresenterWindow | null {
  for (const window of windows) {
    const duration = window.trimEndSec - window.trimStartSec;
    if (duration <= 0) continue;
    if (cue.startSec >= window.startSec - WINDOW_LEAD_SEC && cue.startSec < window.startSec + duration) {
      return window;
    }
  }
  return null;
}

/**
 * Sorts, clips and de-overlaps captions. A caption that would start before the
 * previous one ends is nudged to the previous end; nothing is dropped unless it
 * falls past the composition.
 */
export function monotonicCaptions(
  captions: readonly VoiceCaption[],
  totalSec: number,
): VoiceCaption[] {
  const sorted = [...captions].sort(
    (a, b) => a.startSec - b.startSec || a.endSec - b.endSec,
  );

  const result: VoiceCaption[] = [];
  let cursor = 0;

  for (const caption of sorted) {
    const text = caption.text.trim();
    if (text.length === 0) continue;

    const start = round3(Math.min(totalSec, Math.max(caption.startSec, cursor)));
    if (start >= totalSec) break;

    const end = round3(Math.min(totalSec, Math.max(start + MIN_CAPTION_SEC, caption.endSec)));
    if (end <= start) continue;

    result.push({ text, startSec: start, endSec: end });
    cursor = end;
  }

  return result;
}

export function buildVoicePlan(input: BuildVoicePlanInput): VoicePlan {
  const { cues, windows, lines, totalSec } = input;
  const segments: VoiceSegment[] = [];
  const rawCaptions: VoiceCaption[] = [];
  const placedWindows = new Map<string, VoiceSegment>();
  let segmentCursor = 0;

  cues.forEach((cue, cueIndex) => {
    if (cue.text.trim().length === 0) return;

    const window = presenterWindowForCue(cue, windows);
    if (window) {
      let segment = placedWindows.get(window.sourceId);

      if (!segment) {
        const requested = Math.max(0, window.startSec);
        const start = Math.max(requested, segmentCursor);
        const available = window.trimEndSec - window.trimStartSec;
        const duration = Math.min(available, totalSec - start);

        if (duration > MIN_SEGMENT_SEC) {
          segment = {
            kind: 'presenter',
            id: `presenter-${window.sourceId}`,
            text: cue.text,
            requestedStartSec: requested,
            startSec: round3(start),
            endSec: round3(start + duration),
            durationSec: round3(duration),
            wav: window.wav,
            trim: { startSec: window.trimStartSec, endSec: window.trimEndSec },
          };
          segments.push(segment);
          placedWindows.set(window.sourceId, segment);
          segmentCursor = start + duration;
        }
      }

      const delta = segment ? segment.startSec - window.startSec : 0;
      const windowEnd = segment
        ? segment.endSec
        : window.startSec + (window.trimEndSec - window.trimStartSec);
      const start = Math.max(0, cue.startSec + delta);
      const end = Math.min(windowEnd, Math.max(start + MIN_CAPTION_SEC, cue.endSec + delta));
      rawCaptions.push({ text: cue.text, startSec: start, endSec: Math.max(start, end) });
      return;
    }

    const line = lines.get(cue.text);
    if (!line) {
      throw new Error(
        `No TTS line was generated for cue ${cueIndex}: "${cue.text.slice(0, 48)}"`,
      );
    }

    const requested = Math.max(0, cue.startSec);
    const start = Math.max(requested, segmentCursor);
    const end = Math.min(totalSec, start + line.durationSec);
    if (end - start <= MIN_SEGMENT_SEC) return;

    segments.push({
      kind: 'tts',
      id: `tts-${String(cueIndex).padStart(2, '0')}`,
      text: cue.text,
      requestedStartSec: requested,
      startSec: round3(start),
      endSec: round3(end),
      durationSec: round3(end - start),
      wav: line.wav,
    });
    segmentCursor = end;
    rawCaptions.push({ text: cue.text, startSec: start, endSec: end });
  });

  return {
    segments,
    captions: monotonicCaptions(rawCaptions, totalSec),
  };
}
