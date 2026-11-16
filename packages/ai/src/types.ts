import type { BudgetLedger } from './budget';

/**
 * One part of a multimodal message. Text and image parts may be mixed in a
 * single user turn; the array is forwarded to the provider unchanged.
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When present, the reply must be valid JSON matching this JSON Schema. */
  jsonSchema?: object;
  timeoutMs?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  text: string;
  json?: unknown;
  usage: Usage;
  /** Net cost after the provider's cache discount, rounded to 6 dp. */
  costUsd: number;
  model: string;
  /** `usage.prompt_tokens_details.cached_tokens`, or 0 when not reported. */
  cachedTokens: number;
  /** `usage.cache_discount` in USD, or 0 when not reported. */
  cacheDiscountUsd: number;
}

export interface FetchLike {
  (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
      signal?: AbortSignal;
    },
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export interface ChatClient {
  complete(req: ChatRequest): Promise<ChatResponse>;
}

export interface ClientOptions {
  apiKey: string;
  /** Defaults to https://openrouter.ai/api/v1 */
  baseUrl?: string;
  fetchImpl: FetchLike;
  ledger?: BudgetLedger;
  /** Injectable so tests never wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to 2. */
  maxRetries?: number;
}

export type AiErrorCode =
  | 'E_AUTH'
  | 'E_RATE'
  | 'E_SERVER'
  | 'E_BAD_REQUEST'
  | 'E_NETWORK'
  | 'E_JSON'
  | 'E_BUDGET'
  | 'E_UNKNOWN_MODEL';

export interface AiErrorOptions {
  status?: number;
  /** Human-readable schema issue paths, e.g. `/caption must be string`. */
  issues?: string[];
  cause?: unknown;
}

/**
 * The single error type thrown by this package. `code` is stable; callers branch
 * on it instead of parsing messages.
 */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number | undefined;
  readonly issues: string[];

  constructor(code: AiErrorCode, message: string, options: AiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiError';
    this.code = code;
    this.status = options.status;
    this.issues = options.issues ?? [];
  }
}
