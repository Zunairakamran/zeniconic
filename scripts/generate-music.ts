#!/usr/bin/env tsx
/**
 * Generate one licence-clean music bed for the prototype.
 *
 * Two paths, in order:
 *
 *   1. Lyria via OpenRouter (`roles.music` in services/pipeline/models.json).
 *      Audio comes back as `choices[0].message.audio.data` (base64) or
 *      `.url`; either way it is trimmed/padded to the requested duration and
 *      encoded to 48 kHz stereo AAC 192k.
 *   2. FFmpeg synthesis, when the API has no key, returns no audio, or the
 *      response cannot be decoded. A warm three-sine pad with a slow tremolo,
 *      a 2.5 kHz low-pass and gentle stereo detune, plus a soft sine thump on
 *      every beat. Two-pass `loudnorm` to -18 LUFS, true peak -2 dBTP, then
 *      0.8 s fade-in and 1.2 s fade-out. This is a placeholder bed, not a
 *      licensed catalogue track.
 *
 * Both paths write `data/music/<id>.m4a` and `data/music/<id>.json`. The
 * package catalogue (`packages/music/src/catalog.ts`) is deliberately NOT
 * touched: a synthesised bed must not masquerade as a licensed source.
 *
 * Usage:
 *   npx tsx scripts/generate-music.ts --mood calm --duration 35 --bpm 96 \
 *     --out data/music/calm-bed-96.m4a [--skip-lyria]
 *
 * No dependencies beyond the bundled ffmpeg/ffprobe. The API key is read from
 * `.env` (or the process environment) and is never printed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPath, ffprobePath } from '../packages/media/src/paths';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Mood = 'calm' | 'luxury' | 'social' | 'cinematic';

const MOODS: readonly Mood[] = ['calm', 'luxury', 'social', 'cinematic'];

interface MoodSpec {
  /** Root of the chord, in Hz. The fifth and octave are ratio-derived. */
  root: number;
  /** Tremolo rate for the pad, in Hz. Slow enough to breathe, not wobble. */
  tremoloHz: number;
  prompt: string;
}

const SPECS: Record<Mood, MoodSpec> = {
  calm: {
    root: 110.0, // A2
    tremoloHz: 0.11,
    prompt:
      'Warm, slow ambient real-estate bed. Soft felt-piano pad, airy room tone, no drums or only a very soft heartbeat pulse, no vocals, no lead melody, understated and expensive. Seamless and loopable.',
  },
  luxury: {
    root: 130.81, // C3
    tremoloHz: 0.12,
    prompt:
      'Understated luxury real-estate bed. Warm analogue pad, muted electric piano, quiet brushed pulse, deep and calm, no vocals, no lead melody, nothing that demands attention. Seamless and loopable.',
  },
  social: {
    root: 98.0, // G2
    tremoloHz: 0.22,
    prompt:
      'Catchy modern house bed for luxury property reels. Memorable plucked synth hook, warm chords, four-on-the-floor groove at 120 BPM, elegant and optimistic, no vocals. Strong hook but mixed to sit under a voiceover. Seamless and loopable.',
  },
  cinematic: {
    root: 73.42, // D2
    tremoloHz: 0.1,
    prompt:
      'Wide cinematic real-estate bed. Low warm strings pad, slow swell, distant soft pulse, restrained and spacious, no vocals, no big melody, room for a voiceover. Seamless and loopable.',
  },
};

interface Options {
  mood: Mood;
  durationSec: number;
  bpm: number;
  out: string;
  skipLyria: boolean;
}

interface ProbeSummary {
  durationSec: number;
  channels: number;
  sampleRate: number;
  codec: string;
  bitRate: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function parseNumber(flag: string, raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(`${flag} must be a number between ${min} and ${max}, received ${JSON.stringify(raw)}`);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  let mood: Mood = 'calm';
  let durationSec = 35;
  let bpm = 96;
  let out: string | undefined;
  let skipLyria = false;

  const takeValue = (flag: string, index: number): [string, number] => {
    const inline = argv[index]?.includes('=') ? argv[index]?.split('=').slice(1).join('=') : undefined;
    if (inline !== undefined) return [inline, index];
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) fail(`${flag} needs a value`);
    return [next, index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    const flag = arg.split('=')[0];
    switch (flag) {
      case '--mood': {
        const [value] = takeValue(flag, index);
        if (!MOODS.includes(value as Mood)) {
          fail(`--mood must be one of ${MOODS.join('|')}, received ${JSON.stringify(value)}`);
        }
        mood = value as Mood;
        if (!arg.includes('=')) index += 1;
        break;
      }
      case '--duration': {
        const [value, nextIndex] = takeValue(flag, index);
        durationSec = parseNumber(flag, value, 4, 300);
        index = nextIndex;
        break;
      }
      case '--bpm': {
        const [value, nextIndex] = takeValue(flag, index);
        bpm = parseNumber(flag, value, 40, 240);
        index = nextIndex;
        break;
      }
      case '--out': {
        const [value, nextIndex] = takeValue(flag, index);
        out = value;
        index = nextIndex;
        break;
      }
      case '--skip-lyria':
        skipLyria = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'usage: npx tsx scripts/generate-music.ts ' +
            '[--mood calm|luxury|social|cinematic] [--duration 35] [--bpm 96] ' +
            '[--out data/music/<id>.m4a] [--skip-lyria]',
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${JSON.stringify(arg)} (try --help)`);
    }
  }

  if (out === undefined) {
    const moodSlug = `${mood}-${String(bpm).replace(/\./g, '-')}bpm`;
    out = join('data', 'music', `${moodSlug}.m4a`);
  }
  if (extname(out).toLowerCase() !== '.m4a') {
    fail(`--out must end in .m4a, received ${JSON.stringify(out)}`);
  }

  return {
    mood,
    durationSec: Math.round(durationSec * 1000) / 1000,
    bpm: Math.round(bpm * 1000) / 1000,
    out: isAbsolute(out) ? out : resolve(repoRoot, out),
    skipLyria,
  };
}

/** Same shape as services/pipeline/config.mjs, minus the import (this is a .ts script). */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

interface RuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function loadRuntimeConfig(): RuntimeConfig {
  const fileEnv = parseEnvFile(join(repoRoot, '.env'));
  const read = (key: string): string => process.env[key] ?? fileEnv[key] ?? '';

  let roleModel = 'google/lyria-3-pro-preview';
  try {
    const modelsPath = join(repoRoot, 'services', 'pipeline', 'models.json');
    const models = JSON.parse(readFileSync(modelsPath, 'utf8')) as {
      roles?: { music?: { model?: string } };
    };
    roleModel = models.roles?.music?.model ?? roleModel;
  } catch {
    // A missing/invalid models.json is not fatal: the pinned id is the default.
  }

  return {
    apiKey: read('OPENROUTER_API_KEY'),
    baseUrl: read('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1',
    model: read('MUSIC_MODEL') || roleModel,
  };
}

/** Keep secrets out of any log or error message. */
function redact(text: string): string {
  return text
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, 'sk-or-v1-…')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer …');
}

function runTool(bin: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function probe(path: string): ProbeSummary | null {
  const result = runTool(ffprobePath(), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ]);
  if (!result.ok) return null;

  try {
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number }>;
    };
    const stream = parsed.streams?.find((entry) => entry.codec_type === 'audio');
    const duration = Number(parsed.format?.duration);
    if (!stream || !Number.isFinite(duration)) return null;
    return {
      durationSec: Math.round(duration * 1000) / 1000,
      channels: stream.channels ?? 0,
      sampleRate: Number(stream.sample_rate ?? 0),
      codec: stream.codec_name ?? 'unknown',
      bitRate: Number(parsed.format?.bit_rate ?? 0),
    };
  } catch {
    return null;
  }
}

function measureLufs(path: string): number | null {
  const result = runTool(ffmpegPath(), [
    '-hide_banner',
    '-nostdin',
    '-i',
    path,
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
  // ebur128 prints a running `I:` while measuring and the final value in the
  // summary; take the last one, not the -70 LUFS of the first frame.
  const values = [...result.stderr.matchAll(/\bI:\s+(-?[\d.]+)\s+LUFS/g)];
  const last = values.at(-1);
  if (!last) return null;
  const value = Number(last[1]);
  return Number.isFinite(value) ? value : null;
}

function toRepoPath(path: string): string {
  const rel = relative(repoRoot, path);
  return (rel.startsWith('..') ? path : rel).replace(/\\/g, '/');
}

function titleFromId(id: string): string {
  const words = id.split('-').filter(Boolean);
  if (words.length === 0) return 'Music Bed';
  return words
    .map((word) => (/^\d+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* Path 1: Lyria via OpenRouter                                        */
/* ------------------------------------------------------------------ */

interface LyriaAudio {
  data?: string;
  url?: string;
  format?: string;
}

interface LyriaMessagePart {
  type?: string;
  audio?: LyriaAudio;
  data?: string;
  url?: string;
}

function audioFromMessage(message: unknown): LyriaAudio | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as {
    audio?: LyriaAudio;
    content?: unknown;
  };

  if (record.audio && (record.audio.data || record.audio.url)) return record.audio;

  if (Array.isArray(record.content)) {
    for (const rawPart of record.content) {
      if (typeof rawPart !== 'object' || rawPart === null) continue;
      const part = rawPart as LyriaMessagePart;
      if (part.audio && (part.audio.data || part.audio.url)) return part.audio;
      if ((part.type === 'audio' || part.type === 'output_audio') && (part.data || part.url)) {
        return { data: part.data, url: part.url };
      }
    }
  }

  return null;
}

function responseExcerpt(message: unknown): string {
  if (typeof message !== 'object' || message === null) return 'no message';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim().replace(/\s+/g, ' ').slice(0, 160);
  }
  return 'audio field absent';
}

function inputArgsFor(format: string | undefined, path: string): string[] {
  if (format === 'pcm16' || format === 'pcm') {
    return ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', path];
  }
  return ['-i', path];
}

/**
 * OpenRouter only returns audio on a streaming request, so the audio arrives
 * as base64 chunks in `delta.audio.data`. Decode each chunk separately (each
 * is independently padded) and concatenate the bytes; a `url` is used as-is.
 */
async function collectAudioStream(
  response: Response,
): Promise<{ audio: LyriaAudio | null; text: string; error: string | null }> {
  if (!response.body) return { audio: null, text: '', error: 'stream had no body' };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Buffer[] = [];
  const textParts: string[] = [];
  let url: string | undefined;
  let format: string | undefined;
  let buffer = '';
  let error: string | null = null;

  const consume = (payload: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }

    const record = parsed as {
      error?: { message?: string };
      choices?: Array<{ delta?: unknown; message?: unknown }>;
    };
    if (record.error?.message) {
      error = record.error.message;
      return;
    }

    const delta = record.choices?.[0]?.delta ?? record.choices?.[0]?.message;
    if (typeof delta !== 'object' || delta === null) return;

    const found = audioFromMessage(delta);
    if (found?.data) chunks.push(Buffer.from(found.data, 'base64'));
    if (found?.url) url = found.url;
    if (found?.format) format = found.format;

    const content = (delta as { content?: unknown }).content;
    if (typeof content === 'string') textParts.push(content);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload.length > 0 && payload !== '[DONE]') consume(payload);
      }
      newline = buffer.indexOf('\n');
    }
  }

  const audio: LyriaAudio | null =
    chunks.length > 0
      ? { data: Buffer.concat(chunks).toString('base64'), format }
      : url !== undefined
        ? { url, format }
        : null;

  return { audio, text: textParts.join(' ').trim(), error };
}

/**
 * One generation attempt. Returns the path of a validated m4a, or null with a
 * human-readable reason. Never throws: the caller falls back to synthesis.
 */
async function tryLyria(
  options: Options,
  runtime: RuntimeConfig,
): Promise<{ file: string; reason: string } | { file: null; reason: string }> {
  if (options.skipLyria) return { file: null, reason: 'skipped (--skip-lyria)' };
  if (!runtime.apiKey) return { file: null, reason: 'OPENROUTER_API_KEY is not set' };

  const spec = SPECS[options.mood];
  const prompt = `${spec.prompt} Instrumental only. ${options.durationSec} seconds at ${options.bpm} BPM.`;
  const body = {
    model: runtime.model,
    modalities: ['audio', 'text'],
    // OpenRouter rejects audio output without this: "Audio output requires stream: true".
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  };

  let response: Response;
  try {
    response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://zeniconic.local',
        'X-Title': 'Zeniconic',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    return { file: null, reason: `request failed: ${redact(String(error))}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      file: null,
      reason: `HTTP ${response.status}: ${redact(text).replace(/\s+/g, ' ').slice(0, 220)}`,
    };
  }

  let audio: LyriaAudio | null = null;
  let detail = 'audio field absent';

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const collected = await collectAudioStream(response).catch((error: unknown) => ({
      audio: null,
      text: '',
      error: String(error),
    }));
    if (collected.error !== null) {
      return { file: null, reason: `stream error: ${redact(collected.error).slice(0, 220)}` };
    }
    audio = collected.audio;
    if (collected.text.length > 0) detail = collected.text.replace(/\s+/g, ' ').slice(0, 160);
  } else {
    const text = await response.text().catch(() => '');
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { file: null, reason: 'response was not JSON' };
    }

    const choice = (payload as { choices?: Array<{ message?: unknown }> }).choices?.[0];
    audio = audioFromMessage(choice?.message);
    detail = responseExcerpt(choice?.message);
  }

  if (!audio) {
    return { file: null, reason: `no audio in response (${detail})` };
  }

  const workDir = dirname(options.out);
  mkdirSync(workDir, { recursive: true });
  const id = basename(options.out, extname(options.out));
  const sourcePath = join(workDir, `.${id}.lyria-source`);
  const transcoded = join(workDir, `.${id}.lyria.m4a`);

  try {
    if (audio.data) {
      const buffer = Buffer.from(audio.data, 'base64');
      if (buffer.byteLength < 1024) return { file: null, reason: 'decoded audio was empty' };
      writeFileSync(sourcePath, buffer);
    } else if (audio.url) {
      const download = await fetch(audio.url, { signal: AbortSignal.timeout(120_000) });
      if (!download.ok) return { file: null, reason: `audio URL returned HTTP ${download.status}` };
      writeFileSync(sourcePath, Buffer.from(await download.arrayBuffer()));
    } else {
      return { file: null, reason: 'audio object had neither data nor url' };
    }

    const fadeOutStart = Math.max(0, options.durationSec - 1.2);
    const transcode = runTool(ffmpegPath(), [
      '-hide_banner',
      '-nostdin',
      '-y',
      ...inputArgsFor(audio.format, sourcePath),
      '-af',
      `atrim=0:${options.durationSec},apad=whole_dur=${options.durationSec},` +
        `afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOutStart}:d=1.2`,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      transcoded,
    ]);
    if (!transcode.ok) {
      return { file: null, reason: `decode failed: ${redact(transcode.stderr).slice(-200)}` };
    }

    const summary = probe(transcoded);
    if (!summary || summary.durationSec < options.durationSec - 0.25) {
      return { file: null, reason: 'decoded audio did not reach the requested duration' };
    }

    writeFileSync(options.out, readFileSync(transcoded));
    return { file: options.out, reason: `generated with ${runtime.model}` };
  } finally {
    rmSync(sourcePath, { force: true });
    rmSync(transcoded, { force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Path 2: FFmpeg synthesis                                            */
/* ------------------------------------------------------------------ */

const PAD_ROOT_VOLUME = 0.14;
const PAD_FIFTH_VOLUME = 0.09;
const PAD_OCTAVE_VOLUME = 0.07;
const PULSE_VOLUME = 0.18;
const PAD_LOW_PASS_HZ = 2500;
const FADE_IN_SEC = 0.8;
const FADE_OUT_SEC = 1.2;
const TARGET_LUFS = -18;
const TARGET_TRUE_PEAK = -2;

function padGraph(options: Options): string {
  const spec = SPECS[options.mood];
  const root = spec.root;
  const fifth = root * 1.5;
  const octave = root * 2;
  const duration = options.durationSec;
  const beat = 60 / options.bpm;
  // The thump is an octave below the pad, but never below 49 Hz.
  const pulseHz = root / 2 >= 49 ? root / 2 : root;
  const detune = Math.round(48_000 * 1.0015);

  const freq = (hz: number): string => hz.toFixed(3).replace(/\.?0+$/, '');
  // Phase since the last beat, without a comma (which would split the filtergraph).
  const phase = `(t-floor(t/${beat.toFixed(6)})*${beat.toFixed(6)})`;

  return [
    `sine=frequency=${freq(root)}:sample_rate=48000:duration=${duration}[root]`,
    `sine=frequency=${freq(fifth)}:sample_rate=48000:duration=${duration}[fifth]`,
    `sine=frequency=${freq(octave)}:sample_rate=48000:duration=${duration}[octave]`,
    `[root]volume=${PAD_ROOT_VOLUME}[r]`,
    `[fifth]volume=${PAD_FIFTH_VOLUME}[f]`,
    `[octave]volume=${PAD_OCTAVE_VOLUME}[o]`,
    '[r][f][o]amix=inputs=3:normalize=0:duration=longest[pad]',
    // 35 Hz keeps sub-rumble out without thinning the root.
    `[pad]highpass=f=35,tremolo=f=${spec.tremoloHz}:d=0.35,lowpass=f=${PAD_LOW_PASS_HZ}[padT]`,
    // Gentle width: the right side runs 0.15% sharp, so the two channels drift
    // in and out of phase over seconds instead of being a doubled mono line.
    '[padT]asplit=2[padL][padR0]',
    `[padR0]asetrate=${detune},aresample=48000,apad=whole_dur=${duration},atrim=0:${duration},` +
      'aformat=channel_layouts=mono[padR]',
    '[padL]aformat=channel_layouts=mono[padLm]',
    '[padLm][padR]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[padSt]',
    // Soft sine thump on every beat: 4 ms attack, 70 ms decay. The guard keeps
    // the first frame (where t is NaN) silent instead of logging a warning.
    `sine=frequency=${freq(pulseHz)}:sample_rate=48000:duration=${duration}[pulse0]`,
    `[pulse0]volume=volume='if(eq(t,t),(1-exp(-${phase}/0.004))*exp(-${phase}/0.07),0)':eval=frame,` +
      `lowpass=f=220,volume=${PULSE_VOLUME}[pulse]`,
    '[pulse]aformat=channel_layouts=stereo[pulseSt]',
    '[padSt][pulseSt]amix=inputs=2:normalize=0:duration=longest,atrim=0:' +
      `${duration}[mix]`,
  ].join(';');
}

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

function measureForLoudnorm(graph: string): LoudnormMeasurement | null {
  const result = runTool(ffmpegPath(), [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-filter_complex',
    `${graph};[mix]loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=7:print_format=json[measured]`,
    '-map',
    '[measured]',
    '-f',
    'null',
    '-',
  ]);
  if (!result.ok) return null;

  // loudnorm prints a bare JSON object at the end of stderr.
  const match = result.stderr.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Partial<LoudnormMeasurement>;
    if (
      parsed.input_i === undefined ||
      parsed.input_tp === undefined ||
      parsed.input_lra === undefined ||
      parsed.input_thresh === undefined ||
      parsed.target_offset === undefined
    ) {
      return null;
    }
    // "-inf" (silence) cannot be corrected linearly.
    if (!Number.isFinite(Number(parsed.input_i)) || Number(parsed.input_i) < -70) return null;
    return parsed as LoudnormMeasurement;
  } catch {
    return null;
  }
}

function synthesise(options: Options): { file: string; loudness: number | null } {
  mkdirSync(dirname(options.out), { recursive: true });
  const graph = padGraph(options);
  const work = join(dirname(options.out), `.${basename(options.out, extname(options.out))}.synth.m4a`);

  const measurement = measureForLoudnorm(graph);
  const loudnorm =
    measurement === null
      ? `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=7`
      : `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=7:` +
        `measured_I=${measurement.input_i}:measured_TP=${measurement.input_tp}:` +
        `measured_LRA=${measurement.input_lra}:measured_thresh=${measurement.input_thresh}:` +
        `offset=${measurement.target_offset}:linear=true`;

  if (measurement === null) {
    console.warn('  loudnorm: measure pass failed, using single-pass dynamic mode');
  }

  const fadeOutStart = Math.max(0, options.durationSec - FADE_OUT_SEC);
  const filters =
    `${graph};[mix]${loudnorm},` +
    `afade=t=in:st=0:d=${FADE_IN_SEC},` +
    `afade=t=out:st=${fadeOutStart}:d=${FADE_OUT_SEC},` +
    // Guarantees no inter-sample overshoot survives the AAC encoder.
    'alimiter=limit=0.79:attack=5:release=50:level=false[out]';

  const encoded = runTool(ffmpegPath(), [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-filter_complex',
    filters,
    '-map',
    '[out]',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    work,
  ]);

  if (!encoded.ok) {
    rmSync(work, { force: true });
    fail(`ffmpeg synthesis failed: ${redact(encoded.stderr).trim().slice(-400)}`);
  }

  const summary = probe(work);
  if (!summary) {
    rmSync(work, { force: true });
    fail('ffmpeg wrote a file that ffprobe could not read');
  }
  if (summary.durationSec < options.durationSec - 0.25) {
    rmSync(work, { force: true });
    fail(`synthesis produced ${summary.durationSec}s, expected ${options.durationSec}s`);
  }
  if (summary.channels !== 2 || summary.sampleRate !== 48_000) {
    rmSync(work, { force: true });
    fail(
      `synthesis produced ${summary.channels} ch at ${summary.sampleRate} Hz, expected 2 ch at 48000 Hz`,
    );
  }

  writeFileSync(options.out, readFileSync(work));
  rmSync(work, { force: true });
  return { file: options.out, loudness: measureLufs(options.out) };
}

/* ------------------------------------------------------------------ */
/* Metadata and main                                                   */
/* ------------------------------------------------------------------ */

interface TrackMetadata {
  id: string;
  title: string;
  mood: Mood;
  bpm: number;
  durationSec: number;
  file: string;
  license: { source: string; licenseId: string };
  generatedBy: 'lyria' | 'synthesised';
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runtime = loadRuntimeConfig();
  const id = basename(options.out, extname(options.out));
  const metadataPath = join(dirname(options.out), `${id}.json`);
  const today = new Date().toISOString().slice(0, 10);

  console.log(`music: ${options.mood}, ${options.durationSec}s, ${options.bpm} BPM`);
  console.log(`model: ${runtime.model}`);

  let generatedBy: 'lyria' | 'synthesised' = 'synthesised';
  let loudness: number | null = null;
  let reason = '';

  console.log('path 1: lyria via OpenRouter');
  const lyria = await tryLyria(options, runtime);
  if (lyria.file !== null) {
    generatedBy = 'lyria';
    reason = lyria.reason;
    loudness = measureLufs(lyria.file);
  } else {
    console.log(`  no audio: ${lyria.reason}`);
    reason = lyria.reason;
  }

  if (generatedBy === 'lyria') {
    console.log(`  ok: ${reason}`);
  } else {
    console.log('path 2: ffmpeg synthesis (placeholder bed)');
    const synth = synthesise(options);
    loudness = synth.loudness;
    console.log('  ok: warm pad + soft beat pulse');
  }

  const summary = probe(options.out);
  if (!summary) {
    rmSync(options.out, { force: true });
    fail('the written file does not probe; nothing usable was produced');
  }

  const metadata: TrackMetadata = {
    id,
    title: titleFromId(id),
    mood: options.mood,
    bpm: options.bpm,
    durationSec: summary.durationSec,
    file: toRepoPath(options.out),
    license:
      generatedBy === 'lyria'
        ? { source: 'ai_generated', licenseId: `lyria:gen-${today}-${id}` }
        : { source: 'synthesised', licenseId: `zeniconic-synthesis:${today}-${id}` },
    generatedBy,
  };

  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const kbps = summary.bitRate > 0 ? Math.round(summary.bitRate / 1000) : 0;
  console.log('');
  console.log(`path ran:            ${generatedBy === 'lyria' ? 'lyria (real generation)' : 'synthesised (ffmpeg fallback)'}`);
  if (generatedBy !== 'lyria') console.log(`why fallback:        ${reason}`);
  console.log(`audio:               ${toRepoPath(options.out)}`);
  console.log(`metadata:            ${toRepoPath(metadataPath)}`);
  console.log(
    `probe:               ${summary.durationSec.toFixed(3)} s, ${summary.channels} ch, ` +
      `${summary.sampleRate} Hz, ${summary.codec} ${kbps} kb/s`,
  );
  console.log(`loudness:            ${loudness === null ? 'not measured' : `${loudness.toFixed(1)} LUFS`}`);
  if (generatedBy === 'lyria') {
    console.log('catalogue:           unchanged (the file lives in data/music/, not data/assets/music/)');
  } else {
    console.log(
      'catalogue:           NOT updated — this bed is synthesised, not a licensed source track;',
    );
    console.log('                     it is a prototype placeholder and must not be shipped as catalogue audio.');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`failed: ${redact(message)}`);
  process.exit(1);
});
