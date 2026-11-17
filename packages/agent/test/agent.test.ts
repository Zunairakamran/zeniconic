import { describe, expect, it } from 'vitest';
import { durationSec } from '@zeniconic/edl';
import { createDefaultRegistry } from '@zeniconic/capabilities';
import { runAgent } from '../src/index';
import type { AgentModel, AgentRunInput } from '../src/index';
import { makeEdl } from '../../capabilities/test/fixtures';

interface Reply {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  costUsd?: number;
}

class ScriptedModel implements AgentModel {
  readonly calls: Array<{ tools: unknown[]; messages: unknown[] }> = [];
  constructor(private readonly replies: Reply[]) {}

  async complete(input: { messages: unknown[]; tools: unknown[]; temperature?: number; maxTokens?: number }) {
    this.calls.push({ tools: input.tools, messages: input.messages });
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error('script exhausted');
    return {
      text: reply.text ?? '',
      ...(reply.toolCalls === undefined ? {} : { toolCalls: reply.toolCalls }),
      costUsd: reply.costUsd ?? 0,
    };
  }
}

function input(message: string, overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    message,
    context: { listingId: '2026-11-17-test-listing', edl: makeEdl(), shots: [] },
    autonomy: 'auto',
    ...overrides,
  };
}

const registry = createDefaultRegistry();

describe('agent orchestrator', () => {
  it('discovers and applies a capability, then answers', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'search_capabilities', arguments: JSON.stringify({ query: 'film length' }) },
        ],
      },
      {
        toolCalls: [
          { id: 't2', name: 'set_target_duration', arguments: JSON.stringify({ targetSec: 12 }) },
        ],
      },
      { toolCalls: [{ id: 't3', name: 'finish', arguments: JSON.stringify({ reply: 'Now a 12 second cut.' }) }] },
    ]);

    const result = await runAgent({ model, registry }, input('Make the whole video 12 seconds.'));

    expect(result.ok).toBe(true);
    expect(result.reply).toContain('12');
    expect(durationSec(result.edl)).toBeCloseTo(12, 2);
    expect(result.edits.map((edit) => edit.capability)).toEqual(['set_target_duration']);
    const toolNames = (model.calls[0]!.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name);
    expect(toolNames).toContain('search_capabilities');
    expect(toolNames).toContain('apply_capability');
    expect(toolNames).toContain('finish');
  });

  it('applies a generic capability by id', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          {
            id: 't1',
            name: 'apply_capability',
            arguments: JSON.stringify({
              id: 'set_transition',
              params: { clipId: 'c02', type: 'blur', durationSec: 0.4 },
            }),
          },
        ],
      },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'Blur added.' }) }] },
    ]);

    const result = await runAgent({ model, registry }, input('Add a blur between living and bedroom.'));
    expect(result.ok).toBe(true);
    expect(result.edl.clips[1]!.transitionIn).toEqual({ type: 'blur', durationSec: 0.4 });
  });

  it('asks before a medium-risk change and honours a refusal', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'apply_capability', arguments: JSON.stringify({ id: 'delete_clip', params: { clipId: 'c02' } }) },
        ],
      },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'I left the kitchen in place.' }) }] },
    ]);

    let asked = 0;
    const result = await runAgent(
      { model, registry },
      input('Remove the kitchen scene.', {
        autonomy: 'ask',
        requestApproval: async () => {
          asked += 1;
          return false;
        },
      }),
    );

    expect(asked).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.edl.clips).toHaveLength(3);
  });

  it('performs the change when the user approves', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'apply_capability', arguments: JSON.stringify({ id: 'delete_clip', params: { clipId: 'c02' } }) },
        ],
      },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'Removed the kitchen.' }) }] },
    ]);

    const result = await runAgent(
      { model, registry },
      input('Remove the kitchen scene.', { autonomy: 'ask', requestApproval: async () => true }),
    );
    expect(result.ok).toBe(true);
    expect(result.edl.clips).toHaveLength(2);
    expect(durationSec(result.edl)).toBeCloseTo(9, 2);
  });

  it('denies medium-risk changes in suggest mode without asking', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'apply_capability', arguments: JSON.stringify({ id: 'delete_clip', params: { clipId: 'c02' } }) },
        ],
      },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'Suggested removing the kitchen.' }) }] },
    ]);
    let asked = 0;
    const result = await runAgent(
      { model, registry },
      input('Remove the kitchen.', { autonomy: 'suggest', requestApproval: async () => { asked += 1; return true; } }),
    );
    expect(asked).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('Refused'))).toBe(true);
  });

  it('reports a rejected capability instead of pretending it worked', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'apply_capability', arguments: JSON.stringify({ id: 'apply_effect', params: { target: 'timeline', type: 'blur', params: { sigma: 900 } } }) },
        ],
      },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'That blur was outside the allowed range.' }) }] },
    ]);
    const result = await runAgent({ model, registry }, input('Blur everything hard.'));
    expect(result.ok).toBe(false);
    expect(result.reply).toContain('outside');
  });

  it('survives malformed arguments and unknown tools', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'quantum_edit', arguments: '{}' },
          { id: 't2', name: 'apply_capability', arguments: 'not json' },
        ],
      },
      { toolCalls: [{ id: 't3', name: 'finish', arguments: JSON.stringify({ reply: 'Nothing changed.' }) }] },
    ]);
    const result = await runAgent({ model, registry }, input('Do something impossible.'));
    expect(result.ok).toBe(false);
    expect(result.steps).toBeGreaterThan(0);
  });

  it('stops at the step limit', async () => {
    const loop = Array.from({ length: 6 }, (_, index) => ({
      toolCalls: [{ id: `t${index}`, name: 'get_project', arguments: '{}' }],
    }));
    const model = new ScriptedModel(loop);
    const result = await runAgent({ model, registry }, input('Loop forever.', { limits: { maxSteps: 3 } }));
    expect(result.steps).toBeLessThanOrEqual(3);
    expect(result.warnings.some((warning) => warning.includes('model steps'))).toBe(true);
  });

  it('never exceeds the run budget', async () => {
    const model = new ScriptedModel([
      { costUsd: 0.3, toolCalls: [{ id: 't1', name: 'get_project', arguments: '{}' }] },
      { costUsd: 0.3, toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'Done.' }) }] },
    ]);
    const result = await runAgent({ model, registry }, input('Spend money.', { limits: { maxCostUsd: 0.1 } }));
    expect(result.costUsd).toBeGreaterThan(0.1);
    expect(result.warnings.some((warning) => warning.includes('budget'))).toBe(true);
  });
});

describe('approval memo and preview', () => {
  it('asks once per capability in a run, even after a rejected retry', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'apply_capability', arguments: JSON.stringify({ id: 'delete_clip', params: { clipId: 'c02' } }) },
        ],
      },
      {
        toolCalls: [
          { id: 't2', name: 'apply_capability', arguments: JSON.stringify({ id: 'delete_clip', params: { clipId: 'c02' } }) },
        ],
      },
      { toolCalls: [{ id: 't3', name: 'finish', arguments: JSON.stringify({ reply: 'Done.' }) }] },
    ]);

    let asked = 0;
    const result = await runAgent(
      { model, registry },
      input('Remove the kitchen.', {
        autonomy: 'ask',
        requestApproval: async () => {
          asked += 1;
          return false;
        },
      }),
    );

    expect(asked).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.warnings.filter((warning) => warning.includes('not approved'))).toHaveLength(1);
  });

  it('calls a real preview port from the preview_render tool', async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ id: 't1', name: 'preview_render', arguments: '{}' }] },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'Preview rendered.' }) }] },
    ]);

    const calls: string[] = [];
    const result = await runAgent(
      {
        model,
        registry,
        preview: {
          preview: async (edl) => {
            calls.push(edl.id);
            return { path: 'C:/tmp/preview.mp4' };
          },
        },
      },
      input('Render a preview.'),
    );

    expect(calls).toEqual(['edl_test_v1']);
    expect(result.previewPath).toBe('C:/tmp/preview.mp4');
    expect(result.ok).toBe(false);
    expect(result.reply).toContain('Preview');
  });
});

describe('completeness check', () => {
  it('reports a skipped grade instead of claiming a blanket success', async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ id: 't1', name: 'set_target_duration', arguments: JSON.stringify({ targetSec: 9 }) }] },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'Done: retimed to 9s.' }) }] },
    ]);
    const result = await runAgent(
      { model, registry },
      input('Make it 9 seconds and apply a warm cinematic grade.', { autonomy: 'auto' }),
    );
    expect(result.ok).toBe(true);
    expect(result.reply).toContain('Not applied');
    expect(result.reply.toLowerCase()).toContain('grade');
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('grade'))).toBe(true);
  });

  it('does not warn when the grade was applied', async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ id: 't1', name: 'apply_color_grade', arguments: JSON.stringify({ target: 'timeline', preset: 'warm_cinematic' }) }] },
      { toolCalls: [{ id: 't2', name: 'finish', arguments: JSON.stringify({ reply: 'Graded warm.' }) }] },
    ]);
    const result = await runAgent(
      { model, registry },
      input('Apply a warm cinematic grade.', { autonomy: 'auto' }),
    );
    expect(result.ok).toBe(true);
    expect(result.reply).not.toContain('Not applied');
  });
});
