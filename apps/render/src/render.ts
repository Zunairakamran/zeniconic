/**
 * The render seam.
 *
 * Remotion draws picture plus burned captions to a silent H.264 MP4. FFmpeg
 * muxes the mastered audio afterwards and sets `+faststart`. Captions are only
 * burned when both the request and the EDL agree (`burn` or `both`).
 *
 * Media layout assumed by this module (and documented in apps/render/README.md):
 * `listingDir` is the bundle's public directory, and every EDL `src` is either
 * relative to it (`raw/01.mp4`, `cache/seg/seg_ab12.mp4`, `brand/logo.svg`) or
 * an absolute path inside it. Anything else becomes a gradient, never a 404.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { VideoConfig } from 'remotion';
import type { Edl } from '../../../packages/edl/src/types';
import {
  canvasDurationSec,
  layoutOverlays,
  staticMediaPath,
} from '../../../packages/overlays/src/index';
import type { BrandKit } from '../../../packages/overlays/src/index';
import { PROFILES } from '../../../packages/render/src/profiles';
import type { ProfileId } from '../../../packages/render/src/profiles';
import { canvasFor } from './canvas';
import { appRoot, renderEntry } from './chromium';
import { compositionId } from './Root';
import type { VideoProps } from './types';

export type OverlayQuality = 'draft' | 'standard' | 'high';

export interface RenderOverlayOptions {
  edl: Edl;
  profile: ProfileId;
  brand: BrandKit;
  /** Absolute path to the listing workspace; becomes Remotion's public dir. */
  listingDir: string;
  /** Absolute path to the MP4. */
  output: string;
  quality: OverlayQuality;
  captions: boolean;
}

export interface RenderOverlayResult {
  output: string;
  /** Duration of the rendered picture, in seconds. */
  durationSec: number;
}

interface QualityPreset {
  scale: number;
  crf: number;
  jpegQuality: number;
  concurrency: number;
}

function presetFor(quality: OverlayQuality): QualityPreset {
  const cores = Math.max(1, cpus().length);
  const half = Math.max(1, Math.floor(cores / 2));

  switch (quality) {
    case 'draft':
      // Half scale, cheap intermediates: for chat edits and shot review.
      return { scale: 0.5, crf: 28, jpegQuality: 78, concurrency: 2 };
    case 'high':
      return { scale: 1, crf: 18, jpegQuality: 92, concurrency: half };
    case 'standard':
    default:
      return { scale: 1, crf: 23, jpegQuality: 85, concurrency: Math.min(4, half) };
  }
}

function assertInputs(options: RenderOverlayOptions, expected: 'video' | 'still' = 'video'): void {
  if (!PROFILES[options.profile]) {
    throw new Error(`Unknown render profile "${options.profile}".`);
  }
  if (!existsSync(options.listingDir)) {
    throw new Error(`Listing workspace does not exist: ${options.listingDir}`);
  }
  if (expected === 'video' && !options.output.toLowerCase().endsWith('.mp4')) {
    throw new Error(`Output must be an .mp4 file: ${options.output}`);
  }

  const canvas = canvasFor(options.edl, options.profile);
  const { issues } = layoutOverlays(options.edl, canvas);
  if (issues.length > 0) {
    // Refuse rather than ship clipped text.
    throw new Error(
      `The overlay layout does not fit the ${options.profile} safe area:\n- ${issues.join('\n- ')}`,
    );
  }
}

/** Clips that cannot be reached through the bundle's public directory. */
export function missingClips(edl: Edl, listingDir: string): string[] {
  return edl.clips
    .filter((clip) => {
      const relative = staticMediaPath(clip.src, listingDir);
      if (relative === null) return true;
      return !existsSync(join(listingDir, relative));
    })
    .map((clip) => clip.id);
}

function shouldBurnCaptions(edl: Edl, requested: boolean): boolean {
  if (!requested) return false;
  return edl.captions.mode === 'burn' || edl.captions.mode === 'both';
}

function propsFor(options: RenderOverlayOptions): VideoProps {
  return {
    edl: options.edl,
    profile: options.profile,
    brand: options.brand,
    captions: shouldBurnCaptions(options.edl, options.captions),
    listingDir: options.listingDir,
    missingClipIds: missingClips(options.edl, options.listingDir),
  };
}

interface Prepared {
  serveUrl: string;
  composition: VideoConfig;
  inputProps: Record<string, unknown>;
  cleanup: () => Promise<void>;
}

async function prepare(options: RenderOverlayOptions): Promise<Prepared> {
  const bundleDir = await mkdtemp(join(tmpdir(), 'zeniconic-bundle-'));
  const cleanup = async (): Promise<void> => {
    await rm(bundleDir, { recursive: true, force: true });
  };

  try {
    const serveUrl = await bundle({
      entryPoint: renderEntry(),
      publicDir: options.listingDir,
      outDir: bundleDir,
      onProgress: () => undefined,
    });

    const inputProps: Record<string, unknown> = { ...propsFor(options) };
    const chromiumOptions = { gl: 'swangle' } as const;

    const composition = await selectComposition({
      serveUrl,
      id: compositionId(options.profile),
      inputProps,
      chromiumOptions,
    });

    return { serveUrl, composition, inputProps, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/**
 * Renders the overlay layer to a silent MP4 and returns its picture duration.
 * Audio is deliberately absent: the FFmpeg stage owns music, voice and loudness.
 */
export async function renderOverlayVideo(options: RenderOverlayOptions): Promise<RenderOverlayResult> {
  assertInputs(options);
  await mkdir(dirname(options.output), { recursive: true });

  const preset = presetFor(options.quality);
  const prepared = await prepare(options);

  try {
    await renderMedia({
      serveUrl: prepared.serveUrl,
      composition: prepared.composition,
      inputProps: prepared.inputProps,
      outputLocation: options.output,
      codec: 'h264',
      pixelFormat: 'yuv420p',
      imageFormat: 'jpeg',
      jpegQuality: preset.jpegQuality,
      crf: preset.crf,
      x264Preset: 'veryfast',
      scale: preset.scale,
      concurrency: preset.concurrency,
      muted: true,
      overwrite: true,
      chromiumOptions: { gl: 'swangle' },
    });

    const { durationInFrames, fps } = prepared.composition;
    return { output: options.output, durationSec: durationInFrames / fps };
  } finally {
    await prepared.cleanup();
  }
}

/**
 * One still, used by the snapshot/smoke path. It shares the bundle and props
 * with the video render so a still cannot show a different layout.
 */
export async function renderOverlayStill(
  options: RenderOverlayOptions,
  frame: number,
): Promise<{ output: string; durationSec: number }> {
  assertInputs(options, 'still');
  await mkdir(dirname(options.output), { recursive: true });

  const prepared = await prepare(options);
  try {
    if (frame < 0 || frame >= prepared.composition.durationInFrames) {
      throw new RangeError(
        `Frame ${frame} is outside the composition (0–${prepared.composition.durationInFrames - 1}).`,
      );
    }

    await renderStill({
      serveUrl: prepared.serveUrl,
      composition: prepared.composition,
      inputProps: prepared.inputProps,
      output: options.output,
      frame,
      imageFormat: 'jpeg',
      jpegQuality: 90,
      overwrite: true,
      chromiumOptions: { gl: 'swangle' },
    });

    const { durationInFrames, fps } = prepared.composition;
    return { output: options.output, durationSec: durationInFrames / fps };
  } finally {
    await prepared.cleanup();
  }
}

/** Duration the composition will be cut to, without opening a browser. */
export function overlayDurationSec(edl: Edl): number {
  return canvasDurationSec(edl);
}

export { appRoot };
