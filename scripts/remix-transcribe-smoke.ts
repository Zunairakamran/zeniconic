/**
 * Remix + speech smoke test: transcribe a generated narration, remap it onto
 * the preset order, and create a captioned variant.
 *
 * Usage: npx tsx scripts/remix-transcribe-smoke.ts
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { JsonStore } from '../packages/store/src/index';
import { ffmpegPath } from '../packages/media/src/index';
import { validateEdl, durationSec } from '../packages/edl/src/index';
import { transcribeAudio } from '../services/remix/src/index';
import { createRemixService } from '../apps/desktop/remix';
import { readVariantEdl } from '../apps/desktop/variants';
import models from '../services/pipeline/models.json';

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

async function main(): Promise<void> {
  const root = resolve('data/tmp/remix-transcribe-smoke');
  await rm(root, { recursive: true, force: true });
  const store = new JsonStore(root);
  await store.init();
  const listing = await store.create({
    address: 'Remix Speech Tower, Dubai Marina',
    facts: { price: 'AED 1,850,000', beds: 2, baths: 2, currency: 'AED' },
  });

  const source = resolve('data/tmp/remix-speech.mp4');
  const remix = createRemixService({
    store,
    transcribe: async (file) => {
      const dir = await mkdtemp(join(root, 'audio-'));
      try {
        const wav = join(dir, 'audio.wav');
        await promisify(execFile)(ffmpegPath(), [
          '-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000',
          '-c:a', 'pcm_s16le', wav,
        ]);
        const result = await transcribeAudio(
          { data: await readFile(wav), format: 'wav' },
          { getApiKey: () => key(), model: models.roles.transcription.model },
        );
        console.log(
          `TRANSCRIBED ${result.words.length} words (${result.language}) — "${result.text.slice(0, 90)}…"`,
        );
        console.log(
          `COST ${result.costUsd === undefined ? 'not reported' : `$${result.costUsd.toFixed(6)}`}`,
        );
        return {
          words: result.words,
          durationSec: result.durationSec,
          model: models.roles.transcription.model,
          ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  });

  const storyboard = await remix.analyze({ listingId: listing.id, file: source, transcribe: true });
  console.log(
    'STORYBOARD',
    JSON.stringify({
      shots: storyboard.shots.length,
      words: storyboard.words,
      marketingSlots: storyboard.presets.marketing.length,
      transcription: storyboard.transcription,
      warnings: storyboard.warnings,
    }),
  );

  const variant = await remix.create({ listingId: listing.id, preset: 'marketing' });
  const edl = await readVariantEdl(store.dirFor(listing.id), 'remix');
  const check = validateEdl(edl);
  console.log(
    'VARIANT',
    JSON.stringify({
      variant,
      valid: check.valid,
      duration: durationSec(edl),
      captions: edl.captions.mode,
      captionWords: edl.captions.words?.length ?? 0,
      firstWords: edl.captions.words?.slice(0, 8).map((word) => word.text) ?? [],
    }),
  );
  if (!check.valid || (edl.captions.words?.length ?? 0) === 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
