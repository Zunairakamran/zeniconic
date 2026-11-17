import { describe, expect, it } from 'vitest';
import { AiError, assertModelCapabilities } from '../src/index';
import type { CapabilityMap } from '../src/index';

const CAPABILITIES: CapabilityMap = {
  'openai/gpt-6-astra': { tools: true, vision: true, json: true },
  'google/gemini-3.8-flash': { tools: true, vision: true, video: true, audio: true },
  'google/gemini-4-carbon': { vision: true, video: true },
  'acme/limited': { tools: false, json: true },
};

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  return undefined;
}

describe('assertModelCapabilities', () => {
  it('returns the declared capabilities when every requirement is met', () => {
    expect(assertModelCapabilities('openai/gpt-6-astra', ['tools', 'json'], CAPABILITIES)).toEqual({
      tools: true,
      vision: true,
      json: true,
    });
  });

  it('accepts an empty requirement list', () => {
    expect(assertModelCapabilities('google/gemini-4-carbon', [], CAPABILITIES)).toEqual({
      vision: true,
      video: true,
    });
  });

  it('resolves a routing variant to its base model', () => {
    expect(
      assertModelCapabilities('google/gemini-3.8-flash:floor', ['tools'], CAPABILITIES),
    ).toEqual({ tools: true, vision: true, video: true, audio: true });
    expect(
      assertModelCapabilities('  google/gemini-3.8-flash:nitro  ', ['video'], CAPABILITIES),
    ).toEqual({ tools: true, vision: true, video: true, audio: true });
  });

  it('prefers an exact entry over the base model', () => {
    const map: CapabilityMap = {
      'acme/model': { tools: true },
      'acme/model:floor': { tools: false },
    };
    expect(() => assertModelCapabilities('acme/model:floor', ['tools'], map)).toThrowError(
      expect.objectContaining({ code: 'E_MODEL_CAPABILITY' }),
    );
  });

  it('throws E_MODEL_CAPABILITY naming the model and the missing capability', () => {
    const error = capture(() =>
      assertModelCapabilities('google/gemini-4-carbon', ['vision', 'tools'], CAPABILITIES),
    );

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe('E_MODEL_CAPABILITY');
    expect(error.message).toContain('google/gemini-4-carbon');
    expect(error.message).toContain('"tools"');
    expect(error.message).not.toContain('"vision"');
  });

  it('names every missing capability when several are required', () => {
    const error = capture(() =>
      assertModelCapabilities('google/gemini-4-carbon', ['tools', 'json'], CAPABILITIES),
    );

    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('"tools"');
    expect(message).toContain('"json"');
  });

  it('treats an explicit false as unsupported', () => {
    expect(() => assertModelCapabilities('acme/limited', ['tools'], CAPABILITIES)).toThrowError(
      expect.objectContaining({ code: 'E_MODEL_CAPABILITY' }),
    );
    expect(assertModelCapabilities('acme/limited', ['json'], CAPABILITIES)).toEqual({
      tools: false,
      json: true,
    });
  });

  it('fails closed for a model that is not in the supplied map', () => {
    const error = capture(() => assertModelCapabilities('acme/mystery-1', ['tools'], CAPABILITIES));

    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe('E_MODEL_CAPABILITY');
    expect(error.message).toContain('acme/mystery-1');
    expect(error.message).toContain('"tools"');
    expect(error.message).toContain('not in the capability table');
  });

  it('needs nothing from an unknown model when no capability is required', () => {
    expect(assertModelCapabilities('acme/mystery-1', [], CAPABILITIES)).toEqual({});
  });

  it('does not mutate the supplied map', () => {
    const snapshot = JSON.stringify(CAPABILITIES);
    assertModelCapabilities('openai/gpt-6-astra', ['tools'], CAPABILITIES);
    expect(JSON.stringify(CAPABILITIES)).toBe(snapshot);
  });

  it('returns a copy, so a caller cannot edit the config through the result', () => {
    const result = assertModelCapabilities('openai/gpt-6-astra', ['tools'], CAPABILITIES);
    result.tools = false;
    expect(assertModelCapabilities('openai/gpt-6-astra', ['tools'], CAPABILITIES).tools).toBe(true);
  });
});
