import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FootageIndex, IndexedClip, IndexedShot } from '../indexer';
import {
  FOOTAGE_INDEX_FILE,
  folderSignature,
  indexMatchesSignature,
  readFootageIndex,
  sameSourceFolder,
  writeFootageIndex,
} from '../index-store';

const PROBE = {
  durationSec: 12,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  bitrate: 8_000_000,
  hasAudio: true,
  orientation: 'landscape' as const,
  rotation: 0,
};

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zeniconic-signature-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

function shot(id: string, startSec: number, endSec: number): IndexedShot {
  return {
    id,
    startSec,
    endSec,
    durationSec: Math.round((endSec - startSec) * 1000) / 1000,
    representativeFrames: [0, 10, 20],
    metrics: {
      blur: 0.05,
      shake: 0.2,
      exposureClipLow: 0,
      exposureClipHigh: 0,
      motionEnergy: 0.3,
    },
  };
}

function clip(id: string, folder: string, name: string): IndexedClip {
  return {
    id,
    file: join(folder, name).replace(/\\/g, '/'),
    name,
    sha256: 'a'.repeat(64),
    probe: PROBE,
    frameSize: { width: 160, height: 90 },
    decodedFrames: 120,
    shots: [shot(`${id}_000`, 0, 6), shot(`${id}_001`, 6, 12)],
  };
}

function indexFor(folder: string, names: readonly string[]): FootageIndex {
  return {
    version: 1,
    generatedAt: '2026-11-17T09:00:00.000Z',
    frameSampling: {
      fps: 10,
      mode: 'per-orientation',
      portrait: { width: 90, height: 160 },
      landscape: { width: 160, height: 90 },
    },
    clips: names.map((name, position) => clip(`s_0000000${String(position)}`, folder, name)),
  };
}

/** Writes the fixture videos; sizes differ so a size check alone would notice. */
async function makeFolder(files: Record<string, string>): Promise<string> {
  const folder = await tempDir();
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(folder, name), body, 'utf8');
  }
  return folder;
}

const FILES = {
  'living-room.mp4': 'living-room-bytes',
  'kitchen.mp4': 'kitchen-bytes-longer',
  'notes.txt': 'not footage',
};

describe('folderSignature', () => {
  it('signs every video and ignores non-video files', async () => {
    const folder = await makeFolder(FILES);

    const signature = await folderSignature(folder);
    expect(signature).toBeDefined();
    expect(signature?.files.map((file) => file.name)).toEqual(['kitchen.mp4', 'living-room.mp4']);
    for (const file of signature?.files ?? []) {
      expect(file.sizeBytes).toBeGreaterThan(0);
      expect(Number.isInteger(file.mtimeMs)).toBe(true);
    }
    expect(signature?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across repeated scans of an unchanged folder', async () => {
    const folder = await makeFolder(FILES);
    const first = await folderSignature(folder);
    const second = await folderSignature(folder);

    expect(second).toEqual(first);
  });

  it('returns undefined when the folder cannot be read or holds no video', async () => {
    const empty = await tempDir();
    await writeFile(join(empty, 'readme.txt'), 'nothing to index', 'utf8');

    expect(await folderSignature(join(empty, 'missing'))).toBeUndefined();
    expect(await folderSignature(empty)).toBeUndefined();
  });

  it('folds the absolute folder into the fingerprint', async () => {
    const left = await makeFolder(FILES);
    const right = await makeFolder(FILES);
    const leftSignature = await folderSignature(left);
    const rightSignature = await folderSignature(right);

    expect(leftSignature?.fingerprint).not.toBe(rightSignature?.fingerprint);
  });
});

describe('indexMatchesSignature', () => {
  it('matches the signature it was written with, and survives a save/load round trip', async () => {
    const folder = await makeFolder(FILES);
    const signature = await folderSignature(folder);
    expect(signature).toBeDefined();

    const listingDir = await tempDir();
    const index: FootageIndex = { ...indexFor(folder, ['living-room.mp4']), sourceSignature: signature };
    await writeFootageIndex(listingDir, index);

    const reloaded = await readFootageIndex(listingDir);
    expect(reloaded?.sourceSignature).toEqual(signature);
    expect(indexMatchesSignature(reloaded, signature)).toBe(true);
  });

  it('rejects an index with no signature', async () => {
    const folder = await makeFolder(FILES);
    const signature = await folderSignature(folder);
    const index = indexFor(folder, ['living-room.mp4']);

    expect(indexMatchesSignature(index, signature)).toBe(false);
  });

  it('rejects an index written by a different folder', async () => {
    const folder = await makeFolder(FILES);
    const other = await makeFolder(FILES);
    const otherSignature = await folderSignature(other);
    const index = indexFor(folder, ['living-room.mp4']);

    expect(
      indexMatchesSignature({ ...index, sourceSignature: otherSignature }, await folderSignature(folder)),
    ).toBe(false);
  });

  it('rejects a file whose size changed', async () => {
    const folder = await makeFolder(FILES);
    const signature = await folderSignature(folder);
    const index: FootageIndex = { ...indexFor(folder, ['living-room.mp4']), sourceSignature: signature };

    await writeFile(join(folder, 'living-room.mp4'), 'living-room-bytes-plus-more', 'utf8');
    const changed = await folderSignature(folder);

    expect(changed?.fingerprint).not.toBe(signature?.fingerprint);
    expect(indexMatchesSignature(index, changed)).toBe(false);
  });

  it('rejects a file whose mtime changed even when the size did not', async () => {
    const folder = await makeFolder(FILES);
    const signature = await folderSignature(folder);
    const index: FootageIndex = { ...indexFor(folder, ['living-room.mp4']), sourceSignature: signature };

    const later = new Date(Date.now() + 5_000);
    await utimes(join(folder, 'kitchen.mp4'), later, later);
    const touched = await folderSignature(folder);

    expect(touched?.files.find((file) => file.name === 'kitchen.mp4')?.sizeBytes).toBe(
      signature?.files.find((file) => file.name === 'kitchen.mp4')?.sizeBytes,
    );
    expect(indexMatchesSignature(index, touched)).toBe(false);
  });

  it('rejects a folder that gained or lost a clip', async () => {
    const folder = await makeFolder(FILES);
    const signature = await folderSignature(folder);
    const index: FootageIndex = { ...indexFor(folder, ['living-room.mp4']), sourceSignature: signature };

    await writeFile(join(folder, 'balcony.mp4'), 'balcony-bytes', 'utf8');
    expect(indexMatchesSignature(index, await folderSignature(folder))).toBe(false);

    await rm(join(folder, 'balcony.mp4'));
    expect(indexMatchesSignature(index, await folderSignature(folder))).toBe(true);

    await rm(join(folder, 'kitchen.mp4'));
    expect(indexMatchesSignature(index, await folderSignature(folder))).toBe(false);
  });

  it('is false when there is no current signature to compare against', async () => {
    const folder = await makeFolder(FILES);
    const index: FootageIndex = {
      ...indexFor(folder, ['living-room.mp4']),
      sourceSignature: await folderSignature(folder),
    };

    expect(indexMatchesSignature(index, undefined)).toBe(false);
    expect(indexMatchesSignature(undefined, undefined)).toBe(false);
  });
});

describe('sameSourceFolder', () => {
  it('compares the way the platform compares paths', async () => {
    const folder = await tempDir();
    await mkdir(join(folder, 'raw'), { recursive: true });

    expect(sameSourceFolder(folder, folder)).toBe(true);
    expect(sameSourceFolder(join(folder, '.', 'raw'), join(folder, 'raw'))).toBe(true);
    if (process.platform === 'win32') {
      expect(sameSourceFolder(folder.toUpperCase(), folder.toLowerCase())).toBe(true);
    }
    expect(sameSourceFolder(join(folder, 'raw'), folder)).toBe(false);
  });

  it('does not let the signature hide behind a dropped index body', async () => {
    const folder = await makeFolder(FILES);
    const listingDir = await tempDir();
    // A file with a signature but no clips is not a usable index: the reader
    // keeps the signature, and the pipeline still requires clips to reuse it.
    await writeFile(
      join(listingDir, FOOTAGE_INDEX_FILE),
      JSON.stringify({ version: 1, sourceSignature: await folderSignature(folder), clips: [] }),
      'utf8',
    );

    const reloaded = await readFootageIndex(listingDir);
    expect(reloaded?.clips).toEqual([]);
    expect(reloaded?.sourceSignature?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
