// The vertical slice: a folder of clips → footage index → planned EDL → rendered video.
// A thin CLI over `services/pipeline`, so the script and the app run the same code.
// Usage: npx tsx scripts/make-video.ts <fixture-dir>

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ffmpegPath, probe } from '../packages/media/src/index';
import { listingId } from '../packages/core/src/index';
import type { Facts } from '../packages/planner/src/index';
import {
  analyseFolder,
  buildRequest,
  planEdl,
  renderEdl,
} from '../services/pipeline/service';

const root = resolve(import.meta.dirname, '..');
const folder = resolve(process.argv[2] ?? resolve(root, 'data', 'fixtures'));
const outDir = resolve(root, 'data', 'out');
mkdirSync(outDir, { recursive: true });

const indexPath = resolve(outDir, 'footage_index.json');
const edlPath = resolve(outDir, 'slice-edl.json');
const output = resolve(outDir, 'slice.mp4');

// 1. Index and score through the same service the app uses.
console.log('1/4 indexing', folder);
const { index, candidates } = await analyseFolder(folder, {
  onProgress: (progress) => {
    if (progress.detail) console.log(`    ${progress.stage} ${progress.percent}% ${progress.detail}`);
  },
});
writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`index: ${index.clips.length} clips, ${index.clips.reduce((s, c) => s + c.shots.length, 0)} shots`);

// 2. The candidate pool the planner will choose from.
console.log(`2/4 ${candidates.length} candidates from ${index.clips.length} clips`);

// 3. Plan.
const facts: Facts = {
  address: 'Marina Gate 1, Dubai Marina',
  price: 'AED 1,850,000',
  beds: 3,
  baths: 2,
  currency: 'AED',
};

const music = resolve(root, 'data', 'fixtures', 'music.m4a');
if (!existsSync(music)) {
  spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'aac', music], { windowsHide: true });
}

const request = buildRequest({
  listingId: listingId('Marina Gate 1, Dubai Marina', new Date('2026-11-15T10:00:00Z')),
  candidates,
  facts,
  music: { trackId: 'demo', src: music, beatGrid: [], gainDb: -6, duckUnderVoiceDb: -18 },
  profile: 'vertical-social',
  targetSec: 10,
  now: '2026-11-15T10:00:00.000Z',
});

const edl = planEdl(request);
writeFileSync(edlPath, JSON.stringify(edl, null, 2));
console.log(`3/4 planned ${edl.clips.length} clips, ${edl.clips.reduce((s, c) => s + (c.outSec - c.inSec) / c.speed, 0).toFixed(2)}s → ${basename(edlPath)}`);

// 4. Render a draft.
await renderEdl(edl, 'vertical-social', 'draft', output);

const info = await probe(output);
console.log(`4/4 rendered ${basename(output)}`);
console.log(JSON.stringify({ durationSec: info.durationSec, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio }, null, 2));
