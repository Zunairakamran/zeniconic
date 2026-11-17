/**
 * Live studio-TTS smoke: call OpenRouter speech with the configured model,
 * decode the reply and write a WAV. Proves the request format and decoder.
 *
 * Usage: npx tsx scripts/tts-smoke.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStudioEngine } from '../services/voice/src/index';
import { wavDurationSec } from '../services/voice/src/wav';
import models from '../services/pipeline/models.json';

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

async function main(): Promise<void> {
  const model = models.roles.tts.model;
  const engine = createStudioEngine({ apiKey: key(), model });
  const text = 'Welcome to Marina Gate One. The marina is a short walk away.';
  const started = Date.now();
  const audio = await engine.generate(text, { voice: 'matilda' });
  if (audio.samples.length === 0) throw new Error('no samples returned');

  mkdirSync(resolve('data/tmp'), { recursive: true });
  const file = resolve('data/tmp/tts-smoke.wav');
  const { writeWavMono16 } = await import('../services/voice/src/wav');
  writeWavMono16(file, audio.samples, audio.sampleRate);
  const duration = wavDurationSec(file);
  console.log(
    JSON.stringify(
      {
        model,
        sampleRate: audio.sampleRate,
        samples: audio.samples.length,
        durationSec: duration,
        file,
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ),
  );
  if (!(duration > 0.3)) {
    console.error('Generated audio is too short to be speech.');
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
