import { availableMoods, availableTracks } from './catalog';
import { roundSec } from './grid';
import type { Mood, SelectTrackInput, Track, TrackSelection } from './types';

/** Room for the 1.2 s fade-out plus a little air after the last spoken word. */
export const MUSIC_TAIL_SEC = 2;

interface RankedTrack {
  track: Track;
  index: number;
  energyRank: number;
  lengthRank: number;
}

function formatSeconds(value: number): string {
  const rounded = roundSec(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '');
}

function lengthRank(track: Track, durationSec: number): number {
  if (track.durationSec >= durationSec + MUSIC_TAIL_SEC) return 0;
  if (track.durationSec >= durationSec) return 1;
  return 2;
}

function reasonFor(track: Track, input: SelectTrackInput): string | undefined {
  const notes: string[] = [];

  if (input.energy !== undefined && track.energy !== input.energy) {
    notes.push(`Energy ${track.energy} is the closest fit for energy ${input.energy}.`);
  }

  if (track.durationSec < input.durationSec) {
    notes.push(
      `This bed runs ${formatSeconds(track.durationSec)}s, shorter than the ${formatSeconds(input.durationSec)}s video; loop it on a bar boundary or choose a longer track.`,
    );
  }

  return notes.length === 0 ? undefined : notes.join(' ');
}

/**
 * Thrown when the bank cannot satisfy the request at all. `mood` is the mood the
 * caller asked for (or `undefined` when no mood was given) and `availableMoods`
 * lists what can actually be selected.
 */
export class MusicBankError extends Error {
  readonly code = 'E_NO_TRACK';
  readonly mood: Mood | undefined;
  readonly availableMoods: readonly Mood[];

  constructor(mood: Mood | undefined, available: readonly Mood[]) {
    const detail =
      mood === undefined
        ? 'the bank has no available tracks'
        : `mood "${mood}" has no available track`;
    const moods = available.length === 0 ? 'none' : available.join(', ');
    super(`E_NO_TRACK: ${detail}. Available moods: ${moods}.`);
    this.name = 'MusicBankError';
    this.mood = mood;
    this.availableMoods = [...available];
  }
}

/**
 * Deterministic query over the deliverable bank. Unavailable catalogue entries
 * are filtered out before ranking, so a planned bed can never be returned. Mood
 * is the first filter, then the nearest energy, then a bed long enough for the
 * video; ties keep catalogue order. The selected bed is returned even when it is
 * short, with a `reason` the caller must surface instead of silently looping.
 *
 * When the requested mood has no available track, throws `MusicBankError` with
 * code `E_NO_TRACK`.
 */
export function selectTrack(input: SelectTrackInput): TrackSelection {
  if (!Number.isFinite(input.durationSec) || input.durationSec < 0) {
    throw new RangeError(
      `durationSec must be a non-negative finite number, received ${String(input.durationSec)}`,
    );
  }
  if (input.energy !== undefined && !Number.isFinite(input.energy)) {
    throw new RangeError(`energy must be a finite number, received ${String(input.energy)}`);
  }

  const candidates = availableTracks(input.mood);
  if (candidates.length === 0) {
    throw new MusicBankError(input.mood, availableMoods());
  }

  const ranked: RankedTrack[] = candidates.map((track, index) => ({
    track,
    index,
    energyRank: input.energy === undefined ? 0 : Math.abs(track.energy - input.energy),
    lengthRank: lengthRank(track, input.durationSec),
  }));

  ranked.sort((a, b) => {
    if (a.energyRank !== b.energyRank) return a.energyRank - b.energyRank;
    if (a.lengthRank !== b.lengthRank) return a.lengthRank - b.lengthRank;

    // If nothing is long enough, keep the least-short bed.
    if (a.lengthRank === 2 && a.track.durationSec !== b.track.durationSec) {
      return b.track.durationSec - a.track.durationSec;
    }

    return a.index - b.index;
  });

  const selected = ranked[0];
  if (!selected) {
    throw new MusicBankError(input.mood, availableMoods());
  }

  const reason = reasonFor(selected.track, input);
  return reason === undefined ? selected.track : { ...selected.track, reason };
}
