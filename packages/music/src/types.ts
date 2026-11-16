/** Mood tags shared with the Look vocabulary in `docs/CONVENTIONS.md`. */
export type Mood = 'calm' | 'luxury' | 'social' | 'cinematic' | 'warm';

/** Canonical mood order for reports, error messages and tests. */
export const MOODS: readonly Mood[] = ['calm', 'luxury', 'social', 'cinematic', 'warm'];

/** Energy is a coarse, catalogue-owned label; it is not measured at selection time. */
export type Energy = 1 | 2 | 3 | 4 | 5;

/** Mirrors `MusicLicenseSource` in `@zeniconic/edl`. */
export type TrackLicenseSource = 'ai_generated' | 'royalty_free' | 'user_supplied';

export interface TrackLicense {
  source: TrackLicenseSource;
  licenseId: string;
  attribution?: string;
}

export interface Track {
  id: string;
  title: string;
  mood: Mood;
  bpm: number;
  durationSec: number;
  /** Repo-relative path. Only an `available` track's file is guaranteed to exist. */
  file: string;
  /**
   * True only when the file exists under `data/assets/music/` and the licence
   * record is complete. Unavailable entries are planned beds, not deliverable
   * stock.
   */
  available: boolean;
  license: TrackLicense;
  /** Cached beat times in seconds, 3 dp, ascending. Generated from `bpm`. */
  beatGridSec: number[];
  energy: Energy;
}

/**
 * A selected bed plus the caveats the caller must show or handle. `reason` is
 * present when the bank could not satisfy the request cleanly: the closest
 * energy was used, or the bed is shorter than the video.
 */
export interface TrackSelection extends Track {
  reason?: string;
}

export interface SelectTrackInput {
  mood?: Mood;
  durationSec: number;
  energy?: number;
}

/** One row of the licence audit. `licence` mirrors `Track.license`. */
export interface BankReportTrack {
  id: string;
  mood: Mood;
  file: string;
  available: boolean;
  licence: TrackLicense;
  durationSec: number;
}

export interface BankReportSourceCount {
  source: TrackLicenseSource;
  tracks: number;
}

export interface BankReportTotals {
  /** Every catalogue entry, available or not. */
  trackCount: number;
  /** Entries whose file exists and may be selected or delivered. */
  availableCount: number;
  /** Playing time of the available tracks, rounded to 3 dp. */
  totalMinutes: number;
  /** Available tracks per licence source, in canonical source order. */
  licenceSources: BankReportSourceCount[];
}

export interface BankReport {
  tracks: BankReportTrack[];
  totals: BankReportTotals;
}
