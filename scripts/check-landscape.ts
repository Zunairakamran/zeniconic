// QA: portrait footage into a 16:9 canvas (pad_blur), using the real EDL.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildRenderArgs, PROFILES } from '../packages/render/src/index';
import { ffmpegPath, probe } from '../packages/media/src/index';

const listingDir = resolve('data/listings/marina-gate-1');
const edlPath = join(listingDir, 'out', 'prototype-final.edl.json');
const edl = JSON.parse(readFileSync(edlPath, 'utf8'));
const output = join(listingDir, 'out', 'qa-landscape.mp4');

const argv = buildRenderArgs(edl, PROFILES.landscape, { quality: 'draft', output });
const res = spawnSync(ffmpegPath(), argv, { windowsHide: true, encoding: 'utf8' });
if (res.status !== 0) {
  console.error((res.stderr || '').split('\n').slice(-14).join('\n'));
  process.exit(1);
}
const info = await probe(output);
const frame = join(listingDir, 'out', 'qa-landscape-frame.jpg');
spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-ss', '6', '-i', output, '-frames:v', '1', frame], { windowsHide: true });
console.log(JSON.stringify({ output, width: info.width, height: info.height, durationSec: info.durationSec, frame, exists: existsSync(frame) }, null, 2));
