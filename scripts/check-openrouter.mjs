#!/usr/bin/env node
// Verify the OpenRouter key and report balance/usage. Never prints the key.
// Usage: node scripts/check-openrouter.mjs

import { config, requireKey, redact } from '../services/pipeline/config.mjs';

const key = requireKey();
const base = config.openrouterBase;

const get = async (path) => {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://zeniconic.local', 'X-Title': 'Zeniconic' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${redact(text).slice(0, 200)}`);
  return JSON.parse(text);
};

try {
  const keyInfo = await get('/key');
  const d = keyInfo.data || keyInfo;
  const limit = d.limit ?? null;
  const usage = d.usage ?? 0;
  console.log('key: valid');
  console.log('label:', d.label || '(none)');
  console.log('usage:', `$${Number(usage).toFixed(4)}`);
  console.log('limit:', limit === null ? 'unlimited (prepaid balance)' : `$${Number(limit).toFixed(2)}`);
  if (limit !== null) console.log('remaining:', `$${(Number(limit) - Number(usage)).toFixed(4)}`);
  console.log('rate limit:', d.rate_limit ? JSON.stringify(d.rate_limit) : 'n/a');

  const models = await get('/models');
  const imageModels = models.data.filter((m) => (m.architecture?.output_modalities || []).includes('image'));
  const videoIn = models.data.filter((m) => (m.architecture?.input_modalities || []).includes('video'));
  console.log('models visible:', models.data.length);
  console.log('image-output models:', imageModels.length);
  console.log('video-input models:', videoIn.length);
  console.log('\npinned roles:');
  for (const [role, id] of Object.entries(config.models)) console.log(`  ${role.padEnd(9)} ${id}`);
  console.log('budgets:', JSON.stringify(config.budgets));
  console.log('\nOK');
} catch (err) {
  console.error('FAILED:', redact(err.message));
  process.exit(1);
}
