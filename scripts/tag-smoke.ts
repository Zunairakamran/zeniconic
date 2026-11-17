/**
 * Real vision-tagging smoke test.
 *
 * Indexes the generated fixture clips, prices the batch, tags every shot
 * through OpenRouter, and writes the tagged index. Proves the tagging path the
 * desktop pipeline calls when ZENICONIC_TAG=1.
 *
 * Usage: npx tsx scripts/tag-smoke.ts
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenRouterClient } from '../packages/ai/src/index';
import { analyseFolder } from '../services/pipeline/service';
import { writeFootageIndex } from '../services/pipeline/index-store';
import {
  estimateTaggingCost,
  tagIndexWithReport,
  TAGGING_PROMPT_VERSION,
} from '../services/tagging/src/index';
import models from '../services/pipeline/models.json';

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

async function main(): Promise<void> {
  const folder = resolve('tests/fixtures/media');
  const model = models.roles.tagging.model;
  const { index } = await analyseFolder(folder);
  const shots = index.clips.reduce((sum, clip) => sum + clip.shots.length, 0);
  const estimate = estimateTaggingCost(shots, model);
  console.log(
    `TAGGING ${shots} shots with ${model} — estimate $${estimate.usd.toFixed(4)} ` +
      `(${estimate.inputTokens} in / ${estimate.outputTokens} out tokens)`,
  );

  const workDir = resolve('data/tmp/tag-smoke');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const client = new OpenRouterClient({ apiKey: key(), fetchImpl: (url, init) => fetch(url, init) });
  const run = await tagIndexWithReport(index, {
    client,
    model,
    promptVersion: TAGGING_PROMPT_VERSION,
    workDir,
    concurrency: 2,
    onProgress: (done, total, shotId) => console.log(`  ${done}/${total} ${shotId}`),
  });

  const rows = run.index.clips.flatMap((clip) =>
    clip.shots.map((shot) => ({
      shot: shot.id,
      room: shot.tags?.room ?? 'untagged',
      score: shot.tags?.score ?? null,
      points: shot.tags?.sellingPoints ?? [],
      defects: shot.tags?.defects ?? [],
    })),
  );
  console.log('\nTAGGED', JSON.stringify({ report: run.report, rows }, null, 2));

  const outputDir = resolve('data/tmp/tag-smoke-listing');
  const file = await writeFootageIndex(outputDir, run.index, { tagged: true });
  console.log(`\nWROTE ${file}`);
  if (run.report.tagged === 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
