import { estimateCostUsd, roundCostUsd } from './cost';
import { parseEnvelope } from './envelope';
import type { Envelope } from './envelope';
import { parseJsonReply } from './json';
import { buildWireMessages } from './messages';
import { codeForStatus, excerpt, isRetryableStatus, redactSecrets, retryDelayMs } from './retry';
import { AiError } from './types';
import type { BudgetLedger } from './budget';
import type {
  ChatClient,
  ChatContentPart,
  ChatRequest,
  ChatResponse,
  ClientOptions,
  FetchLike,
  ToolDefinition,
} from './types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS_ESTIMATE = 4096;
const CHARS_PER_TOKEN = 4;
const TOKENS_PER_MESSAGE = 4;
const REFERER = 'https://zeniconic.local';
const TITLE = 'Zeniconic';
const PROVIDER_PREFERENCES = { data_collection: 'deny', allow_fallbacks: true } as const;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface TransportReply {
  ok: boolean;
  status: number;
  body: string;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}

/**
 * Characters that will be billed: the text, plus the base64 image URL, which is
 * the bulk of a vision request. Plain strings keep their exact previous count.
 */
function contentChars(content: string | ChatContentPart[]): number {
  if (typeof content === 'string') return content.length;
  return content.reduce(
    (total, part) => total + (part.type === 'text' ? part.text.length : part.image_url.url.length),
    0,
  );
}

/**
 * Tools travel natively in `tools`; an empty array is treated as absent so a
 * caller spreading an empty registry cannot provoke a provider 400.
 */
function wireTools(req: ChatRequest): ToolDefinition[] | undefined {
  return req.tools !== undefined && req.tools.length > 0 ? req.tools : undefined;
}

export class OpenRouterClient implements ChatClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly ledger: BudgetLedger | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(options: ClientOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new AiError('E_AUTH', 'OpenRouter API key is required; the caller passes it in, this package never reads .env.');
    }
    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new RangeError('maxRetries must be an integer >= 0');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl;
    this.ledger = options.ledger;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = maxRetries;
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    // Price the request before touching the network: an unknown model or an
    // over-budget call must never be sent. Evaluated even when no ledger is
    // attached, so `E_UNKNOWN_MODEL` always fires pre-flight.
    const estimatedUsd = this.estimateRequestUsd(req);
    this.ledger?.reserve(estimatedUsd);

    try {
      const envelope = await this.request(req);
      const grossUsd = estimateCostUsd(req.model, envelope.usage);
      const costUsd = roundCostUsd(Math.max(0, grossUsd - envelope.cacheDiscountUsd), 6);
      this.ledger?.commit(costUsd);

      const json = req.jsonSchema === undefined ? undefined : parseJsonReply(envelope.text, req.jsonSchema);
      return {
        text: envelope.text,
        usage: envelope.usage,
        costUsd,
        model: envelope.model ?? req.model,
        cachedTokens: envelope.cachedTokens,
        cacheDiscountUsd: envelope.cacheDiscountUsd,
        ...(json === undefined ? {} : { json }),
        ...(envelope.toolCalls.length === 0 ? {} : { toolCalls: envelope.toolCalls }),
        ...(envelope.finishReason === undefined ? {} : { finishReason: envelope.finishReason }),
      };
    } catch (error) {
      // A failed or already-committed call releases the reservation; spend stays.
      this.ledger?.release();
      throw error;
    }
  }

  /** Conservative: prompt chars / 4, plus the full completion allowance. */
  private estimateRequestUsd(req: ChatRequest): number {
    const toolTokens = (wireTools(req) ?? []).reduce(
      (total, tool) => total + Math.ceil(JSON.stringify(tool).length / CHARS_PER_TOKEN) + TOKENS_PER_MESSAGE,
      0,
    );
    const messageTokens = req.messages.reduce(
      (total, message) => total + Math.ceil(contentChars(message.content) / CHARS_PER_TOKEN) + TOKENS_PER_MESSAGE,
      0,
    );
    const completionTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS_ESTIMATE;
    return estimateCostUsd(req.model, {
      promptTokens: messageTokens + toolTokens,
      completionTokens,
    });
  }

  private requestBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: buildWireMessages(req),
      temperature: req.temperature ?? DEFAULT_TEMPERATURE,
      provider: PROVIDER_PREFERENCES,
    };
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.jsonSchema !== undefined) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'reply', strict: true, schema: req.jsonSchema },
      };
    }
    const tools = wireTools(req);
    if (tools !== undefined) body.tools = tools;
    if (req.toolChoice !== undefined) body.tool_choice = req.toolChoice;
    return body;
  }

  private async request(req: ChatRequest): Promise<Envelope> {
    const url = `${this.baseUrl}/chat/completions`;
    const payload = JSON.stringify(this.requestBody(req));

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let reply: TransportReply;
      try {
        reply = await this.send(url, payload, req.timeoutMs);
      } catch (error) {
        if (error instanceof AiError && error.code === 'E_NETWORK' && attempt < this.maxRetries) {
          await this.sleep(retryDelayMs(attempt));
          continue;
        }
        throw error;
      }

      if (reply.ok) return parseEnvelope(reply.body);

      if (!isRetryableStatus(reply.status) || attempt === this.maxRetries) {
        throw new AiError(
          codeForStatus(reply.status),
          this.redact(`OpenRouter ${reply.status}: ${excerpt(reply.body, 300)}`),
          { status: reply.status },
        );
      }
      await this.sleep(retryDelayMs(attempt));
    }

    throw new AiError('E_NETWORK', 'OpenRouter request exhausted its retries without a response.');
  }

  private async send(url: string, payload: string, timeoutMs: number | undefined): Promise<TransportReply> {
    const controller = timeoutMs !== undefined && timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': REFERER,
          'X-Title': TITLE,
        },
        body: payload,
        ...(controller === undefined ? {} : { signal: controller.signal }),
      });
      const body = await response.text();
      return { ok: response.ok, status: response.status, body };
    } catch (cause) {
      const timedOut = controller?.signal.aborted === true;
      const detail = timedOut ? `request timed out after ${String(timeoutMs)}ms` : messageOf(cause);
      throw new AiError('E_NETWORK', this.redact(`Network error calling OpenRouter: ${detail}`), { cause });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private redact(text: string): string {
    return redactSecrets(text, [this.apiKey]);
  }
}
