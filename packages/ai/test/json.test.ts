import { describe, expect, it } from 'vitest';
import { AiError, parseJsonReply } from '../src/index';

const SCHEMA: object = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'price'],
  properties: {
    caption: { type: 'string', minLength: 1 },
    price: { type: 'number' },
  },
};

describe('parseJsonReply', () => {
  it('parses plain JSON when no schema is supplied', () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a fenced reply', () => {
    expect(parseJsonReply('```json\n{"caption":"Garden","price":1}\n```', SCHEMA)).toEqual({
      caption: 'Garden',
      price: 1,
    });
    expect(parseJsonReply('```\n{"caption":"Garden","price":1}\n```', SCHEMA)).toEqual({
      caption: 'Garden',
      price: 1,
    });
  });

  it('rejects invalid JSON with E_JSON', () => {
    expect(() => parseJsonReply('not json at all')).toThrowError(
      expect.objectContaining({ code: 'E_JSON' }),
    );
  });

  it('accepts a reply that satisfies the schema', () => {
    expect(parseJsonReply('{"caption":"Hallway","price":250000}', SCHEMA)).toEqual({
      caption: 'Hallway',
      price: 250000,
    });
  });

  it('rejects a reply that breaks the schema and names the paths', () => {
    const error = (() => {
      try {
        parseJsonReply('{"caption":"","price":"cheap"}', SCHEMA);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe('E_JSON');
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0]).toContain('/caption');
    expect(error.issues[1]).toContain('/price');
  });

  it('reports a missing required property by name', () => {
    const error = (() => {
      try {
        parseJsonReply('{"caption":"Hallway"}', SCHEMA);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.issues.join(' ')).toContain('price is required');
  });

  it('reports at most the first three issues', () => {
    const fourRequired: object = {
      type: 'object',
      required: ['a', 'b', 'c', 'd'],
      properties: { a: {}, b: {}, c: {}, d: {} },
    };
    const error = (() => {
      try {
        parseJsonReply('{}', fourRequired);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.issues).toHaveLength(3);
  });

  it('reports nested instance paths', () => {
    const nested: object = {
      type: 'object',
      properties: {
        property: {
          type: 'object',
          properties: { bedrooms: { type: 'number' } },
        },
      },
    };
    const error = (() => {
      try {
        parseJsonReply('{"property":{"bedrooms":"three"}}', nested);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.issues[0]).toContain('/property/bedrooms');
  });

  it('rejects an uncompilable schema as E_JSON', () => {
    expect(() => parseJsonReply('{}', { type: 'not-a-json-type' })).toThrowError(
      expect.objectContaining({ code: 'E_JSON' }),
    );
  });
});
