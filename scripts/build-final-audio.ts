// Guaranteed hybrid audio build: presenter lines + Kokoro AI voice + catchy bed.
// Usage: npx tsx scripts/build-final-audio.ts <listingDir>

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KokoroTTS } from 'kokoro-js';
import { ffmpegPath, ffprobePath } from '../packages/media/src/paths';

const listingDir = resolve(process.argv[2] ?? 'data/listings/marina-gate-1');
const outDir = join(listingDir, 'out', 'audio');
const voiceDir = resolve('data/voice-final');
mkdirSync(outDir, { recursive: true });
mkdirSync(voiceDir, { recursive: true });

const speech = JSON.parse(readFileSync(join(outDir, 'speech.json'), 'utf8')) as Record<
  string,
  { startSec: number; endSec: number; wav: string }
>;

type Segment = { file: string; text: string; atSec: number; durSec: number };

const writeWav = (file: string, samples: Float32Array, rate: number) => {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
};

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });

const aiLines = [
  { id: 'intro', text: 'Marina Gate One, Dubai Marina.', atSec: 0.2 },
  { id: 'beds', text: 'Three bedrooms, two baths, twelve hundred and forty square feet.', atSec: 6.0 },
  { id: 'ready', text: 'Fully furnished, with a marina view. Ready to move in.', atSec: 11.2 },
  { id: 'living', text: 'Thoughtfully designed interiors, and everything you need to feel at home.', atSec: 18.8 },
  { id: 'cta', text: 'Priced at one point eight five million dirhams. Contact Sara at Ashgrove and Company.', atSec: 24.0 },
];

const segments: Segment[] = [];

for (const line of aiLines) {
  const wav = join(voiceDir, `${line.id}.wav`);
  const audio = await tts.generate(line.text, { voice: 'af_heart' });
  const samples = audio.audio as Float32Array;
  const rate = audio.sampling_rate ?? 24000;
  writeWav(wav, samples, rate);
  const dur = samples.length / rate;
  segments.push({ file: wav, text: line.text, atSec: line.atSec, durSec: dur });
  console.log(`ai ${line.id}: ${dur.toFixed(2)}s at ${line.atSec}s`);
}

// Presenter clips trimmed to their detected speech windows.
const presenter = [
  { id: 'presenter-entry', source: 's_ee267360', text: 'with private elevators coming right up to your apartment', atSec: 2.8 },
  { id: 'presenter-why', source: 's_eab4993a', text: 'Why wait for years when your dream home is already ready for you?', atSec: 15.8 },
];

for (const p of presenter) {
  const info = speech[p.source];
  if (!info) continue;
  const wav = join(voiceDir, `${p.id}.wav`);
  spawnSync(
    ffmpegPath(),
    ['-y', '-v', 'error', '-i', info.wav, '-af', `atrim=start=${info.startSec}:end=${info.endSec},asetpts=PTS-STARTPTS`, '-ac', '1', '-ar', '24000', wav],
    { windowsHide: true },
  );
  if (!existsSync(wav)) continue;
  const probe = spawnSync(ffmpegPath(), ['-hide_banner', '-i', wav, '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' });
  const m = `${probe.stderr}`.match(/time=(\d+):(\d+):(\d+\.\d+)/);
  const dur = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 3;
  segments.push({ file: wav, text: p.text, atSec: p.atSec, durSec: dur });
  console.log(`${p.id}: ${dur.toFixed(2)}s at ${p.atSec}s`);
}

segments.sort((a, b) => a.atSec - b.atSec);

const music = resolve('data/music/catchy-120.m4a');
if (!existsSync(music)) throw new Error('Missing data/music/catchy-120.m4a');

const inputs: string[] = [];
const filters: string[] = [];
segments.forEach((segment, i) => {
  inputs.push('-i', segment.file);
  const delay = Math.round(segment.atSec * 1000);
  filters.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}|${delay}[a${i}]`);
});
inputs.push('-i', music);
const mixedVo = `amix=inputs=${segments.length}:duration=longest:normalize=0,alimiter=limit=0.95[vo]`;
const musicIndex = segments.length;
filters.push(`${segments.map((_, i) => `[a${i}]`).join('')}${mixedVo}`);
filters.push(`[${musicIndex}:a]volume=0.30[bed]`);
filters.push(`[vo]asplit=2[voKey][voMix];[bed][voKey]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=350[ducked]`);
filters.push(`[voMix][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);

const filterComplex = filters.join(';');
const audioOut = join(outDir, 'final-mix.m4a');
const args = ['-y', '-v', 'error', ...inputs, '-filter_complex', filterComplex, '-map', '[aout]', '-t', '30', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', audioOut];
const res = spawnSync(ffmpegPath(), args, { windowsHide: true, encoding: 'utf8' });
if (res.status !== 0) {
  console.error((res.stderr || '').split('\n').slice(-14).join('\n'));
  process.exit(1);
}

const captions = segments.map((s) => ({
  text: s.text,
  startSec: Math.round(s.atSec * 1000) / 1000,
  endSec: Math.round((s.atSec + s.durSec) * 1000) / 1000,
}));
writeFileSync(join(outDir, 'final-captions.json'), JSON.stringify(captions, null, 2));

console.log(`wrote ${audioOut}`);
console.log(JSON.stringify(captions, null, 2));
