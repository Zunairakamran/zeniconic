// Final assembly: transitions + captions + hybrid audio → one deliverable.
// Usage: npx tsx scripts/finalize-prototype.ts <listingDir>

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ffmpegPath, probe } from '../packages/media/src/index';
import { validateEdl } from '../packages/edl/src/index';

const listingDir = resolve(process.argv[2] ?? 'data/listings/marina-gate-1');
const outDir = join(listingDir, 'out');
const edlPath = join(outDir, 'prototype.edl.json');
if (!existsSync(edlPath)) throw new Error(`Missing ${edlPath}`);

type Word = { text: string; startSec: number; endSec: number };
type Caption = { text: string; startSec: number; endSec: number };

const edl = JSON.parse(readFileSync(edlPath, 'utf8'));

// 1. Crossfades: a 0.35 s dissolve on every cut after the first. The Remotion
//    composition overlaps the sequences, so this is a real crossfade.
edl.clips.forEach((clip: { transitionIn: unknown }, i: number) => {
  clip.transitionIn = i === 0 ? { type: 'cut', durationSec: 0 } : { type: 'dissolve', durationSec: 0.35 };
});

// 2. Captions: phrase-level timings from the hybrid voice build, expanded to
//    word-level so the renderer can lay out two lines and highlight the cue.
const captionsPath = [join(outDir, 'audio', 'final-captions.json'), join(outDir, 'audio', 'captions.json')].find((p) => existsSync(p)) ?? join(outDir, 'audio', 'captions.json');
const captions: Caption[] = existsSync(captionsPath) ? JSON.parse(readFileSync(captionsPath, 'utf8')) : [];
// The end card carries price and contact; a caption on top of it is noise.
const spokenCaptions = captions.filter((c) => c.startSec < 23.5);
// Room labels were a bridge before captions existed; together they collide.
edl.overlays = edl.overlays.filter((o: { kind: string }) => o.kind !== 'room_label');
const words: Word[] = [];
let previousEnd = 0;
for (const caption of spokenCaptions) {
  // Audio may overlap by a few hundred ms; captions may not. Clamp forward.
  caption.startSec = Math.max(caption.startSec, previousEnd);
  if (caption.endSec <= caption.startSec) caption.endSec = caption.startSec + 0.8;
  previousEnd = caption.endSec;
  const parts = caption.text.trim().split(/\s+/);
  const totalChars = parts.reduce((n, p) => n + p.length + 1, 0);
  let cursor = caption.startSec;
  for (const part of parts) {
    const share = ((part.length + 1) / totalChars) * (caption.endSec - caption.startSec);
    words.push({
      text: part,
      startSec: Math.round(cursor * 1000) / 1000,
      endSec: Math.round((cursor + share) * 1000) / 1000,
    });
    cursor += share;
  }
}
if (words.length) {
  edl.captions = { mode: 'burn', style: 'bold_center', language: 'en-GB', words };
} else {
  console.warn('No captions.json found; rendering without burned captions.');
}

const check = validateEdl(edl);
if (!check.valid) {
  console.error('EDL invalid after finalisation:', check.issues.slice(0, 6));
  process.exit(1);
}
const finalEdlPath = join(outDir, 'prototype-final.edl.json');
writeFileSync(finalEdlPath, JSON.stringify(edl, null, 2));

// 3. Media paths relative to the listing for Remotion's publicDir.
const overlayEdl = {
  ...edl,
  clips: edl.clips.map((c: { src: string }) => ({ ...c, src: relative(listingDir, resolve(c.src)).replace(/\\/g, '/') })),
};
const overlayEdlPath = join(outDir, 'overlay-final.edl.json');
writeFileSync(overlayEdlPath, JSON.stringify(overlayEdl, null, 2));

// 4. Render the silent overlay video at 1080p.
const silent = join(outDir, 'final-silent.mp4');
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');
const render = spawnSync(
  process.execPath,
  [
    tsxCli,
    resolve('apps/render/src/cli.ts'),
    '--edl', overlayEdlPath,
    '--profile', 'vertical-social',
    '--listing', listingDir,
    '--out', silent,
    '--quality', 'standard',
    '--agent', 'Sara Whitfield',
    '--agency', 'Ashgrove & Co',
    '--captions',
  ],
  { windowsHide: true, encoding: 'utf8' },
);
if (render.status !== 0) {
  console.error((render.stderr || '').split('\n').slice(-20).join('\n'));
  process.exit(1);
}

// 5. Mux the hybrid audio.
const audio = [join(outDir, 'hybrid-audio.m4a'), join(outDir, 'audio', 'voice-track.m4a'), join(outDir, 'audio', 'final-mix.m4a')].find((p) => existsSync(p)) ?? join(outDir, 'hybrid-audio.m4a');
if (!existsSync(audio)) {
  console.error(`Missing ${audio}. Build it first.`);
  process.exit(1);
}
const final = join(outDir, 'zeniconic-final.mp4');
const mux = spawnSync(
  ffmpegPath(),
  [
    '-y', '-v', 'error',
    '-i', silent,
    '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
    '-shortest', '-movflags', '+faststart',
    final,
  ],
  { windowsHide: true, encoding: 'utf8' },
);
if (mux.status !== 0) {
  console.error((mux.stderr || '').split('\n').slice(-12).join('\n'));
  process.exit(1);
}

const info = await probe(final);
console.log(JSON.stringify({ output: final, durationSec: info.durationSec, width: info.width, height: info.height, audio: info.hasAudio, captions: words.length }, null, 2));
