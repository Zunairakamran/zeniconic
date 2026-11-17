import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRACKS, bankReport } from '../src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * `data/` is gitignored, so a clean clone has no bed files and no sidecars.
 * `node scripts/make-music-fixtures.mjs` generates them. Without them the audit
 * below is skipped rather than failed: the catalogue's availability flags are
 * code, but the files they describe are local fixtures.
 */
const sidecarPresent = TRACKS.some(
  (track) => track.available && existsSync(join(repoRoot, track.file.replace(/\.m4a$/, '.json'))),
);

interface Sidecar {
  id?: unknown;
  mood?: unknown;
  bpm?: unknown;
  durationSec?: unknown;
  file?: unknown;
  license?: unknown;
  generatedBy?: unknown;
  synthId?: unknown;
  clientDeliveryCleared?: unknown;
}

describe('bankReport', () => {
  it('returns one audit row per catalogue entry', () => {
    const report = bankReport();

    expect(report.tracks).toHaveLength(TRACKS.length);

    for (let index = 0; index < TRACKS.length; index += 1) {
      const track = TRACKS[index];
      const row = report.tracks[index];
      expect(track).toBeDefined();
      expect(row).toEqual({
        id: track?.id,
        mood: track?.mood,
        file: track?.file,
        available: track?.available,
        licence: track?.license,
        durationSec: track?.durationSec,
      });
      expect(Object.keys(row ?? {}).sort()).toEqual([
        'available',
        'durationSec',
        'file',
        'id',
        'licence',
        'mood',
      ]);
    }
  });

  it('counts available tracks and total minutes', () => {
    const report = bankReport();
    const available = TRACKS.filter((track) => track.available);
    const totalSeconds = available.reduce((sum, track) => sum + track.durationSec, 0);

    expect(report.totals.trackCount).toBe(16);
    expect(report.totals.availableCount).toBe(available.length);
    expect(report.totals.availableCount).toBe(2);
    expect(report.totals.totalMinutes).toBeCloseTo(totalSeconds / 60, 3);
    expect(report.totals.totalMinutes).toBe(1.167);
  });

  it('summarises licence sources of the available tracks', () => {
    const report = bankReport();

    expect(report.totals.licenceSources).toEqual([{ source: 'ai_generated', tracks: 2 }]);
    expect(
      report.totals.licenceSources.reduce((sum, entry) => sum + entry.tracks, 0),
    ).toBe(report.totals.availableCount);
  });

  it.skipIf(!sidecarPresent)('keeps a sidecar licence record beside every available file', () => {
    const available = TRACKS.filter((track) => track.available);
    expect(available.length).toBeGreaterThan(0);

    for (const track of available) {
      const sidecarPath = join(repoRoot, track.file.replace(/\.m4a$/, '.json'));
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Sidecar;

      expect(sidecar.id).toBe(track.id);
      expect(sidecar.mood).toBe(track.mood);
      expect(sidecar.bpm).toBe(track.bpm);
      expect(sidecar.durationSec).toBe(track.durationSec);
      expect(sidecar.file).toBe(track.file);
      expect(sidecar.license).toEqual(track.license);
      // The generator string is provenance, not a licence: accept the Lyria
      // record or the deterministic ffmpeg placeholder built by
      // `scripts/make-music-fixtures.mjs`, but never an empty/unknown value.
      expect(sidecar.generatedBy).toMatch(/^(lyria|ffmpeg-synth-fixture|synthesised)$/);
      expect(sidecar.synthId).toBe(true);
      expect(sidecar.clientDeliveryCleared).toBe(false);
    }
  });

  it('returns fresh rows and does not let callers mutate the catalogue', () => {
    const report = bankReport();
    report.tracks.length = 0;

    expect(bankReport().tracks).toHaveLength(16);

    const row = bankReport().tracks[0];
    expect(row).toBeDefined();
    if (row) row.licence.licenseId = 'mutated';

    expect(TRACKS[0]?.license.licenseId).not.toBe('mutated');
  });
});
