import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOODS,
  TRACKS,
  availableMoods,
  availableTracks,
  tracksFor,
} from '../src/index';
import type { Mood } from '../src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('music bank catalogue', () => {
  it('holds sixteen catalogue entries with unique kebab ids', () => {
    expect(TRACKS).toHaveLength(16);
    const ids = TRACKS.map((track) => track.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(KEBAB);
  });

  it('keeps availability in step with the files on disk', () => {
    const available = TRACKS.filter((track) => track.available);

    expect(available.map((track) => track.id)).toEqual(['calm-096', 'catchy-120']);

    for (const track of TRACKS) {
      expect(
        existsSync(join(repoRoot, track.file)),
        `${track.id}: available=${track.available} does not match ${track.file}`,
      ).toBe(track.available);
    }

    for (const track of available) {
      expect(track.file).toBe(`data/assets/music/${track.id}.m4a`);
    }
  });

  it('spreads at least two catalogue tracks across every mood', () => {
    for (const mood of MOODS) {
      const matches = TRACKS.filter((track) => track.mood === mood);
      expect(matches.length, `${mood} has too few beds`).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses ten AI beds and six royalty-free beds, all with licence records', () => {
    const ai = TRACKS.filter((track) => track.license.source === 'ai_generated');
    const free = TRACKS.filter((track) => track.license.source === 'royalty_free');

    expect(ai).toHaveLength(10);
    expect(free).toHaveLength(6);

    for (const track of TRACKS) {
      expect(track.license.licenseId.length).toBeGreaterThan(0);
      expect(track.license.source).toMatch(/^(ai_generated|royalty_free|user_supplied)$/);
      if (track.license.source === 'ai_generated') {
        expect(track.license.licenseId.startsWith('lyria:')).toBe(true);
      }
    }

    const uppbeat = TRACKS.find((track) => track.license.licenseId.startsWith('uppbeat:'));
    expect(uppbeat?.license.attribution).toContain('Uppbeat');
  });

  it('keeps every bed within the bank range and spreads energy 1-5', () => {
    const energies = new Set<number>();

    for (const track of TRACKS) {
      expect(track.title.length).toBeGreaterThan(0);
      expect(track.bpm).toBeGreaterThanOrEqual(70);
      expect(track.bpm).toBeLessThanOrEqual(128);
      expect(track.durationSec).toBeGreaterThan(0);
      expect(Number.isInteger(track.energy)).toBe(true);
      expect(track.energy).toBeGreaterThanOrEqual(1);
      expect(track.energy).toBeLessThanOrEqual(5);

      if (track.available) {
        expect(track.file).toBe(`data/assets/music/${track.id}.m4a`);
      } else {
        expect(track.file).toBe(`data/assets/music/${track.mood}/${track.id}.wav`);
      }

      energies.add(track.energy);
    }

    expect([...energies].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('caches a beat grid that matches the BPM and stays inside the schema rules', () => {
    for (const track of TRACKS) {
      expect(track.beatGridSec.length).toBeGreaterThan(0);
      expect(track.beatGridSec.length).toBeLessThanOrEqual(2400);

      const first = track.beatGridSec[0] ?? NaN;
      expect(first).toBe(0);

      const expectedInterval = 60 / track.bpm;
      for (let index = 1; index < track.beatGridSec.length; index += 1) {
        const previous = track.beatGridSec[index - 1] ?? NaN;
        const current = track.beatGridSec[index] ?? NaN;
        const interval = current - previous;
        expect(current).toBeGreaterThan(previous);
        expect(Math.abs(interval - expectedInterval)).toBeLessThanOrEqual(expectedInterval * 0.08);
        expect(Number.isInteger(Math.round(current * 1000))).toBe(true);
      }

      const last = track.beatGridSec[track.beatGridSec.length - 1] ?? NaN;
      expect(last).toBeLessThan(track.durationSec);
    }
  });

  it('filters by mood without exposing the catalogue array', () => {
    for (const mood of MOODS) {
      const matches = tracksFor(mood);
      expect(matches.length).toBeGreaterThanOrEqual(2);
      expect(matches.every((track) => track.mood === mood)).toBe(true);

      matches.length = 0;
      expect(tracksFor(mood).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('exposes only deliverable tracks through availableTracks and availableMoods', () => {
    expect(availableMoods()).toEqual(['calm', 'social']);

    for (const mood of MOODS) {
      const matches = availableTracks(mood);
      expect(matches.every((track) => track.mood === mood && track.available)).toBe(true);
      if ((['calm', 'social'] as readonly Mood[]).includes(mood)) {
        expect(matches.length).toBeGreaterThan(0);
      } else {
        expect(matches).toHaveLength(0);
      }
    }

    expect(availableTracks().map((track) => track.id)).toEqual(['calm-096', 'catchy-120']);
  });
});
