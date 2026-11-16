/**
 * ElevenLabs Scribe v2 via OpenRouter, typed and testable.
 *
 * The client owns transport concerns only: base64 the audio, ask for
 * `verbose_json` with word granularity, retry a rate limit or a server fault
 * once, and normalise the reply. It never reads `.env`, never logs and never
 * puts the key in an error message.
 */

import {
  codeForStatus,
  excerpt,
  isRetryableStatus,
  redactSecrets,
} from '@zeniconic/ai';
import type { AiErrorCode, FetchLike } from '@zeniconic/ai';

export const DEFAULT_TRANSCRIPTION_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_TRANSCRIPTION_MODEL = 'elevenlabs/scribe-v2';
export const TRANSCRIPTION_TIMEOUT_MS = 60_000;
/** OpenRouter's per-request audio ceiling. */
export const MAX_AUDIO_CHUNK_BYTES = 25 * 1024 * 1024;

const RETRY_DELAY_MS = 300;
const MAX_RETRIES = 1;
const REFERER = 'https://zeniconic.local';
const TITLE = 'Zeniconic';

export interface AudioInput {
  data: Uint8Array;
  /** Container hint, e.g. `mp3`, `m4a`, `wav`. Leading dots are stripped. */
  format: string;
  /** Known runtime, used to keep offsets stable when the provider omits it. */
  durationSec?: number;
}

/** One normalised word with source-relative seconds. */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  durationSec: number;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

export type TranscriptionErrorCode = Extract<
  AiErrorCode,
  'E_AUTH' | 'E_RATE' | 'E_SERVER' | 'E_BAD_REQUEST' | 'E_NETWORK' | 'E_JSON'
>;

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly status: number | undefined;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TranscriptionError';
    this.code = code;
    this.status = options.status;
  }
}

export interface TranscribeOptions {
  /**
   * The settings-owned key, read lazily on every call so changing it in Settings
   * does not require restarting the app.
   */
  getApiKey: () => string | Promise<string>;
  /** Defaults to the platform fetch. Tests inject a fake. */
  fetchImpl?: FetchLike;
  baseUrl?: string;
  model?: string;
  /** Defaults to 60 s. */
  timeoutMs?: number;
  /** Injectable so retry tests never wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Delay before the single retry. Defaults to 300 ms. */
  retryDelayMs?: number;
  language?: string;
  /** Raw bytes per request. Defaults to 25 MB. */
  maxAudioBytes?: number;
  /**
   * Optional splitter for compressed containers. Byte-slicing an MP4/M4A
   * produces invalid parts, so a caller that wants to chunk those must supply
   * independently decodable parts here. WAV is safe to slice.
   */
  chunkAudio?: (audio: AudioInput, maxBytes: number) => readonly AudioInput[];
}

export interface Transcriber {
  transcribe(audio: AudioInput | readonly AudioInput[]): Promise<TranscriptionResult>;
}

interface JsonObject {
  [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normaliseFormat(format: string): string {
  const cleaned = format.trim().replace(/^\./, '').toLowerCase();
  if (cleaned.length === 0) {
    throw new TranscriptionError('E_BAD_REQUEST', 'Audio format must be a non-empty string.');
  }
  return cleaned;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Splits raw bytes into <= maxBytes parts. This is safe for WAV and for
 * best-effort MP3; container formats that need an index (MP4/M4A) must be
 * split into valid files by the caller's `chunkAudio`.
 */
export function chunkAudioBytes(data: Uint8Array, maxBytes: number): Uint8Array[] {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(`maxBytes must be a positive integer, received ${maxBytes}`);
  }
  if (data.length <= maxBytes) return [data];

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += maxBytes) {
    chunks.push(data.slice(offset, Math.min(data.length, offset + maxBytes)));
  }
  return chunks;
}

function splitPart(
  part: AudioInput,
  maxBytes: number,
  chunker: TranscribeOptions['chunkAudio'],
): AudioInput[] {
  if (part.data.length === 0) {
    throw new TranscriptionError('E_BAD_REQUEST', 'Audio input is empty.');
  }
  if (part.data.length <= maxBytes) return [part];

  if (chunker) {
    const provided = [...chunker(part, maxBytes)];
    if (provided.length === 0) {
      throw new TranscriptionError('E_BAD_REQUEST', 'chunkAudio returned no parts.');
    }
    return provided.map((chunk) => ({
      ...chunk,
      format: normaliseFormat(chunk.format),
    }));
  }

  const chunks = chunkAudioBytes(part.data, maxBytes);
  return chunks.map((data) => {
    const fraction = data.length / part.data.length;
    return {
      data,
      format: normaliseFormat(part.format),
      ...(part.durationSec === undefined
        ? {}
        : { durationSec: round3(part.durationSec * fraction) }),
    };
  });
}

function normaliseReply(
  raw: unknown,
  fallbackDurationSec: number | undefined,
): TranscriptionResult {
  if (!isObject(raw)) {
    throw new TranscriptionError('E_JSON', 'Transcription response was not a JSON object.');
  }

  const words: TranscriptWord[] = [];
  for (const entry of asArray(raw.words)) {
    if (!isObject(entry)) continue;

    const word = asString(entry.word) ?? asString(entry.text);
    const start = asNumber(entry.start) ?? asNumber(entry.startSec);
    const end = asNumber(entry.end) ?? asNumber(entry.endSec);
    if (word === undefined || start === undefined || end === undefined) continue;
    if (start < 0 || end < start) continue;

    words.push({ word: word.trim(), start: round3(start), end: round3(end) });
  }
  words.sort((a, b) => a.start - b.start || a.end - b.end);

  const segments: TranscriptSegment[] = [];
  for (const entry of asArray(raw.segments)) {
    if (!isObject(entry)) continue;

    const start = asNumber(entry.start) ?? asNumber(entry.startSec);
    const end = asNumber(entry.end) ?? asNumber(entry.endSec);
    const text = asString(entry.text);
    if (start === undefined || end === undefined || text === undefined) continue;
    if (start < 0 || end < start) continue;

    const id = asNumber(entry.id);
    segments.push({
      ...(id === undefined ? {} : { id: Math.trunc(id) }),
      start: round3(start),
      end: round3(end),
      text: text.trim(),
    });
  }
  segments.sort((a, b) => a.start - b.start);

  const lastWordEnd = words.length > 0 ? words[words.length - 1]?.end ?? 0 : 0;
  const lastSegmentEnd = segments.length > 0 ? segments[segments.length - 1]?.end ?? 0 : 0;
  const reportedDuration =
    asNumber(raw.duration) ??
    asNumber(raw.duration_seconds) ??
    asNumber(raw.durationSec);

  const durationSec = round3(
    reportedDuration !== undefined && reportedDuration > 0
      ? reportedDuration
      : Math.max(0, lastWordEnd, lastSegmentEnd, fallbackDurationSec ?? 0),
  );

  const text =
    asString(raw.text) ??
    words.map((word) => word.word).join(' ');

  return {
    text: text.trim(),
    language: asString(raw.language) ?? 'und',
    durationSec,
    words,
    segments,
  };
}

function offsetResult(
  result: TranscriptionResult,
  offsetSec: number,
): TranscriptionResult {
  return {
    text: result.text,
    language: result.language,
    durationSec: result.durationSec,
    words: result.words.map((word) => ({
      word: word.word,
      start: round3(word.start + offsetSec),
      end: round3(word.end + offsetSec),
    })),
    segments: result.segments.map((segment) => ({
      ...segment,
      start: round3(segment.start + offsetSec),
      end: round3(segment.end + offsetSec),
    })),
  };
}

function mergeResults(results: readonly TranscriptionResult[]): TranscriptionResult {
  if (results.length === 0) {
    return { text: '', language: 'und', durationSec: 0, words: [], segments: [] };
  }

  const words: TranscriptWord[] = [];
  const segments: TranscriptSegment[] = [];
  const texts: string[] = [];
  let durationSec = 0;
  let language = 'und';

  for (const result of results) {
    if (result.text.length > 0) texts.push(result.text);
    if (language === 'und' && result.language !== 'und') language = result.language;
    durationSec = round3(Math.max(durationSec, result.durationSec));
    words.push(...result.words);
    segments.push(...result.segments);
  }

  return { text: texts.join(' ').trim(), language, durationSec, words, segments };
}

function transportFetch(): FetchLike {
  return (url, init) => fetch(url, init);
}

/**
 * Builds a reusable client. The key is resolved per call; the returned object
 * holds only the provider options, never the resolved credential.
 */
export function createTranscriber(options: TranscribeOptions): Transcriber {
  const fetchImpl = options.fetchImpl ?? transportFetch();
  const baseUrl = (options.baseUrl ?? DEFAULT_TRANSCRIPTION_BASE_URL).replace(/\/+$/, '');
  const model = options.model ?? DEFAULT_TRANSCRIPTION_MODEL;
  const timeoutMs = options.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS;
  const maxAudioBytes = options.maxAudioBytes ?? MAX_AUDIO_CHUNK_BYTES;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`timeoutMs must be a positive finite number, received ${timeoutMs}`);
  }
  if (!Number.isInteger(maxAudioBytes) || maxAudioBytes <= 0) {
    throw new RangeError(`maxAudioBytes must be a positive integer, received ${maxAudioBytes}`);
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError(`retryDelayMs must be a non-negative finite number, received ${retryDelayMs}`);
  }

  async function resolveKey(): Promise<string> {
    let key: string;
    try {
      key = (await options.getApiKey()).trim();
    } catch (cause) {
      throw new TranscriptionError(
        'E_AUTH',
        'Could not read the OpenRouter API key. Check Settings and try again.',
        { cause },
      );
    }
    if (key.length === 0) {
      throw new TranscriptionError(
        'E_AUTH',
        'OpenRouter API key is required. Add it in Settings and try again.',
      );
    }
    return key;
  }

  function redact(text: string, key: string): string {
    return redactSecrets(text, [key]);
  }

  async function send(
    part: AudioInput,
    key: string,
  ): Promise<{ ok: boolean; status: number; body: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body = JSON.stringify({
      model,
      input_audio: {
        data: Buffer.from(part.data).toString('base64'),
        format: normaliseFormat(part.format),
      },
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
      ...(options.language === undefined ? {} : { language: options.language }),
    });

    try {
      const response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': REFERER,
          'X-Title': TITLE,
        },
        body,
        signal: controller.signal,
      });

      return {
        ok: response.ok,
        status: response.status,
        body: await response.text(),
      };
    } catch (cause) {
      const timedOut = controller.signal.aborted;
      const detail = timedOut ? `request timed out after ${timeoutMs}ms` : 'network request failed';
      throw new TranscriptionError(
        'E_NETWORK',
        redact(`OpenRouter transcription ${detail}.`, key),
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function transcribePart(part: AudioInput, key: string): Promise<TranscriptionResult> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const reply = await send(part, key);

      if (reply.ok) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(reply.body);
        } catch (cause) {
          throw new TranscriptionError(
            'E_JSON',
            redact(
              `OpenRouter transcription returned invalid JSON: ${excerpt(reply.body, 300, [key])}`,
              key,
            ),
            { cause },
          );
        }
        return normaliseReply(parsed, part.durationSec);
      }

      const retryable = isRetryableStatus(reply.status);
      if (retryable && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs);
        continue;
      }

      const code = codeForStatus(reply.status) as TranscriptionErrorCode;
      throw new TranscriptionError(
        code,
        redact(
          `OpenRouter transcription ${reply.status}: ${excerpt(reply.body, 300, [key])}`,
          key,
        ),
        { status: reply.status },
      );
    }

    throw new TranscriptionError(
      'E_NETWORK',
      'OpenRouter transcription exhausted its retries without a response.',
    );
  }

  return {
    async transcribe(audio: AudioInput | readonly AudioInput[]): Promise<TranscriptionResult> {
      const key = await resolveKey();
      const inputs = Array.isArray(audio) ? audio : [audio];
      if (inputs.length === 0) {
        throw new TranscriptionError('E_BAD_REQUEST', 'At least one audio part is required.');
      }

      const parts = inputs.flatMap((part) =>
        splitPart(part, maxAudioBytes, options.chunkAudio),
      );
      if (parts.length === 0) {
        throw new TranscriptionError('E_BAD_REQUEST', 'At least one audio part is required.');
      }

      const results: TranscriptionResult[] = [];
      let offsetSec = 0;

      for (const part of parts) {
        const result = await transcribePart(part, key);
        const shifted = offsetResult(result, offsetSec);
        results.push(shifted);

        const measured = Math.max(
          result.durationSec,
          result.words[result.words.length - 1]?.end ?? 0,
          result.segments[result.segments.length - 1]?.end ?? 0,
        );
        offsetSec = round3(offsetSec + measured);
      }

      const merged = mergeResults(results);
      return {
        ...merged,
        durationSec: round3(Math.max(merged.durationSec, offsetSec)),
      };
    },
  };
}

/** One-shot convenience wrapper; build a client when transcribing repeatedly. */
export function transcribeAudio(
  audio: AudioInput | readonly AudioInput[],
  options: TranscribeOptions,
): Promise<TranscriptionResult> {
  return createTranscriber(options).transcribe(audio);
}
