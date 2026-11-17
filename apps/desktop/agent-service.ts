/**
 * Desktop adapter for the editing agent.
 *
 * Owns the model call, the project context and the commit step; the pure agent
 * loop lives in `packages/agent`. Nothing here writes a version until the loop
 * has produced a valid draft.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AiError, OpenRouterClient } from '../../packages/ai/src/index';
import type { ChatMessage, ToolDefinition } from '../../packages/ai/src/index';
import { createDefaultRegistry } from '../../packages/capabilities/src/index';
import { runAgent } from '../../packages/agent/src/index';
import type {
  AgentModel,
  AgentRunResult,
  Autonomy,
  ShotSummary,
} from '../../packages/agent/src/index';
import type { Edl } from '../../packages/edl/src/index';
import { renderPreview } from '../../services/preview/src/index';
import type { Store, ListingRecord } from '../../packages/store/src/index';
import { readReferenceProfile, referenceGuidance } from '../../services/reference/src/index';
import type { AgentEventDto } from '../../packages/ipc/src/index';
import type { ChatService } from './chat';
import { readVariantEdl, readVariants } from './variants';

export interface AgentServiceOptions {
  store: Store;
  chat: ChatService;
  apiKey: () => string | undefined | Promise<string | undefined>;
  /** Primary agent model; candidates are tried on a capability failure. */
  models: readonly string[];
  baseUrl?: string;
  now?: () => string;
  /** Where draft previews are written; absent disables `preview_render`. */
  dataDir?: string;
  /** Bundled font directory for the overlay pass. */
  fontsDir?: string;
  /** Live activity for the renderer; failures are swallowed. */
  onEvent?: (event: AgentEventDto) => void;
  /** Records billed spend after a run. */
  onSpend?: (input: {
    role: 'agent';
    model: string;
    listingId: string;
    runId: string;
    costUsd: number;
  }) => Promise<void> | void;
  /** How long to wait for a human approval before denying it. */
  approvalTimeoutMs?: number;
  /** False when the persisted budget would be exceeded by a worst-case run. */
  canSpend?: (usd: number, listingId: string) => Promise<boolean> | boolean;
}

export interface AgentRunInput {
  listingId: string;
  variantId: string;
  message: string;
  autonomy?: Autonomy;
}

export interface AgentRunOutcome {
  ok: boolean;
  runId: string;
  reply: string;
  diff?: string;
  versionId?: string;
  /** True when the committed version was also made current for export. */
  applied: boolean;
  warnings: string[];
  edits: AgentRunResult['edits'];
  costUsd: number;
  steps: number;
  /** Absolute draft preview rendered during the run, when any. */
  previewPath?: string;
  error?: string;
}

export interface AgentService {
  run(input: AgentRunInput): Promise<AgentRunOutcome>;
  /** Render the current variant draft for the Refine stage; no model call. */
  preview(input: { listingId: string; variantId: string }): Promise<{ path?: string; warning?: string }>;
  /** Resolve a pending approval; false when the run is unknown or already done. */
  approve(runId: string, approved: boolean): boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inputArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * One model, with an ordered fallback. A capability failure (the model cannot
 * call tools or read images) moves to the next candidate; transport, auth and
 * budget failures go straight through.
 */
function fallbackModel(options: {
  apiKey: string;
  models: readonly string[];
  baseUrl?: string;
}): AgentModel {
  const models = options.models.filter((model) => model.trim().length > 0);
  if (models.length === 0) throw new Error('No agent model is configured.');

  return {
    async complete(input) {
      let last: unknown;
      for (let index = 0; index < models.length; index += 1) {
        const model = models[index]!;
        try {
          const client = new OpenRouterClient({
            apiKey: options.apiKey,
            fetchImpl: (url, init) => fetch(url, init),
            ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
          });
          const response = await client.complete({
            model,
            messages: input.messages as ChatMessage[],
            tools: input.tools as ToolDefinition[],
            temperature: input.temperature ?? 0.2,
            ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
          });
          return {
            text: response.text,
            ...(response.toolCalls === undefined ? {} : { toolCalls: response.toolCalls }),
            costUsd: response.costUsd,
            ...(response.finishReason === undefined ? {} : { finishReason: response.finishReason }),
          };
        } catch (error) {
          last = error;
          const retryable =
            error instanceof AiError &&
            (error.code === 'E_MODEL_CAPABILITY' || error.code === 'E_BAD_REQUEST' || error.code === 'E_UNKNOWN_MODEL');
          if (!retryable || index === models.length - 1) throw error;
        }
      }
      throw last instanceof Error ? last : new Error(messageOf(last));
    },
  };
}

async function readShots(listingDir: string): Promise<ShotSummary[]> {
  const files = ['footage_index.tagged.json', 'footage_index.json'];
  for (const name of files) {
    let raw: string;
    try {
      raw = await readFile(join(listingDir, name), 'utf8');
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as {
        clips?: Array<{
          id?: unknown;
          file?: unknown;
          name?: unknown;
          shots?: Array<{
            id?: unknown;
            startSec?: unknown;
            endSec?: unknown;
            tags?: { room?: unknown; score?: unknown; sellingPoints?: unknown };
          }>;
        }>;
      };
      const shots: ShotSummary[] = [];
      for (const clip of inputArray(parsed.clips) as Array<Record<string, unknown>>) {
        const sourceId = typeof clip.id === 'string' ? clip.id : '';
        const src = typeof clip.file === 'string' ? clip.file : typeof clip.name === 'string' ? clip.name : undefined;
        for (const shot of inputArray(clip.shots) as Array<Record<string, unknown>>) {
          const id = typeof shot.id === 'string' ? shot.id : '';
          const startSec = typeof shot.startSec === 'number' ? shot.startSec : undefined;
          const endSec = typeof shot.endSec === 'number' ? shot.endSec : undefined;
          if (id.length === 0 || startSec === undefined || endSec === undefined) continue;
          const tags = shot.tags as { room?: unknown; score?: unknown; sellingPoints?: unknown } | undefined;
          shots.push({
            id,
            sourceId,
            room: typeof tags?.room === 'string' ? tags.room : 'unknown',
            startSec,
            endSec,
            ...(typeof tags?.score === 'number' ? { score: tags.score / 100 } : {}),
            ...(src === undefined ? {} : { src }),
          });
        }
      }
      return shots;
    } catch {
      continue;
    }
  }
  return [];
}

export function createAgentService(options: AgentServiceOptions): AgentService {
  const registry = createDefaultRegistry();
  const pending = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }>();
  const approvalTimeoutMs = options.approvalTimeoutMs ?? 5 * 60_000;

  const settle = (runId: string, approved: boolean): boolean => {
    const entry = pending.get(runId);
    if (entry === undefined) return false;
    pending.delete(runId);
    clearTimeout(entry.timer);
    entry.resolve(approved);
    return true;
  };

  /**
   * One draft render path for both the agent tool and the Refine stage. Writes
   * under `<data>/previews`, never over an export, and never throws to callers.
   */
  const renderDraft = async (
    listing: ListingRecord,
    listingDir: string,
    draft: Edl,
  ): Promise<{ path?: string; warning?: string }> => {
    if (options.dataDir === undefined) {
      return { warning: 'Preview rendering is unavailable in this build.' };
    }
    const output = join(
      options.dataDir,
      'previews',
      `${draft.id}-${Date.now().toString(36)}.mp4`,
    );
    try {
      const rendered = await renderPreview({
        edl: draft,
        listingDir,
        output,
        width: 540,
        facts: {
          address: listing.facts.address,
          ...(listing.facts.price === undefined ? {} : { price: listing.facts.price }),
          ...(listing.facts.beds === undefined ? {} : { beds: listing.facts.beds }),
          ...(listing.facts.baths === undefined ? {} : { baths: listing.facts.baths }),
        },
        ...(options.fontsDir === undefined ? {} : { fontsDir: options.fontsDir }),
      });
      return {
        path: rendered.path,
        ...(rendered.warnings.length > 0 ? { warning: rendered.warnings[0] } : {}),
      };
    } catch (error) {
      return {
        warning:
          error instanceof Error ? `Preview failed: ${error.message}` : 'Preview failed.',
      };
    }
  };

  return {
    approve(runId: string, approved: boolean): boolean {
      return settle(runId, approved);
    },

    async preview(input: { listingId: string; variantId: string }): Promise<{
      path?: string;
      warning?: string;
    }> {
      const listing = await options.store.get(input.listingId);
      if (listing === undefined) return { warning: 'That listing was not found.' };
      const listingDir = options.store.dirFor(listing.id);
      const variants = await readVariants(listingDir);
      const variant = variants.find(
        (entry) => entry.id === input.variantId || entry.look === input.variantId,
      );
      if (variant === undefined) return { warning: 'That variant was not found.' };
      const edl = await readVariantEdl(listingDir, variant.id);
      return renderDraft(listing, listingDir, edl);
    },

    async run(input: AgentRunInput): Promise<AgentRunOutcome> {
      const runId = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const emit = (event: Omit<AgentEventDto, 'runId'>): void => {
        try {
          options.onEvent?.({ ...event, runId });
        } catch {
          // A window that is closing must not break an edit.
        }
      };

      const message = input.message.trim();
      if (message.length === 0) {
        return { ok: false, runId, reply: 'Type what you want to change.', warnings: [], edits: [], costUsd: 0, steps: 0, applied: false, error: 'empty request' };
      }

      const key = await options.apiKey();
      if (typeof key !== 'string' || key.trim().length === 0) {
        return {
          ok: false,
          runId,
          reply: 'Add an OpenRouter key in Settings before asking the assistant to edit.',
          warnings: [],
          edits: [],
          costUsd: 0,
          steps: 0,
          applied: false,
          error: 'missing key',
        };
      }

      const listing = await options.store.get(input.listingId);
      if (listing === undefined) {
        return { ok: false, runId, reply: `Listing "${input.listingId}" was not found.`, warnings: [], edits: [], costUsd: 0, steps: 0, applied: false, error: 'not found' };
      }

      const listingDir = options.store.dirFor(listing.id);
      const variants = await readVariants(listingDir);
      const variant = variants.find((entry) => entry.id === input.variantId || entry.look === input.variantId);
      if (variant === undefined) {
        return { ok: false, runId, reply: 'That variant was not found.', warnings: [], edits: [], costUsd: 0, steps: 0, applied: false, error: 'variant not found' };
      }

      if (options.canSpend !== undefined) {
        const allowed = await Promise.resolve(options.canSpend(0.25, listing.id)).catch(() => false);
        if (!allowed) {
          return {
            ok: false,
            runId,
            reply:
              'The model budget for today, this month or this listing is exhausted. Raise the cap or wait for the reset.',
            warnings: [],
            edits: [],
            costUsd: 0,
            steps: 0,
            applied: false,
            error: 'budget',
          };
        }
      }

      const edl = await readVariantEdl(listingDir, variant.id);
      const shots = await readShots(listingDir);
      const history = (await options.chat.versions(listing.id, variant.id)).slice(0, 5).map((version) => version.summary);
      const storedReference = await readReferenceProfile(listingDir).catch(() => undefined);

      const model = fallbackModel({
        apiKey: key,
        models: options.models,
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      });

      const requestApproval = (request: { summary: string; risk: 'medium' | 'high' }): Promise<boolean> =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            if (pending.get(runId)?.resolve === resolve) {
              pending.delete(runId);
              emit({ type: 'warning', message: `Approval timed out for ${request.summary}; nothing was changed.` });
              resolve(false);
            }
          }, approvalTimeoutMs);
          pending.set(runId, { resolve, timer });
        });

      let result;
      try {
        result = await runAgent(
          {
            model,
            registry,
            ...(options.dataDir === undefined
              ? {}
              : {
                  preview: {
                    preview: (draft: Edl) => renderDraft(listing, listingDir, draft),
                  },
                }),
          },
          {
            message,
            autonomy: input.autonomy ?? 'ask',
            context: {
              listingId: listing.id,
              ...(listing.address.trim().length === 0 ? {} : { address: listing.address }),
              facts: { ...listing.facts },
              edl,
              shots,
              history,
              ...(storedReference === undefined ? {} : { reference: referenceGuidance(storedReference) }),
            },
            limits: { maxSteps: 10, maxToolCalls: 24, maxCostUsd: 0.25 },
            onEvent: emit,
            requestApproval,
          },
        );
      } finally {
        settle(runId, false);
      }

      // Record billed spend even when the run failed after a model call.
      if (result.costUsd > 0) {
        try {
          await options.onSpend?.({
            role: 'agent',
            model: options.models[0] ?? 'unknown',
            listingId: listing.id,
            runId,
            costUsd: result.costUsd,
          });
        } catch {
          // Spend accounting must not fail the edit; the next run re-reads the file.
        }
      }

      const warnings = [...result.warnings];
      if (!result.ok) {
        return {
          ok: false,
          runId,
          reply: result.reply,
          warnings,
          edits: result.edits,
          costUsd: result.costUsd,
          steps: result.steps,
          applied: false,
          ...(result.previewPath === undefined ? {} : { previewPath: result.previewPath }),
          ...(result.error === undefined ? {} : { error: result.error }),
        };
      }

      const summary = result.edits.map((edit) => edit.summary).join(' ') || result.reply;
      try {
        const committed = await options.chat.commit({
          listingId: listing.id,
          variantId: variant.id,
          edl: result.edl,
          summary,
        });
        warnings.push(...committed.warnings);
        // Auto autonomy makes the edit current; ask/suggest leave it as a saved
        // version so the user can review and apply it.
        let applied = false;
        if ((input.autonomy ?? 'ask') === 'auto') {
          try {
            const current = await options.chat.apply({
              listingId: listing.id,
              variantId: variant.id,
              versionId: committed.versionId,
            });
            applied = current.ok;
            if (!applied) warnings.push('The edit was saved but could not be made current.');
          } catch (error) {
            warnings.push(`The edit was saved but not applied: ${messageOf(error)}`);
          }
        }
        return {
          ok: true,
          runId,
          reply: result.reply,
          diff: committed.diff,
          versionId: committed.versionId,
          applied,
          warnings,
          edits: result.edits,
          costUsd: result.costUsd,
          steps: result.steps,
          ...(result.previewPath === undefined ? {} : { previewPath: result.previewPath }),
        };
      } catch (error) {
        return {
          ok: false,
          runId,
          reply: `The edit was made but could not be saved: ${messageOf(error)}`,
          warnings,
          edits: result.edits,
          costUsd: result.costUsd,
          steps: result.steps,
          applied: false,
          ...(result.previewPath === undefined ? {} : { previewPath: result.previewPath }),
          error: messageOf(error),
        };
      }
    },
  };
}
