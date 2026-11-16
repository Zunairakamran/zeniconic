/**
 * The typed boundary between whisper.cpp (which produces word timings) and the
 * rest of the pipeline (which lays those words out into caption cues).
 *
 * This module deliberately performs no transcription and makes no network
 * calls. A `Transcriber` is supplied by the caller; everything below it is
 * deterministic and testable without audio.
 */

/** One recognised word with its measured span in the source audio. */
export interface Word {
  text: string;
  startSec: number;
  endSec: number;
  /** whisper.cpp probability, 0–1. Absent when the engine did not report one. */
  confidence?: number;
}

/** A display-ready caption: one or two lines shown between two timestamps. */
export interface Cue {
  startSec: number;
  endSec: number;
  lines: string[];
}

export interface TranscribeOptions {
  language?: string;
  model?: 'base.en' | 'small.en';
}

export interface Transcript {
  words: Word[];
  language: string;
}

/**
 * Implemented later around the bundled whisper.cpp binary. Declared here so
 * cue layout, SRT writing and the EDL never depend on the engine directly.
 */
export interface Transcriber {
  transcribe(audioPath: string, opts?: TranscribeOptions): Promise<Transcript>;
}

export interface CueOptions {
  maxCharsPerLine?: number;
  maxLines?: number;
  maxCueSec?: number;
  minCueSec?: number;
  gapSec?: number;
  /**
   * Language used for spelling and casing rules. Defaults to `en-GB`, the
   * product default. Pass `en-US` to opt out of the British spelling map.
   */
  language?: string;
}
