import type { FetchLike } from '../src/index';

export const API_KEY = 'sk-or-v1-testkey000000000000000000000000000000000000';

export interface RecordedCall {
  url: string;
  init: Parameters<FetchLike>[1];
}

export interface MockReply {
  status?: number;
  body?: unknown;
  throws?: Error;
}

export interface MockTransport {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
}

/** A transport that replays queued replies and records every request. */
export function mockTransport(replies: MockReply[]): MockTransport {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const reply = replies[index];
    index += 1;
    if (reply === undefined) throw new Error(`Unexpected fetch call #${index}`);

    if (reply.throws !== undefined) throw reply.throws;
    const status = reply.status ?? 200;
    const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    };
  };

  return { fetchImpl, calls };
}

export interface CompletionOptions {
  content?: unknown;
  usage?: Record<string, unknown>;
  model?: string;
}

export function completionBody(options: CompletionOptions = {}): Record<string, unknown> {
  return {
    id: 'gen-test',
    model: options.model ?? 'google/gemini-3.8-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: options.content ?? 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: options.usage ?? { prompt_tokens: 1000, completion_tokens: 500 },
  };
}

export interface SleepRecorder {
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
}

export function recordingSleep(): SleepRecorder {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
    },
  };
}

export function callAt(calls: RecordedCall[], index: number): RecordedCall {
  const call = calls[index];
  if (call === undefined) throw new Error(`Expected a fetch call at index ${index}`);
  return call;
}

export function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(call.init.body) as Record<string, unknown>;
}

export interface WirePart {
  type?: unknown;
  text?: unknown;
  cache_control?: unknown;
}

/** Normalises the first wire message to content parts, string content included. */
export function systemParts(body: Record<string, unknown>): WirePart[] {
  const messages = body['messages'];
  if (!Array.isArray(messages)) return [];
  const first: unknown = messages[0];
  if (typeof first !== 'object' || first === null) return [];
  const record = first as { role?: unknown; content?: unknown };
  if (record.role !== 'system') return [];
  if (typeof record.content === 'string') return [{ type: 'text', text: record.content }];
  if (!Array.isArray(record.content)) return [];
  return record.content as WirePart[];
}

export function serialisedSystemMessage(body: Record<string, unknown>): string {
  const messages = body['messages'];
  if (!Array.isArray(messages)) return '';
  return JSON.stringify(messages[0] ?? null);
}
