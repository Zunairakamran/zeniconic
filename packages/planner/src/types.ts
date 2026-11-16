import type { FormatId, LookId, Profile, Room, SafeArea } from '@zeniconic/edl';

/**
 * A shot plus its quality score. Produced by the analysis/tagging stages; the
 * planner treats it as immutable input.
 */
export interface Candidate {
  shotId: string;
  sourceId: string;
  src: string;
  room: Room;
  /** 0..1 */
  score: number;
  /** Source seconds. */
  inSec: number;
  /** Source seconds. */
  outSec: number;
  reason: string;
}

export interface Facts {
  address: string;
  price?: string;
  beds?: number;
  baths?: number;
  currency: 'AED' | 'GBP' | 'USD' | 'EUR';
}

export interface FormatSpec {
  id: FormatId;
  label: string;
  targetDurationSec: number;
}

export interface LookSpec {
  id: LookId;
  label: string;
}

export interface PlanRequest {
  listingId: string;
  format: FormatSpec;
  look: LookSpec;
  profile: Profile;
  canvas: { width: number; height: number; fps: number; safeArea: SafeArea };
  candidates: Candidate[];
  facts: Facts;
  music: {
    trackId: string;
    src: string;
    beatGrid: number[];
    gainDb: number;
    duckUnderVoiceDb: number;
  };
  /** Reserved for deterministic tie-breaks between equal-scored shots. */
  seed: number;
  /** ISO timestamp, injected so plans are reproducible. */
  now: string;
}

export interface SequenceSpec {
  targetDurationSec: number;
  minShotSec: number;
  maxShotSec: number;
  roomOrder: Room[];
}

/**
 * The planner's own shape: a candidate plus the slice of its source window the
 * edit actually consumes. `durationSec` is always <= `outSec - inSec`.
 */
export interface PlannedClip {
  shotId: string;
  sourceId: string;
  src: string;
  room: Room;
  /** 0..1 */
  score: number;
  /** Source seconds. */
  inSec: number;
  /** Source seconds, end of the available shot. */
  outSec: number;
  /** Timeline seconds consumed, at speed 1. */
  durationSec: number;
  reason: string;
  /** True for the bookend return to the hook's room. */
  isReturn?: boolean;
}
