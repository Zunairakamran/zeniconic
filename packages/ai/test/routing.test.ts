import { describe, expect, it } from 'vitest';
import { resolveModelId } from '../src/index';

describe('resolveModelId', () => {
  it('applies the floor suffix', () => {
    expect(resolveModelId('x/y', 'floor')).toBe('x/y:floor');
  });

  it('applies the nitro suffix', () => {
    expect(resolveModelId('x/y', 'nitro')).toBe('x/y:nitro');
  });

  it('leaves the model unchanged for auto and for an omitted variant', () => {
    expect(resolveModelId('x/y', 'auto')).toBe('x/y');
    expect(resolveModelId('x/y')).toBe('x/y');
  });

  it('never appends a second suffix', () => {
    expect(resolveModelId('x/y:free', 'floor')).toBe('x/y:free');
    expect(resolveModelId('x/y:nitro', 'floor')).toBe('x/y:nitro');
  });

  it('does not manufacture a free model', () => {
    expect(resolveModelId('google/gemini-3.8-flash', 'floor')).not.toContain(':free');
    expect(resolveModelId('google/gemini-3.8-flash', 'nitro')).not.toContain(':free');
  });
});
