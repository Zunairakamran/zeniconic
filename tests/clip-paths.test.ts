/**
 * EDL clip paths resolve once, against the four legitimate shapes:
 * absolute, listing-relative, listing `raw/`-relative and repo-relative.
 * A missing file raises the named `ClipSourceError`, never an ffmpeg crash.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClipSourceError, DesktopPipeline } from '../apps/desktop/pipeline';
import type { Store } from '../packages/store/src/index';

interface Resolver {
  resolveClipSource(clipId: string, src: string, listingDir: string): Promise<string>;
}

let root: string;
let resolver: Resolver;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'zeniconic-clip-paths-'));
  const pipeline = new DesktopPipeline({
    store: {} as Store,
    dataDir: join(root, 'data'),
    repoRoot: join(root, 'repo'),
  });
  resolver = pipeline as unknown as Resolver;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('clip source resolution', () => {
  it('accepts a raw/-relative clip (the EDL contract)', async () => {
    const listing = join(root, 'listings', '2026-01-01-flat');
    await mkdir(join(listing, 'raw'), { recursive: true });
    await writeFile(join(listing, 'raw', 'living.mp4'), 'x');

    await expect(resolver.resolveClipSource('c01', 'living.mp4', listing)).resolves.toBe(
      join(listing, 'raw', 'living.mp4'),
    );
  });

  it('accepts listing- and repo-relative clips and absolute paths', async () => {
    const listing = join(root, 'listings', '2026-01-01-flat');
    await mkdir(join(listing, 'raw'), { recursive: true });
    await mkdir(join(root, 'repo', 'data', 'listings', 'flat', 'raw'), { recursive: true });
    await writeFile(join(listing, 'raw', 'kitchen.mp4'), 'x');
    await writeFile(join(root, 'repo', 'data', 'listings', 'flat', 'raw', 'exterior.mp4'), 'x');
    await writeFile(join(root, 'elsewhere.mp4'), 'x');

    await expect(resolver.resolveClipSource('c02', 'raw/kitchen.mp4', listing)).resolves.toBe(
      join(listing, 'raw', 'kitchen.mp4'),
    );
    await expect(
      resolver.resolveClipSource('c03', 'data/listings/flat/raw/exterior.mp4', listing),
    ).resolves.toBe(join(root, 'repo', 'data', 'listings', 'flat', 'raw', 'exterior.mp4'));
    await expect(
      resolver.resolveClipSource('c04', join(root, 'elsewhere.mp4'), listing),
    ).resolves.toBe(join(root, 'elsewhere.mp4'));
  });

  it('names the clip and the src when no candidate exists', async () => {
    const listing = join(root, 'listings', '2026-01-01-flat');
    await mkdir(listing, { recursive: true });

    const error = await resolver
      .resolveClipSource('c07', 'raw/missing.mp4', listing)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ClipSourceError);
    expect((error as ClipSourceError).name).toBe('ClipSourceError');
    expect((error as ClipSourceError).clipId).toBe('c07');
    expect((error as ClipSourceError).message).toContain('raw/missing.mp4');
  });
});
