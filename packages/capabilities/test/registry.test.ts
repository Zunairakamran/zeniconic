import { describe, expect, it } from 'vitest';
import { validateEdl } from '@zeniconic/edl';
import { createDefaultRegistry, createRegistry } from '../src/index';
import type { Capability } from '../src/index';
import { makeEdl } from './fixtures';

const registry = createDefaultRegistry();

describe('capability registry', () => {
  it('ships a catalogue with unique ids and valid manifests', () => {
    const list = registry.list();
    expect(list.length).toBeGreaterThanOrEqual(20);
    expect(new Set(list.map((entry) => entry.id)).size).toBe(list.length);
    for (const entry of list) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.backends.length).toBeGreaterThan(0);
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('filters by category, risk, cost and backend', () => {
    expect(registry.list({ category: 'effect' }).every((entry) => entry.category === 'effect')).toBe(true);
    expect(registry.list({ risk: 'high' })).toEqual([]);
    expect(registry.list({ backend: 'edl' }).length).toBeGreaterThan(0);
    expect(registry.list({ cost: 'paid' })).toEqual([]);
  });

  it('searches by intent words, not only ids', () => {
    expect(registry.search('blur').map((entry) => entry.id)).toContain('apply_effect');
    expect(registry.search('shorter film').map((entry) => entry.id)).toContain('set_target_duration');
    expect(registry.search('captions').some((entry) => entry.category === 'caption')).toBe(true);
    expect(registry.search('quantum blockchain')).toEqual([]);
  });

  it('describes a capability with its params and docs', () => {
    const text = registry.describe('set_transition');
    expect(text).toContain('set_transition');
    expect(text).toContain('Params:');
    expect(text).toContain('Docs:');
    expect(registry.describe('nope')).toContain('No capability');
  });

  it('rejects unknown ids and invalid params instead of no-oping', () => {
    const edl = makeEdl();
    expect(registry.apply('nope', edl, {})).toMatchObject({ ok: false });
    const bad = registry.apply('set_transition', edl, { clipId: 'c02', type: 'quantum' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]?.code).toBe('E_CAPABILITY_PARAM');
  });

  it('refuses to construct with duplicate ids', () => {
    const one: Capability = {
      id: 'dup', version: '1.0.0', name: 'x', category: 'timeline', description: 'x',
      params: { type: 'object' }, risk: 'low', cost: 'free', backends: ['edl'],
      preview: false, docs: 'x',
      apply: (edl) => ({ ok: true, edl, summary: 'x' }),
    };
    expect(() => createRegistry([one, one])).toThrow(/Duplicate capability id/);
  });

  it('never returns an EDL that fails the contract', () => {
    const edl = makeEdl();
    const applied = registry.apply('set_target_duration', edl, { targetSec: 12 });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(validateEdl(applied.edl).valid).toBe(true);
      expect(applied.edl.format.targetDurationSec).toBe(12);
    }
  });

  it('leaves the input document untouched', () => {
    const edl = makeEdl();
    const before = JSON.stringify(edl);
    registry.apply('set_target_duration', edl, { targetSec: 10 });
    expect(JSON.stringify(edl)).toBe(before);
  });
});
