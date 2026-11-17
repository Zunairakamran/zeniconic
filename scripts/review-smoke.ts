/**
 * Live visual-inspection smoke: send frames from a real rendered file to the
 * configured OpenRouter review model and print the findings.
 *
 * Usage: npx tsx scripts/review-smoke.ts [file]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OpenRouterClient } from '../packages/ai/src/index';
import { createReviewService } from '../apps/desktop/review-service';
import models from '../services/pipeline/models.json';

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

async function main(): Promise<void> {
  const file = resolve(process.argv[2] ?? 'data/tmp/agent-smoke.mp4');
  const service = createReviewService({
    dataDir: resolve('data'),
    model: models.roles.review.model,
    client: async () =>
      new OpenRouterClient({ apiKey: key(), fetchImpl: (url, init) => fetch(url, init) }),
    onCost: (usd) => console.log(`[cost] review $${usd.toFixed(4)}`),
  });

  const result = await service.inspect({
    file,
    facts: { address: 'Smoke Test Tower, Dubai Marina', price: 'AED 1,850,000', beds: 2, baths: 2 },
  });
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
