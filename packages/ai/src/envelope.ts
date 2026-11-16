import { excerpt } from './retry';
import { AiError } from './types';
import type { Usage } from './types';

export interface Envelope {
  text: string;
  usage: Usage;
  cachedTokens: number;
  cacheDiscountUsd: number;
  model: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function money(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Some models return `content` as parts; concatenate the text parts only. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = asRecord(part);
        const text = record?.['text'];
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  throw new AiError('E_SERVER', 'OpenRouter response message had no usable content.');
}

/** Reads the OpenRouter envelope, including cache accounting, from raw JSON. */
export function parseEnvelope(rawBody: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (cause) {
    throw new AiError('E_SERVER', `OpenRouter returned a non-JSON body: ${excerpt(rawBody, 120)}`, { cause });
  }

  const root = asRecord(parsed);
  const choices = root?.['choices'];
  const firstChoice = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
  const message = firstChoice === undefined ? undefined : asRecord(firstChoice['message']);
  if (root === undefined || message === undefined) {
    throw new AiError('E_SERVER', 'OpenRouter response had no message.');
  }

  const usageRaw = asRecord(root['usage']);
  const details = asRecord(usageRaw?.['prompt_tokens_details']);
  const reportedModel = root['model'];

  return {
    text: contentToText(message['content']),
    usage: {
      promptTokens: tokenCount(usageRaw?.['prompt_tokens']),
      completionTokens: tokenCount(usageRaw?.['completion_tokens']),
    },
    cachedTokens: tokenCount(details?.['cached_tokens']),
    cacheDiscountUsd: money(usageRaw?.['cache_discount']),
    model: typeof reportedModel === 'string' && reportedModel.length > 0 ? reportedModel : undefined,
  };
}
