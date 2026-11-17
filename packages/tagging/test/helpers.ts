import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatClient, ChatRequest, ChatResponse } from '@zeniconic/ai';
import type { ShotTags } from '../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXTURES = resolve(HERE, 'fixtures');
export const SHEET_PATH = resolve(FIXTURES, 'sheet.jpg');
export const TAGS_PATH = resolve(FIXTURES, 'shot-tags.json');

export const MODEL = 'google/gemini-3.8-flash:floor';
export const PROMPT_VERSION = 'tag-1.3.0';
export const DURATION = 6.5;

/** A defensive copy, so a test can mutate the fixture without leaking. */
export function validTags(): ShotTags {
  return JSON.parse(readFileSync(TAGS_PATH, 'utf8')) as ShotTags;
}

export function sheetBytes(): Uint8Array {
  return new Uint8Array(readFileSync(SHEET_PATH));
}

export interface MockReply {
  /** Parsed payload the client would have validated. */
  json?: unknown;
  /** Raw reply text, for clients that return JSON without a parsed field. */
  text?: string;
  /** Thrown instead of replying, e.g. a transport or auth failure. */
  throws?: unknown;
  /** Overrides the billed cost for this reply. Defaults to 0.000196. */
  costUsd?: number;
  /** Reply as a client that reports no cost at all would. */
  omitCost?: boolean;
}

export interface MockClientHandle {
  client: ChatClient;
  calls: ChatRequest[];
}

/** A client that replays queued replies and records every request. */
export function mockClient(replies: MockReply[]): MockClientHandle {
  const calls: ChatRequest[] = [];
  let index = 0;

  const client: ChatClient = {
    async complete(req) {
      calls.push(req);
      const reply = replies[index];
      index += 1;
      if (reply === undefined) throw new Error(`Unexpected model call #${index}`);
      if (reply.throws !== undefined) throw reply.throws;

      const text = reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
      const billing = reply.omitCost === true ? {} : { costUsd: reply.costUsd ?? 0.000196 };
      return {
        text,
        ...(reply.json === undefined ? {} : { json: reply.json }),
        usage: { promptTokens: 1200, completionTokens: 180 },
        ...billing,
        model: req.model,
        cachedTokens: 0,
        cacheDiscountUsd: 0,
      } as ChatResponse;
    },
  };

  return { client, calls };
}
