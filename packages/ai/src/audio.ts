/**
 * Music generation through OpenRouter's audio-output chat models (Lyria).
 *
 * Audio only arrives as SSE chunks: `choices[0].delta.audio.data` holds a
 * base64 fragment. Lyria sends MP3 and does not take an `audio` object; the
 * final chunk carries `usage.cost`. We decode each fragment separately and
 * concatenate bytes, which is safe across chunk boundaries.
 */

import { AiError } from './types';
import { codeForStatus, redactSecrets } from './retry';
import type { FetchLike } from './types';

export interface GenerateAudioOptions {
  apiKey: string;
  model: string;
  prompt: string;
  fetchImpl: FetchLike | typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  now?: () => number;
}

export interface GeneratedAudio {
  bytes: Uint8Array;
  mimeType: string;
  model: string;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 180_000;
const REFERER = 'https://zeniconic.local';
const TITLE = 'Zeniconic';

interface SseChunk {
  choices?: Array<{ delta?: { audio?: { data?: unknown } }; finish_reason?: unknown }>;
  usage?: { cost?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown };
}

export async function generateAudioWithModel(options: GenerateAudioOptions): Promise<GeneratedAudio> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl as (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
      signal?: AbortSignal;
    },
  ) => Promise<{ ok: boolean; status: number; text(): Promise<string>; body?: unknown }>;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': REFERER,
        'X-Title': TITLE,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: 'user', content: options.prompt }],
        modalities: ['text', 'audio'],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AiError(
        codeForStatus(response.status),
        redactSecrets(`OpenRouter audio ${response.status}: ${text.slice(0, 300)}`, [options.apiKey]),
        { status: response.status },
      );
    }

    const body = response.body;
    if (body === undefined || body === null || typeof (body as { getReader?: unknown }).getReader !== 'function') {
      throw new AiError('E_JSON', 'OpenRouter did not stream an audio response.');
    }

    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const pieces: Uint8Array[] = [];
    let total = 0;
    let buffer = '';
    let costUsd = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload.length === 0 || payload === '[DONE]') continue;
        let chunk: SseChunk;
        try {
          chunk = JSON.parse(payload) as SseChunk;
        } catch {
          continue;
        }
        const fragment = chunk.choices?.[0]?.delta?.audio?.data;
        if (typeof fragment === 'string' && fragment.length > 0) {
          const bytes = Uint8Array.from(Buffer.from(fragment, 'base64'));
          pieces.push(bytes);
          total += bytes.length;
        }
        if (typeof chunk.usage?.cost === 'number' && Number.isFinite(chunk.usage.cost)) {
          costUsd = chunk.usage.cost;
        }
        if (typeof chunk.usage?.prompt_tokens === 'number') promptTokens = chunk.usage.prompt_tokens;
        if (typeof chunk.usage?.completion_tokens === 'number') completionTokens = chunk.usage.completion_tokens;
      }
    }

    if (total === 0) {
      throw new AiError(
        'E_JSON',
        'The music model returned no audio. Retry with a simpler prompt or another audio model.',
      );
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const piece of pieces) {
      bytes.set(piece, offset);
      offset += piece.length;
    }

    return {
      bytes,
      mimeType: 'audio/mpeg',
      model: options.model,
      costUsd,
      promptTokens,
      completionTokens,
    };
  } catch (error) {
    if (error instanceof AiError) throw error;
    const aborted = controller.signal.aborted;
    throw new AiError(
      aborted ? 'E_NETWORK' : 'E_NETWORK',
      redactSecrets(
        aborted
          ? `Music generation timed out after ${String(Math.round(timeoutMs / 1000))} s.`
          : `Music generation failed: ${error instanceof Error ? error.message : String(error)}`,
        [options.apiKey],
      ),
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}
