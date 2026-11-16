/**
 * Types for the voice stage.
 *
 * The stage is deliberately split into a pure planner, a cacheable TTS seam and
 * an injectable mixer. That is what lets the tests exercise timeline assembly
 * and caching without a network, a model download or ffmpeg.
 */

import type { Edl } from '../../../packages/edl/src/types';

/** One caption shown beside the audio. Seconds, never frames. */
export interface VoiceCaption {
  text: string;
  startSec: number;
  endSec: number;
}

/** What a text-to-speech engine must provide. Kokoro is the shipped one. */
export interface TtsEngine {
  generate(text: string, options: { voice: string }): Promise<TtsAudio>;
}

export interface TtsAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** One presenter window, optionally overriding `out/audio/speech.json`. */
export interface PresenterClipInput {
  /** The clip's source id, e.g. `s_ee267360`. */
  sourceId: string;
  /** Path to the extracted presenter wav. */
  wav?: string;
  /** Speech window inside the wav, in wav seconds. */
  startSec?: number;
  endSec?: number;
  /** Where the window starts on the assembled timeline; the clip's start by default. */
  timelineStartSec?: number;
  transcript?: string;
}

export interface VoiceTrackInput {
  edl: Edl;
  listingDir: string;
  presenterClips?: PresenterClipInput[];
  /** Kokoro voice id. Defaults to `af_heart`. */
  voice?: string;
  /** Music bed path. Defaults to data/music/catchy-120.m4a; `null` disables it. */
  music?: string | null;
  /** Injected for tests. Defaults to Kokoro. */
  tts?: TtsEngine;
  /** Injected for tests. Defaults to the ffmpeg mixer. */
  mixer?: VoiceMixer;
  /** Defaults to data/voice at the repository root. */
  cacheDir?: string;
  /** Kokoro cache root (`<data>/models/kokoro`); enables local, verified weights. */
  modelDir?: string;
  /** Defaults to <listingDir>/out/audio. */
  outDir?: string;
  /** Defaults to the EDL's target duration. */
  totalSec?: number;
}

export interface VoiceTrackResult {
  audioPath: string;
  captions: VoiceCaption[];
  durationSec: number;
}

export interface VoiceSegment {
  kind: 'tts' | 'presenter';
  id: string;
  text: string;
  /** Where the cue asked the segment to start, before collision handling. */
  requestedStartSec: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** Resolvable on disk: a cached TTS line or the presenter wav. */
  wav: string;
  /** Presenter windows only: the range to trim inside `wav`. */
  trim?: { startSec: number; endSec: number };
}

export interface AssembleInput {
  segments: VoiceSegment[];
  totalSec: number;
  outPath: string;
}

export interface MasterInput {
  voicePath: string;
  musicPath: string | null;
  totalSec: number;
  outPath: string;
}

/** The ffmpeg seam. Tests supply a recorder instead. */
export interface VoiceMixer {
  assemble(input: AssembleInput): Promise<void>;
  master(input: MasterInput): Promise<void>;
}
