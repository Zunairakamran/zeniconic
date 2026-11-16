import { describe, expect, it } from 'vitest';
import type { Clip, Edl } from '@zeniconic/edl';
import example from '../../edl/example.edl.json';
import {
  TOOLS,
  applyPatch,
  isAllowedPath,
  summariseDiff,
  toolManifest,
  type PatchOp,
} from '../src/index';

const EXPECTED_NAMES = [
  'read_edl',
  'list_shots',
  'patch_edl',
  'set_look',
  'set_music',
  'set_captions',
  'set_voice',
  'set_profile',
  'regenerate_variant',
  'preview',
  'render',
  'explain',
] as const;

function cloneExample(): Edl {
  return structuredClone(example) as unknown as Edl;
}

function fixtureClip(id: string, room: Clip['room'], durationSec: number): Clip {
  const template = cloneExample().clips[0];
  if (template === undefined) throw new Error('fixture has no clips');

  return {
    ...structuredClone(template),
    id,
    room,
    inSec: 0,
    outSec: durationSec,
    speed: 1,
    transitionIn: { type: 'cut', durationSec: 0 },
    transitionOut: { type: 'cut', durationSec: 0 },
    reason: `Fixture shot ${id}`,
  };
}

/** 30.0s before: exterior, living, kitchen, view, bedroom, dining. */
function canonicalBefore(): Edl {
  const edl = cloneExample();
  edl.clips = [
    fixtureClip('c01', 'exterior', 8),
    fixtureClip('c02', 'living', 2),
    fixtureClip('c03', 'kitchen', 5),
    fixtureClip('c04', 'view', 5),
    fixtureClip('c05', 'bedroom', 4),
    fixtureClip('c06', 'dining', 6),
  ];
  edl.overlays = [];
  return edl;
}

/** 28.0s after: balcony added at 8.0s, kitchen removed. */
function canonicalAfter(): Edl {
  const edl = canonicalBefore();
  edl.clips = [
    fixtureClip('c01', 'exterior', 8),
    fixtureClip('c07', 'balcony', 3),
    fixtureClip('c02', 'living', 2),
    fixtureClip('c04', 'view', 5),
    fixtureClip('c05', 'bedroom', 4),
    fixtureClip('c06', 'dining', 6),
  ];
  return edl;
}

describe('tool registry', () => {
  it('publishes exactly the twelve tools with unique names', () => {
    expect(TOOLS).toHaveLength(12);
    expect(TOOLS.map((tool) => tool.name)).toEqual([...EXPECTED_NAMES]);
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(12);
  });

  it('gives every tool a real object schema, a one-sentence description and a latency', () => {
    for (const tool of TOOLS) {
      const schema = tool.inputSchema as {
        type?: unknown;
        properties?: Record<string, unknown>;
      };

      expect(schema.type).toBe('object');
      expect(schema.properties).toBeTypeOf('object');
      expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(20);
      expect(tool.description.trim().endsWith('.')).toBe(true);
      expect(tool.description.indexOf('.')).toBe(tool.description.trim().length - 1);
      expect(['instant', 'draft', 'render']).toContain(tool.latency);
    }
  });

  it('marks reads as non-mutating and the paid/visual actions with the right latency', () => {
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

    expect(byName.get('read_edl')?.mutates).toBe(false);
    expect(byName.get('list_shots')?.mutates).toBe(false);
    expect(byName.get('explain')?.mutates).toBe(false);
    expect(byName.get('preview')?.mutates).toBe(false);
    expect(byName.get('render')?.mutates).toBe(false);

    expect(byName.get('patch_edl')?.mutates).toBe(true);
    expect(byName.get('set_music')?.mutates).toBe(true);
    expect(byName.get('regenerate_variant')?.mutates).toBe(true);

    expect(byName.get('preview')?.latency).toBe('draft');
    expect(byName.get('render')?.latency).toBe('render');
    expect(byName.get('read_edl')?.latency).toBe('instant');
    expect(byName.get('patch_edl')?.latency).toBe('instant');
    expect(byName.get('regenerate_variant')?.latency).toBe('instant');
  });

  it('returns an OpenAI/OpenRouter-style manifest without sharing schema objects', () => {
    const manifest = toolManifest();

    expect(manifest).toHaveLength(12);
    expect(manifest[0]).toEqual({
      name: 'read_edl',
      description: expect.any(String),
      parameters: expect.objectContaining({ type: 'object' }),
    });

    const parameters = manifest[0]?.parameters as { properties?: Record<string, unknown> };
    parameters.properties = {};
    const registry = TOOLS[0]?.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(registry.properties ?? {}).length).toBeGreaterThan(0);
  });
});

describe('patch allowlist', () => {
  it('accepts clip trims, transform points, overlay text and audio fields', () => {
    for (const path of [
      '/clips/0/inSec',
      '/clips/0/outSec',
      '/clips/0/speed',
      '/clips/0/transform/path/0/scale',
      '/overlays/0/text',
      '/overlays/2/outSec',
      '/audio/music/trackId',
      '/audio/music/beatGrid/4',
      '/audio/voice/enhance/denoise',
      '/captions/mode',
      '/captions/words/0/text',
      '/look/id',
      '/format/targetDurationSec',
      '/clips/0',
      '/overlays/-',
    ]) {
      expect(isAllowedPath(path), path).toBe(true);
    }
  });

  it('rejects identity, provenance, unknown keys, ids and prototype segments', () => {
    for (const path of [
      '/provenance',
      '/provenance/pipelineVersion',
      '/id',
      '/createdAt',
      '/edlVersion',
      '/clips/0/constructor/x',
      '/clips/0/__proto__/x',
      '/overlays/0/prototype',
      '/clips/0/id',
      '/overlays/0/id',
      '/clips/0/unknownField',
      '/clips/0/transform/unknownField',
      '/audio/mix/lufs',
      '/clips',
      '/overlays',
      '/audio',
      '/clips/0/transform/path/00',
      '/clips/0/transform/path/0/~2',
      '/clips/-/outSec',
      '/clips/0/transform/path/-/x',
      '',
      'clips/0/outSec',
    ]) {
      expect(isAllowedPath(path), path).toBe(false);
    }
  });

  it('applies a clip trim and the result still validates', () => {
    const before = cloneExample();
    const result = applyPatch(before, [
      { op: 'replace', path: '/clips/0/outSec', value: 15 },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.edl.clips[0]?.outSec).toBe(15);
  });

  it('applies an overlay text edit', () => {
    const before = cloneExample();
    const result = applyPatch(before, [
      { op: 'replace', path: '/overlays/0/text', value: '16 Oak Avenue' },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.edl.overlays[0]?.text).toBe('16 Oak Avenue');
  });

  it('reports E_DURATION when a trim pushes the timeline off target', () => {
    const result = applyPatch(cloneExample(), [
      { op: 'replace', path: '/clips/0/outSec', value: 40 },
    ]);

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'E_DURATION', path: '/format/targetDurationSec' }),
    );
  });

  it('does not mutate the input edit', () => {
    const before = cloneExample();
    const snapshot = structuredClone(before);

    applyPatch(before, [
      { op: 'replace', path: '/clips/0/outSec', value: 15 },
      { op: 'replace', path: '/overlays/0/text', value: '16 Oak Avenue' },
    ]);

    expect(before).toEqual(snapshot);
  });

  it('supports remove and add for whole overlays without touching the input', () => {
    const before = cloneExample();
    const snapshot = structuredClone(before);

    const removed = applyPatch(before, [{ op: 'remove', path: '/overlays/1' }]);
    expect(removed.issues).toEqual([]);
    expect(removed.edl.overlays).toHaveLength(before.overlays.length - 1);

    const restored = applyPatch(removed.edl, [
      {
        op: 'add',
        path: '/overlays/1',
        value: structuredClone(before.overlays[1]),
      },
    ]);
    expect(restored.issues).toEqual([]);
    expect(restored.edl.overlays).toEqual(before.overlays);
    expect(before).toEqual(snapshot);
  });

  it('returns issues instead of throwing for a malformed or forbidden path', () => {
    const before = cloneExample();
    const snapshot = structuredClone(before);

    const forbidden = applyPatch(before, [
      { op: 'replace', path: '/provenance/pipelineVersion', value: 'x' },
    ]);
    expect(forbidden.issues.length).toBeGreaterThan(0);
    expect(forbidden.edl).toEqual(snapshot);

    const prototype = applyPatch(before, [
      { op: 'replace', path: '/clips/0/constructor/x', value: 'x' },
    ]);
    expect(prototype.issues.length).toBeGreaterThan(0);
    expect(prototype.edl).toEqual(snapshot);

    const missing = applyPatch(before, [
      { op: 'replace', path: '/clips/999/outSec', value: 1 },
    ]);
    expect(missing.issues.length).toBeGreaterThan(0);
    expect(missing.edl).toEqual(snapshot);
  });

  it('returns issues instead of throwing for a malformed operation', () => {
    const before = cloneExample();
    const snapshot = structuredClone(before);
    const malformed = [
      { op: 'frobnicate', path: '/clips/0/outSec', value: 1 },
      { op: 'replace', path: '/clips/0/outSec' },
      { op: 'replace', path: 42, value: 1 },
    ] as unknown as PatchOp[];

    for (const op of malformed) {
      const result = applyPatch(before, [op]);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.edl).toEqual(snapshot);
    }
  });
});

describe('summariseDiff', () => {
  it('uses the singular for one change and one decimal for the duration arrow', () => {
    const before = cloneExample();
    const after = cloneExample();
    const first = after.clips[0];
    if (!first) throw new Error('fixture has no clips');
    first.outSec = first.inSec + 0.5;

    expect(summariseDiff(before, after)).toBe('1 change: 30.0s → 28.0s');
  });

  it('produces the canonical three-clause summary in timeline order', () => {
    expect(summariseDiff(canonicalBefore(), canonicalAfter())).toBe(
      '3 changes: balcony at 8.0s, kitchen removed, 30.0s → 28.0s',
    );
  });

  it('caps the visible clauses at four and reports the remainder', () => {
    const before = canonicalBefore();
    const after = canonicalAfter();
    after.look = { id: 'editorial', label: 'Editorial' };
    after.audio.music.trackId = 'focus_02';

    const summary = summariseDiff(before, after);

    expect(summary.startsWith('5 changes: ')).toBe(true);
    expect(summary.endsWith('and 1 more')).toBe(true);
    expect(summary).toContain('balcony at 8.0s');
    expect(summary).toContain('kitchen removed');
    expect(summary).not.toContain('30.0s → 28.0s');
  });

  it('collapses remove-then-add of the same overlay to no clauses', () => {
    const before = cloneExample();
    const target = before.overlays[2];
    if (target === undefined) throw new Error('fixture has no third overlay');

    const after = cloneExample();
    after.overlays = after.overlays.filter((overlay) => overlay.id !== target.id);
    after.overlays.push(structuredClone(target));

    expect(summariseDiff(before, after)).toBe('Nothing to change');
  });

  it('reports a single overlay removal in the user words', () => {
    const after = cloneExample();
    after.overlays = after.overlays.filter((overlay) => overlay.id !== 'o03');

    expect(summariseDiff(cloneExample(), after)).toBe('1 change: price card removed');
  });
});
