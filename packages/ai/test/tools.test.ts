import { describe, expect, it } from 'vitest';
import { AiError, parseToolArguments } from '../src/index';
import type { ToolCall } from '../src/index';

const PRICE_TOOL_SCHEMA: object = {
  type: 'object',
  additionalProperties: false,
  required: ['price', 'bedrooms'],
  properties: {
    price: { type: 'number', minimum: 0 },
    bedrooms: { type: 'number', minimum: 1 },
  },
};

function call(name: string, args: string, id = 'call_1'): ToolCall {
  return { id, name, arguments: args };
}

describe('parseToolArguments', () => {
  it('parses and validates a well-formed call', () => {
    const parsed = parseToolArguments<{ price: number; bedrooms: number }>(
      call('set_price', '{"price":425000,"bedrooms":3}'),
      PRICE_TOOL_SCHEMA,
    );
    expect(parsed).toEqual({ price: 425000, bedrooms: 3 });
  });

  it('keeps numbers, booleans and nested values intact', () => {
    const schema: object = {
      type: 'object',
      properties: {
        published: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(
      parseToolArguments(call('publish', '{"published":true,"tags":["garden","annexe"]}'), schema),
    ).toEqual({ published: true, tags: ['garden', 'annexe'] });
  });

  it('accepts an empty object when the schema allows it', () => {
    const schema: object = { type: 'object', properties: {} };
    expect(parseToolArguments(call('ping', '{}'), schema)).toEqual({});
  });

  it('rejects malformed JSON with E_JSON, naming the tool and call id', () => {
    const error = (() => {
      try {
        parseToolArguments(call('set_price', '{"price":', 'call_abc'), PRICE_TOOL_SCHEMA);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe('E_JSON');
    expect(error.message).toContain('set_price');
    expect(error.message).toContain('call_abc');
    expect(error.message).toContain('not valid JSON');
  });

  it('rejects schema-breaking arguments with issue paths', () => {
    const error = (() => {
      try {
        parseToolArguments(call('set_price', '{"price":-1,"bedrooms":"three"}'), PRICE_TOOL_SCHEMA);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe('E_JSON');
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0]).toContain('/price');
    expect(error.issues[1]).toContain('/bedrooms');
  });

  it('reports a missing required argument by name', () => {
    const error = (() => {
      try {
        parseToolArguments(call('set_price', '{"price":100}'), PRICE_TOOL_SCHEMA);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.issues.join(' ')).toContain('bedrooms is required');
  });

  it('does not silently strip a code fence from arguments', () => {
    expect(() =>
      parseToolArguments(
        call('set_price', '```json\n{"price":1,"bedrooms":2}\n```'),
        PRICE_TOOL_SCHEMA,
      ),
    ).toThrowError(expect.objectContaining({ code: 'E_JSON' }));
  });

  it('rejects JSON that is valid but not an object when the schema says object', () => {
    expect(() => parseToolArguments(call('set_price', '"425000"'), PRICE_TOOL_SCHEMA)).toThrowError(
      expect.objectContaining({ code: 'E_JSON' }),
    );
  });

  it('rejects an uncompilable parameter schema as E_JSON', () => {
    expect(() =>
      parseToolArguments(call('broken', '{}'), { type: 'not-a-json-type' }),
    ).toThrowError(expect.objectContaining({ code: 'E_JSON' }));
  });

  it('truncates a long malformed argument excerpt', () => {
    const error = (() => {
      try {
        parseToolArguments(call('set_price', `{"price":${'9'.repeat(500)}`), PRICE_TOOL_SCHEMA);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('…');
    expect(message.length).toBeLessThan(260);
  });
});
