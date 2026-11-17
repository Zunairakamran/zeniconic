/**
 * Visual inspection of a finished render.
 *
 * Deterministic checks (`review.ts`) prove the file is technically sound; this
 * asks a multimodal model what the frames actually look like. The reply schema
 * is pinned here, and a reply that does not match is a failed inspection, never
 * a partially-trusted one.
 */

import type { ChatClient, ChatMessage } from '@zeniconic/ai';
import type { FrameSample } from './types';

export const INSPECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'score', 'summary', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'retry', 'fail'] },
    score: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string', maxLength: 400 },
    issues: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'severity', 'atSec', 'detail'],
        properties: {
          issue: { type: 'string', maxLength: 120 },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          atSec: { type: 'number', minimum: 0, maximum: 3600 },
          detail: { type: 'string', maxLength: 240 },
        },
      },
    },
  },
} as const;

export type InspectVerdict = 'pass' | 'retry' | 'fail';
export type InspectSeverity = 'low' | 'medium' | 'high';

export interface InspectIssue {
  issue: string;
  severity: InspectSeverity;
  atSec: number;
  detail: string;
}

export interface InspectResult {
  verdict: InspectVerdict;
  score: number;
  summary: string;
  issues: InspectIssue[];
  model: string;
  costUsd: number;
  frames: number[];
}

export type InspectErrorCode = 'E_INSPECT_JSON' | 'E_INSPECT_NO_FRAMES' | 'E_INSPECT_MODEL';

export class InspectError extends Error {
  readonly code: InspectErrorCode;

  constructor(code: InspectErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InspectError';
    this.code = code;
  }
}

export interface InspectInput {
  file: string;
  /** Optional project facts so the model can check the cards for accuracy. */
  facts?: Record<string, string | number | undefined>;
  /** Timeline seconds to sample. Defaults to six even points. */
  times?: number[];
}

export interface InspectDeps {
  sampleFrames(file: string, times: number[]): Promise<FrameSample[]>;
  probe(file: string): Promise<{ durationSec: number }>;
  client: ChatClient;
  model: string;
}

export function inspectTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  return Array.from({ length: 6 }, (_, index) =>
    Math.round(((index + 0.5) / 6) * durationSec * 1000) / 1000,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseText(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return undefined;
  }
}

/** Strict validation; anything unexpected fails the inspection. */
export function validateInspectReply(value: unknown): Omit<InspectResult, 'model' | 'costUsd' | 'frames'> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.verdict !== 'pass' && value.verdict !== 'retry' && value.verdict !== 'fail') return undefined;
  if (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) return undefined;
  if (typeof value.summary !== 'string' || value.summary.length === 0 || value.summary.length > 400) return undefined;
  if (!Array.isArray(value.issues) || value.issues.length > 12) return undefined;

  const issues: InspectIssue[] = [];
  for (const item of value.issues) {
    if (!isRecord(item)) return undefined;
    if (typeof item.issue !== 'string' || item.issue.length === 0 || item.issue.length > 120) return undefined;
    if (item.severity !== 'low' && item.severity !== 'medium' && item.severity !== 'high') return undefined;
    if (typeof item.atSec !== 'number' || !Number.isFinite(item.atSec) || item.atSec < 0) return undefined;
    if (typeof item.detail !== 'string' || item.detail.length > 240) return undefined;
    issues.push({
      issue: item.issue,
      severity: item.severity,
      atSec: Math.round(item.atSec * 1000) / 1000,
      detail: item.detail,
    });
  }

  return { verdict: value.verdict, score: value.score, summary: value.summary, issues };
}

export async function inspectRender(input: InspectInput, deps: InspectDeps): Promise<InspectResult> {
  const info = await deps.probe(input.file);
  const times = input.times ?? inspectTimes(info.durationSec);
  if (times.length === 0) {
    throw new InspectError('E_INSPECT_NO_FRAMES', 'The file has no readable duration.');
  }

  const frames = await deps.sampleFrames(input.file, times);
  if (frames.length === 0) {
    throw new InspectError('E_INSPECT_NO_FRAMES', 'No frames could be sampled from the export.');
  }

  const facts = input.facts === undefined
    ? ''
    : `Confirmed facts (check any card against these): ${JSON.stringify(input.facts)}.`;
  const instruction = [
    'You are a senior real-estate video editor reviewing six frames from a finished vertical or landscape marketing cut.',
    'Judge composition, cropping, text legibility, text overlap, safe-area placement, black/blank frames, continuity and whether the property cards are plausible.',
    'Do not invent facts. If a card is unreadable, say so rather than guessing its content.',
    facts,
    'Reply with one JSON object matching the schema. Use seconds from the start of the file for atSec.',
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  const content = [
    { type: 'text' as const, text: `${instruction}\nFrame times: ${frames.map((frame) => frame.t).join(', ')} s.` },
    ...frames.map((frame) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/jpeg;base64,${frame.jpegBase64}` },
    })),
  ];
  const messages: ChatMessage[] = [{ role: 'user', content }];

  let response;
  try {
    response = await deps.client.complete({
      model: deps.model,
      messages,
      jsonSchema: INSPECT_SCHEMA,
      temperature: 0.1,
      maxTokens: 1_800,
    });
  } catch (error) {
    throw new InspectError(
      'E_INSPECT_MODEL',
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  const parsed = response.json ?? parseText(response.text);
  const validated = validateInspectReply(parsed);
  if (validated === undefined) {
    throw new InspectError('E_INSPECT_JSON', 'The review model did not return a usable inspection.');
  }

  return {
    ...validated,
    model: response.model,
    costUsd: response.costUsd,
    frames: frames.map((frame) => frame.t),
  };
}
