import { validateEdl } from '@zeniconic/edl';
import type { Edl } from '@zeniconic/edl';
import type { CapabilityRegistry } from '@zeniconic/capabilities';
import { createToolbox } from './tools';
import { capabilityCardsForPrompt, shotsContext } from './tools';
import type { PreviewPort } from './tools';
import type {
  AgentEditSummary,
  AgentEvent,
  AgentLimits,
  AgentModel,
  AgentRunInput,
  AgentRunResult,
  AgentTool,
  Autonomy,
} from './types';
import { DEFAULT_LIMITS } from './types';

export interface OrchestratorOptions {
  model: AgentModel;
  registry: CapabilityRegistry;
  preview?: PreviewPort;
  /** Injectable clock for tests. */
  now?: () => string;
}

const SYSTEM_PROMPT = `You are the editing agent inside Zeniconic, a property-video editor.

You edit a validated EDL (timeline JSON). You do not write prose about editing: you inspect the project, discover capabilities, apply them, then answer briefly.

Method:
1. Read the project and the user's request. If the request is ambiguous, make the smallest reasonable interpretation and say so.
2. Discover operations with search_capabilities / describe_capability. Never invent a capability id or a parameter.
3. Apply one capability at a time with apply_capability (or a named shortcut tool), then validate_edl if the result is structural.
4. Preserve facts: never invent a price, bedroom count, size, address, distance or agent detail. Only edit copy from the project facts.
5. Keep the price card and disclaimer unless the user explicitly changes their content.
6. Do not remove more than the request needs; prefer the smallest edit.
7. When done, call finish with one or two plain sentences describing what changed. No markdown, no chain-of-thought.
8. Re-read the request before finish. Every named change must be applied or explicitly reported as not done. Do not spend the whole budget on one part of a multi-part request.

If a required operation does not exist, say which capability is missing and what you did instead.`;

function event(run: AgentRunInput, payload: AgentEvent): void {
  try {
    run.onEvent?.(payload);
  } catch {
    // A UI listener must never break an edit.
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('arguments must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Tool arguments are not a JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function approvalFor(tool: AgentTool, args: Record<string, unknown>, registry: CapabilityRegistry) {
  const capabilityId = typeof args.id === 'string' ? args.id : undefined;
  const capability = capabilityId === undefined ? undefined : registry.get(capabilityId);
  const risk = capability?.risk ?? tool.risk;
  const summary = capability === undefined
    ? `${tool.name}`
    : `${capability.name}: ${capability.description}`;
  return { risk, capabilityId, summary };
}

function allowedByAutonomy(risk: 'low' | 'medium' | 'high', autonomy: Autonomy, hasApproval: boolean): 'allow' | 'ask' | 'deny' {
  if (risk === 'low') return 'allow';
  if (autonomy === 'auto') return risk === 'high' && !hasApproval ? 'ask' : 'allow';
  if (autonomy === 'suggest') return 'deny';
  return 'ask';
}

export async function runAgent(options: OrchestratorOptions, input: AgentRunInput): Promise<AgentRunResult> {
  const limits: AgentLimits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const autonomy: Autonomy = input.autonomy ?? 'ask';
  const tools = createToolbox({
    registry: options.registry,
    context: input.context,
    getEdl: () => draft,
    setEdl: (next) => {
      draft = next;
    },
    ...(options.preview === undefined ? {} : { preview: options.preview }),
    maxToolCalls: limits.maxToolCalls,
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolSpecs = tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  let draft: Edl = structuredClone(input.context.edl);
  let lastValid: Edl = structuredClone(input.context.edl);
  const edits: AgentEditSummary[] = [];
  const warnings: string[] = [];
  // One decision per capability per run: a retry after a rejected edit must not
  // ask the same question again.
  const approvedThisRun = new Set<string>();
  const deniedThisRun = new Set<string>();
  let costUsd = 0;
  let steps = 0;
  let reply = '';
  let failure: string | undefined;
  /** Latest draft file rendered by `preview_render`, for real playback. */
  let previewPath: string | undefined;

  const facts = input.context.facts === undefined ? 'No confirmed facts supplied.' : JSON.stringify(input.context.facts);
  const history = (input.context.history ?? []).slice(0, 5).join('\n') || 'No earlier edits.';
  const reference = input.context.reference === undefined ? 'none' : JSON.stringify(input.context.reference);

  const contextBlock = [
    `Listing: ${input.context.listingId}${input.context.address === undefined ? '' : ` — ${input.context.address}`}`,
    `Facts: ${facts}`,
    `Current edit: ${JSON.stringify({
      format: input.context.edl.format,
      look: input.context.edl.look,
      clips: input.context.edl.clips.map((clip) => ({
        id: clip.id, room: clip.room, in: clip.inSec, out: clip.outSec, speed: clip.speed,
      })),
      overlays: input.context.edl.overlays.map((overlay) => ({ id: overlay.id, kind: overlay.kind, text: overlay.text })),
      captions: input.context.edl.captions.mode,
    })}`,
    `Shots:\n${shotsContext(input.context.shots)}`,
    `Recent edits:\n${history}`,
    `Reference style: ${reference}`,
    `Autonomy: ${autonomy}.`,
    `Capabilities (search for full params):\n${capabilityCardsForPrompt(options.registry).join('\n')}`,
  ].join('\n\n');

  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${contextBlock}\n\nRequest: ${input.message}` },
  ];

  event(input, { type: 'understood', message: 'Read the current edit and the footage index.' });

  for (; steps < limits.maxSteps; steps += 1) {
    if (costUsd > limits.maxCostUsd) {
      warnings.push(`Stopped at the $${limits.maxCostUsd.toFixed(2)} run budget.`);
      break;
    }

    let response;
    try {
      response = await options.model.complete({
        messages,
        tools: toolSpecs,
        temperature: 0.2,
        maxTokens: 1600,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      event(input, { type: 'error', message: failure });
      break;
    }

    costUsd += typeof response.costUsd === 'number' && Number.isFinite(response.costUsd) ? response.costUsd : 0;
    const calls = response.toolCalls ?? [];

    if (calls.length === 0) {
      reply = response.text.trim();
      event(input, { type: 'thinking', message: reply.length > 0 ? reply.slice(0, 200) : 'No further changes.' });
      break;
    }

    // Record the assistant turn once, with every call it made.
    messages.push({
      role: 'assistant',
      content: response.text ?? '',
      toolCalls: calls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
    });

    for (const call of calls) {
      const tool = byName.get(call.name);
      if (tool === undefined) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ error: `Unknown tool "${call.name}".` }),
        });
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = parseArgs(call.arguments);
      } catch (error) {
        messages.push({
          role: 'tool', toolCallId: call.id, name: call.name,
          content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        });
        continue;
      }

      const approval = approvalFor(tool, args, options.registry);
      const approvalKey = approval.capabilityId ?? tool.name;
      const decision = approvedThisRun.has(approvalKey)
        ? 'allow'
        : deniedThisRun.has(approvalKey)
          ? 'deny'
          : allowedByAutonomy(approval.risk, autonomy, input.requestApproval !== undefined);

      if (decision === 'deny') {
        const message = `Refused ${approval.summary} (${approval.risk} risk; autonomy is ${autonomy}). Ask the user first.`;
        const firstDenial = !deniedThisRun.has(approvalKey);
        deniedThisRun.add(approvalKey);
        if (firstDenial) warnings.push(message);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify({ denied: true, reason: message }) });
        if (firstDenial) event(input, { type: 'warning', message });
        continue;
      }

      if (decision === 'ask') {
        event(input, {
          type: 'approval_required',
          message: `Approve ${approval.summary}?`,
          tool: tool.name,
          data: { risk: approval.risk, capability: approval.capabilityId, params: args },
        });
        let approved = false;
        if (input.requestApproval !== undefined) {
          try {
            approved = await input.requestApproval({
              tool: tool.name,
              ...(approval.capabilityId === undefined ? {} : { capability: approval.capabilityId }),
              risk: approval.risk as 'medium' | 'high',
              summary: approval.summary,
              params: args,
            });
          } catch {
            approved = false;
          }
        }
        if (!approved) {
          messages.push({
            role: 'tool', toolCallId: call.id, name: call.name,
            content: JSON.stringify({ denied: true, reason: 'The user did not approve this change.' }),
          });
          if (!deniedThisRun.has(approvalKey)) {
            warnings.push(`${approval.summary} was not approved.`);
            deniedThisRun.add(approvalKey);
          }
          continue;
        }
        approvedThisRun.add(approvalKey);
      }

      event(input, { type: 'tool_start', message: `${tool.name}…`, tool: tool.name });
      let result;
      try {
        result = await tool.execute(args);
      } catch (error) {
        result = {
          ok: false,
          content: { error: error instanceof Error ? error.message : String(error) },
          summary: `${tool.name} failed.`,
        };
      }

      if (result.edl !== undefined) {
        draft = result.edl;
        const check = validateEdl(draft);
        if (check.valid) {
          lastValid = structuredClone(draft);
        } else {
          draft = structuredClone(lastValid);
          result = { ...result, ok: false, content: { issues: check.issues }, summary: 'That edit was invalid and was reverted.' };
        }
      }
      if (result.edit !== undefined && result.ok) edits.push(result.edit);

      // Only a successful preview_render yields a playable draft. The tool
      // returns the absolute path in its content; the IPC layer turns it into
      // a scheme URL so the renderer never sees a filesystem path.
      if (tool.name === 'preview_render' && result.ok) {
        const content = result.content as { path?: unknown } | undefined;
        if (typeof content?.path === 'string' && content.path.length > 0) {
          previewPath = content.path;
        }
      }

      if (result.terminate === true) {
        const content = result.content as { reply?: unknown };
        reply = typeof content.reply === 'string' ? content.reply : reply;
      }

      event(input, {
        type: 'tool_result',
        message: result.summary,
        tool: tool.name,
        ok: result.ok,
        data: result.edit,
      });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: tool.name,
        content: JSON.stringify(result.content).slice(0, 6000),
      });

      if (result.terminate === true) break;
    }

    if (reply.length > 0) break;
  }

  if (steps >= limits.maxSteps && reply.length === 0) {
    warnings.push(`Stopped after ${limits.maxSteps} model steps.`);
  }

  if (edits.length === 0 && failure === undefined) {
    failure = 'No valid change was made.';
  }

  if (reply.length === 0) {
    reply = edits.length === 0
      ? 'I could not make that change safely, so the edit is unchanged.'
      : `Done: ${edits.map((edit) => edit.summary).join(' ')}`;
  }

  // Deterministic completeness check for the changes users ask for most. The
  // model can still skip something; the reply must then say so instead of
  // claiming a blanket success.
  const gaps: string[] = [];
  const askedForGrade = /\b(grad(?:e|ed|ing)?|warm(?:er)?|cool(?:er)?|cinematic|colour|color)\b/i.test(input.message);
  const graded = edits.some((edit) => edit.capability === 'apply_grade');
  if (askedForGrade && !graded && draft.grade === undefined && !draft.clips.some((clip) => clip.grade !== undefined)) {
    gaps.push('No colour grade was applied.');
  }
  const askedForCaptions = /\b(caption|subtitle|typography|kinetic)\b/i.test(input.message);
  const captioned = edits.some((edit) => edit.capability.startsWith('set_caption') || edit.capability === 'upsert_caption_words');
  if (askedForCaptions && !captioned) {
    gaps.push('Caption changes were not applied.');
  }
  if (gaps.length > 0) {
    warnings.push(...gaps);
    reply = `${reply} Not applied: ${gaps.join(' ')}`;
    event(input, { type: 'warning', message: gaps.join(' ') });
  }

  event(input, {
    type: edits.length === 0 ? 'warning' : 'done',
    message: reply,
    ok: edits.length > 0,
  });

  return {
    ok: edits.length > 0 && failure === undefined,
    reply,
    edl: edits.length > 0 ? draft : structuredClone(input.context.edl),
    edits,
    warnings,
    costUsd,
    steps: Math.min(steps, limits.maxSteps),
    ...(previewPath === undefined ? {} : { previewPath }),
    ...(failure === undefined ? {} : { error: failure }),
  };
}
