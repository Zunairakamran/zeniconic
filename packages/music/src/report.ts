import { TRACKS } from './catalog';
import type {
  BankReport,
  BankReportSourceCount,
  BankReportTrack,
  TrackLicenseSource,
} from './types';

const SOURCE_ORDER: readonly TrackLicenseSource[] = [
  'ai_generated',
  'royalty_free',
  'user_supplied',
];

function roundMinutes(minutes: number): number {
  return Math.round(minutes * 1000) / 1000;
}

/**
 * Read-only audit view of the bank. Every catalogue entry appears once with its
 * availability and licence record, so a reviewer can compare the catalogue with
 * the files on disk. Totals cover **available** tracks only: those are the beds
 * that can actually be selected or delivered.
 */
export function bankReport(): BankReport {
  const tracks: BankReportTrack[] = TRACKS.map((track) => ({
    id: track.id,
    mood: track.mood,
    file: track.file,
    available: track.available,
    licence: { ...track.license },
    durationSec: track.durationSec,
  }));

  const available = TRACKS.filter((track) => track.available);
  const totalSeconds = available.reduce((sum, track) => sum + track.durationSec, 0);

  const licenceSources: BankReportSourceCount[] = SOURCE_ORDER.map((source) => ({
    source,
    tracks: available.filter((track) => track.license.source === source).length,
  })).filter((entry) => entry.tracks > 0);

  return {
    tracks,
    totals: {
      trackCount: tracks.length,
      availableCount: available.length,
      totalMinutes: roundMinutes(totalSeconds / 60),
      licenceSources,
    },
  };
}
