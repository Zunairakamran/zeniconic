/**
 * The draft preview is a real render, so these tests run FFmpeg.
 *
 * They prove the four things the desktop depends on: a file exists and is the
 * right length, the draft canvas is the profile's half-size (never a stretch),
 * a price overlay is genuinely burned (pixel difference against the same edit
 * without overlays), and a missing source is a typed `E_SOURCE` naming the
 * clip. Every source is 160x284 and just over a second, so the suite is quick.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { validateEdl } from '../../../packages/edl/src/index';
import type { Edl, Overlay } from '../../../packages/edl/src/index';
import { readFrames } from '../../../packages/media/src/index';
import { PreviewError, draftCanvas, renderPreview, selectPreviewProfile } from '../src/index';

const FONTS_DIR = join(process.cwd(), 'apps', 'desktop', 'electron', 'assets', 'fonts');
const SOURCE_WIDTH = 160;
const SOURCE_HEIGHT = 284;

/** 5 cuts x 0.96 s = 4.800 s; the EDL schema's minimum target is 5 s ± 0.5 s. */
const CLIP_SEC = 0.96;
const CLIP_COUNT = 5;
const EDL_DURATION_SEC = CLIP_SEC * CLIP_COUNT;

let root = '';
let listingDir = '';
let absoluteClip = '';

function ffmpeg(args: string[]): void {
  if (typeof ffmpegStatic !== 'string' || ffmpegStatic.length === 0) {
    throw new Error('ffmpeg-static did not resolve; run "npm install".');
  }
  const result = spawnSync(ffmpegStatic, args, { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${String(result.status)}): ${result.stderr ?? ''}`);
  }
}

/** One flat-colour source at the source profile size. */
function makeClip(path: string, colour: string): void {
  ffmpeg([
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${colour}:s=${String(SOURCE_WIDTH)}x${String(SOURCE_HEIGHT)}:r=30:d=1.2`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

function priceOverlay(): Overlay {
  return {
    id: 'o01',
    kind: 'price',
    text: 'AED 1,250,000',
    subtext: '3 bed · 2 bath',
    inSec: 0.2,
    outSec: 4.4,
    anchor: 'bottom_center',
    style: 'price_lower',
    maxWidthPct: 84,
    opacity: 1,
    animation: 'count_up',
  };
}

/**
 * A valid 2.0.0 document: five cuts totalling 4.800 s, one price overlay, no
 * music (a preview may be silent). Sources are deliberately mixed so all three
 * resolver rules are exercised: listing-relative flat, listing-relative `raw/`
 * and an absolute path.
 */
function buildEdl(options: { overlays: Overlay[] }): Edl {
  const sources: Array<{ id: string; sourceId: string; src: string; room: 'exterior' | 'living' | 'kitchen' }> = [
    { id: 'c01', sourceId: 's_4f2a1b9c', src: 'a.mp4', room: 'exterior' },
    { id: 'c02', sourceId: 's_8ba1c02d', src: 'b.mp4', room: 'living' },
    { id: 'c03', sourceId: 's_c71e9a44', src: absoluteClip, room: 'kitchen' },
    { id: 'c04', sourceId: 's_4f2a1b9c', src: 'a.mp4', room: 'exterior' },
    { id: 'c05', sourceId: 's_8ba1c02d', src: 'b.mp4', room: 'living' },
  ];

  return {
    edlVersion: '2.0.0',
    id: 'edl_preview-fixture_v1',
    listingId: 'preview-fixture',
    createdAt: '2026-11-17T10:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 5 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips: sources.slice(0, CLIP_COUNT).map((source, index) => ({
      ...source,
      inSec: 0,
      outSec: CLIP_SEC,
      speed: 1,
      volumeDb: 0,
      transform: {
        mode: 'cover' as const,
        focus: 'center' as const,
        path: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }],
      },
      transitionIn: { type: 'cut' as const, durationSec: 0 },
      reason: `preview fixture clip ${String(index + 1)}`,
    })),
    overlays: options.overlays,
    audio: {
      music: { trackId: 'none', src: '', gainDb: 0, duckUnderVoiceDb: 0, beatGrid: [] },
      voice: { mode: 'mute' },
      mix: { lufs: -14 },
    },
    captions: { mode: 'none', language: 'en-GB', words: [] },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'test', planning: 'test' },
      promptVersions: { tagging: 'test', planning: 'test' },
      costUsd: 0,
    },
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zeniconic-preview-'));
  listingDir = join(root, 'listing');
  await mkdir(join(listingDir, 'raw'), { recursive: true });

  makeClip(join(listingDir, 'a.mp4'), '0x335577');
  makeClip(join(listingDir, 'raw', 'b.mp4'), '0x775533');
  absoluteClip = join(root, 'c.mp4');
  makeClip(absoluteClip, '0x557733');
}, 60_000);

afterAll(async () => {
  if (root.length > 0) await rm(root, { recursive: true, force: true });
});

describe('renderPreview', () => {
  it('renders a valid 2.0.0 EDL to a probed draft file', async () => {
    const edl = buildEdl({ overlays: [priceOverlay()] });
    const check = validateEdl(edl);
    expect(check.issues).toEqual([]);
    expect(check.valid).toBe(true);

    const output = join(root, 'out', 'draft.mp4');
    const result = await renderPreview(
      { edl, listingDir, output, width: 540, fontsDir: FONTS_DIR },
      {},
    );

    // The draft rung of vertical-social is 540x960: half the profile canvas,
    // never stretched beyond it, and never above the EDL's own canvas.
    expect(result.path).toBe(resolve(output));
    expect(result.width).toBe(540);
    expect(result.height).toBe(960);
    expect(result.width).toBeLessThanOrEqual(edl.canvas.width);
    expect(result.height).toBeLessThanOrEqual(edl.canvas.height);
    expect(draftCanvas('vertical-social')).toEqual({ width: 540, height: 960 });

    // Every clip is 0.960 s; the probed file must match the document.
    expect(Math.abs(result.durationSec - EDL_DURATION_SEC)).toBeLessThanOrEqual(0.35);
    expect(result.renderedOverlays).toBe(true);
    expect(result.warnings).toEqual([]);

    const info = await stat(result.path);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBeGreaterThan(1000);
  }, 60_000);

  it('burns the price overlay onto the picture (real drawtext pass)', async () => {
    const plain = buildEdl({ overlays: [] });

    const withText = await renderPreview(
      {
        edl: buildEdl({ overlays: [priceOverlay()] }),
        listingDir,
        output: join(root, 'out', 'with-text.mp4'),
        width: 540,
        fontsDir: FONTS_DIR,
      },
      {},
    );
    const withoutText = await renderPreview(
      {
        edl: plain,
        listingDir,
        output: join(root, 'out', 'plain.mp4'),
        width: 540,
        fontsDir: FONTS_DIR,
      },
      {},
    );

    expect(withText.renderedOverlays).toBe(true);
    expect(withoutText.renderedOverlays).toBe(false);
    // Same duration, same canvas: only the text differs.
    expect(withText.width).toBe(withoutText.width);
    expect(withText.height).toBe(withoutText.height);
    expect(Math.abs(withText.durationSec - withoutText.durationSec)).toBeLessThan(0.1);

    // Decode both to 108x192 grey and take the largest per-frame difference.
    // The paper-coloured price card is a large luminance change against the
    // flat source, so a real burn is far above the noise floor of two encodes
    // of the same picture. Comparing the best frame keeps the assertion
    // independent of frame-rate rounding.
    const [withFrames, plainFrames] = await Promise.all([
      greyFrames(withText.path),
      greyFrames(withoutText.path),
    ]);
    expect(withFrames.length).toBeGreaterThan(2);
    expect(plainFrames.length).toBe(withFrames.length);

    let largest = 0;
    for (let frame = 0; frame < withFrames.length; frame += 1) {
      const a = withFrames[frame]!;
      const b = plainFrames[frame]!;
      let difference = 0;
      for (let index = 0; index < a.length; index += 1) {
        difference += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
      }
      largest = Math.max(largest, difference);
    }
    expect(largest).toBeGreaterThan(500);
  }, 90_000);

  it('throws E_SOURCE naming the clip and the paths it tried', async () => {
    const edl = buildEdl({ overlays: [] });
    const broken: Edl = {
      ...edl,
      clips: edl.clips.map((clip) =>
        clip.id === 'c02' ? { ...clip, src: 'missing-living.mp4' } : clip,
      ),
    };
    const output = join(root, 'out', 'never.mp4');

    let caught: unknown;
    try {
      await renderPreview({ edl: broken, listingDir, output, fontsDir: FONTS_DIR }, {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PreviewError);
    const error = caught as PreviewError;
    expect(error.code).toBe('E_SOURCE');
    expect(error.context.clipId).toBe('c02');
    expect(error.message).toContain('c02');
    expect(error.context.tried).toEqual([
      join(listingDir, 'missing-living.mp4'),
      join(listingDir, 'raw', 'missing-living.mp4'),
    ]);
    // Nothing was written for a document that cannot render.
    await expect(stat(output)).rejects.toThrow();
  }, 30_000);

  it('creates the output directory when it does not exist', async () => {
    const output = join(root, 'fresh', 'nested', 'another', 'draft.mp4');
    const result = await renderPreview(
      {
        edl: buildEdl({ overlays: [] }),
        listingDir,
        output,
        width: 540,
        fontsDir: FONTS_DIR,
      },
      {},
    );
    expect((await stat(result.path)).isFile()).toBe(true);
    expect(result.renderedOverlays).toBe(false);
  }, 60_000);
});

describe('selectPreviewProfile', () => {
  it('keeps the EDL profile when the cap fits the draft rung', () => {
    const choice = selectPreviewProfile('vertical-social', 540);
    expect(choice.profile).toBe('vertical-social');
    expect(choice.warnings).toEqual([]);
    expect(draftCanvas(choice.profile)).toEqual({ width: 540, height: 960 });
    // A cap above the rung does not upscale.
    expect(selectPreviewProfile('vertical-social', 2000).profile).toBe('vertical-social');
  });

  it('never stretches: an impossible cap keeps the profile and warns', () => {
    const choice = selectPreviewProfile('vertical-social', 300);
    expect(choice.profile).toBe('vertical-social');
    expect(choice.warnings.join(' ')).toMatch(/never stretches/i);
  });

  it('falls back to vertical-social for an unknown canvas profile', () => {
    const choice = selectPreviewProfile('square-ish');
    expect(choice.profile).toBe('vertical-social');
    expect(choice.warnings.join(' ')).toMatch(/unknown canvas profile/i);
  });
});

/** Decoded grey frames at 108x192 for the pixel comparison. */
async function greyFrames(file: string): Promise<Uint8Array[]> {
  const frames: Uint8Array[] = [];
  for await (const frame of readFrames(file, { width: 108, height: 192, fps: 2, limit: 8 })) {
    frames.push(frame.gray);
  }
  return frames;
}
