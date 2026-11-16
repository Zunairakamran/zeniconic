import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const key = readFileSync(resolve('.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('OPENROUTER_API_KEY missing');
const outDir = resolve('data/marketing/audio');
mkdirSync(outDir, { recursive: true });

const LINES = {
  'm_bridge.mp3': '[warmly] Thoughtfully designed spaces. Modern interiors, and everything you need to feel at home.',
  'm_ready.mp3': '[gently] And yes, your new home is ready.',
  'm_lift.mp3': '[confident] With private elevators coming straight to your apartment.',
  'm_price.mp3': '[warmly] One-bedroom residences from one point four million dirhams.',
  'm_cta.mp3': '[with a smile] Whether you are buying or investing, this opportunity is worth exploring.',
};

for (const [file, input] of Object.entries(LINES)) {
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'elevenlabs/eleven-v4', input, voice: 'matilda', response_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`${file} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(outDir, file), bytes);
  console.log(`${file} ${(bytes.length / 1024).toFixed(0)} KB`);
}
