/**
 * Build one real demo listing from the presenter clips in `raw-clips/`.
 *
 * Facts come from the presenter's own audio (transcribed separately) plus the
 * Marina Gate 1 listing cited in docs/MARKETING-CUTS.md. Nothing is invented:
 * price and bedroom count are spoken; baths/sqft are left blank.
 *
 * Usage: npx tsx scripts/demo-build.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OpenRouterClient } from '../packages/ai/src/index';
import { JobRunner, JsonJobStore } from '../packages/jobs/src/index';
import type { StageExecutor } from '../packages/jobs/src/index';
import { CostLedger } from '../packages/ledger/src/index';
import { JsonStore } from '../packages/store/src/index';
import type { ListingRecord } from '../packages/store/src/index';
import { DesktopPipeline } from '../apps/desktop/pipeline';
import { readVariants, setVariantApproval } from '../apps/desktop/variants';
import { configureStudioVoice, DEFAULT_VOICE_ID } from '../services/voice/src/index';
import models from '../services/pipeline/models.json';

const ROOT = resolve('data');
const FOOTAGE = resolve('raw-clips');
const ADDRESS = 'Marina Gate 1, Dubai Marina';
const FACTS = {
  price: 'AED 1,400,000',
  beds: 1,
  currency: 'AED' as const,
  confirmedAt: new Date().toISOString(),
};

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const store = new JsonStore(ROOT);
  await store.init();
  for (const existing of await store.list()) {
    if (existing.address === ADDRESS) await store.remove(existing.id);
  }
  const listing = await store.create({ address: ADDRESS, facts: FACTS });
  console.log(`[demo] listing ${listing.id}`);

  const apiKey = key();
  const ledger = new CostLedger(ROOT, { caps: models.budgets });
  configureStudioVoice({
    getApiKey: () => apiKey,
    getVoiceId: async () => DEFAULT_VOICE_ID,
  });

  const pipeline = new DesktopPipeline({
    store,
    dataDir: ROOT,
    repoRoot: process.cwd(),
    ttsModel: models.roles.tts.model,
    onProgress: (event) =>
      console.log(`[demo] ${event.stage} ${String(event.percent)}% ${event.status}`),
    tagging: {
      model: models.roles.tagging.model,
      maxUsd: 0.25,
      enabled: () => true,
      client: async () =>
        new OpenRouterClient({ apiKey, fetchImpl: (url, init) => fetch(url, init) }),
      onCost: (usd) =>
        ledger
          .record({
            role: 'tagging',
            model: models.roles.tagging.model,
            listingId: listing.id,
            costUsd: usd,
          })
          .then(() => console.log(`[demo] tagging cost $${usd.toFixed(4)}`)),
    },
    voiceOnCost: (usd, listingId) =>
      ledger
        .record({
          role: 'voice',
          model: models.roles.tts.model,
          listingId,
          costUsd: usd,
        })
        .then(() => console.log(`[demo] voice cost $${usd.toFixed(4)}`)),
  });

  const jobStore = new JsonJobStore(ROOT);
  await jobStore.init();
  const executor: StageExecutor = {
    run: (job, signal) => pipeline.run(job, signal),
  };
  const runner = new JobRunner({ executor, store: jobStore });
  const job = runner.enqueue(listing.id, { kind: 'analysis', checkpoint: FOOTAGE });
  pipeline.prepareAnalysis({ jobId: job.id, listingId: listing.id, folder: FOOTAGE });
  await runner.flush();
  const finished = await runner.run(job.id);
  console.log(`[demo] analysis ${finished.status} at ${finished.stage}`);
  if (finished.status !== 'complete') throw new Error(finished.error ?? 'analysis failed');

  const listingDir = store.dirFor(listing.id);
  let variants = await readVariants(listingDir);
  console.log(
    `[demo] variants ${variants
      .map((variant) => `${variant.id}:${String(variant.targetDurationSec)}s/${String(variant.clipCount)}`)
      .join(', ')}`,
  );

  for (const id of ['calm', 'marketing38']) {
    if (variants.some((variant) => variant.id === id)) {
      await setVariantApproval(listingDir, id, true);
    }
  }
  variants = await readVariants(listingDir);
  console.log(`[demo] approved ${variants.filter((v) => v.approved).map((v) => v.id).join(', ')}`);

  const refreshed = (await store.get(listing.id)) as ListingRecord;
  const result = await pipeline.exportListing({
    listing: refreshed,
    profiles: ['vertical-social'],
    quality: 'high',
    captions: 'burned',
    voice: 'ai',
    cover: true,
  });

  console.log('[demo] export', JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(`[demo] FAILED ${messageOf(error)}`);
  process.exitCode = 1;
});
