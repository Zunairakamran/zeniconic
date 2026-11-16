// Find the spoken region inside a clip's audio using FFmpeg silencedetect.
// Usage: npx tsx scripts/locate-speech.ts <listingDir>
// Writes out/audio/speech.json: { [sourceId]: { startSec, endSec, wav } }

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ffmpegPath } from '../packages/media/src/paths';

const listingDir = resolve(process.argv[2] ?? 'data/listings/marina-gate-1');
const index = JSON.parse(readFileSync(join(listingDir, 'footage_index.tagged.json'), 'utf8'));
const outDir = join(listingDir, 'out', 'audio');
mkdirSync(outDir, { recursive: true });

const TARGETS = ['s_ee267360', 's_eab4993a'];
const result: Record<string, { startSec: number; endSec: number; wav: string; transcript: string }> = {};

for (const clip of index.clips) {
  const short = String(clip.id).slice(0, 10);
  if (!TARGETS.includes(short)) continue;

  const wav = join(outDir, `${short}.wav`);
  spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-t', '8', '-i', resolve(clip.file), '-vn', '-ac', '1', '-ar', '16000', wav], { windowsHide: true });

  const detect = spawnSync(
    ffmpegPath(),
    ['-hide_banner', '-i', wav, '-af', 'silencedetect=noise=-34dB:d=0.35', '-f', 'null', '-'],
    { windowsHide: true, encoding: 'utf8' },
  );
  const log = `${detect.stderr ?? ''}`;

  const silences: Array<{ start: number; end: number }> = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*([0-9.]+)/);
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (s) open = Number(s[1]);
    if (e && open !== null) {
      silences.push({ start: open, end: Number(e[1]) });
      open = null;
    }
  }

  const duration = Math.min(8, clip.probe.durationSec);
  if (open !== null) silences.push({ start: open, end: duration });

  // Speech = the longest gap between silences.
  let cursor = 0;
  let best = { start: 0, end: 0 };
  for (const silence of [...silences, { start: duration, end: duration }]) {
    const start = cursor;
    const end = silence.start;
    if (end - start > best.end - best.start) best = { start, end };
    cursor = silence.end;
  }

  const transcript = clip.shots?.[0]?.tags?.sellingPoints?.join(',') ?? '';
  result[short] = { startSec: Number(best.start.toFixed(2)), endSec: Number(best.end.toFixed(2)), wav, transcript };
  console.log(`${short} speech ${best.start.toFixed(2)}–${best.end.toFixed(2)}s`);
}

writeFileSync(join(outDir, 'speech.json'), JSON.stringify(result, null, 2));
console.log(`wrote ${join(outDir, 'speech.json')}`);
