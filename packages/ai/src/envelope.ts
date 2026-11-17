import { excerpt } from './retry';
import { AiError } from './types';
import type { ToolCall, Usage } from './types';

export interface Envelope {
  text: string;
  toolCalls: ToolCall[];
  finishReason: string | undefined;
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

/**
 * Reads `tool_calls` defensively: only complete entries with string id, name and
 * arguments survive. A provider quirk is dropped rather than allowed to crash a
 * reply that otherwise carries usable text.
 */
function toolCallsOf(message: Record<string, unknown>): ToolCall[] {
  const raw = message['tool_calls'];
  if (!Array.isArray(raw)) return [];

  const calls: ToolCall[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const fn = asRecord(record?.['function']);
    const id = record?.['id'];
    const name = fn?.['name'];
    const args = fn?.['arguments'];
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof name !== 'string' || name.length === 0) continue;
    if (typeof args !== 'string') continue;
    calls.push({ id, name, arguments: args });
  }
  return calls;
}

/** Some models return `content` as parts; concatenate the text parts only. */
function contentToText(content: unknown, allowEmpty: boolean): string {
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
  // A tool-calling reply legitimately has `content: null`.
  if (allowEmpty && (content === null || content === undefined)) return '';
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

  const toolCalls = toolCallsOf(message);
  const usageRaw = asRecord(root['usage']);
  const details = asRecord(usageRaw?.['prompt_tokens_details']);
  const reportedModel = root['model'];
  const reportedFinish = firstChoice?.['finish_reason'];

  return {
    text: contentToText(message['content'], toolCalls.length > 0),
    toolCalls,
    finishReason:
      typeof reportedFinish === 'string' && reportedFinish.length > 0 ? reportedFinish : undefined,
    usage: {
      promptTokens: tokenCount(usageRaw?.['prompt_tokens']),
      completionTokens: tokenCount(usageRaw?.['completion_tokens']),
    },
    cachedTokens: tokenCount(details?.['cached_tokens']),
    cacheDiscountUsd: money(usageRaw?.['cache_discount']),
    model: typeof reportedModel === 'string' && reportedModel.length > 0 ? reportedModel : undefined,
  };
}
