import { describe, expect, it } from 'vitest';
import { AiError, BudgetLedger, MODEL_PRICES, OpenRouterClient, estimateCostUsd } from '../src/index';
import type { ChatMessage } from '../src/index';
import {
  API_KEY,
  bodyOf,
  callAt,
  completionBody,
  mockTransport,
  recordingSleep,
  serialisedSystemMessage,
  systemParts,
} from './helpers';

const MODEL = 'google/gemini-3.8-flash';

function user(content: string): ChatMessage {
  return { role: 'user', content };
}

const CAPTION_SCHEMA: object = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'price'],
  properties: {
    caption: { type: 'string', minLength: 1 },
    price: { type: 'number' },
  },
};

describe('OpenRouterClient — transport', () => {
  it('returns text, usage and a cost computed from MODEL_PRICES', async () => {
    const transport = mockTransport([
      { body: completionBody({ content: 'Sunlit kitchen with oak floors.' }) },
    ]);
    const { sleep, sleeps } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({
      model: MODEL,
      messages: [user('Describe the kitchen in one line.')],
      maxTokens: 500,
    });

    expect(response.text).toBe('Sunlit kitchen with oak floors.');
    expect(response.usage).toEqual({ promptTokens: 1000, completionTokens: 500 });
    expect(estimateCostUsd(MODEL, response.usage)).toBe(0.0028875);
    expect(response.costUsd).toBe(0.002888); // net cost is rounded to 6 dp
    expect(response.cachedTokens).toBe(0);
    expect(response.cacheDiscountUsd).toBe(0);
    expect(response.model).toBe(MODEL);
    expect(response.json).toBeUndefined();
    expect(sleeps).toEqual([]);

    const call = callAt(transport.calls, 0);
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['Authorization']).toBe(`Bearer ${API_KEY}`);
    expect(call.init.headers['Content-Type']).toBe('application/json');
    expect(call.init.headers['HTTP-Referer']).toBe('https://zeniconic.local');
    expect(call.init.headers['X-Title']).toBe('Zeniconic');

    const body = bodyOf(call);
    expect(body['model']).toBe(MODEL);
    expect(body['temperature']).toBe(0.2);
    expect(body['max_tokens']).toBe(500);
  });

  it('retries a 429 after one 300 ms backoff, then succeeds', async () => {
    const transport = mockTransport([
      { status: 429, body: { error: { message: 'rate limited' } } },
      { body: completionBody({ content: 'done' }) },
    ]);
    const { sleep, sleeps } = recordingSleep();
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep, ledger });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')], maxTokens: 100 });

    expect(response.text).toBe('done');
    expect(transport.calls).toHaveLength(2);
    expect(sleeps).toEqual([300]);
    expect(ledger.spentUsd()).toBe(response.costUsd);
    expect(ledger.remainingUsd()).toBe(0.997112);
  });

  it('gives up with E_SERVER after maxRetries retries', async () => {
    const transport = mockTransport([
      { status: 500, body: 'upstream exploded' },
      { status: 500, body: 'upstream exploded' },
      { body: completionBody({ content: 'too late' }) },
    ]);
    const { sleep, sleeps } = recordingSleep();
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    const client = new OpenRouterClient({
      apiKey: API_KEY,
      fetchImpl: transport.fetchImpl,
      sleep,
      ledger,
      maxRetries: 1,
    });

    const error = await client
      .complete({ model: MODEL, messages: [user('Hi')], maxTokens: 100 })
      .then(() => undefined, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'E_SERVER', status: 500 });
    expect(transport.calls).toHaveLength(2);
    expect(sleeps).toEqual([300]);
    expect(ledger.spentUsd()).toBe(0);
    expect(ledger.remainingUsd()).toBe(1);
  });

  it('walks the 300 / 900 ms backoff before succeeding on the third attempt', async () => {
    const transport = mockTransport([
      { status: 503, body: 'busy' },
      { status: 502, body: 'busy' },
      { body: completionBody({ content: 'finally' }) },
    ]);
    const { sleep, sleeps } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')], maxTokens: 100 });

    expect(response.text).toBe('finally');
    expect(transport.calls).toHaveLength(3);
    expect(sleeps).toEqual([300, 900]);
  });

  it('does not retry a 401 and throws E_AUTH', async () => {
    const transport = mockTransport([{ status: 401, body: { error: 'invalid key' } }]);
    const { sleep, sleeps } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const error = await client
      .complete({ model: MODEL, messages: [user('Hi')] })
      .then(() => undefined, (thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'E_AUTH', status: 401 });
    expect(transport.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('maps 404 to E_BAD_REQUEST without retrying', async () => {
    const transport = mockTransport([{ status: 404, body: 'no such model' }]);
    const { sleep, sleeps } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await expect(client.complete({ model: MODEL, messages: [user('Hi')] })).rejects.toMatchObject({
      code: 'E_BAD_REQUEST',
    });
    expect(transport.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('refuses an over-budget call before it reaches fetch', async () => {
    const transport = mockTransport([{ body: completionBody() }]);
    const { sleep } = recordingSleep();
    const ledger = new BudgetLedger({ monthlyCapUsd: 0.01 });
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep, ledger });

    await expect(
      client.complete({ model: 'openai/gpt-6-astra', messages: [user('Plan this listing.')], maxTokens: 1000 }),
    ).rejects.toMatchObject({ code: 'E_BUDGET' });

    expect(transport.calls).toHaveLength(0);
    expect(ledger.spentUsd()).toBe(0);
    expect(ledger.remainingUsd()).toBe(0.01);
  });

  it('rejects an unknown model before the request', async () => {
    const transport = mockTransport([{ body: completionBody() }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await expect(client.complete({ model: 'acme/unknown-1', messages: [user('Hi')] })).rejects.toMatchObject({
      code: 'E_UNKNOWN_MODEL',
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('sends provider preferences that refuse data collection', async () => {
    const transport = mockTransport([
      { body: completionBody({ content: 'one' }) },
      { body: completionBody({ content: 'two', model: 'openai/gpt-6-astra' }) },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({ model: MODEL, messages: [user('One')] });
    await client.complete({ model: 'openai/gpt-6-astra', messages: [user('Two')] });

    for (const call of transport.calls) {
      expect(bodyOf(call)['provider']).toEqual({
        data_collection: 'deny',
        allow_fallbacks: true,
      });
    }
  });

  it('concatenates content returned as parts', async () => {
    const transport = mockTransport([
      {
        body: completionBody({
          content: [
            { type: 'text', text: 'Sun' },
            { type: 'text', text: 'lit' },
            { type: 'image', url: 'https://example.invalid/x.png' },
            { type: 'text', text: ' kitchen' },
          ],
        }),
      },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });
    expect(response.text).toBe('Sunlit kitchen');
  });

  it('serialises array content parts intact', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'ok' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const parts = [
      { type: 'text' as const, text: 'Shot length 4.000 s.' },
      {
        type: 'image_url' as const,
        image_url: { url: 'data:image/jpeg;base64,AAAA' },
      },
    ];

    await client.complete({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Tag the shot.' },
        { role: 'user', content: parts },
      ],
    });

    const messages = bodyOf(callAt(transport.calls, 0))['messages'];
    expect(Array.isArray(messages)).toBe(true);
    const wire = messages as Array<{ role: string; content: unknown }>;
    expect(wire[0]?.role).toBe('system');
    const sent = wire.find((message) => message.role === 'user');
    expect(sent?.content).toEqual(parts);
  });

  it('falls back to the requested model when the reply omits it', async () => {
    const body = completionBody({ content: 'no model field' });
    delete body['model'];
    const transport = mockTransport([{ body }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });
    expect(response.model).toBe(MODEL);
  });
});

describe('OpenRouterClient — structured replies', () => {
  it('parses a valid JSON reply and requests a strict schema', async () => {
    const transport = mockTransport([
      { body: completionBody({ content: '{"caption":"Sunlit kitchen","price":425000}' }) },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({
      model: MODEL,
      messages: [{ role: 'system', content: 'Write a caption.' }, user('Kitchen, £425,000.')],
      jsonSchema: CAPTION_SCHEMA,
    });

    expect(response.json).toEqual({ caption: 'Sunlit kitchen', price: 425000 });
    const body = bodyOf(callAt(transport.calls, 0));
    expect(body['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'reply', strict: true, schema: CAPTION_SCHEMA },
    });
  });

  it('accepts a fenced JSON reply', async () => {
    const transport = mockTransport([
      { body: completionBody({ content: '```json\n{"caption":"Garden","price":300000}\n```' }) },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({
      model: MODEL,
      messages: [user('Garden, £300,000.')],
      jsonSchema: CAPTION_SCHEMA,
    });
    expect(response.json).toEqual({ caption: 'Garden', price: 300000 });
  });

  it('rejects a schema-breaking reply with E_JSON and issue paths', async () => {
    const transport = mockTransport([
      { body: completionBody({ content: '{"caption":"","price":"lots"}' }) },
    ]);
    const { sleep } = recordingSleep();
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep, ledger });

    const error = await client
      .complete({ model: MODEL, messages: [user('Hi')], jsonSchema: CAPTION_SCHEMA })
      .then(() => undefined, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'E_JSON' });
    const issues = error instanceof AiError ? error.issues : [];
    expect(issues).toHaveLength(2);
    expect(issues.join(' ')).toContain('/caption');
    expect(issues.join(' ')).toContain('/price');
    // The tokens were still spent, so the ledger keeps the committed cost.
    expect(ledger.spentUsd()).toBe(0.002888);
  });
});

describe('OpenRouterClient — prompt caching', () => {
  it('marks the final Anthropic system block as ephemeral', async () => {
    const anthropic = 'anthropic/claude-fable-5.2';
    // Test-only rate: the client refuses to guess a price for an unpinned model.
    MODEL_PRICES[anthropic] = { input: 3, output: 15 };
    try {
      const transport = mockTransport([{ body: completionBody({ content: '{"caption":"A","price":1}' }) }]);
      const { sleep } = recordingSleep();
      const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

      await client.complete({
        model: anthropic,
        messages: [{ role: 'system', content: 'You are a property listing editor.' }, user('Kitchen.')],
        jsonSchema: CAPTION_SCHEMA,
      });

      const parts = systemParts(bodyOf(callAt(transport.calls, 0)));
      expect(parts).toHaveLength(2); // instructions, then schema
      const last = parts[parts.length - 1];
      expect(last).toBeDefined();
      expect(last?.cache_control).toEqual({ type: 'ephemeral' });
      expect(parts[0]?.cache_control).toBeUndefined();
    } finally {
      delete MODEL_PRICES[anthropic];
    }
  });

  it('does not add cache_control for a Google model', async () => {
    const transport = mockTransport([{ body: completionBody({ content: '{"caption":"A","price":1}' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({
      model: MODEL,
      messages: [{ role: 'system', content: 'You are a property listing editor.' }, user('Kitchen.')],
      jsonSchema: CAPTION_SCHEMA,
    });

    const body = bodyOf(callAt(transport.calls, 0));
    expect(typeof (body['messages'] as Array<{ content: unknown }>)[0]?.content).toBe('string');
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('keeps the stable system prefix byte-identical across calls', async () => {
    const transport = mockTransport([
      { body: completionBody({ content: '{"caption":"A","price":1}' }) },
      { body: completionBody({ content: '{"caption":"B","price":2}' }) },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const shared = {
      model: MODEL,
      jsonSchema: CAPTION_SCHEMA,
      messages: [{ role: 'system' as const, content: 'Write a caption from the shot table.' }],
    };
    await client.complete({ ...shared, messages: [...shared.messages, user('First kitchen.')] });
    await client.complete({ ...shared, messages: [...shared.messages, user('Second garden.')] });

    const first = serialisedSystemMessage(bodyOf(callAt(transport.calls, 0)));
    const second = serialisedSystemMessage(bodyOf(callAt(transport.calls, 1)));
    expect(first).toBe(second);
    expect(first).toContain('JSON Schema');
    expect(first).toContain('caption');
  });

  it('puts the stable system prefix before variable user content', async () => {
    const transport = mockTransport([{ body: completionBody({ content: 'ok' }) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    await client.complete({
      model: MODEL,
      messages: [user('Variable request first in the array.'), { role: 'system', content: 'Stable prefix.' }],
    });

    const messages = bodyOf(callAt(transport.calls, 0))['messages'];
    expect(Array.isArray(messages)).toBe(true);
    expect((messages as Array<{ role: string }>)[0]?.role).toBe('system');
    expect((messages as Array<{ role: string }>)[1]?.role).toBe('user');
  });

  it('records cached tokens and applies the reported cache discount', async () => {
    const transport = mockTransport([
      {
        body: completionBody({
          content: 'ok',
          usage: {
            prompt_tokens: 100_000,
            completion_tokens: 10_000,
            prompt_tokens_details: { cached_tokens: 8000 },
            cache_discount: 0.004,
          },
        }),
      },
    ]);
    const { sleep } = recordingSleep();
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep, ledger });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });

    const gross = estimateCostUsd(MODEL, { promptTokens: 100_000, completionTokens: 10_000 });
    expect(gross).toBe(0.12375);
    expect(response.cachedTokens).toBe(8000);
    expect(response.cacheDiscountUsd).toBe(0.004);
    expect(response.costUsd).toBe(0.11975);
    expect(gross - response.costUsd).toBeCloseTo(0.004, 10);
    expect(ledger.spentUsd()).toBe(0.11975);
  });

  it('records cached tokens without inventing a discount', async () => {
    const transport = mockTransport([
      {
        body: completionBody({
          content: 'ok',
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            prompt_tokens_details: { cached_tokens: 8000 },
          },
        }),
      },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });
    expect(response.cachedTokens).toBe(8000);
    expect(response.cacheDiscountUsd).toBe(0);
    expect(response.costUsd).toBe(0.002888);
  });

  it('clamps the net cost at zero when the discount exceeds the gross cost', async () => {
    const transport = mockTransport([
      {
        body: completionBody({
          content: 'ok',
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            cache_discount: 9.5,
          },
        }),
      },
    ]);
    const { sleep } = recordingSleep();
    const ledger = new BudgetLedger({ monthlyCapUsd: 1 });
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep, ledger });

    const response = await client.complete({ model: MODEL, messages: [user('Hi')] });
    expect(response.costUsd).toBe(0);
    expect(response.cacheDiscountUsd).toBe(9.5);
    expect(ledger.spentUsd()).toBe(0);
  });
});

describe('OpenRouterClient — redaction', () => {
  it('never puts the API key in an HTTP error message', async () => {
    const transport = mockTransport([
      { status: 401, body: `{"error":"Incorrect API key provided: ${API_KEY}"}` },
    ]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({ apiKey: API_KEY, fetchImpl: transport.fetchImpl, sleep });

    const error = await client
      .complete({ model: MODEL, messages: [user('Hi')] })
      .then(() => undefined, (thrown: unknown) => thrown);
    const message = error instanceof Error ? error.message : '';

    expect(message).not.toContain(API_KEY);
    expect(message).toContain('sk-or-v1-…');
  });

  it('never puts the API key in a transport error message', async () => {
    const transport = mockTransport([{ throws: new Error(`connect ECONNREFUSED (key ${API_KEY})`) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({
      apiKey: API_KEY,
      fetchImpl: transport.fetchImpl,
      sleep,
      maxRetries: 0,
    });

    const error = await client
      .complete({ model: MODEL, messages: [user('Hi')] })
      .then(() => undefined, (thrown: unknown) => thrown);
    const message = error instanceof Error ? error.message : '';

    expect(error).toMatchObject({ code: 'E_NETWORK' });
    expect(message).not.toContain(API_KEY);
    expect(message).toContain('sk-or-v1-…');
  });

  it('trims the response excerpt to 300 characters', async () => {
    const transport = mockTransport([{ status: 500, body: 'x'.repeat(2000) }]);
    const { sleep } = recordingSleep();
    const client = new OpenRouterClient({
      apiKey: API_KEY,
      fetchImpl: transport.fetchImpl,
      sleep,
      maxRetries: 0,
    });

    const error = await client
      .complete({ model: MODEL, messages: [user('Hi')] })
      .then(() => undefined, (thrown: unknown) => thrown);
    const message = error instanceof Error ? error.message : '';

    expect(message.length).toBeLessThan(330);
    expect(message).not.toContain('x'.repeat(301));
  });

  it('refuses to be constructed without a key', () => {
    const transport = mockTransport([]);
    expect(
      () => new OpenRouterClient({ apiKey: '   ', fetchImpl: transport.fetchImpl }),
    ).toThrowError(expect.objectContaining({ code: 'E_AUTH' }));
  });
});
