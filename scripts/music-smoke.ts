/**
 * Live music-generation smoke: Lyria 3 Pro via OpenRouter streaming audio.
 *
 * Usage: npx tsx scripts/music-smoke.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMusicService } from '../apps/desktop/music-service';
import { probeAudio } from '../packages/media/src/index';
import models from '../services/pipeline/models.json';

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

async function main(): Promise<void> {
  const service = createMusicService({
    dataDir: resolve('data/tmp/music-smoke'),
    model: models.roles.music.model,
    apiKey: () => key(),
    onCost: (usd) => console.log(`[cost] music $${usd.toFixed(2)}`),
    onSelect: (fileName) => console.log(`[select] ${fileName}`),
  });

  const result = await service.generate(
    'A calm, warm instrumental bed for a luxury Dubai marina property video. Soft piano, gentle strings, subtle pulse, no vocals. Instrumental only.',
  );
  const path = resolve('data/tmp/music-smoke/assets/music', result.fileName);
  const info = await probeAudio(path);
  console.log(JSON.stringify({ ...result, path, probedDuration: info.durationSec, sampleRate: info.sampleRate, channels: info.channels }, null, 2));
  if (!(info.durationSec > 1)) {
    console.error('Generated music file is not usable.');
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
