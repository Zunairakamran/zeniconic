import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  clearReferenceProfile,
  readReferenceProfile,
  referenceGuidance,
  REFERENCE_PROFILE_FILE,
  saveReferenceProfile,
} from '../src/store';
import type { ReferenceStyleProfile } from '../src/types';

const profile = {
  durationSec: 12,
  width: 1080,
  height: 1920,
  fps: 30,
  aspect: '9:16',
  shotCount: 6,
  averageShotSec: 2,
  medianShotSec: 2,
  cutDensityPerMin: 30,
  shotDurationsSec: [2, 2, 2, 2, 2, 2],
  pacing: 'fast',
  motion: 'medium',
  motionScore: 0.03,
  palette: ['#112233', '#445566', '#778899'],
  transitionsGuess: 'cuts',
  style: {
    style: 'fast warm edit',
    pacing: 'fast',
    transition_style: 'hard cuts',
    caption_style: 'unknown',
    color_style: 'warm',
    camera_style: 'handheld',
    motion_graphics: 'none-detected',
  },
  confidence: 0.9,
  sources: {},
} as unknown as ReferenceStyleProfile;

describe('reference profile store', () => {
  it('round-trips and never exposes the file path in guidance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ref-store-'));
    try {
      await saveReferenceProfile(dir, { file: 'C:/secret/ref.mp4', profile, analyzedAt: '2026-11-17T10:00:00.000Z' });
      const read = await readReferenceProfile(dir);
      expect(read?.profile.pacing).toBe('fast');
      expect(read?.file).toBe('C:/secret/ref.mp4');
      const guidance = referenceGuidance(read!);
      expect(JSON.stringify(guidance)).not.toContain('secret');
      expect(guidance.pacing).toBe('fast');
      expect(guidance.sources).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined for missing and corrupt files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ref-store-'));
    try {
      expect(await readReferenceProfile(dir)).toBeUndefined();
      await writeFile(join(dir, REFERENCE_PROFILE_FILE), '{not json', 'utf8');
      expect(await readReferenceProfile(dir)).toBeUndefined();
      await writeFile(join(dir, REFERENCE_PROFILE_FILE), JSON.stringify({ version: 2 }), 'utf8');
      expect(await readReferenceProfile(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('clears the profile and leaves no temp file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ref-store-'));
    try {
      await saveReferenceProfile(dir, { file: 'ref.mp4', profile });
      await clearReferenceProfile(dir);
      expect(await readReferenceProfile(dir)).toBeUndefined();
      expect((await readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
