/**
 * Live draft-preview smoke: a real ffmpeg render into `<data>/previews`, then
 * the `zeniconic-media` response path serving it (full + byte range).
 *
 * Usage: npx tsx scripts/refine-preview-smoke.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { validateEdl } from '../packages/edl/src/index';
import type { Edl } from '../packages/edl/src/index';
import { probe } from '../packages/media/src/index';
import { renderPreview } from '../services/preview/src/index';
import { previewResponse } from '../apps/desktop/media-protocol';

const ROOT = resolve('data/tmp/refine-preview-smoke');
const LISTING = join(ROOT, 'listing');
const PREVIEWS = join(ROOT, 'previews');
const FONTS = join('apps', 'desktop', 'electron', 'assets', 'fonts');

function ffmpeg(args: string[]): void {
  if (typeof ffmpegStatic !== 'string') throw new Error('ffmpeg-static is unavailable.');
  const result = spawnSync(ffmpegStatic, args, { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr ?? ''}`);
}

function makeClip(path: string): void {
  ffmpeg([
    '-y', '-v', 'error', '-f', 'lavfi',
    '-i', 'color=c=0x335577:s=160x284:r=30:d=1.2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path,
  ]);
}

function buildEdl(): Edl {
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `c0${String(index + 1)}`,
    sourceId: `s_${String(index).padStart(8, '0')}`,
    src: 'a.mp4',
    room: 'living' as const,
    inSec: 0,
    outSec: 0.96,
    speed: 1,
    volumeDb: 0,
    transform: {
      mode: 'cover' as const,
      focus: 'center' as const,
      path: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }],
    },
    transitionIn: { type: 'cut' as const, durationSec: 0 },
    reason: `preview smoke clip ${String(index + 1)}`,
  }));

  return {
    edlVersion: '2.0.0',
    id: 'edl_refine-preview-smoke_v1',
    listingId: 'refine-preview-smoke',
    createdAt: '2026-11-17T10:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 5 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social', width: 1080, height: 1920, fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips,
    overlays: [{
      id: 'o01', kind: 'price', text: 'AED 1,250,000', subtext: '3 bed \u00b7 2 bath',
      inSec: 0.2, outSec: 4.4, anchor: 'bottom_center', style: 'price_lower',
      maxWidthPct: 84, opacity: 1, animation: 'count_up',
    }],
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
  } as Edl;
}

async function main(): Promise<void> {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(LISTING, { recursive: true });
  makeClip(join(LISTING, 'a.mp4'));

  const edl = buildEdl();
  const check = validateEdl(edl);
  if (!check.valid) throw new Error(`Fixture EDL is invalid: ${JSON.stringify(check.issues)}`);

  const output = join(PREVIEWS, 'calm-v3-smoke.mp4');
  const rendered = await renderPreview({
    edl, listingDir: LISTING, output, width: 540, fontsDir: FONTS,
  });
  const info = await probe(rendered.path);
  const bytes = (await stat(rendered.path)).size;

  const full = await previewResponse(PREVIEWS, 'zeniconic-media://preview/calm-v3-smoke.mp4', null);
  const ranged = await previewResponse(
    PREVIEWS,
    'zeniconic-media://preview/calm-v3-smoke.mp4',
    'bytes=0-99',
  );
  const body = new Uint8Array(await ranged.arrayBuffer());

  console.log(JSON.stringify({
    rendered: rendered.path,
    width: info.width,
    height: info.height,
    durationSec: rendered.durationSec,
    bytes,
    fullStatus: full.status,
    fullLength: full.headers.get('content-length'),
    rangeStatus: ranged.status,
    rangeLength: ranged.headers.get('content-length'),
    contentRange: ranged.headers.get('content-range'),
    rangeBytes: body.length,
  }, null, 2));

  if (info.width !== 540 || info.height !== 960) throw new Error('Draft is not 540x960.');
  if (Math.abs(rendered.durationSec - 4.8) > 0.35) throw new Error('Draft duration is wrong.');
  if (full.status !== 200 || full.headers.get('content-length') !== String(bytes)) {
    throw new Error('Full preview response is wrong.');
  }
  if (ranged.status !== 206 || body.length !== 100) throw new Error('Range response is wrong.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
