import { describe, expect, it } from 'vitest';
import {
  MusicBankError,
  TRACKS,
  availableMoods,
  availableTracks,
  selectTrack,
} from '../src/index';

describe('selectTrack', () => {
  it('prefers the requested mood and energy', () => {
    const selected = selectTrack({ mood: 'calm', energy: 1, durationSec: 20 });

    expect(selected.id).toBe('calm-096');
    expect(selected.mood).toBe('calm');
    expect(selected.energy).toBe(1);
    expect(selected.available).toBe(true);
    expect(selected.reason).toBeUndefined();
  });

  it('returns a mood match for every mood that has an available bed', () => {
    expect(availableMoods()).toEqual(['calm', 'social']);

    for (const mood of availableMoods()) {
      const selected = selectTrack({ mood, durationSec: 20 });
      expect(selected.mood).toBe(mood);
      expect(selected.available).toBe(true);
      expect(selected.reason).toBeUndefined();
    }
  });

  it('never returns an unavailable catalogue track', () => {
    const unavailable = new Set(
      TRACKS.filter((track) => !track.available).map((track) => track.id),
    );
    expect(unavailable.size).toBe(14);

    for (const mood of availableMoods()) {
      for (const energy of [1, 2, 3, 4, 5]) {
        for (const durationSec of [10, 60, 500]) {
          const selected = selectTrack({ mood, energy, durationSec });
          expect(selected.available).toBe(true);
          expect(unavailable.has(selected.id)).toBe(false);
        }
      }
    }
  });

  it('throws E_NO_TRACK with the missing mood and the available moods', () => {
    let error: unknown;
    try {
      selectTrack({ mood: 'luxury', durationSec: 20 });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MusicBankError);
    const bankError = error as MusicBankError;
    expect(bankError.code).toBe('E_NO_TRACK');
    expect(bankError.mood).toBe('luxury');
    expect(bankError.availableMoods).toEqual(['calm', 'social']);
    expect(bankError.message).toContain('E_NO_TRACK');
    expect(bankError.message).toContain('"luxury"');
    expect(bankError.message).toContain('calm, social');
  });

  it('throws E_NO_TRACK for every mood with no available bed', () => {
    for (const mood of ['luxury', 'cinematic', 'warm'] as const) {
      expect(() => selectTrack({ mood, durationSec: 20 }))
        .toThrowError(MusicBankError);
      try {
        selectTrack({ mood, durationSec: 20 });
      } catch (caught) {
        expect((caught as MusicBankError).code).toBe('E_NO_TRACK');
        expect((caught as MusicBankError).mood).toBe(mood);
      }
    }
  });

  it('reports a short bed instead of looping silently', () => {
    const selected = selectTrack({ mood: 'calm', durationSec: 90 });

    expect(selected.id).toBe('calm-096');
    expect(selected.durationSec).toBe(35);
    expect(selected.reason).toBeDefined();
    expect(selected.reason).toContain('shorter');
    expect(selected.reason).toContain('loop');
  });

  it('keeps mood and energy preference even when that bed is short', () => {
    const selected = selectTrack({ mood: 'social', energy: 4, durationSec: 75 });

    expect(selected.id).toBe('catchy-120');
    expect(selected.energy).toBe(4);
    expect(selected.reason).toContain('shorter than the 75s video');
  });

  it('falls back to the closest energy and says so', () => {
    const selected = selectTrack({ mood: 'social', energy: 5, durationSec: 20 });

    expect(selected.id).toBe('catchy-120');
    expect(selected.mood).toBe('social');
    expect(selected.energy).toBe(4);
    expect(selected.reason).toContain('closest');
  });

  it('picks the least-short available bed when nothing covers the video', () => {
    const selected = selectTrack({ durationSec: 500 });

    expect(selected.id).toBe('calm-096');
    expect(selected.durationSec).toBe(35);
    expect(selected.reason).toContain('shorter');
  });

  it('is deterministic and never mutates the catalogue', () => {
    const before = JSON.stringify(TRACKS);
    const first = selectTrack({ mood: 'calm', energy: 2, durationSec: 30 });
    const second = selectTrack({ mood: 'calm', energy: 2, durationSec: 30 });

    expect(second).toEqual(first);
    expect(JSON.stringify(TRACKS)).toBe(before);
    expect(TRACKS).toHaveLength(16);
  });

  it('only selects from available beds in the requested mood', () => {
    const selected = selectTrack({ mood: 'social', energy: 2, durationSec: 20 });
    expect(availableTracks('social').map((track) => track.id)).toContain(selected.id);
  });

  it('rejects invalid duration and energy values', () => {
    expect(() => selectTrack({ durationSec: -1 })).toThrow(RangeError);
    expect(() => selectTrack({ durationSec: Number.NaN })).toThrow(RangeError);
    expect(() => selectTrack({ durationSec: 20, energy: Number.NaN })).toThrow(RangeError);
  });
});
