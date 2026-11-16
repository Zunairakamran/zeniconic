import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const key = readFileSync(resolve('.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('OPENROUTER_API_KEY missing');

const [file, start, dur] = process.argv.slice(2);
if (!file) throw new Error('usage: transcribe.mjs <video> [start] [dur]');
const wav = resolve('data/marketing/audio/tmp.wav');
const args = ['-y', '-v', 'error'];
if (start) args.push('-ss', start);
if (dur) args.push('-t', dur);
args.push('-i', resolve(file), '-vn', '-ac', '1', '-ar', '16000', wav);
execFileSync(ffmpeg, args);

const base64 = readFileSync(wav).toString('base64');
const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'elevenlabs/scribe-v2',
    input_audio: { data: base64, format: 'wav' },
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
const json = JSON.parse(text);
writeFileSync(resolve('data/marketing/audio/transcript.json'), JSON.stringify(json, null, 2));
const words = json.words ?? [];
console.log(`language=${json.language} duration=${json.duration} words=${words.length}`);
console.log((json.text ?? '').slice(0, 400));
if (words.length) console.log(words.slice(0, 30).map((w) => `${w.word}@${w.start?.toFixed(2)}`).join(' '));
