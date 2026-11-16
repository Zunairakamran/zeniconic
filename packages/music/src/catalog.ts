import { beatGridFromBpm } from './grid';
import { MOODS } from './types';
import type { Mood, Track } from './types';

type TrackSeed = Omit<Track, 'beatGridSec'>;

function makeTrack(seed: TrackSeed): Track {
  return { ...seed, beatGridSec: beatGridFromBpm(seed.bpm, seed.durationSec) };
}

/**
 * The bank. `available` is the audit flag, not a hint: only a track whose file
 * exists under `data/assets/music/` and whose licence record is complete may be
 * selected for a render or delivered to a client. The catalogue deliberately
 * keeps planned beds so the planner can see the intended coverage, but those
 * entries are never returned by `selectTrack`.
 *
 * The two shipped beds are the Lyria prototypes, promoted from `data/music/`
 * under stable names. Their licence caveat is recorded in
 * `docs/MUSIC-LICENCES.md`; Lyria output is not unambiguously cleared for client
 * work and carries SynthID.
 */
export const TRACKS: readonly Track[] = [
  // Shipped: file present, licence recorded, deliverable.
  makeTrack({
    id: 'calm-096',
    title: 'Calm Bed 96',
    mood: 'calm',
    bpm: 96,
    durationSec: 35,
    file: 'data/assets/music/calm-096.m4a',
    available: true,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-11-15-calm-bed-96',
      attribution:
        'Generated with Google Lyria (google/lyria-3-pro-preview) on 2026-11-15. Output carries SynthID and is not cleared for client delivery without legal sign-off.',
    },
    energy: 1,
  }),
  makeTrack({
    id: 'catchy-120',
    title: 'Catchy 120',
    mood: 'social',
    bpm: 120,
    durationSec: 35,
    file: 'data/assets/music/catchy-120.m4a',
    available: true,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-11-15-catchy-120',
      attribution:
        'Generated with Google Lyria (google/lyria-3-pro-preview) on 2026-11-15. Output carries SynthID and is not cleared for client delivery without legal sign-off.',
    },
    energy: 4,
  }),

  // Planned: no file on disk yet. `licenseId` values are internal placeholders,
  // not legal records, until the matching file and signed licence land.
  makeTrack({
    id: 'quiet-courtyard',
    title: 'Quiet Courtyard',
    mood: 'calm',
    bpm: 72,
    durationSec: 72,
    file: 'data/assets/music/calm/quiet-courtyard.wav',
    available: false,
    license: {
      source: 'royalty_free',
      licenseId: 'artlist:acct-dxb-4417/track-108842',
    },
    energy: 1,
  }),
  makeTrack({
    id: 'marina-morning',
    title: 'Marina Morning',
    mood: 'calm',
    bpm: 78,
    durationSec: 64,
    file: 'data/assets/music/calm/marina-morning.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-01-08-marina-morning',
    },
    energy: 2,
  }),
  makeTrack({
    id: 'linen-light',
    title: 'Linen Light',
    mood: 'calm',
    bpm: 84,
    durationSec: 55,
    file: 'data/assets/music/calm/linen-light.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-01-11-linen-light',
    },
    energy: 2,
  }),
  makeTrack({
    id: 'amber-atrium',
    title: 'Amber Atrium',
    mood: 'luxury',
    bpm: 88,
    durationSec: 68,
    file: 'data/assets/music/luxury/amber-atrium.wav',
    available: false,
    license: {
      source: 'royalty_free',
      licenseId: 'epidemic:acct-dxb-4417/track-es-229104',
    },
    energy: 2,
  }),
  makeTrack({
    id: 'palm-haze',
    title: 'Palm Haze',
    mood: 'luxury',
    bpm: 92,
    durationSec: 60,
    file: 'data/assets/music/luxury/palm-haze.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-01-15-palm-haze',
    },
    energy: 3,
  }),
  makeTrack({
    id: 'midnight-marble',
    title: 'Midnight Marble',
    mood: 'luxury',
    bpm: 96,
    durationSec: 75,
    file: 'data/assets/music/luxury/midnight-marble.wav',
    available: false,
    license: {
      source: 'royalty_free',
      licenseId: 'musicbed:MB-2026-11842',
    },
    energy: 2,
  }),
  makeTrack({
    id: 'business-bay-pulse',
    title: 'Business Bay Pulse',
    mood: 'social',
    bpm: 118,
    durationSec: 40,
    file: 'data/assets/music/social/business-bay-pulse.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-01-22-business-bay-pulse',
    },
    energy: 4,
  }),
  makeTrack({
    id: 'open-house',
    title: 'Open House',
    mood: 'social',
    bpm: 124,
    durationSec: 35,
    file: 'data/assets/music/social/open-house.wav',
    available: false,
    license: {
      source: 'royalty_free',
      licenseId: 'uppbeat:free/ub-77120',
      attribution: '"Open House" by Atlas Loom via Uppbeat (free tier).',
    },
    energy: 5,
  }),
  makeTrack({
    id: 'golden-hour-keys',
    title: 'Golden Hour Keys',
    mood: 'social',
    bpm: 108,
    durationSec: 50,
    file: 'data/assets/music/social/golden-hour-keys.wav',
    available: false,
    license: {
      source: 'royalty_free',
      licenseId: 'pixabay:audio-24817-2026-01-09',
    },
    energy: 3,
  }),
  makeTrack({
    id: 'skyline-drift',
    title: 'Skyline Drift',
    mood: 'cinematic',
    bpm: 90,
    durationSec: 64,
    file: 'data/assets/music/cinematic/skyline-drift.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-02-02-skyline-drift',
    },
    energy: 2,
  }),
  makeTrack({
    id: 'dune-light',
    title: 'Dune Light',
    mood: 'cinematic',
    bpm: 98,
    durationSec: 58,
    file: 'data/assets/music/cinematic/dune-light.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-02-06-dune-light',
    },
    energy: 3,
  }),
  makeTrack({
    id: 'city-of-pearl',
    title: 'City of Pearl',
    mood: 'cinematic',
    bpm: 102,
    durationSec: 82,
    file: 'data/assets/music/cinematic/city-of-pearl.wav',
    available: false,
    license: {
      source: 'royalty_free',
      licenseId: 'artlist:acct-dxb-4417/track-109771',
    },
    energy: 4,
  }),
  makeTrack({
    id: 'sunlit-palm',
    title: 'Sunlit Palm',
    mood: 'warm',
    bpm: 86,
    durationSec: 52,
    file: 'data/assets/music/warm/sunlit-palm.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-02-11-sunlit-palm',
    },
    energy: 2,
  }),
  makeTrack({
    id: 'creek-reflections',
    title: 'Creek Reflections',
    mood: 'warm',
    bpm: 76,
    durationSec: 58,
    file: 'data/assets/music/warm/creek-reflections.wav',
    available: false,
    license: {
      source: 'ai_generated',
      licenseId: 'lyria:gen-2026-02-14-creek-reflections',
    },
    energy: 1,
  }),
];

/** All catalogue tracks with a mood, in catalogue order. A new array every call. */
export function tracksFor(mood: Mood): Track[] {
  return TRACKS.filter((track) => track.mood === mood);
}

/** Deliverable tracks only, optionally narrowed to one mood. New array every call. */
export function availableTracks(mood?: Mood): Track[] {
  return TRACKS.filter(
    (track) => track.available && (mood === undefined || track.mood === mood),
  );
}

/** Moods with at least one deliverable track, in canonical mood order. */
export function availableMoods(): Mood[] {
  return MOODS.filter((mood) => availableTracks(mood).length > 0);
}
