/**
 * Types for reference-video understanding.
 *
 * A reference video is a finished cut someone else made — a competitor's
 * listing reel, the client's favourite TikTok, the agent's old showreel. We do
 * not copy it. We measure it locally and hand the planner a small, typed profile
 * of *how it is edited*: how long the shots run, how much the picture moves,
 * which colours dominate, how loud it is. The planner then treats that profile
 * as guidance, never as a source of facts about the property.
 *
 * Everything in `ReferenceStyleProfile` is either measured (probe, frame
 * differences, palette scan, ebur128) or derived from a documented heuristic in
 * `analyse.ts`. Models may enrich the soft fields through the optional vision
 * port; they never override a measured number.
 */

import type { ProbeResult, RawFrame, ReadFramesOpts } from '@zeniconic/media';

/** Display aspect, after rotation and pixel aspect have been applied. */
export type ReferenceAspect = '9:16' | '16:9' | '1:1' | '4:5' | 'other';

/** Editorial pace, from average shot length. */
export type ReferencePacing = 'slow' | 'medium' | 'fast';

/** How much the picture moves between samples. */
export type ReferenceMotionLevel = 'low' | 'medium' | 'high';

/** Whether the reference reads as straight cuts or as blended transitions. */
export type ReferenceTransitionGuess = 'cuts' | 'mixed';

/**
 * The assignment's style vocabulary, kept as plain words the planner prompt can
 * quote verbatim. Values are snake_case so they survive JSON round-trips and
 * diff cleanly in a prompt.
 */
export interface ReferenceStyleWords {
  /** One-line summary, e.g. `"fast-paced 9:16 warm edit"`. */
  style: string;
  /** Mirrors the top-level `pacing`. */
  pacing: ReferencePacing;
  /** What the transitions look like from picture alone. */
  transition_style: string;
  /** Caption treatment. Picture-only analysis cannot read text: `"unknown"`. */
  caption_style: string;
  /** Palette temperature and contrast, e.g. `"warm high-contrast"`. */
  color_style: string;
  /** Movement signature, e.g. `"locked-off or tripod"`. */
  camera_style: string;
  /** Motion-graphics presence. Picture-only analysis says `"none-detected"`. */
  motion_graphics: string;
}

/** Where one number came from. */
export type ReferenceSourceMethod =
  | 'ffprobe'
  | 'frame-diff'
  | 'palette-scan'
  | 'ebur128'
  | 'derived'
  | 'transcript'
  | 'vision'
  | 'unavailable';

export interface ReferenceSourceNote {
  method: ReferenceSourceMethod;
  /** Human-readable detail: the command, the formula, or why it is missing. */
  detail?: string;
}

/**
 * One note per profile field, keyed by the field it explains. `vision` and
 * `transcript` are present only when those ports were injected.
 */
export interface ReferenceSources {
  durationSec: ReferenceSourceNote;
  width: ReferenceSourceNote;
  height: ReferenceSourceNote;
  fps: ReferenceSourceNote;
  aspect: ReferenceSourceNote;
  shotCount: ReferenceSourceNote;
  averageShotSec: ReferenceSourceNote;
  medianShotSec: ReferenceSourceNote;
  cutDensityPerMin: ReferenceSourceNote;
  shotDurationsSec: ReferenceSourceNote;
  pacing: ReferenceSourceNote;
  motion: ReferenceSourceNote;
  motionScore: ReferenceSourceNote;
  palette: ReferenceSourceNote;
  loudnessLufs: ReferenceSourceNote;
  hasVoice: ReferenceSourceNote;
  transitionsGuess: ReferenceSourceNote;
  style: ReferenceSourceNote;
  confidence: ReferenceSourceNote;
  vision?: ReferenceSourceNote;
  transcript?: ReferenceSourceNote;
}

/**
 * The structured editing-style profile.
 *
 * `shotDurationsSec` covers the whole reference: it starts at 0 and the last
 * entry ends at `durationSec`. `motionScore` is the measured 0..1 mean frame
 * difference that `motion` was bucketed from, so a caller can re-threshold it
 * without re-decoding.
 */
export interface ReferenceStyleProfile {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  aspect: ReferenceAspect;
  shotCount: number;
  averageShotSec: number;
  medianShotSec: number;
  cutDensityPerMin: number;
  shotDurationsSec: number[];
  pacing: ReferencePacing;
  motion: ReferenceMotionLevel;
  /** Mean absolute luma difference between non-cut samples, 0..1. */
  motionScore: number;
  /** 3–5 dominant colours, lowercase `#rrggbb`, most frequent first. */
  palette: string[];
  /** Integrated loudness in LUFS; absent when the file has no audio track. */
  loudnessLufs?: number;
  /** Present only when a transcript port was supplied. */
  hasVoice?: boolean;
  /** Present whenever the picture carried enough signal to say. */
  transitionsGuess?: ReferenceTransitionGuess;
  style: ReferenceStyleWords;
  /** 0..1 aggregate of how much of the profile is actually measured. */
  confidence: number;
  sources: ReferenceSources;
}

/** A decoded sample handed to the optional vision port. */
export interface ReferenceVisionFrame {
  t: number;
  width: number;
  height: number;
  /** Luma, row-major, exactly `width * height` bytes. */
  gray: Uint8Array;
}

export interface ReferenceVisionShot {
  startSec: number;
  endSec: number;
}

/**
 * Everything a vision model needs to describe the soft fields. The port owns
 * its own encoder/transport; it may re-read `file` for colour frames, because
 * the deterministic pass only keeps luma samples.
 */
export interface ReferenceVisionInput {
  file: string;
  durationSec: number;
  aspect: ReferenceAspect;
  shots: readonly ReferenceVisionShot[];
  palette: readonly string[];
  frames: readonly ReferenceVisionFrame[];
}

/** Optional enrichment. Must resolve to a partial profile, never a full one. */
export type ReferenceVisionPort = (
  input: ReferenceVisionInput,
) => Promise<Partial<ReferenceStyleProfile>>;

/** What the orchestrator's transcription stage can hand back. */
export interface ReferenceTranscript {
  hasVoice: boolean;
  /** Optional for provenance only; never stored in the profile. */
  text?: string;
}

export type ReferenceTranscriptPort = (
  file: string,
) => Promise<ReferenceTranscript>;

/** Injected seams; every one has a local default except vision/transcript. */
export type ProbeFn = (file: string) => Promise<ProbeResult>;
export type ReadFramesFn = (
  file: string,
  opts: ReadFramesOpts,
) => AsyncGenerator<RawFrame>;
/** Integrated LUFS, or null when the measurement produced no value. */
export type LoudnessFn = (file: string) => Promise<number | null>;
/**
 * One averaged RGB sample per sampled second. The default implementation gets
 * these by scaling frames to 1×1; a test can return hand-built samples.
 */
export type PaletteFn = (file: string) => Promise<readonly RgbSample[]>;

export interface ReferenceDeps {
  probe?: ProbeFn;
  readFrames?: ReadFramesFn;
  measureLoudness?: LoudnessFn;
  samplePalette?: PaletteFn;
  /**
   * Optional and never called by the deterministic path. Tests must inject
   * nothing here: no suite may reach a model.
   */
  vision?: ReferenceVisionPort;
  /** Optional; supplies `hasVoice` and nothing else. */
  transcript?: ReferenceTranscriptPort;
}

/** An RGB sample from the palette scan. */
export interface RgbSample {
  r: number;
  g: number;
  b: number;
}

export type ReferenceErrorCode =
  | 'E_URL_NOT_ALLOWED'
  | 'E_NOT_A_FILE'
  | 'E_PROBE_FAILED'
  | 'E_ANALYSIS_FAILED';

/** Typed failure so callers can branch without reading English. */
export class ReferenceAnalysisError extends Error {
  readonly code: ReferenceErrorCode;

  constructor(
    code: ReferenceErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ReferenceAnalysisError';
    this.code = code;
  }
}
