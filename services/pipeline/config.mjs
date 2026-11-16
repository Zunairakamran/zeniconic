// Runtime configuration for the Zeniconic pipeline.
//
// Development: reads .env at the repository root.
// Packaged app: the key is NOT bundled. It is entered once in Settings and kept in
// the OS credential store via Electron safeStorage, then injected here as env.
// Never log, print or serialise `openrouterKey`.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export const models = JSON.parse(readFileSync(join(here, 'models.json'), 'utf8'));

/** Per-stage OpenRouter routing defaults (`:floor`, `:nitro`, `auto`). */
export const routing = models.routing ?? {};
/** Stable-prefix caching policy; the client reads this shape. */
export const caching = models.caching ?? {};

export function variantFor(stage) {
  const entry = routing[stage];
  const variant = entry?.variant;
  return variant === 'floor' || variant === 'nitro' ? variant : 'auto';
}

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const fileEnv = parseEnvFile(join(repoRoot, '.env'));
const env = { ...fileEnv, ...process.env };

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  openrouterKey: env.OPENROUTER_API_KEY || '',
  openrouterBase: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  models: {
    tagging: env.TAGGING_MODEL || models.roles.tagging.model,
    planning: env.PLANNING_MODEL || models.roles.planning.model,
    review: env.REVIEW_MODEL || models.roles.review.model,
    music: env.MUSIC_MODEL || models.roles.music.model,
    tts: env.TTS_MODEL || models.roles.tts.model,
  },
  budgets: {
    monthlyCapUsd: num(env.MONTHLY_CAP_USD, models.budgets.monthlyCapUsd),
    perListingUsd: num(env.PER_LISTING_CAP_USD, models.budgets.perListingDefaultUsd),
    dailyCapUsd: num(env.DAILY_CAP_USD, models.budgets.dailyCapUsd),
  },
  paths: {
    repoRoot,
    data: join(repoRoot, 'data'),
    listings: join(repoRoot, 'data', 'listings'),
    cache: join(repoRoot, 'data', 'cache'),
  },
};

export function requireKey() {
  if (!config.openrouterKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Add it to .env for development, or enter it in Settings in the app.',
    );
  }
  return config.openrouterKey;
}

// Safe for logs and error reports.
export function redact(text) {
  return String(text)
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, 'sk-or-v1-…')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer …');
}

export function assertBudgetStage(stage, estimatedUsd) {
  const budget = config.budgets;
  if (estimatedUsd > budget.perListingUsd) {
    const err = new Error(
      `Estimated cost $${estimatedUsd.toFixed(2)} exceeds the per-listing cap of $${budget.perListingUsd.toFixed(2)}.`,
    );
    err.code = 'E_BUDGET_STAGE';
    throw err;
  }
  return true;
}
