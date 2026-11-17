/**
 * The studio voice: ElevenLabs `eleven-v4` through OpenRouter's speech
 * endpoint.
 *
 * OpenRouter answers with raw audio bytes, not JSON. The engine turns those
 * bytes into the same `{ samples, sampleRate }` shape Kokoro returns, so the
 * plan/mix stage never learns which provider spoke a line.
 *
 * Everything expensive is behind a seam: `fetchImpl` and `decode` are
 * injectable, so tests exercise retries, caching and typed failures without a
 * network call or ffmpeg. The key is read from a getter on every request (a
 * key added in Settings works without a restart) and never appears in an
 * error, a cache file name or a log line.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { ffmpegPath } from '../../../packages/media/src/index';
import { voiceLinePath } from './cache';
import type { VoiceCacheTag } from './cache';
import { createKokoroEngine, DEFAULT_VOICE } from './tts';
import type { TtsAudio, TtsEngine } from './types';
import { DEFAULT_VOICE_ID, isVoiceId } from './voices';
import { readWavMono16, wavIsIntact, writeWavMono16 } from './wav';

export const STUDIO_SPEECH_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
export const STUDIO_MODEL_ID = 'elevenlabs/eleven-v4';
/** Gemini TTS is served by the same OpenRouter speech endpoint. */
export const GEMINI_TTS_PREFIX = 'google/gemini';
/** Gemini requires raw PCM and its own voice names. */
export const GEMINI_TTS_SAMPLE_RATE = 24_000;
export const GEMINI_VOICE_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  matilda: 'Kore',
  bella: 'Aoede',
  alice: 'Leda',
  sarah: 'Zephyr',
  jessica: 'Puck',
  lily: 'Fenrir',
  daniel: 'Orus',
  george: 'Charon',
});
/** $80 per million characters; used only for a plain-language receipt. */
export const STUDIO_USD_PER_CHAR = 80 / 1_000_000;
export const STUDIO_TIMEOUT_MS = 30_000;
export const STUDIO_SAMPLE_RATE = 44_100;

export type StudioVoiceErrorCode =
  | 'E_STUDIO_CONFIG'
  | 'E_STUDIO_AUTH'
  | 'E_STUDIO_RATE_LIMIT'
  | 'E_STUDIO_UNAVAILABLE'
  | 'E_STUDIO_TIMEOUT'
  | 'E_STUDIO_FAILED'
  | 'E_STUDIO_EMPTY'
  | 'E_STUDIO_DECODE';

/** A typed studio failure; `message` is safe to show in the UI. */
export class StudioVoiceError extends Error {
  readonly code: StudioVoiceErrorCode;
  readonly status?: number;

  constructor(
    code: StudioVoiceErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StudioVoiceError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
  }
}

/** The provider/model tag that keys every studio line in the voice cache. */
export const STUDIO_CACHE_TAG: VoiceCacheTag = Object.freeze({
  provider: 'studio',
  model: STUDIO_MODEL_ID,
});

type KeySource =
  | string
  | (() => string | undefined | Promise<string | undefined>);

export interface StudioEngineOptions {
  /** The OpenRouter key, or a getter read at call time. */
  apiKey: KeySource;
  /** Defaults to `elevenlabs/eleven-v4`. */
  model?: string;
  /** Defaults to the documented OpenRouter speech endpoint. */
  endpoint?: string;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Existing voice-line cache root (`data/voice`); absent disables the cache. */
  cacheDir?: string;
  /** Whole-request deadline, including the body read. Defaults to 30 s. */
  timeoutMs?: number;
  /** Delay before the single retry of a 429/5xx, in ms. */
  retryDelayMs?: number;
  /** `mp3` (decoded with ffmpeg) or raw 16-bit `pcm`. Defaults to mp3. */
  responseFormat?: 'mp3' | 'pcm';
  /** Sample rate of the raw PCM response. Defaults to 44.1 kHz. */
  pcmSampleRate?: number;
  /** Test seam for the byte decoder. */
  decode?: (bytes: Buffer, contentType: string) => Promise<TtsAudio>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** The key must never reach a log, an exception message or a URL. */
function redact(value: string, key: string | undefined): string {
  let safe = value;
  if (key !== undefined && key.length > 0) {
    safe = safe.split(key).join('[key]');
  }
  return safe.replace(/Bearer\s+\S+/gi, 'Bearer [key]');
}

function truncate(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

async function resolveKey(source: KeySource): Promise<string> {
  const value = typeof source === 'function' ? await source() : source;
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length === 0) {
    throw new StudioVoiceError(
      'E_STUDIO_CONFIG',
      'Add an OpenRouter API key in Settings to use the studio voice.',
    );
  }
  return key;
}

/**
 * Decodes an MP3/other compressed body to mono float samples with the ffmpeg
 * binary the renderer already ships. MP3 is self-describing, so the sample
 * rate comes from the file rather than a guess.
 */
function decodeWithFfmpeg(bytes: Buffer): TtsAudio {
  const result = spawnSync(
    ffmpegPath(),
    [
      '-hide_banner',
      '-v',
      'error',
      '-i',
      'pipe:0',
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      '-ac',
      '1',
      '-ar',
      String(STUDIO_SAMPLE_RATE),
      'pipe:1',
    ],
    {
      input: bytes,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.error !== undefined) {
    throw new StudioVoiceError('E_STUDIO_DECODE', 'The studio audio could not be decoded.', {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-3).join(' ');
    throw new StudioVoiceError(
      'E_STUDIO_DECODE',
      `The studio audio could not be decoded${tail.length > 0 ? ` (${tail})` : ''}.`,
    );
  }

  const raw = result.stdout;
  const count = Math.floor(raw.length / 4);
  if (count === 0) {
    throw new StudioVoiceError('E_STUDIO_EMPTY', 'The studio returned no audio for this line.');
  }
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = raw.readFloatLE(index * 4);
  }
  return { samples, sampleRate: STUDIO_SAMPLE_RATE };
}

/** Raw signed 16-bit little-endian mono. */
function decodePcm16(bytes: Buffer, sampleRate: number): TtsAudio {
  const count = Math.floor(bytes.length / 2);
  if (count === 0) {
    throw new StudioVoiceError('E_STUDIO_EMPTY', 'The studio returned no audio for this line.');
  }
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2) / 32768;
  }
  return { samples, sampleRate };
}

function looksLikeMp3(bytes: Buffer): boolean {
  if (bytes.length < 2) return false;
  // ID3 tag, or an MPEG frame sync.
  if (bytes.toString('ascii', 0, 3) === 'ID3') return true;
  return bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
}

/** Reads a cached line, regenerating a truncated one instead of reusing it. */
function readCachedLine(file: string): TtsAudio | null {
  try {
    if (!wavIsIntact(file)) {
      rmSync(file, { force: true });
      return null;
    }
    const wav = readWavMono16(file);
    return wav.samples.length > 0 ? wav : null;
  } catch {
    rmSync(file, { force: true });
    return null;
  }
}

/** Atomic, so a crash mid-write never publishes a half-line. */
function writeCachedLine(file: string, audio: TtsAudio): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeWavMono16(temp, audio.samples, audio.sampleRate);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function createStudioEngine(options: StudioEngineOptions): TtsEngine {
  const model = options.model ?? STUDIO_MODEL_ID;
  const isGemini = model.startsWith(GEMINI_TTS_PREFIX);
  const endpoint = options.endpoint ?? STUDIO_SPEECH_ENDPOINT;
  // Gemini rejects mp3 and our catalogue voice ids; it wants PCM and its own
  // voice names. ElevenLabs accepts the catalogue ids and mp3.
  const responseFormat: 'mp3' | 'pcm' = isGemini ? 'pcm' : (options.responseFormat ?? 'mp3');
  const pcmSampleRate = options.pcmSampleRate ?? (isGemini ? GEMINI_TTS_SAMPLE_RATE : STUDIO_SAMPLE_RATE);
  const providerVoice = (voice: string): string =>
    isGemini ? (GEMINI_VOICE_BY_ID[voice] ?? 'Kore') : voice;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? STUDIO_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 750;
  const cacheTag: VoiceCacheTag = { provider: 'studio', model };

  const decode = async (bytes: Buffer, contentType: string): Promise<TtsAudio> => {
    if (options.decode !== undefined) return options.decode(bytes, contentType);
    const lowercase = contentType.toLowerCase();
    if (lowercase.includes('mpeg') || lowercase.includes('mp3')) {
      return decodeWithFfmpeg(bytes);
    }
    if (lowercase.includes('pcm') || lowercase.includes('l16')) {
      return decodePcm16(bytes, pcmSampleRate);
    }
    // No useful content type: the requested format and the bytes decide.
    if (responseFormat === 'pcm' && !looksLikeMp3(bytes)) {
      return decodePcm16(bytes, pcmSampleRate);
    }
    return decodeWithFfmpeg(bytes);
  };

  return {
    async generate(text: string, generateOptions: { voice: string }): Promise<TtsAudio> {
      const input = text.trim();
      if (input.length === 0) {
        throw new StudioVoiceError('E_STUDIO_CONFIG', 'A studio line cannot be empty.');
      }
      if (!isVoiceId(generateOptions.voice)) {
        throw new StudioVoiceError(
          'E_STUDIO_CONFIG',
          `Unknown studio voice "${String(generateOptions.voice)}".`,
        );
      }
      const voice = generateOptions.voice;

      const cacheFile =
        options.cacheDir === undefined
          ? null
          : voiceLinePath(options.cacheDir, input, voice, cacheTag);
      if (cacheFile !== null && existsSync(cacheFile)) {
        const cached = readCachedLine(cacheFile);
        if (cached !== null) return cached;
      }

      const key = await resolveKey(options.apiKey);
      const body = JSON.stringify({
        model,
        input,
        voice: providerVoice(voice),
        response_format: responseFormat,
      });

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
              Accept: responseFormat === 'pcm' ? 'audio/pcm' : 'audio/mpeg',
            },
            body,
            signal: controller.signal,
          });
        } catch (error) {
          clearTimeout(timer);
          if (isAbort(error)) {
            throw new StudioVoiceError(
              'E_STUDIO_TIMEOUT',
              `The studio voice took longer than ${Math.round(timeoutMs / 1000)} seconds. Try again, or switch to the offline voice.`,
              { cause: error },
            );
          }
          // A dropped connection is transient: one retry, like a 5xx.
          if (attempt === 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }
          throw new StudioVoiceError(
            'E_STUDIO_UNAVAILABLE',
            `The studio voice could not be reached (${truncate(redact(messageOf(error), key), 140)}).`,
            { cause: error },
          );
        }

        try {
          if (!response.ok) {
            const detail = truncate(
              redact(await response.text().catch(() => ''), key),
              160,
            );
            const retryable = response.status === 429 || response.status >= 500;
            if (retryable && attempt === 1) {
              await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
              continue;
            }
            const suffix = detail.length > 0 ? ` ${detail}` : '';
            if (response.status === 401 || response.status === 403) {
              throw new StudioVoiceError(
                'E_STUDIO_AUTH',
                `OpenRouter rejected the key for studio speech (${response.status}). Check the key in Settings.${suffix}`,
                { status: response.status },
              );
            }
            if (response.status === 429) {
              throw new StudioVoiceError(
                'E_STUDIO_RATE_LIMIT',
                'The studio voice is busy right now. Wait a moment and try again.',
                { status: response.status },
              );
            }
            if (response.status >= 500) {
              throw new StudioVoiceError(
                'E_STUDIO_UNAVAILABLE',
                `The studio voice is unavailable (${response.status}). Try again shortly.`,
                { status: response.status },
              );
            }
            throw new StudioVoiceError(
              'E_STUDIO_FAILED',
              `The studio rejected this line (${response.status}).${suffix}`,
              { status: response.status },
            );
          }

          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length === 0) {
            throw new StudioVoiceError(
              'E_STUDIO_EMPTY',
              'The studio returned no audio for this line. Try again.',
            );
          }
          const contentType = response.headers.get('content-type') ?? '';
          const audio = await decode(bytes, contentType);
          if (audio.samples.length === 0 || !(audio.sampleRate > 0)) {
            throw new StudioVoiceError(
              'E_STUDIO_DECODE',
              'The studio returned audio this app could not read. Try another voice.',
            );
          }
          if (cacheFile !== null) writeCachedLine(cacheFile, audio);
          return audio;
        } catch (error) {
          if (error instanceof StudioVoiceError) throw error;
          if (isAbort(error)) {
            throw new StudioVoiceError(
              'E_STUDIO_TIMEOUT',
              `The studio voice took longer than ${Math.round(timeoutMs / 1000)} seconds. Try again, or switch to the offline voice.`,
              { cause: error },
            );
          }
          throw new StudioVoiceError(
            'E_STUDIO_UNAVAILABLE',
            `The studio audio could not be read (${truncate(redact(messageOf(error), key), 140)}).`,
            { cause: error },
          );
        } finally {
          clearTimeout(timer);
        }
      }

      // The loop either returns or throws; this keeps the type honest.
      throw new StudioVoiceError('E_STUDIO_FAILED', 'The studio voice failed.');
    },
  };
}

/* ── Provider selection ─────────────────────────────────────────────── */

export type VoiceProvider = 'auto' | 'studio' | 'local';

export interface StudioVoiceConfig {
  /** The key from secure storage; read per render so a new key needs no restart. */
  getApiKey: () => string | undefined | Promise<string | undefined>;
  /** The voice selected in Settings. */
  getVoiceId?: () => string | undefined | Promise<string | undefined>;
}

let activeStudioConfig: StudioVoiceConfig | undefined;

/**
 * Points `buildVoiceTrack` at the settings-owned key and voice. Called once in
 * the Electron main process; a plain Node caller can pass the same values on
 * the track input instead.
 */
export function configureStudioVoice(config: StudioVoiceConfig | undefined): void {
  activeStudioConfig = config;
}

export function studioVoiceConfig(): StudioVoiceConfig | undefined {
  return activeStudioConfig;
}

export interface SelectVoiceEngineOptions {
  /** `auto` uses the studio when a key exists, otherwise Kokoro. */
  provider?: VoiceProvider;
  /** Overrides the configured getter. */
  getApiKey?: () => string | undefined | Promise<string | undefined>;
  /** Studio voice id; defaults to the Settings selection, then matilda. */
  voiceId?: string;
  /** Kokoro voice used when the studio is unavailable. */
  localVoice?: string;
  cacheDir?: string;
  modelDir?: string;
  studioModel?: string;
  fetchImpl?: typeof fetch;
  decode?: (bytes: Buffer, contentType: string) => Promise<TtsAudio>;
}

export interface VoiceEngineSelection {
  provider: 'studio' | 'local';
  engine: TtsEngine;
  /** The voice id the engine will speak with. */
  voice: string;
  /** Provider model id, used as the cache tag. */
  model: string;
  /** Plain-language fallback note, when the studio was asked for but unusable. */
  warnings: string[];
}

/**
 * Chooses the studio engine when the machine has a key, and Kokoro otherwise.
 * A missing key is a warning, never a failed export: the offline voice still
 * speaks the bridge lines.
 */
export async function selectVoiceEngine(
  options: SelectVoiceEngineOptions = {},
): Promise<VoiceEngineSelection> {
  const provider = options.provider ?? 'auto';
  const warnings: string[] = [];

  const keySource = options.getApiKey ?? activeStudioConfig?.getApiKey;
  let key: string | undefined;
  if (keySource !== undefined) {
    try {
      const value = await keySource();
      key = typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
    } catch {
      key = undefined;
    }
  }

  if (provider !== 'local' && key !== undefined) {
    let configured: string | undefined;
    try {
      configured = await activeStudioConfig?.getVoiceId?.();
    } catch {
      configured = undefined;
    }
    const requested = options.voiceId ?? configured ?? DEFAULT_VOICE_ID;
    const voice = isVoiceId(requested) ? requested : DEFAULT_VOICE_ID;
    if (!isVoiceId(requested)) {
      warnings.push(
        `The selected voice "${String(requested)}" is not in the studio catalogue; using ${voice}.`,
      );
    }
    return {
      provider: 'studio',
      engine: createStudioEngine({
        apiKey: async () => key,
        cacheDir: options.cacheDir,
        ...(options.studioModel === undefined ? {} : { model: options.studioModel }),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.decode === undefined ? {} : { decode: options.decode }),
      }),
      voice,
      model: options.studioModel ?? STUDIO_MODEL_ID,
      warnings,
    };
  }

  if (provider === 'studio') {
    warnings.push(
      'No OpenRouter key is configured, so the studio voice cannot be used. Rendering with the offline Kokoro voice instead.',
    );
  } else if (provider === 'auto' && key === undefined) {
    warnings.push(
      'No OpenRouter key is configured; the offline Kokoro voice speaks the bridge lines.',
    );
  }

  const voice = options.localVoice ?? DEFAULT_VOICE;
  return {
    provider: 'local',
    engine: createKokoroEngine(undefined, {
      ...(options.modelDir === undefined ? {} : { modelDir: options.modelDir }),
    }),
    voice,
    model: 'kokoro-82m',
    warnings,
  };
}

/** True when a studio key can be resolved right now (a cheap preflight probe). */
export async function studioVoiceReady(
  getApiKey?: () => string | undefined | Promise<string | undefined>,
): Promise<boolean> {
  const source = getApiKey ?? activeStudioConfig?.getApiKey;
  if (source === undefined) return false;
  try {
    const value = await source();
    return typeof value === 'string' && value.trim().length > 0;
  } catch {
    return false;
  }
}
