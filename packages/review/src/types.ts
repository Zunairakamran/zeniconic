/**
 * Public types for the render review loop.
 *
 * Review is the last gate before a take is accepted: it inspects the finished
 * file, not the EDL that produced it. Deterministic checks are free and run
 * first; a vision pass costs money and only runs when the cheap checks pass.
 */

import type { ChatClient } from '@zeniconic/ai';
import type { Edl } from '@zeniconic/edl';
import type { RenderProfile } from '@zeniconic/render';

/**
 * The ten checks, with the exact ids the EDL schema's `review.checks` enum
 * allows (§FR-28). The UI and the schema both switch on these strings.
 */
export type CheckId =
  | 'duration'
  | 'no_black_frames'
  | 'no_freeze'
  | 'text_safe_area'
  | 'cta_legible'
  | 'room_order'
  | 'loudness'
  | 'no_repeated_shot'
  | 'hook_visible'
  | 'facts_present'
  | 'marketing_beats';

export interface CheckResult {
  id: CheckId;
  passed: boolean;
  /** One plain sentence naming what was measured. */
  detail: string;
}

export interface ReviewResult {
  /** 0..1. The vision mean when vision ran, otherwise the deterministic pass rate. */
  score: number;
  checks: CheckResult[];
  verdict: 'pass' | 'retry' | 'fail';
  /** One paragraph addressed to the planner. Only present when `verdict` is `retry`. */
  feedback?: string;
  /** Vision spend for this review. Deterministic checks cost nothing. */
  costUsd: number;
}

/** One sampled frame, already encoded as JPEG, as the render worker returns it. */
export interface FrameSample {
  t: number;
  jpegBase64: string;
}

/**
 * Everything the loop needs from the outside world. There is no fs or network
 * access in this package: the caller owns ffprobe, FFmpeg and the relay client.
 */
export interface ReviewDeps {
  probe(file: string): Promise<{ durationSec: number; width: number; height: number }>;
  loudness(file: string): Promise<{ lufs: number; truePeak: number }>;
  sampleFrames(file: string, times: number[]): Promise<FrameSample[]>;
  vision?: ChatClient;
  /** Review model. Defaults to the SPEC §8.1 review model. */
  model?: string;
}

/**
 * The confirmed facts the take must show. Everything is optional: a fact the
 * user never confirmed is simply absent, and its overlay is not required.
 */
export interface ReviewFacts {
  address?: string;
  price?: string;
  beds?: number;
  baths?: number;
}

export interface ReviewInput {
  output: string;
  edl: Edl;
  profile: RenderProfile;
  /**
   * Confirmed facts, when the caller has them. Without this the check falls
   * back to the fact-bearing overlays already on the EDL and to the formats
   * that cannot be planned without a price or address.
   */
  facts?: ReviewFacts;
  /**
   * How many re-renders this take has already used. A third review after two
   * retries fails instead of asking for another one; absent means zero.
   */
  retriesUsed?: number;
}
