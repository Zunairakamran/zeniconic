// Step 7 of docs/BUILD.md: footage_index.json → footage_index.tagged.json.
// Usage: npx tsx scripts/tag-clips.ts <listingDir> [--dry-run] [--concurrency 3]
//
// Reads the listing's index, builds one 3x2 contact sheet per shot, asks the
// pinned vision model for typed tags and merges them back. The original index
// is never overwritten: the tagged copy is a separate file.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenRouterClient, resolveModelId } from '../packages/ai/src/index';
import type { ChatClient, FetchLike } from '../packages/ai/src/index';
import { MemoryTaggingCache } from '../packages/tagging/src/index';
import type { FootageIndex } from '../services/pipeline/indexer';
import {
  assertTaggingBudget,
  DEFAULT_CONCURRENCY,
  estimateLines,
  estimateTaggingCost,
  tagIndexWithReport,
  TAGGING_PROMPT_VERSION,
} from '../services/tagging/src/index';

interface PipelineConfig {
  openrouterBase: string;
  models: { tagging: string };
}

interface ConfigModule {
  config: PipelineConfig;
  requireKey: () => string;
  redact: (text: string) => string;
}

const USAGE = 'usage: npx tsx scripts/tag-clips.ts <listingDir> [--dry-run] [--concurrency 3]';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv: string[]): { listingDir: string; dryRun: boolean; concurrency?: number } {
  let listing: string | undefined;
  let dryRun = false;
  let concurrency: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--concurrency') {
      concurrency = Number(argv[index + 1]);
      index += 1;
      if (!Number.isInteger(concurrency) || concurrency < 1) fail(`${USAGE}\n--concurrency needs a positive integer.`);
    } else if (arg.startsWith('--')) {
      fail(`${USAGE}\nUnknown flag ${arg}.`);
    } else if (listing === undefined) {
      listing = arg;
    } else {
      fail(USAGE);
    }
  }

  if (listing === undefined) fail(USAGE);
  return { listingDir: resolve(listing), dryRun, concurrency };
}

/** Per-room counts, highest first, then alphabetically so output is stable. */
function printRooms(index: FootageIndex): void {
  const rooms = new Map<string, number>();
  let untagged = 0;

  for (const clip of index.clips) {
    for (const shot of clip.shots) {
      if (shot.tags === undefined) {
        untagged += 1;
        continue;
      }
      rooms.set(shot.tags.room, (rooms.get(shot.tags.room) ?? 0) + 1);
    }
  }

  const rows = [...rooms.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  console.log('\nrooms:');
  for (const [room, count] of rows) console.log(`  ${room.padEnd(9)} ${count}`);
  if (rows.length === 0) console.log('  (none)');
  if (untagged > 0) console.log(`  ${'untagged'.padEnd(9)} ${untagged}`);
}

async function main(): Promise<void> {
  const { listingDir, dryRun, concurrency } = parseArgs(process.argv.slice(2));
  const indexPath = join(listingDir, 'footage_index.json');
  const outPath = join(listingDir, 'footage_index.tagged.json');

  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as FootageIndex;
  const shots = index.clips.reduce((total, clip) => total + clip.shots.length, 0);

  const configModule = (await import('../services/pipeline/config.mjs' as string)) as ConfigModule;
  const { config, requireKey } = configModule;
  const model = resolveModelId(config.models.tagging, 'floor');

  const estimate = estimateTaggingCost(shots, model);
  for (const line of estimateLines(estimate)) console.log(line);

  try {
    assertTaggingBudget(estimate);
  } catch (error) {
    fail(messageOf(error));
  }

  if (dryRun) {
    console.log('\n--dry-run: no sheets built, no model calls, nothing written.');
    return;
  }
  if (shots === 0) {
    console.log(`\nNo shots in ${indexPath}; nothing to tag.`);
    return;
  }

  const fetchImpl: FetchLike = (url, init) => fetch(url, init);
  const client = new OpenRouterClient({
    apiKey: requireKey(),
    baseUrl: config.openrouterBase,
    fetchImpl,
  });

  // Count real spend at the seam: `tagShot` returns tags, not a bill.
  const spend = { calls: 0, usd: 0 };
  const metered: ChatClient = {
    async complete(request) {
      const reply = await client.complete(request);
      spend.calls += 1;
      spend.usd += reply.costUsd;
      return reply;
    },
  };

  const workDir = join(tmpdir(), 'zeniconic-tagging', basename(listingDir));
  const { index: tagged, report } = await tagIndexWithReport(index, {
    client: metered,
    model,
    promptVersion: TAGGING_PROMPT_VERSION,
    cache: new MemoryTaggingCache(),
    workDir,
    ...(concurrency === undefined ? {} : { concurrency }),
    onProgress: (done, total, shotId) => {
      console.log(`[${String(done).padStart(3)}/${total}] ${shotId}`);
    },
  });

  writeFileSync(outPath, JSON.stringify(tagged, null, 2));

  if (report.failed > 0) {
    console.log(`\n${report.failed} shot${report.failed === 1 ? '' : 's'} left untagged:`);
    for (const failure of report.failures) console.log(`  ${failure.shotId} ${failure.message}`);
  }

  printRooms(tagged);
  console.log(
    `\ntagged ${report.tagged}/${report.total} shots · ${spend.calls} call${spend.calls === 1 ? '' : 's'} · ` +
      `$${spend.usd.toFixed(4)} (estimate $${estimate.usd.toFixed(4)})`,
  );
  console.log(`wrote ${outPath}`);
}

await main().catch((error: unknown) => {
  // The config module is the only thing that can redact a key that leaked into
  // a message; keep the fallback safe by printing only the message.
  fail(messageOf(error));
});
