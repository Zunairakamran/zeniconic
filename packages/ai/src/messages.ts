import type { ChatContentPart, ChatMessage, ChatRequest, ChatRole, ToolCall } from './types';

export interface TextPart {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface WireToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface WireMessage {
  role: ChatRole;
  content: string | TextPart[] | ChatContentPart[];
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  name?: string;
}

const SCHEMA_PREAMBLE =
  'Return a single JSON value that validates against this JSON Schema. No prose, no code fences.';

export function isAnthropicModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('anthropic/');
}

/** System messages carry instructions only; image parts are dropped there. */
function textOf(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** Instructions from every system message, in the order the caller supplied them. */
function instructionsOf(req: ChatRequest): string {
  return req.messages
    .filter((message) => message.role === 'system')
    .map((message) => textOf(message.content))
    .filter((content) => content.length > 0)
    .join('\n\n');
}

function schemaBlock(schema: object): string {
  return `${SCHEMA_PREAMBLE}\n${JSON.stringify(schema)}`;
}

/**
 * The stable prefix: instructions first, then the schema. Nothing variable is
 * allowed in here — the whole point is that the provider can cache these bytes
 * across calls in the same stage. Tool schemas ride in the native `tools` field
 * (which the provider also caches), so they are not duplicated here.
 */
function stablePrefix(req: ChatRequest): string {
  return [instructionsOf(req), req.jsonSchema === undefined ? '' : schemaBlock(req.jsonSchema)]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

/**
 * Anthropic caches a prefix up to and including the block that carries
 * `cache_control`. Instructions and schema stay separate blocks so the final
 * one can mark the whole prefix as cacheable; other providers use the same
 * ordering and rely on their implicit caching.
 */
function anthropicSystemParts(req: ChatRequest): TextPart[] {
  const parts: TextPart[] = [];
  const instructions = instructionsOf(req);
  if (instructions.length > 0) parts.push({ type: 'text', text: instructions });
  if (req.jsonSchema !== undefined) parts.push({ type: 'text', text: schemaBlock(req.jsonSchema) });

  const last = parts[parts.length - 1];
  if (last !== undefined) last.cache_control = { type: 'ephemeral' };
  return parts;
}

function wireToolCalls(calls: ToolCall[]): WireToolCall[] {
  return calls.map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments },
  }));
}

/**
 * Tool turns carry `tool_call_id` (and optionally the tool name) beside their
 * content. Content is flattened to text: providers do not accept image parts
 * in a tool result, and silently dropping them would hide the problem.
 */
function wireToolMessage(message: ChatMessage): WireMessage {
  const wire: WireMessage = { role: 'tool', content: textOf(message.content) };
  if (message.toolCallId !== undefined) wire.tool_call_id = message.toolCallId;
  if (message.name !== undefined) wire.name = message.name;
  return wire;
}

function wireMessage(message: ChatMessage): WireMessage {
  if (message.role === 'tool') return wireToolMessage(message);

  const wire: WireMessage = { role: message.role, content: message.content };
  if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
    wire.tool_calls = wireToolCalls(message.toolCalls);
  }
  return wire;
}

/**
 * Rewrites a request into wire messages with the stable prefix first and the
 * variable content (shot table, user request, tool exchange) last. Consecutive
 * system messages are merged, because a second system turn would break
 * Anthropic's prefix.
 */
export function buildWireMessages(req: ChatRequest): WireMessage[] {
  const variable: WireMessage[] = req.messages
    .filter((message) => message.role !== 'system')
    .map(wireMessage);

  const prefix = stablePrefix(req);
  if (prefix.length === 0) return variable;

  if (!isAnthropicModel(req.model)) {
    return [{ role: 'system', content: prefix }, ...variable];
  }
  return [{ role: 'system', content: anthropicSystemParts(req) }, ...variable];
}
