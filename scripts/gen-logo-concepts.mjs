#!/usr/bin/env node
// Generate logo concepts through OpenRouter. Reads OPENROUTER_API_KEY from .env.
// Usage: node scripts/gen-logo-concepts.mjs
// Output: docs/brand/concepts/<name>.png + <name>.json sidecar

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  console.error('No .env found. Copy .env.example and add OPENROUTER_API_KEY.');
  process.exit(1);
}
const env = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY missing in .env');
  process.exit(1);
}

const MODEL = 'google/gemini-3-pro-image';
const outDir = join(root, 'docs', 'brand', 'concepts');
mkdirSync(outDir, { recursive: true });

const concepts = [
  {
    name: 'a-doorway',
    prompt: `Flat vector logo mark for a premium real-estate video brand. A solid brass architectural doorway: a tall rounded arch with a triangular play-button shape cut out of its centre as negative space, plus a thin threshold line beneath it. Single brass colour (#B08A4A) on warm off-white (#F7F4EF). Geometric, architectural, editorial, luxury. No gradient, no shadow, no texture, no perspective, no 3D. Perfectly centred with generous margins. Absolutely NO TEXT, no words, no letters, no watermark, no mockup, no business card. Square 1:1.`,
  },
  {
    name: 'b-z-play',
    prompt: `Flat vector monogram logo for a premium real-estate video brand. The capital letter Z built from three thick geometric strokes, where the middle diagonal is replaced by a right-pointing play triangle, so it reads as both a Z and a play button. Deep ink (#14120F) letterform on warm cream (#F7F4EF), with the triangle in brass (#B08A4A). Minimal, bold, editorial, luxury. Sharp corners, even stroke weight, no gradient, no shadow, no 3D. Centred, generous margins. Absolutely NO TEXT beyond the single Z shape, no words, no watermark, no mockup. Square 1:1.`,
  },
  {
    name: 'c-frame-roof',
    prompt: `Flat vector logo mark for a premium real-estate video brand. A bold rounded-square film frame in brass (#B08A4A) containing a simple ink (#14120F) roofline chevron and a small play triangle, reading as a house inside a frame. Geometric, architectural, modern, luxury, minimal. Solid shapes, two colours only, no gradient, no shadow, no 3D, no texture. Centred with generous margins. Absolutely NO TEXT, no letters, no words, no watermark, no mockup. Square 1:1.`,
  },
];

const call = async (concept) => {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zeniconic.local',
      'X-Title': 'Zeniconic brand concepts',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: concept.prompt }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '1:1' },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${concept.name}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return null;
  }
  const json = JSON.parse(text);
  const msg = json.choices?.[0]?.message;
  const img = msg?.images?.[0];
  const url = img?.image_url?.url || img?.url;
  if (!url || !url.startsWith('data:image/')) {
    console.error(`${concept.name}: no image in response`, JSON.stringify(msg).slice(0, 300));
    return null;
  }
  const [meta, b64] = url.split(',');
  const ext = meta.includes('jpeg') ? 'jpg' : meta.includes('webp') ? 'webp' : 'png';
  const file = join(outDir, `${concept.name}.${ext}`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  writeFileSync(join(outDir, `${concept.name}.json`), JSON.stringify({
    model: MODEL,
    prompt: concept.prompt,
    usage: json.usage,
    text: msg?.content ?? null,
    file,
  }, null, 2));
  console.log(`${concept.name}: ${file}`);
  return file;
};

for (const concept of concepts) {
  await call(concept);
}
console.log('\nDone. Concepts in', outDir);
