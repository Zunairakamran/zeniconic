/**
 * Spike: generate one music bed with Lyria through OpenRouter.
 * Audio output arrives as SSE base64 chunks when `modalities` includes audio.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const key = readFileSync(resolve('.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('OPENROUTER_API_KEY missing');

const prompt = process.argv[2] ?? [
  'Cinematic luxury real-estate underscore, 108 BPM, warm analog synth pulse,',
  'soft strings, restrained percussion that enters at 18 seconds, tasteful build,',
  'no vocals, no lead melody, no sudden drops, 35 seconds, seamless loop.',
].join(' ');

const outDir = resolve('data/marketing/audio');
mkdirSync(outDir, { recursive: true });

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://zeniconic.local',
    'X-Title': 'Zeniconic music',
  },
  body: JSON.stringify({
    model: 'google/lyria-3-pro-preview',
    messages: [{ role: 'user', content: prompt }],
    modalities: ['text', 'audio'],
    audio: { format: 'mp3' },
    stream: true,
  }),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}

const chunks = [];
let text = '';
let buffer = '';
const decoder = new TextDecoder();
for await (const part of res.body) {
  buffer += decoder.decode(part, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta ?? {};
      if (delta.audio?.data) chunks.push(delta.audio.data);
      if (typeof delta.content === 'string') text += delta.content;
      if (delta.audio?.transcript) text += delta.audio.transcript;
    } catch {
      // partial frame
    }
  }
}

if (chunks.length === 0) {
  console.error('No audio chunks. Text was:', text.slice(0, 300));
  process.exit(1);
}
const bytes = Buffer.from(chunks.join(''), 'base64');
const file = resolve(outDir, process.argv[3] ?? 'lyria-bed.mp3');
writeFileSync(file, bytes);
console.log(`wrote ${file} ${(bytes.length / 1024).toFixed(0)} KB; text: ${text.slice(0, 120)}`);
