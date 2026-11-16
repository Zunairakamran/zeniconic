// Generate a vertical brand background still via OpenRouter image output.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const key = readFileSync(resolve('.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('No OPENROUTER_API_KEY');

const prompt = [
  'Cinematic macro photograph for a luxury real-estate brand.',
  'Warm travertine stone meeting a brushed brass edge, a single soft beam of late afternoon light',
  'raking across the surface, deep calm shadows, shallow depth of field, fine grain,',
  'editorial, expensive, minimal, no text, no logos, no people, no furniture.',
  'Vertical 9:16 composition with generous empty space in the centre for a logo.',
].join(' ');

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'google/gemini-3-pro-image',
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: '9:16' },
  }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
const json = JSON.parse(text) as { choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }> };
const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
if (!url?.startsWith('data:image/')) {
  console.error('No image in response');
  process.exit(1);
}
const [meta, b64] = url.split(',');
const ext = meta?.includes('jpeg') ? 'jpg' : 'png';
mkdirSync(resolve('data/brand-gen'), { recursive: true });
const out = resolve(`data/brand-gen/brand-bg.${ext}`);
writeFileSync(out, Buffer.from(b64 ?? '', 'base64'));
console.log(`wrote ${out}`);
