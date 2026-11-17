import { durationSec, validateEdl } from '@zeniconic/edl';
import type { Edl } from '@zeniconic/edl';
import type { CapabilityRegistry } from '@zeniconic/capabilities';
import type { AgentTool, AgentToolResult, ProjectContext, ShotSummary } from './types';

export interface PreviewPort {
  /** Render a low-cost draft. Never the final export. */
  preview(edl: Edl): Promise<{ path?: string; warning?: string }>;
}

export interface ToolboxOptions {
  registry: CapabilityRegistry;
  context: ProjectContext;
  getEdl: () => Edl;
  setEdl: (edl: Edl) => void;
  preview?: PreviewPort;
  /** Maximum clip edits applied in one run; enforced by the orchestrator too. */
  maxToolCalls?: number;
}

function clipSummary(edl: Edl) {
  return edl.clips.map((clip) => ({
    id: clip.id,
    room: clip.room ?? 'unknown',
    src: clip.src.split(/[\\/]/).pop(),
    in: clip.inSec,
    out: clip.outSec,
    speed: clip.speed,
    duration: Math.round(((clip.outSec - clip.inSec) / clip.speed) * 1000) / 1000,
    ...(clip.effects === undefined ? {} : { effects: clip.effects.map((effect) => effect.type) }),
  }));
}

function projectSummary(edl: Edl) {
  return {
    format: edl.format,
    look: edl.look,
    durationSec: durationSec(edl),
    output: edl.output ?? 'profile default',
    clips: clipSummary(edl),
    overlays: edl.overlays.map((overlay) => ({
      id: overlay.id, kind: overlay.kind, text: overlay.text ?? '', in: overlay.inSec, out: overlay.outSec,
    })),
    grade: edl.grade ?? null,
    effects: (edl.effects ?? []).map((effect) => ({ id: effect.id, type: effect.type, amount: effect.amount })),
    captions: {
      mode: edl.captions.mode,
      style: edl.captions.style ?? null,
      animation: (edl.captions as { animation?: string }).animation ?? 'none',
      words: (edl.captions.words ?? []).length,
    },
    music: { trackId: edl.audio.music.trackId, gainDb: edl.audio.music.gainDb },
    voice: { mode: edl.audio.voice.mode },
  };
}

function textOf(result: unknown): string {
  return JSON.stringify(result);
}

export function createToolbox(options: ToolboxOptions): AgentTool[] {
  const { registry, context } = options;
  const shots = context.shots ?? [];
  let toolCalls = 0;
  const limit = options.maxToolCalls ?? 24;

  const applyCapability = async (
    id: string,
    params: Record<string, unknown>,
  ): Promise<AgentToolResult> => {
    toolCalls += 1;
    if (toolCalls > limit) {
      return { ok: false, content: 'Tool budget exhausted; stop and report what changed.', summary: 'Tool budget exhausted.' };
    }
    const capability = registry.get(id);
    if (capability === undefined) {
      return { ok: false, content: `No capability "${id}". Search first.`, summary: `Unknown capability ${id}.` };
    }
    const before = options.getEdl();
    const result = registry.apply(id, before, params);
    if (!result.ok) {
      return {
        ok: false,
        content: { issues: result.issues },
        summary: `${id} rejected: ${result.issues[0]?.message ?? 'invalid params'}`,
      };
    }
    options.setEdl(result.edl);
    return {
      ok: true,
      content: { summary: result.summary, warnings: result.warnings ?? [] },
      summary: result.summary,
      edl: result.edl,
      edit: { capability: id, summary: result.summary, risk: capability.risk },
    };
  };

  const tools: AgentTool[] = [
    {
      name: 'get_project',
      description: 'Return the current edit: duration, format, clips, overlays, grade, captions and audio.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      risk: 'low',
      execute: () => ({ ok: true, content: projectSummary(options.getEdl()), summary: 'Read the current edit.' }),
    },
    {
      name: 'search_shots',
      description: 'Find indexed shots by room, keyword or minimum score. Use before swapping footage.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 80 },
          room: { type: 'string', maxLength: 32 },
          minScore: { type: 'number', minimum: 0, maximum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
      risk: 'low',
      execute: (args) => {
        const query = typeof args.query === 'string' ? args.query.toLowerCase() : undefined;
        const room = typeof args.room === 'string' ? args.room.toLowerCase() : undefined;
        const minScore = typeof args.minScore === 'number' ? args.minScore : 0;
        const limit = typeof args.limit === 'number' ? args.limit : 8;
        const rows = shots
          .filter((shot) => {
            if (room !== undefined && shot.room.toLowerCase() !== room) return false;
            if ((shot.score ?? 0) < minScore) return false;
            if (query === undefined) return true;
            return `${shot.id} ${shot.room} ${shot.reason ?? ''} ${shot.sourceId}`.toLowerCase().includes(query);
          })
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, limit);
        return {
          ok: true,
          content: rows,
          summary: `${rows.length} shot${rows.length === 1 ? '' : 's'} found.`,
        };
      },
    },
    {
      name: 'search_capabilities',
      description: 'Discover editing operations by intent, e.g. "blur transition", "kinetic captions", "shorten film".',
      parameters: {
        type: 'object',
        required: ['query'],
        additionalProperties: false,
        properties: { query: { type: 'string', minLength: 1, maxLength: 120 }, limit: { type: 'integer', minimum: 1, maximum: 12 } },
      },
      risk: 'low',
      execute: (args) => {
        const found = registry.search(String(args.query), typeof args.limit === 'number' ? args.limit : 6);
        return { ok: true, content: found, summary: `${found.length} capabilities match.` };
      },
    },
    {
      name: 'describe_capability',
      description: 'Read the full parameter schema and docs for one capability id.',
      parameters: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1, maxLength: 80 } },
      },
      risk: 'low',
      execute: (args) => ({ ok: true, content: registry.describe(String(args.id)), summary: `Described ${String(args.id)}.` }),
    },
    {
      name: 'apply_capability',
      description: 'Apply one registered editing capability to the draft. Params must match describe_capability.',
      parameters: {
        type: 'object',
        required: ['id', 'params'],
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1, maxLength: 80 }, params: { type: 'object' } },
      },
      risk: 'low',
      execute: (args) => applyCapability(String(args.id), (args.params ?? {}) as Record<string, unknown>),
    },
    {
      name: 'validate_edl',
      description: 'Validate the current draft against the EDL schema and timeline invariants.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      risk: 'low',
      execute: () => {
        const check = validateEdl(options.getEdl());
        return {
          ok: check.valid,
          content: check.valid ? { valid: true } : { valid: false, issues: check.issues.slice(0, 10) },
          summary: check.valid ? 'The edit is valid.' : `${check.issues.length} validation issue(s).`,
        };
      },
    },
    {
      name: 'preview_render',
      description: 'Render a low-resolution draft of the current edit so the result can be inspected.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      risk: 'low',
      execute: async () => {
        if (options.preview === undefined) {
          return { ok: true, content: { rendered: false, reason: 'No preview engine in this build.' }, summary: 'Preview is unavailable here.' };
        }
        const result = await options.preview.preview(options.getEdl());
        return {
          ok: result.path !== undefined,
          content: result,
          summary: result.path === undefined ? result.warning ?? 'Preview failed.' : 'Draft preview rendered.',
        };
      },
    },
    {
      name: 'finish',
      description: 'Stop and answer the user. Call this when the edit is complete or cannot be done.',
      parameters: {
        type: 'object',
        required: ['reply'],
        additionalProperties: false,
        properties: { reply: { type: 'string', minLength: 1, maxLength: 600 } },
      },
      risk: 'low',
      execute: (args) => ({
        ok: true,
        content: { reply: String(args.reply) },
        summary: String(args.reply).slice(0, 140),
        terminate: true,
      }),
    },
  ];

  // Thin, named aliases for the operations people ask for most. They all go
  // through the same registry and the same validation.
  const aliases: Array<{ name: string; capability: string; description: string; parameters: Record<string, unknown>; risk: 'low' | 'medium' | 'high'; map: (args: Record<string, unknown>) => Record<string, unknown> }> = [
    {
      name: 'trim_clip', capability: 'trim_clip', risk: 'low',
      description: 'Trim a clip. Params: clipId, inSec?, outSec?, keepTarget?.',
      parameters: {
        type: 'object', required: ['clipId'], additionalProperties: false,
        properties: { clipId: { type: 'string' }, inSec: { type: 'number' }, outSec: { type: 'number' }, keepTarget: { type: 'boolean' } },
      },
      map: (args) => args,
    },
    {
      name: 'set_transition', capability: 'set_transition', risk: 'low',
      description: 'Set the transition entering a clip. Params: clipId, type, durationSec?.',
      parameters: {
        type: 'object', required: ['clipId', 'type'], additionalProperties: false,
        properties: { clipId: { type: 'string' }, type: { type: 'string' }, durationSec: { type: 'number' } },
      },
      map: (args) => args,
    },
    {
      name: 'apply_effect', capability: 'apply_effect', risk: 'low',
      description: 'Apply a visual effect. Params: target, clipId?, type, amount?, params?.',
      parameters: {
        type: 'object', required: ['target', 'type'], additionalProperties: false,
        properties: {
          target: { type: 'string', enum: ['clip', 'timeline'] }, clipId: { type: 'string' },
          type: { type: 'string' }, amount: { type: 'number' }, params: { type: 'object' },
        },
      },
      map: (args) => args,
    },
    {
      name: 'add_text', capability: 'add_overlay', risk: 'low',
      description: 'Add a title/card/lower third. Params: kind, text?, inSec, outSec, style?, anchor?, animation?, keyframes?.',
      parameters: {
        type: 'object', required: ['kind', 'inSec', 'outSec'], additionalProperties: false,
        properties: {
          kind: { type: 'string' }, text: { type: 'string' }, subtext: { type: 'string' },
          inSec: { type: 'number' }, outSec: { type: 'number' }, style: { type: 'string' },
          anchor: { type: 'string' }, animation: { type: 'string' }, keyframes: { type: 'array' },
        },
      },
      map: (args) => args,
    },
    {
      name: 'set_captions', capability: 'set_caption_animation', risk: 'low',
      description: 'Animate captions (word_by_word, typewriter, pop…). Params: animation, maxWordsPerLine?.',
      parameters: {
        type: 'object', required: ['animation'], additionalProperties: false,
        properties: { animation: { type: 'string' }, maxWordsPerLine: { type: 'number' } },
      },
      map: (args) => args,
    },
    {
      name: 'apply_color_grade', capability: 'apply_grade', risk: 'low',
      description: 'Grade the film or a clip. Params: target, clipId?, preset?, look?, intensity?.',
      parameters: {
        type: 'object', required: ['target'], additionalProperties: false,
        properties: { target: { type: 'string' }, clipId: { type: 'string' }, preset: { type: 'string' }, look: { type: 'object' }, intensity: { type: 'number' } },
      },
      map: (args) => args,
    },
    {
      name: 'set_music', capability: 'set_music', risk: 'low',
      description: 'Change the bed or its gain. Params: trackId?, src?, gainDb?, duckUnderVoiceDb?.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { trackId: { type: 'string' }, src: { type: 'string' }, gainDb: { type: 'number' }, duckUnderVoiceDb: { type: 'number' } },
      },
      map: (args) => args,
    },
    {
      name: 'set_target_duration', capability: 'set_target_duration', risk: 'medium',
      description: 'Retime the film to a length in seconds (5–90). Params: targetSec.',
      parameters: {
        type: 'object', required: ['targetSec'], additionalProperties: false,
        properties: { targetSec: { type: 'number', minimum: 5, maximum: 90 } },
      },
      map: (args) => args,
    },
  ];

  for (const alias of aliases) {
    tools.push({
      name: alias.name,
      description: alias.description,
      parameters: alias.parameters,
      risk: alias.risk,
      execute: (args) => applyCapability(alias.capability, alias.map(args)),
    });
  }

  return tools;
}

/** Compact JSON card list for the system prompt; not the whole registry. */
export function capabilityCardsForPrompt(registry: CapabilityRegistry, limit = 28) {
  return registry.cards().slice(0, limit).map((card) => `${card.id} — ${card.description}`);
}

export function shotsContext(shots: ShotSummary[] | undefined): string {
  if (shots === undefined || shots.length === 0) return 'No shot index was persisted for this listing.';
  return shots
    .slice(0, 40)
    .map((shot) => `${shot.id} | ${shot.room} | ${shot.startSec}-${shot.endSec}s | score ${shot.score ?? 'n/a'} | ${shot.reason ?? ''}`)
    .join('\n');
}

export { textOf };
