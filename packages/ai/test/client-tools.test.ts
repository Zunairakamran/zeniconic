import { describe, expect, it } from 'vitest';
import { AiError, BudgetLedger, OpenRouterClient } from '../src/index';
import type { ChatMessage, ToolDefinition } from '../src/index';
import {
  API_KEY,
  bodyOf,
  callAt,
  completionBody,
  mockTransport,
  recordingSleep,
} from './helpers';

const MODEL = 'google/gemini-3.8-flash';

const SET_PRICE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'set_price',
    description: 'Record the confirmed asking price for the listing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['price'],
      properties: { price: { type: 'number', minimum: 0 } },
    },
  },
};

const NAMED_CAPTION_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_caption',
    parameters: {
      type: 'object',
      required: ['caption'],
      properties: { caption: { type: 'string', minLength: 1 } },
    },
  },
};

function user(content: string): ChatMessage {
  return { role: 'user', content };
}

interface ToolBodyOptions {
  content?: unknown;
  toolCalls?: unknown;
  finishReason?: unknown;
  usage?: unknown;
}

function toolCallBody(options: ToolBodyOptions = {}): Record<string, unknown> {
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: options.content === undefined ? null : options.content,
  };
  if (options.toolCalls !== undefined) message['tool_calls'] = options.toolCalls;
  return {
    id: 'gen-tool-test',
    model: MODEL,
    choices: [
      {
        index: 0,
        message,
        finish_reason: options.finishReason === undefined ? 'tool_calls' : options.finishReason,
      },
    ],
    usage: options.usage ?? { prompt_tokens: 1000, completion_tokens: 500 },
  };
}

const VALID_CALL = {
  id: 'call_1',
  type: 'function',
  function: { name: 'set_price', arguments: '{"price":425000}' },
};

describe('OpenRouterClient — tool request body', () => {
  it('sends tools and tool_choice natively and keeps provider preferences', async () => {
    const transport = mockTransport([{ body: toolCallBody({ toolCalls: [VALID_CALL] }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({
      model: MODEL,
      messages: [user('Set the price to £425,000.')],
      tools: [SET_PRICE_TOOL, NAMED_CAPTION_TOOL],
      toolChoice: 'required',
    });

    const body = bodyOf(callAt(transport.calls, 0));
    expect(body['tools']).toEqual([SET_PRICE_TOOL, NAMED_CAPTION_TOOL]);
    expect(body['tool_choice']).toBe('required');
    expect(body['provider']).toEqual({ data_collection: 'deny', allow_fallbacks: true });
    expect(body['temperature']).toBe(0.2);
    expect(body['response_format']).toBeUndefined();
  });

  it('accepts a named function tool_choice', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'ok' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({
      model: MODEL,
      messages: [user('Write a caption.')],
      tools: [NAMED_CAPTION_TOOL],
      toolChoice: { type: 'function', function: { name: 'write_caption' } },
    });

    expect(bodyOf(callAt(transport.calls, 0))['tool_choice']).toEqual({
      type: 'function',
      function: { name: 'write_caption' },
    });
  });

  it('does not send tool fields when no tools are supplied', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'plain' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({ model: MODEL, messages: [user('Hi')] });

    const body = bodyOf(callAt(transport.calls, 0));
    expect('tools' in body).toBe(false);
    expect('tool_choice' in body).toBe(false);
    expect('response_format' in body).toBe(false);
  });

  it('treats an empty tool list as absent so no provider 400 is provoked', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'plain' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({ model: MODEL, messages: [user('Hi')], tools: [] });

    expect('tools' in bodyOf(callAt(transport.calls, 0))).toBe(false);
  });

  it('sends a supplied tool_choice even without tools, verbatim', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'plain' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({ model: MODEL, messages: [user('Hi')], toolChoice: 'none' });

    const body = bodyOf(callAt(transport.calls, 0));
    expect(body['tool_choice']).toBe('none');
    expect('tools' in body).toBe(false);
  });
});

describe('OpenRouterClient — tool replies', () => {
  it('parses tool calls, empty content and the finish reason', async () => {
    const second = {
      id: 'call_2',
      type: 'function',
      function: { name: 'write_caption', arguments: '{"caption":"Sunlit kitchen"}' },
    };
    const transport = mockTransport([{ body: toolCallBody({ toolCalls: [VALID_CALL, second] }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({
      model: MODEL,
      messages: [user('Price it, then caption it.')],
      tools: [SET_PRICE_TOOL, NAMED_CAPTION_TOOL],
    });

    expect(response.toolCalls).toEqual([
      { id: 'call_1', name: 'set_price', arguments: '{"price":425000}' },
      { id: 'call_2', name: 'write_caption', arguments: '{"caption":"Sunlit kitchen"}' },
    ]);
    expect(response.text).toBe('');
    expect(response.finishReason).toBe('tool_calls');
    expect(response.usage).toEqual({ promptTokens: 1000, completionTokens: 500 });
    expect(response.costUsd).toBe(0.002625);
    expect(response.json).toBeUndefined();
  });

  it('keeps text alongside a tool call when the model sent both', async () => {
    const transport = mockTransport([
      { body: toolCallBody({ content: 'Checking the listing facts.', toolCalls: [VALID_CALL] }) },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Like this.')] });
    expect(response.text).toBe('Checking the listing facts.');
    expect(response.toolCalls).toHaveLength(1);
  });

  it('reports finish_reason "stop" on a normal reply', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'done' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });
    expect(response.finishReason).toBe('stop');
    expect(response.toolCalls).toBeUndefined();
  });

  it('ignores malformed tool_calls and keeps the usable text', async () => {
    const transport = mockTransport([
      {
        body: toolCallBody({
          content: 'Fallback answer.',
          finishReason: 'stop',
          toolCalls: [
            { id: 'bad_args', type: 'function', function: { name: 'set_price', arguments: 425000 } },
            { id: 'no_name', type: 'function', function: { arguments: '{}' } },
            { id: '', type: 'function', function: { name: 'set_price', arguments: '{}' } },
            { type: 'function', function: { name: 'set_price', arguments: '{}' } },
            'not-an-object',
            null,
            [VALID_CALL],
          ],
        }),
      },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });
    expect(response.toolCalls).toBeUndefined();
    expect(response.text).toBe('Fallback answer.');
    expect(response.finishReason).toBe('stop');
  });

  it('keeps the valid calls when only some entries are malformed', async () => {
    const transport = mockTransport([
      {
        body: toolCallBody({
          toolCalls: [
            { id: 'bad', type: 'function', function: { name: 'set_price', arguments: 1 } },
            VALID_CALL,
          ],
        }),
      },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });
    expect(response.toolCalls).toEqual([
      { id: 'call_1', name: 'set_price', arguments: '{"price":425000}' },
    ]);
  });

  it('still rejects a reply with no content and no usable tool call', async () => {
    const transport = mockTransport([
      {
        body: toolCallBody({
          content: null,
          toolCalls: [{ id: 'bad', type: 'function', function: { name: 'x', arguments: 1 } }],
        }),
      },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await expect(client.complete({ model: MODEL, messages: [user('Hi')] })).rejects.toMatchObject({
      code: 'E_SERVER',
    });
  });
});

describe('OpenRouterClient — tool message wire shape', () => {
  it('serialises assistant tool calls and the tool result', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'Price recorded.' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You edit property listings.' },
      user('What is the asking price?'),
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'set_price', arguments: '{"price":425000}' }],
      },
      { role: 'tool', toolCallId: 'call_1', name: 'set_price', content: '{"ok":true}' },
    ];

    await client.complete({ model: MODEL, messages, tools: [SET_PRICE_TOOL] });

    const wire = bodyOf(callAt(transport.calls, 0))['messages'];
    expect(Array.isArray(wire)).toBe(true);
    if (!Array.isArray(wire)) return;

    // The stable system prefix still comes first, followed by the exchange in order.
    expect(wire[0]).toMatchObject({ role: 'system' });
    expect(wire.map((message: { role: string }) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);

    const assistant = wire[2] as Record<string, unknown>;
    expect(assistant['content']).toBe('');
    expect(assistant['tool_calls']).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'set_price', arguments: '{"price":425000}' } },
    ]);
    expect(assistant['tool_call_id']).toBeUndefined();

    const tool = wire[3] as Record<string, unknown>;
    expect(tool).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'set_price',
      content: '{"ok":true}',
    });
  });

  it('omits name and tool_call_id keys the caller did not supply', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'ok' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({
      model: MODEL,
      messages: [
        user('Hi'),
        { role: 'assistant', content: 'one moment', toolCalls: [] },
        { role: 'tool', content: 'result' },
      ],
    });

    const wire = bodyOf(callAt(transport.calls, 0))['messages'];
    if (!Array.isArray(wire)) throw new Error('expected wire messages');
    const tool = wire[2] as Record<string, unknown>;
    expect(tool).toEqual({ role: 'tool', content: 'result' });

    const assistant = wire[1] as Record<string, unknown>;
    expect('tool_calls' in assistant).toBe(false);
  });

  it('flattens array content in a tool result to its text parts', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'ok' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({
      model: MODEL,
      messages: [
        user('Hi'),
        {
          role: 'tool',
          toolCallId: 'call_9',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ],
        },
      ],
    });

    const wire = bodyOf(callAt(transport.calls, 0))['messages'];
    if (!Array.isArray(wire)) throw new Error('expected wire messages');
    expect(wire[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_9',
      content: 'line one\nline two',
    });
  });
});

describe('OpenRouterClient — tool regressions', () => {
  it('still sends a strict response_format and no tools for a json-schema request', async () => {
    const schema: object = {
      type: 'object',
      required: ['caption'],
      properties: { caption: { type: 'string', minLength: 1 } },
    };
    const transport = mockTransport([
      { body: completionBody({ content: '{"caption":"Sunlit kitchen","price":1}' }) },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({
      model: MODEL,
      messages: [user('Kitchen.')],
      jsonSchema: schema,
    });

    expect(response.json).toEqual({ caption: 'Sunlit kitchen', price: 1 });
    const body = bodyOf(callAt(transport.calls, 0));
    expect(body['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'reply', strict: true, schema },
    });
    expect('tools' in body).toBe(false);
    expect('tool_choice' in body).toBe(false);
  });

  it('retries a tool request with the same payload and backoff', async () => {
    const transport = mockTransport([
      { status: 429, body: { error: { message: 'rate limited' } } },
      { body: toolCallBody({ toolCalls: [VALID_CALL] }) },
    ]);
    const { sleep, sleeps } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({
      model: MODEL,
      messages: [user('Set the price.')],
      tools: [SET_PRICE_TOOL],
      toolChoice: 'auto',
    });

    expect(transport.calls).toHaveLength(2);
    expect(sleeps).toEqual([300]);
    expect(bodyOf(callAt(transport.calls, 0))).toEqual(bodyOf(callAt(transport.calls, 1)));
    expect(response.toolCalls).toHaveLength(1);
  });

  it('commits the actual cost of a tool call to the ledger', async () => {
    const transport = mockTransport([{ body: toolCallBody({ toolCalls: [VALID_CALL] }) }]);
    const { sleep } = recordingSleep();
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep, ledger });

    const response = await client.complete({
      model: MODEL,
      messages: [user('Set the price.')],
      tools: [SET_PRICE_TOOL],
    });

    expect(ledger.spentUsd()).toBe(response.costUsd);
    expect(ledger.remainingUsd()).toBe(0.997375);
  });

  it('counts the tool schemas in the pre-flight estimate', async () => {
    const bigTool: ToolDefinition = {
      type: 'function',
      function: {
        name: 'set_price',
        description: 'x'.repeat(8000),
        parameters: { type: 'object', properties: {} },
      },
    };

    const withTools = mockTransport([{ body: completionBody({ content: 'unreachable' }) }]);
    const { sleep } = recordingSleep();
    const capped = new OpenRouterClient({
      apiKey: API_KEY,
      fetchImpl: withTools.fetchImpl,
      sleep,
      ledger: new BudgetLedger({ monthlyCapUsd: 1, perCallCapUsd: 0.001 }),
    });

    await expect(
      capped.complete({
        model: MODEL,
        messages: [user('Hi')],
        tools: [bigTool],
        maxTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'E_BUDGET' });
    expect(withTools.calls).toHaveLength(0);

    // The same call without the tool schema fits under the per-call cap.
    const withoutTools = mockTransport([{ body: completionBody({ content: 'fits' }) }]);
    const allowed = new OpenRouterClient({
      apiKey: API_KEY,
      fetchImpl: withoutTools.fetchImpl,
      sleep,
      ledger: new BudgetLedger({ monthlyCapUsd: 1, perCallCapUsd: 0.001 }),
    });

    const response = await allowed.complete({ model: MODEL, messages: [user('Hi')], maxTokens: 100 });
    expect(response.text).toBe('fits');
    expect(withoutTools.calls).toHaveLength(1);
  });

  it('never leaks the API key through a tool request failure', async () => {
    const transport = mockTransport([
      { status: 401, body: `{"error":"Incorrect API key provided: ${API_KEY}"}` },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const error = await client
      .complete({ model: MODEL, messages: [user('Hi')], tools: [SET_PRICE_TOOL] })
      .then(() => undefined, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AiError);
    const message = error instanceof Error ? error.message : '';
    expect(message).not.toContain(API_KEY);
  });
});
