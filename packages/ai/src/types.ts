import type { BudgetLedger } from './budget';

/**
 * One part of a multimodal message. Text and image parts may be mixed in a
 * single user turn; the array is forwarded to the provider unchanged.
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** A function the model may call, in the provider's native tool format. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    /** JSON Schema for the call arguments, validated by `parseToolArguments`. */
    parameters: object;
  };
}

/** One call the model requested. `arguments` is the raw JSON string, unparsed. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[];
  /** Assistant turns: the calls the model asked for, echoed back on the next request. */
  toolCalls?: ToolCall[];
  /** Tool turns only: the `ToolCall.id` this message answers. */
  toolCallId?: string;
  /** Tool turns only: the tool name, echoed for providers that expect it. */
  name?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When present, the reply must be valid JSON matching this JSON Schema. */
  jsonSchema?: object;
  /** Native function tools. Sent only when non-empty. */
  tools?: ToolDefinition[];
  /** Sent only when supplied; never inferred from `tools`. */
  toolChoice?: ToolChoice;
  timeoutMs?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  text: string;
  json?: unknown;
  /** Tool calls requested by the assistant, in provider order. */
  toolCalls?: ToolCall[];
  /** `choices[0].finish_reason`, e.g. `stop` or `tool_calls`. */
  finishReason?: string;
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
  | 'E_MODEL_CAPABILITY'
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
