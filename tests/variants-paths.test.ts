/**
 * H7: variant EDL paths are persisted relative to the listing workspace.
 *
 * Moving the data directory to another drive (or another PC) must not break
 * `variants:list` or previews. Older absolute paths are still readable while
 * the file exists, and the next write stores the relative form.
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import example from '../packages/edl/example.edl.json';
import {
  readVariantEdl,
  readVariants,
  saveVariants,
  resolveVariantEdlPath,
} from '../apps/desktop/variants';
import type { Edl } from '../packages/edl/src/index';

const EDL = example as unknown as Edl;

let root: string;

async function writeListing(dir: string, edlPath: string): Promise<void> {
  await mkdir(join(dir, 'variants'), { recursive: true });
  await writeFile(join(dir, 'variants', 'calm.json'), `${JSON.stringify(EDL, null, 2)}\n`, 'utf8');
  await writeFile(
    join(dir, 'variants', 'variants.json'),
    `${JSON.stringify(
      {
        version: 1,
        variants: [
          {
            id: 'calm',
            look: 'calm',
            format: EDL.format.id,
            targetDurationSec: EDL.format.targetDurationSec,
            clipCount: EDL.clips.length,
            score: 80,
            edlPath,
            approved: true,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'zeniconic-variants-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('variant EDL paths', () => {
  it('keeps a listing readable after it is copied to a different root', async () => {
    const first = join(root, 'machine-a', 'listings', '2026-01-01-flat');
    await writeListing(first, 'variants/calm.json');

    const moved = join(root, 'machine-b', 'listings', '2026-01-01-flat');
    await cp(first, moved, { recursive: true });

    const variants = await readVariants(moved);
    expect(variants).toHaveLength(1);
    expect(variants[0]?.edlPath).toBe('variants/calm.json');
    expect(variants[0]?.edlPath.includes(':')).toBe(false);

    const edl = await readVariantEdl(moved, 'calm');
    expect(edl.id).toBe(EDL.id);
  });

  it('falls back to the canonical file when a legacy absolute path moved', async () => {
    // An old build stored the absolute path of machine A. The listing is then
    // copied to machine B, where that path no longer exists.
    const first = join(root, 'machine-a', 'listings', '2026-01-01-flat');
    await writeListing(first, join(first, 'variants', 'calm.json'));

    const moved = join(root, 'machine-b', 'listings', '2026-01-01-flat');
    await cp(first, moved, { recursive: true });
    await rm(join(root, 'machine-a'), { recursive: true, force: true });

    const variants = await readVariants(moved);
    expect(variants[0]?.edlPath.includes(':')).toBe(true);

    const resolved = await resolveVariantEdlPath(moved, variants[0]!);
    expect(resolved).toBe(join(moved, 'variants', 'calm.json'));

    const edl = await readVariantEdl(moved, 'calm');
    expect(edl.id).toBe(EDL.id);
  });

  it('writes the relative form on save and does not auto-approve a plan', async () => {
    const dir = join(root, 'listings', '2026-01-01-flat');
    await mkdir(dir, { recursive: true });

    const saved = await saveVariants(dir, [
      {
        summary: {
          id: 'calm',
          look: 'calm',
          format: EDL.format.id,
          targetDurationSec: EDL.format.targetDurationSec,
          clipCount: EDL.clips.length,
          score: 80,
          edlPath: '',
          approved: false,
        },
        edl: EDL,
      },
    ]);

    expect(saved).toHaveLength(1);
    expect(saved[0]?.edlPath).toBe('variants/calm.json');
    expect(saved[0]?.approved).toBe(false);

    const stored = JSON.parse(await readFile(join(dir, 'variants', 'variants.json'), 'utf8')) as {
      variants: Array<{ edlPath: string }>;
    };
    expect(stored.variants[0]?.edlPath).toBe('variants/calm.json');
  });
});
