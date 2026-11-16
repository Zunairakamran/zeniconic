import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Edl } from '../../../packages/edl/src/types';
import example from '../../../packages/edl/example.edl.json';
import type { BrandKit } from '../../../packages/overlays/src/index';
import { chromiumAvailable } from '../src/chromium';
import { missingClips, renderOverlayStill } from '../src/render';

const EXAMPLE = example as unknown as Edl;
const LISTING = fileURLToPath(new URL('../../../data/fixtures/', import.meta.url));
const BRAND: BrandKit = { agentName: 'Sara Whitfield', agency: 'Whitfield & Co' };

const chromiumReady = chromiumAvailable();
const temporaryDirs: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('missingClips', () => {
  it('finds clips whose relative source is not in the listing workspace', () => {
    const missing = missingClips(EXAMPLE, LISTING);
    expect(missing.length).toBe(EXAMPLE.clips.length);
    expect(missing[0]).toBe('c01');
  });
});

describe.skipIf(!chromiumReady)('renderOverlayStill — smoke', () => {
  it('renders one frame of the example EDL to a JPEG', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zeniconic-still-'));
    temporaryDirs.push(dir);
    const output = join(dir, 'example-frame-45.jpg');

    const result = await renderOverlayStill(
      {
        edl: EXAMPLE,
        profile: 'vertical-social',
        brand: BRAND,
        listingDir: LISTING,
        output,
        quality: 'draft',
        captions: true,
      },
      45,
    );

    expect(result.output).toBe(output);
    expect(result.durationSec).toBeCloseTo(30, 5);
    expect(existsSync(output)).toBe(true);

    const info = await stat(output);
    expect(info.size).toBeGreaterThan(10_000);
  }, 240_000);
});
