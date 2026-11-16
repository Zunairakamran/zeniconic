/**
 * One-off audio for the marketing variants: matilda voice lines and a Lyria bed.
 * Writes to data/marketing/audio. Reads the key from .env; never prints it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const key = readFileSync(resolve('.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('OPENROUTER_API_KEY missing');

const outDir = resolve('data/marketing/audio');
mkdirSync(outDir, { recursive: true });

const MODEL = 'elevenlabs/eleven-v4';
const VOICE = 'matilda';

async function tts(text, file) {
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: text, voice: VOICE, response_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000) throw new Error(`TTS too small: ${bytes.length}`);
  writeFileSync(resolve(outDir, file), bytes);
  console.log(`${file} ${(bytes.length / 1024).toFixed(0)} KB  "${text.slice(0, 40)}…"`);
}

const LINES = {
  's1.mp3': 'Some mornings, the city is still asleep.',
  's2.mp3': 'This is above it.',
  's3.mp3': 'Light that moves with the day.',
  's4.mp3': 'A kitchen built for slow coffee.',
  's5.mp3': 'Three bedrooms. Two baths. Twelve hundred and forty square feet.',
  's6.mp3': 'And a private lift that takes you straight to your door.',
  's7.mp3': 'Marina Gate One. One point eight five million dirhams.',
  's8.mp3': 'Book a private viewing.',
  's9.mp3': 'One point eight five million dirhams. This is what it buys.',
};

const only = process.argv[2];
for (const [file, text] of Object.entries(LINES)) {
  if (only && only !== file) continue;
  await tts(text, file);
}
