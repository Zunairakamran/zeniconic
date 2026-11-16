// Generate a short brand background via OpenRouter (Gemini Omni video output).
// Usage: npx tsx scripts/gen-brand-video.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const key = readFileSync(resolve('.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('No OPENROUTER_API_KEY in .env');

const outDir = resolve('data/brand-gen');
mkdirSync(outDir, { recursive: true });

const prompt = [
  'A five-second cinematic brand background for a luxury real-estate video app.',
  'Slow macro dolly across warm travertine stone and brushed brass architectural edges,',
  'a single soft light sweep crossing the frame, deep calm shadows, shallow depth of field,',
  'editorial and expensive, no text, no logos, no people, no furniture, no windows with views.',
  'Vertical 9:16, 24 fps, subtle grain, stable camera.',
].join(' ');

const body = {
  model: 'google/gemini-omni-1.2-flash',
  messages: [{ role: 'user', content: prompt }],
  modalities: ['video', 'text'],
  video_config: { duration_seconds: 5, aspect_ratio: '9:16' },
  stream: true,
};

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://zeniconic.local',
    'X-Title': 'Zeniconic brand intro',
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`HTTP ${res.status}: ${text.slice(0, 600)}`);
  process.exit(1);
}

let raw = '';
const chunks: string[] = [];

const extract = (value: unknown, depth = 0): string | null => {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 200)) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extract(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/url$/i.test(k) && typeof v === 'string' && /^https?:/.test(v)) return v;
      const found = extract(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
};

const reader = res.body?.getReader();
if (!reader) throw new Error('No stream body');
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  raw += decoder.decode(value, { stream: true });
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const found = extract(json);
      if (found) chunks.push(found);
    } catch {
      /* partial line, keep buffering */
    }
  }
  raw = raw.slice(raw.lastIndexOf('\n') + 1);
}

if (!chunks.length) {
  console.error('No video payload in response. First 600 chars:');
  console.error(raw.slice(0, 600));
  process.exit(1);
}

const last = chunks[chunks.length - 1]!;
const out = join(outDir, 'brand-bg.mp4');
if (last.startsWith('http')) {
  const video = await fetch(last);
  writeFileSync(out, Buffer.from(await video.arrayBuffer()));
} else {
  writeFileSync(out, Buffer.from(last.replace(/\s/g, ''), 'base64'));
}
console.log(`wrote ${out}`);
