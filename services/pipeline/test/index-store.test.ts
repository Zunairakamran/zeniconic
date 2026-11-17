import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FootageIndex, IndexedClip, IndexedShot } from '../indexer';
import {
  FOOTAGE_INDEX_FILE,
  IndexStoreError,
  TAGGED_INDEX_FILE,
  indexShotRows,
  readFootageIndex,
  writeFootageIndex,
} from '../index-store';
import type { IndexShotRow } from '../index-store';

const PROBE = {
  durationSec: 12,
  width: 1080,
  height: 1920,
  fps: 30,
  codec: 'h264',
  bitrate: 8_000_000,
  hasAudio: true,
  orientation: 'portrait' as const,
  rotation: 0,
};

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zeniconic-index-store-'));
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

function clip(id: string, file: string, shots: IndexedShot[]): IndexedClip {
  return {
    id,
    file,
    name: file.split('/').at(-1) ?? file,
    sha256: 'a'.repeat(64),
    probe: PROBE,
    frameSize: { width: 90, height: 160 },
    decodedFrames: 120,
    shots,
  };
}

function fixture(): FootageIndex {
  return {
    version: 1,
    generatedAt: '2026-11-16T09:00:00.000Z',
    frameSampling: {
      fps: 10,
      mode: 'per-orientation',
      portrait: { width: 90, height: 160 },
      landscape: { width: 160, height: 90 },
    },
    clips: [
      clip('s_aaaa1111', 'D:/raw/kitchen.mp4', [shot('s_aaaa1111_sh_000', 0, 3.5)]),
      clip('s_bbbb2222', 'D:/raw/living.mp4', [
        shot('s_bbbb2222_sh_000', 0, 2),
        shot('s_bbbb2222_sh_001', 2, 6.25),
      ]),
    ],
  };
}

describe('writeFootageIndex', () => {
  it('round-trips an untagged index', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listings', 'oak-avenue');

    const written = await writeFootageIndex(listingDir, fixture());

    expect(written).toBe(join(listingDir, FOOTAGE_INDEX_FILE));
    expect(existsSync(written)).toBe(true);

    const back = await readFootageIndex(listingDir);
    expect(back).toBeDefined();
    expect(back?.version).toBe(1);
    expect(back?.generatedAt).toBe('2026-11-16T09:00:00.000Z');
    expect(back?.frameSampling).toEqual(fixture().frameSampling);
    expect(back?.clips).toHaveLength(2);
    expect(back?.clips[0]?.id).toBe('s_aaaa1111');
    expect(back?.clips[0]?.sha256).toBe('a'.repeat(64));
    expect(back?.clips[0]?.probe).toEqual(PROBE);
    expect(back?.clips[1]?.shots).toHaveLength(2);
    expect(back?.clips[1]?.shots[1]?.endSec).toBe(6.25);
  });

  it('writes the tagged twin and keeps the two files independent', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listing');
    const tagged = fixture();
    const second = tagged.clips[1];
    if (second === undefined) throw new Error('fixture is wrong');
    second.shots[0] = {
      ...shot('s_bbbb2222_sh_000', 0, 2),
      tags: {
        room: 'living',
        cameraMove: 'static',
        sellingPoints: ['open_plan'],
        defects: [],
        score: 82,
        confidence: 0.9,
      },
    };

    const written = await writeFootageIndex(listingDir, tagged, { tagged: true });

    expect(written).toBe(join(listingDir, TAGGED_INDEX_FILE));
    expect(existsSync(written)).toBe(true);

    const taggedBack = await readFootageIndex(listingDir, { tagged: true });
    expect(taggedBack?.clips[1]?.shots[0]?.tags?.room).toBe('living');
    // The untagged name was never created, and never borrowed.
    expect(await readFootageIndex(listingDir)).toBeUndefined();
  });

  it('leaves no temporary file behind and stamps the write', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listing');

    await writeFootageIndex(listingDir, fixture());

    const names = await readdir(listingDir);
    expect(names).toEqual([FOOTAGE_INDEX_FILE]);
    expect(names.some((name) => name.endsWith('.tmp'))).toBe(false);

    const parsed = JSON.parse(await readFile(join(listingDir, FOOTAGE_INDEX_FILE), 'utf8')) as {
      version: number;
      savedAt: string;
      generatedAt: string;
      clips: unknown[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.generatedAt).toBe('2026-11-16T09:00:00.000Z');
    expect(Number.isNaN(Date.parse(parsed.savedAt))).toBe(false);
    expect(parsed.clips).toHaveLength(2);
  });

  it('creates the listing directory when it is missing', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'deep', 'nested', 'listing');

    await writeFootageIndex(listingDir, fixture());

    expect((await stat(listingDir)).isDirectory()).toBe(true);
  });

  it('replaces the file cleanly when written twice', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listing');
    const first = fixture();
    const second = fixture();
    second.generatedAt = '2026-11-17T11:00:00.000Z';
    second.clips = [clip('s_cccc3333', 'D:/raw/garden.mp4', [shot('s_cccc3333_sh_000', 1, 4)])];

    await writeFootageIndex(listingDir, first);
    await writeFootageIndex(listingDir, second);

    expect(await readdir(listingDir)).toEqual([FOOTAGE_INDEX_FILE]);
    const back = await readFootageIndex(listingDir);
    expect(back?.generatedAt).toBe('2026-11-17T11:00:00.000Z');
    expect(back?.clips.map((entry) => entry.id)).toEqual(['s_cccc3333']);
  });

  it('rejects a non-index with E_INDEX_INVALID', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listing');

    const bad = { version: 1, generatedAt: 'x', clips: 'nope' } as unknown as FootageIndex;
    await expect(writeFootageIndex(listingDir, bad)).rejects.toMatchObject({
      name: 'IndexStoreError',
      code: 'E_INDEX_INVALID',
    });
    expect(existsSync(join(listingDir, FOOTAGE_INDEX_FILE))).toBe(false);
  });

  it('rejects a shot whose window is not a window', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listing');
    const bad = fixture();
    const target = bad.clips[0];
    if (target === undefined) throw new Error('fixture is wrong');
    target.shots = [shot('s_aaaa1111_sh_000', 5, 5)];

    await expect(writeFootageIndex(listingDir, bad)).rejects.toBeInstanceOf(IndexStoreError);
    await expect(writeFootageIndex(listingDir, bad)).rejects.toMatchObject({
      code: 'E_INDEX_INVALID',
    });
    expect(await readdir(listingDir).catch(() => [])).toEqual([]);
  });

  it('rejects a clip without an id', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listing');
    const bad = fixture();
    const target = bad.clips[0];
    if (target === undefined) throw new Error('fixture is wrong');
    target.id = '   ';

    await expect(writeFootageIndex(listingDir, bad)).rejects.toMatchObject({
      code: 'E_INDEX_INVALID',
    });
  });
});

describe('readFootageIndex', () => {
  it('returns undefined for a missing file', async () => {
    const dir = await tempDir();

    expect(await readFootageIndex(join(dir, 'nothing-here'))).toBeUndefined();
    expect(await readFootageIndex(dir, { tagged: true })).toBeUndefined();
  });

  it('returns undefined for corrupt JSON', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, FOOTAGE_INDEX_FILE), '{"version": 1, "clips": [', 'utf8');

    expect(await readFootageIndex(dir)).toBeUndefined();
  });

  it('returns undefined when clips is not an array', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, FOOTAGE_INDEX_FILE), JSON.stringify({ version: 1, clips: {} }), 'utf8');

    expect(await readFootageIndex(dir)).toBeUndefined();
  });

  it('returns undefined for valid JSON that is not an object', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, FOOTAGE_INDEX_FILE), '"footage"', 'utf8');

    expect(await readFootageIndex(dir)).toBeUndefined();
  });

  it('drops malformed clips and shots instead of failing', async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    const raw = {
      version: 1,
      generatedAt: '2026-11-16T09:00:00.000Z',
      clips: [
        { id: 's_good0000', file: 'D:/raw/good.mp4', name: 'good.mp4', shots: [
          { id: 's_good0000_sh_000', startSec: 0, endSec: 2, durationSec: 2 },
          { id: '', startSec: 2, endSec: 4 },
          { id: 's_good0000_sh_002', startSec: 4, endSec: 4 },
          { id: 's_good0000_sh_003', startSec: 'x', endSec: 6 },
          { id: 's_good0000_sh_004', startSec: 6, endSec: 8 },
        ] },
        { file: 'D:/raw/no-id.mp4', shots: [] },
        { id: 's_nofile00', shots: [] },
        { id: 's_noshots0', file: 'D:/raw/x.mp4' },
        'nonsense',
        null,
      ],
    };
    await writeFile(join(dir, FOOTAGE_INDEX_FILE), JSON.stringify(raw), 'utf8');

    const back = await readFootageIndex(dir);
    expect(back).toBeDefined();
    expect(back?.clips).toHaveLength(1);
    expect(back?.clips[0]?.id).toBe('s_good0000');
    expect(back?.clips[0]?.shots.map((entry) => entry.id)).toEqual([
      's_good0000_sh_000',
      's_good0000_sh_004',
    ]);
    // durationSec is recomputed when the file omits it.
    expect(back?.clips[0]?.shots[1]?.durationSec).toBe(2);
  });

  it('survives a file written by hand without frameSampling or generatedAt', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, FOOTAGE_INDEX_FILE),
      JSON.stringify({ clips: [{ id: 's_x0000000', file: 'a.mp4', shots: [] }] }),
      'utf8',
    );

    const back = await readFootageIndex(dir);
    expect(back?.version).toBe(1);
    expect(back?.generatedAt).toBe('');
    expect(back?.frameSampling.fps).toBe(10);
    expect(back?.clips[0]?.name).toBe('a.mp4');
  });
});

describe('indexShotRows', () => {
  it('maps tags onto rows and falls back to unknown', () => {
    const index = fixture();
    const tagged = index.clips[1];
    if (tagged === undefined) throw new Error('fixture is wrong');
    tagged.shots[0] = {
      ...tagged.shots[0]!,
      tags: {
        room: 'kitchen',
        cameraMove: 'pan_right',
        sellingPoints: ['marble_island'],
        defects: ['shaky'],
        score: 74,
        confidence: 0.8,
      },
    };

    const rows = indexShotRows(index);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual<IndexShotRow>({
      shotId: 's_aaaa1111_sh_000',
      sourceId: 's_aaaa1111',
      room: 'unknown',
      startSec: 0,
      endSec: 3.5,
      src: 'D:/raw/kitchen.mp4',
    });
    expect(rows[0]).not.toHaveProperty('score');
    expect(rows[1]).toEqual<IndexShotRow>({
      shotId: 's_bbbb2222_sh_000',
      sourceId: 's_bbbb2222',
      room: 'kitchen',
      startSec: 0,
      endSec: 2,
      score: 0.74,
      src: 'D:/raw/living.mp4',
    });
    // The second shot of a tagged clip is still untagged.
    expect(rows[2]?.room).toBe('unknown');
  });

  it('falls back to the clip name when file is empty and clamps a wild score', () => {
    const index = fixture();
    const target = index.clips[0];
    if (target === undefined) throw new Error('fixture is wrong');
    target.file = '';
    target.shots[0] = {
      ...target.shots[0]!,
      // A hand-edited or model-produced file can hold junk; the reader must not
      // trust it into the agent context.
      tags: {
        room: '  ',
        cameraMove: 'static',
        sellingPoints: [],
        defects: [],
        score: 180,
        confidence: 1,
      } as unknown as NonNullable<IndexedShot['tags']>,
    };

    const rows = indexShotRows(index);

    expect(rows[0]?.src).toBe('kitchen.mp4');
    expect(rows[0]?.room).toBe('unknown');
    expect(rows[0]?.score).toBe(1);
  });

  it('returns an empty list for an index with no clips', () => {
    const index: FootageIndex = { ...fixture(), clips: [] };
    expect(indexShotRows(index)).toEqual([]);
  });
});

describe('round-trip through the tagged file', () => {
  it('keeps shot tags and rows identical to the written index', async () => {
    const dir = await tempDir();
    const listingDir = join(dir, 'listing');
    const index = fixture();
    const target = index.clips[0];
    if (target === undefined) throw new Error('fixture is wrong');
    target.shots[0] = {
      ...target.shots[0]!,
      tags: {
        room: 'kitchen',
        cameraMove: 'push_in',
        sellingPoints: ['island', 'light'],
        defects: [],
        bestInSec: 0.5,
        bestOutSec: 2.5,
        score: 91,
        confidence: 0.95,
      },
    };

    await writeFootageIndex(listingDir, index, { tagged: true });
    const back = await readFootageIndex(listingDir, { tagged: true });
    if (back === undefined) throw new Error('the tagged index did not read back');

    expect(indexShotRows(back)).toEqual(indexShotRows(index));
    expect(back.clips[0]?.shots[0]?.tags?.bestOutSec).toBe(2.5);
  });
});
