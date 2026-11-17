/**
 * Desktop-pipeline tagging smoke test.
 *
 * Runs the real index stage through DesktopPipeline with vision tagging on,
 * then reads the persisted tagged index back. Proves the wiring the app uses
 * when ZENICONIC_TAG=1.
 *
 * Usage: npx tsx scripts/tag-pipeline-smoke.ts
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenRouterClient } from '../packages/ai/src/index';
import { JsonStore } from '../packages/store/src/index';
import { DesktopPipeline } from '../apps/desktop/pipeline';
import { readFootageIndex } from '../services/pipeline/index-store';
import models from '../services/pipeline/models.json';

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

async function main(): Promise<void> {
  const root = resolve('data/tmp/pipeline-smoke');
  rmSync(root, { recursive: true, force: true });

  const store = new JsonStore(root);
  await store.init();
  const listing = await store.create({ address: 'Tag Smoke Tower, Dubai Marina' });
  const folder = resolve('tests/fixtures/media');
  const jobId = 'job_tag_smoke';

  const pipeline = new DesktopPipeline({
    store,
    dataDir: root,
    repoRoot: process.cwd(),
    tagging: {
      model: models.roles.tagging.model,
      maxUsd: 0.05,
      client: async () =>
        new OpenRouterClient({ apiKey: key(), fetchImpl: (url, init) => fetch(url, init) }),
      onCost: (usd, listingId) => {
        console.log(`[cost] tagging $${usd.toFixed(4)} for ${listingId}`);
      },
    },
    onProgress: (event) => {
      if (event.detail !== undefined) console.log(`[${event.stage}] ${event.percent}% ${event.detail}`);
    },
  });

  pipeline.prepareAnalysis({ jobId, listingId: listing.id, folder });
  const controller = new AbortController();
  const result = await pipeline.run(
    {
      id: jobId,
      listingId: listing.id,
      stage: 'index',
      status: 'running',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    controller.signal,
  );
  console.log('STAGE', result);

  const listingDir = store.dirFor(listing.id);
  const taggedPath = join(listingDir, 'footage_index.tagged.json');
  const untaggedPath = join(listingDir, 'footage_index.json');
  console.log('FILES', { untagged: existsSync(untaggedPath), tagged: existsSync(taggedPath) });

  const tagged = await readFootageIndex(listingDir, { tagged: true });
  if (tagged === undefined) throw new Error('tagged index was not written');
  const shots = tagged.clips.flatMap((clip) => clip.shots);
  const taggedShots = shots.filter((shot) => shot.tags !== undefined);
  console.log(
    JSON.stringify(
      {
        shots: shots.length,
        tagged: taggedShots.length,
        rooms: [...new Set(taggedShots.map((shot) => shot.tags?.room))],
        scored: taggedShots.filter((shot) => (shot.tags?.score ?? 0) > 0).length,
      },
      null,
      2,
    ),
  );
  if (taggedShots.length === 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
