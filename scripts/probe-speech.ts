// Find presenter speech in the raw clips, so the hybrid track uses a real voice.
// Usage: npx tsx scripts/probe-speech.ts <listingDir>

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ffmpegPath } from '../packages/media/src/paths';

const listingDir = resolve(process.argv[2] ?? 'data/listings/marina-gate-1');
const index = JSON.parse(readFileSync(join(listingDir, 'footage_index.tagged.json'), 'utf8'));
const key = readFileSync(resolve('.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('No OPENROUTER_API_KEY in .env');

const outDir = join(listingDir, 'out', 'audio');
mkdirSync(outDir, { recursive: true });

type Clip = { id: string; file: string; name: string; probe: { hasAudio: boolean; durationSec: number }; shots: Array<{ tags?: { room?: string } }> };
const clips: Clip[] = index.clips.filter((c: Clip) => c.probe.hasAudio);
console.log(`clips with audio: ${clips.length}/${index.clips.length}`);

const toWav = (clip: Clip): string => {
  const out = join(outDir, `${clip.id}.wav`);
  const seconds = Math.min(8, clip.probe.durationSec);
  spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-t', String(seconds), '-i', resolve(clip.file), '-vn', '-ac', '1', '-ar', '16000', out], { windowsHide: true });
  return out;
};

const transcribe = async (wav: string): Promise<string> => {
  const data = readFileSync(wav).toString('base64');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3.8-flash:floor',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe the speech in this audio. If there is no intelligible speech, reply exactly NO_SPEECH. Otherwise reply with the transcript only.' },
            { type: 'input_audio', input_audio: { data, format: 'wav' } },
          ],
        },
      ],
      max_tokens: 120,
    }),
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return String(json.choices?.[0]?.message?.content ?? '').trim();
};

for (const clip of clips) {
  const wav = toWav(clip);
  const text = await transcribe(wav);
  const room = clip.shots.map((s) => s.tags?.room).filter(Boolean).join('/');
  console.log(`${clip.id} ${room} :: ${text.slice(0, 120)}`);
}
writeFileSync(join(outDir, 'README.txt'), 'Presenter audio candidates extracted from raw clips.\n');
