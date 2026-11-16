// Step 8 of docs/BUILD.md: one real render through buildRenderArgs.
// Usage: npx tsx scripts/render-demo.ts

import { mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildRenderArgs, PROFILES } from '../packages/render/src/index';
import { ffmpegPath, probe } from '../packages/media/src/index';
import type { Edl } from '../packages/edl/src/index';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'data', 'out');
mkdirSync(outDir, { recursive: true });

const fixtures = ['landscape.mp4', 'portrait.mp4', 'bars.mp4'].map((name) => resolve(root, 'data', 'fixtures', name));
for (const file of fixtures) {
  if (!existsSync(file)) {
    console.error(`Missing fixture ${file}. Generate it with ffmpeg first.`);
    process.exit(1);
  }
}

const music = resolve(root, 'data', 'fixtures', 'music.m4a');
if (!existsSync(music)) {
  const gen = spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'aac', '-b:a', '128k', music], { windowsHide: true });
  if (gen.status !== 0) {
    console.error('Could not generate the music fixture.');
    process.exit(1);
  }
}

const clip = (id: string, src: string, inSec: number, outSec: number, room: Edl['clips'][number]['room']): Edl['clips'][number] => ({
  id,
  sourceId: 's_0000000' + id.slice(-1),
  src,
  inSec,
  outSec,
  speed: 1,
  volumeDb: -60,
  room,
  transform: { mode: 'cover', focus: 'center', path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }, { t: 1, x: 0.5, y: 0.5, scale: 1.06 }] },
  transitionIn: { type: 'cut', durationSec: 0 },
  reason: 'fixture shot for the L4 render gate',
});

const edl: Edl = {
  edlVersion: '1.0.0',
  id: 'edl_render-demo_v1',
  listingId: '2026-11-15-render-demo',
  createdAt: '2026-11-15T00:00:00.000Z',
  format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 5 },
  look: { id: 'calm', label: 'Calm' },
  canvas: { profile: 'landscape', width: 1920, height: 1080, fps: 30, safeArea: { top: 0, bottom: 0, left: 0, right: 0 } },
  clips: [
    clip('c01', fixtures[0]!, 0, 1.7, 'exterior'),
    clip('c02', fixtures[1]!, 0, 1.7, 'living'),
    clip('c03', fixtures[2]!, 0, 1.6, 'kitchen'),
  ],
  overlays: [],
  audio: {
    music: { trackId: 'demo', src: music, gainDb: -6, duckUnderVoiceDb: 0, beatGrid: [] },
    voice: { mode: 'mute' },
    mix: { lufs: -16, truePeakDbtp: -1.5 },
  },
  captions: { mode: 'none' },
  provenance: {
    pipelineVersion: '0.1.0',
    models: { tagging: 'n/a', planning: 'local-manual' },
    promptVersions: { tagging: 'n/a', planning: 'n/a' },
    costUsd: 0,
  },
};

const output = resolve(outDir, 'demo-landscape.mp4');
const args = buildRenderArgs(edl, PROFILES.landscape, { quality: 'draft', output });

console.log('argv tokens:', args.length);
console.log('output:', output);

const started = Date.now();
const result = spawnSync(ffmpegPath(), args, { windowsHide: true, encoding: 'utf8' });
const elapsed = Date.now() - started;

if (result.status !== 0) {
  console.error('Render failed.\n', (result.stderr || '').split('\n').slice(-18).join('\n'));
  process.exit(1);
}

const info = await probe(output);
console.log(`rendered in ${(elapsed / 1000).toFixed(1)}s`);
console.log(JSON.stringify({ durationSec: info.durationSec, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio }, null, 2));
