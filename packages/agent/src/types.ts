/**
 * The editing agent.
 *
 * One orchestrator, no decorative multi-agent framework: it builds context,
 * exposes the capability registry as tools, runs a bounded tool loop against
 * OpenRouter, validates every edit through the registry, optionally renders a
 * preview and asks for approval before destructive changes.
 *
 * The agent never writes files. It returns a draft EDL plus a summary; the
 * desktop host decides when a version is written and when it becomes current.
 */

import type { Edl } from '@zeniconic/edl';

export type Autonomy = 'suggest' | 'ask' | 'auto';

export type AgentRole = 'agent' | 'planner';

export interface ShotSummary {
  id: string;
  sourceId: string;
  room: string;
  startSec: number;
  endSec: number;
  score?: number;
  reason?: string;
  src?: string;
}

export interface ProjectContext {
  listingId: string;
  address?: string;
  facts?: Record<string, unknown>;
  edl: Edl;
  shots?: ShotSummary[];
  /** Recent edit summaries, newest first. */
  history?: string[];
  reference?: Record<string, unknown>;
}

export interface AgentLimits {
  maxSteps: number;
  maxToolCalls: number;
  /** Stop when the estimated+committed spend for this run exceeds this. */
  maxCostUsd: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxSteps: 10,
  maxToolCalls: 24,
  maxCostUsd: 0.25,
};

export interface AgentEvent {
  type:
    | 'understood'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'approval_required'
    | 'warning'
    | 'done'
    | 'error';
  /** Plain text the UI can show; never chain-of-thought. */
  message: string;
  tool?: string;
  ok?: boolean;
  data?: unknown;
}

export interface ApprovalRequest {
  tool: string;
  capability?: string;
  risk: 'medium' | 'high';
  summary: string;
  params?: unknown;
}

export interface AgentRunInput {
  message: string;
  context: ProjectContext;
  autonomy?: Autonomy;
  limits?: Partial<AgentLimits>;
  /** Called for every visible event. Must not throw. */
  onEvent?: (event: AgentEvent) => void;
  /** Ask a human. Absent = deny medium/high risk changes. */
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
}

export interface AgentEditSummary {
  capability: string;
  summary: string;
  risk: string;
}

export interface AgentRunResult {
  ok: boolean;
  reply: string;
  edl: Edl;
  edits: AgentEditSummary[];
  warnings: string[];
  costUsd: number;
  steps: number;
  /** Absolute path of the latest draft preview, when one was rendered. */
  previewPath?: string;
  /** Set when the model produced no usable change. */
  error?: string;
}

/** The model/tool seam; implemented with OpenRouter in the desktop host. */
export interface AgentModel {
  complete(input: {
    messages: unknown[];
    tools: unknown[];
    temperature?: number;
    maxTokens?: number;
    model?: string;
  }): Promise<{
    text: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    costUsd?: number;
    finishReason?: string;
  }>;
}

export interface AgentToolResult {
  ok: boolean;
  /** Serialised into the tool message; keep it small and factual. */
  content: unknown;
  /** Human-facing one-liner for the event stream. */
  summary: string;
  /** Present when the tool changed the draft. */
  edl?: Edl;
  edit?: AgentEditSummary;
  terminate?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for native tool calling. */
  parameters: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  execute(args: Record<string, unknown>): Promise<AgentToolResult> | AgentToolResult;
}
