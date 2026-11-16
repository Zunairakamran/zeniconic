/**
 * Generates the bundled voice previews.
 *
 * Run from the repository root:
 *
 *   npx tsx services/voice/scripts/generate-samples.ts
 *
 * The key is read from `.env` (OPENROUTER_API_KEY) and never printed. Each
 * curated voice speaks the same line; the MP3 lands in
 * `apps/desktop/electron/assets/voices/<id>.mp3` at 44.1 kHz mono, and
 * `voices.json` records the successful files plus any voice that is missing.
 *
 * A failure is recorded, never faked: the gallery simply has no preview for
 * that voice. Existing files are reused unless `--force` is passed, so a
 * re-run never re-bills a line that is already on disk.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ffmpegPath } from '../../../packages/media/src/index';
import {
  createStudioEngine,
  CURATED_VOICE_IDS,
  MAX_SAMPLE_BYTES,
  SAMPLE_LINE,
  VOICES_MANIFEST,
  voiceById,
} from '../src/index';
import { writeWavMono16 } from '../src/wav';

const REPO_ROOT = resolve(process.cwd());
const OUTPUT_DIR = join(REPO_ROOT, 'apps', 'desktop', 'electron', 'assets', 'voices');
const TEMP_DIR = join(REPO_ROOT, 'data', 'tmp');
const force = process.argv.includes('--force');

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readKey(): Promise<string> {
  const envFile = join(REPO_ROOT, '.env');
  let raw = '';
  try {
    raw = await readFile(envFile, 'utf8');
  } catch {
    throw new Error(`No .env at ${envFile}; set OPENROUTER_API_KEY there first.`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*OPENROUTER_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (match === null) continue;
    const value = (match[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    if (value.length > 0) return value;
  }
  throw new Error('OPENROUTER_API_KEY is not set in .env.');
}

/** 96 kbps; if an unusual line pushes past the cap, 64 kbps is still clear. */
function encodeMp3(wav: string, mp3: string, bitrate: string): void {
  const result = spawnSync(
    ffmpegPath(),
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-i',
      wav,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      bitrate,
      mp3,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`${(result.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' ')}`);
  }
}

interface SampleRecord {
  id: string;
  name: string;
  accent: string;
  tone: string[];
  gender: string;
  file: string;
  bytes: number;
  durationSec: number;
}

async function generateOne(
  id: string,
  key: string,
): Promise<SampleRecord> {
  const meta = voiceById(id);
  if (meta === undefined) throw new Error(`Unknown voice "${id}".`);

  const wav = join(TEMP_DIR, `voice-sample-${id}.wav`);
  const mp3 = join(OUTPUT_DIR, `${id}.mp3`);
  const engine = createStudioEngine({ apiKey: key });

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const audio = await engine.generate(SAMPLE_LINE, { voice: id });
      if (audio.samples.length === 0 || !(audio.sampleRate > 0)) {
        throw new Error('The provider returned no audio.');
      }
      const durationSec = audio.samples.length / audio.sampleRate;

      // Write the decoded line to a WAV, then encode the delivered MP3.
      await mkdir(TEMP_DIR, { recursive: true });
      writeWavMono16(wav, audio.samples, audio.sampleRate);

      await mkdir(OUTPUT_DIR, { recursive: true });
      const tempMp3 = `${mp3}.tmp.mp3`;
      let bitrate = '96k';
      encodeMp3(wav, tempMp3, bitrate);
      let bytes = (await stat(tempMp3)).size;
      if (bytes > MAX_SAMPLE_BYTES) {
        bitrate = '64k';
        encodeMp3(wav, tempMp3, bitrate);
        bytes = (await stat(tempMp3)).size;
      }
      if (bytes > MAX_SAMPLE_BYTES) {
        throw new Error(`The encoded sample is ${bytes} bytes, over the 250 KB cap.`);
      }
      await rename(tempMp3, mp3);

      return {
        id,
        name: meta.name,
        accent: meta.accent,
        tone: [...meta.tone],
        gender: meta.gender,
        file: `${id}.mp3`,
        bytes,
        durationSec: Math.round(durationSec * 1000) / 1000,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        await new Promise<void>((done) => setTimeout(done, 900));
      }
    }
  }

  throw new Error(`${id}: ${messageOf(lastError)}`);
}

async function main(): Promise<void> {
  const key = await readKey();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const records: SampleRecord[] = [];
  const missing: string[] = [];

  for (const id of CURATED_VOICE_IDS) {
    const target = join(OUTPUT_DIR, `${id}.mp3`);
    if (!force && existsSync(target)) {
      const meta = voiceById(id);
      const info = await stat(target);
      if (meta !== undefined && info.size > 0 && info.size <= MAX_SAMPLE_BYTES) {
        records.push({
          id,
          name: meta.name,
          accent: meta.accent,
          tone: [...meta.tone],
          gender: meta.gender,
          file: `${id}.mp3`,
          bytes: info.size,
          durationSec: 0,
        });
        console.log(`[voice] ${id}: kept ${info.size} bytes`);
        continue;
      }
      await rm(target, { force: true });
    }

    try {
      const record = await generateOne(id, key);
      records.push(record);
      console.log(
        `[voice] ${id}: ${record.bytes} bytes, ${record.durationSec.toFixed(2)} s`,
      );
    } catch (error) {
      missing.push(id);
      console.error(`[voice] ${id}: FAILED — ${messageOf(error)}`);
    }
  }

  const manifest = {
    version: 1,
    line: SAMPLE_LINE,
    generatedAt: new Date().toISOString(),
    voices: records,
    missing,
  };
  const manifestPath = join(OUTPUT_DIR, VOICES_MANIFEST);
  const tempPath = `${manifestPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(tempPath, manifestPath);

  console.log(
    `[voice] wrote ${records.length} sample(s) to ${OUTPUT_DIR}` +
      (missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''),
  );
}

main().catch((error: unknown) => {
  // The error is already redacted by the engine; never print the key.
  console.error(`[voice] sample generation stopped: ${messageOf(error)}`);
  process.exitCode = 1;
});
