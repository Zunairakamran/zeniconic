import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ReferenceStyleProfile } from './types';

export const REFERENCE_PROFILE_FILE = 'reference-profile.json';

export interface StoredReferenceProfile {
  version: 1;
  analyzedAt: string;
  file: string;
  profile: ReferenceStyleProfile;
}

/** Atomic write; a failed save leaves the previous profile intact. */
export async function saveReferenceProfile(
  listingDir: string,
  input: { file: string; profile: ReferenceStyleProfile; analyzedAt?: string },
): Promise<StoredReferenceProfile> {
  const stored: StoredReferenceProfile = {
    version: 1,
    analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    file: input.file,
    profile: input.profile,
  };
  const path = join(listingDir, REFERENCE_PROFILE_FILE);
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new Error(
      `The reference profile could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return stored;
}

/** Missing or corrupt profile is `undefined`, never a crash. */
export async function readReferenceProfile(
  listingDir: string,
): Promise<StoredReferenceProfile | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(listingDir, REFERENCE_PROFILE_FILE), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as { version?: unknown; analyzedAt?: unknown; file?: unknown; profile?: unknown };
    if (record.version !== 1) return undefined;
    if (typeof record.profile !== 'object' || record.profile === null) return undefined;
    if (typeof record.analyzedAt !== 'string' || typeof record.file !== 'string') return undefined;
    return {
      version: 1,
      analyzedAt: record.analyzedAt,
      file: record.file,
      profile: record.profile as ReferenceStyleProfile,
    };
  } catch {
    return undefined;
  }
}

export async function clearReferenceProfile(listingDir: string): Promise<void> {
  await rm(join(listingDir, REFERENCE_PROFILE_FILE), { force: true });
}

/**
 * The subset that is safe and useful in a prompt: measured style, no absolute
 * path, no raw sources map.
 */
export function referenceGuidance(stored: StoredReferenceProfile): Record<string, unknown> {
  const profile = stored.profile;
  return {
    analyzedAt: stored.analyzedAt,
    style: profile.style,
    pacing: profile.pacing,
    averageShotSec: profile.averageShotSec,
    cutDensityPerMin: profile.cutDensityPerMin,
    aspect: profile.aspect,
    motion: profile.motion,
    palette: profile.palette,
    confidence: profile.confidence,
  };
}
