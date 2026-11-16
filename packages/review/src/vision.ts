/**
 * The paid half of review: six frames, one strict JSON reply, four scores.
 *
 * The reply schema is pinned here rather than trusted from the model. A reply
 * that does not match is a failed review, never a partially-used one.
 */

import type { ChatContentPart, ChatMessage, ChatResponse } from '@zeniconic/ai';
import type { Edl } from '@zeniconic/edl';
import type { FrameSample, ReviewFacts } from './types';

/** SPEC §8.1: the review model. */
export const DEFAULT_REVIEW_MODEL = 'google/gemini-4-carbon';

/** Four independent axes, each 0..1, plus a short note. */
export const VISION_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['adherence', 'pacing', 'visualQuality', 'watchability', 'notes'],
  properties: {
    adherence: { type: 'number', minimum: 0, maximum: 1 },
    pacing: { type: 'number', minimum: 0, maximum: 1 },
    visualQuality: { type: 'number', minimum: 0, maximum: 1 },
    watchability: { type: 'number', minimum: 0, maximum: 1 },
    notes: { type: 'string', maxLength: 200 },
  },
} as const;

export const VISION_MAX_NOTES = 200;

export interface VisionScores {
  adherence: number;
  pacing: number;
  visualQuality: number;
  watchability: number;
  notes: string;
}

const FENCE = /^\s*```(?:json|JSON)?\s*([\s\S]*?)\s*```\s*$/;

const KEYS = ['adherence', 'pacing', 'visualQuality', 'watchability', 'notes'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberInRange(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Strict validation: every field present, no extras, notes inside the limit. */
export function validateVisionScores(value: unknown): VisionScores | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of Object.keys(value)) {
    if (!(KEYS as readonly string[]).includes(key)) return undefined;
  }

  const adherence = value.adherence;
  const pacing = value.pacing;
  const visualQuality = value.visualQuality;
  const watchability = value.watchability;
  const notes = value.notes;
  if (
    !numberInRange(adherence) ||
    !numberInRange(pacing) ||
    !numberInRange(visualQuality) ||
    !numberInRange(watchability) ||
    typeof notes !== 'string' ||
    notes.length > VISION_MAX_NOTES
  ) {
    return undefined;
  }

  return { adherence, pacing, visualQuality, watchability, notes };
}

function parseText(text: string): unknown {
  const cleaned = FENCE.exec(text)?.[1]?.trim() ?? text.trim();
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Reads a `ChatResponse`. The client may already have parsed `json` against the
 * schema; a fake client, or one without structured output, leaves us the text.
 */
export function readVisionScores(response: ChatResponse): VisionScores | undefined {
  if (response.json !== undefined) {
    const candidate = typeof response.json === 'string' ? parseText(response.json) : response.json;
    const fromJson = validateVisionScores(candidate);
    if (fromJson !== undefined) return fromJson;
  }
  return validateVisionScores(parseText(response.text));
}

export function sceneSummary(edl: Edl, facts: ReviewFacts | undefined): string {
  const clips = edl.clips
    .map((clip, index) => {
      const start = clip.inSec;
      const end = clip.outSec;
      return `${String(index + 1)}. ${clip.room ?? 'unknown'} ${start.toFixed(1)}–${end.toFixed(1)}s: ${clip.reason}`;
    })
    .join('\n');

  const overlays = edl.overlays
    .map(
      (overlay) =>
        `${overlay.kind} "${overlay.text ?? ''}"${overlay.subtext === undefined ? '' : ` / "${overlay.subtext}"`} ${overlay.inSec.toFixed(1)}–${overlay.outSec.toFixed(1)}s, ${overlay.anchor}`,
    )
    .join('\n');

  const factLines = [
    facts?.price === undefined ? undefined : `price: ${facts.price}`,
    facts?.address === undefined ? undefined : `address: ${facts.address}`,
    facts?.beds === undefined ? undefined : `beds: ${String(facts.beds)}`,
    facts?.baths === undefined ? undefined : `baths: ${String(facts.baths)}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('; ');

  return [
    `Format: ${edl.format.label} (${edl.format.id}), target ${String(edl.format.targetDurationSec)} s.`,
    `Look: ${edl.look.label} (${edl.look.id}).`,
    `Canvas: ${String(edl.canvas.width)}x${String(edl.canvas.height)}, safe area ${String(edl.canvas.safeArea.top)}/${String(edl.canvas.safeArea.bottom)}/${String(edl.canvas.safeArea.left)}/${String(edl.canvas.safeArea.right)}.`,
    factLines.length === 0 ? 'Confirmed facts: none supplied.' : `Confirmed facts: ${factLines}.`,
    `Shots:\n${clips}`,
    overlays.length === 0 ? 'Overlays: none.' : `Overlays:\n${overlays}`,
  ].join('\n');
}

const SYSTEM_PROMPT = [
  'You review a finished property-listing video for a branch marketing team.',
  'Judge only the six frames and the edit plan. Do not invent facts, rooms or people.',
  'Score each axis from 0 (broken) to 1 (excellent):',
  '- adherence: the frames match the plan, the order, and the confirmed facts on screen.',
  '- pacing: cuts feel intentional; no dead air, no rushed or stalled ending.',
  '- visualQuality: sharp, correctly exposed, well framed; overlays legible and inside the safe area.',
  '- watchability: would a buyer keep watching to the end?',
  'Name at most three concrete fixes in notes, under 200 characters.',
  'Reply with JSON only, matching the supplied schema. No prose, no code fence.',
].join('\n');

/** Six evenly spaced moments, half a step inside each sixth. */
export function visionSampleTimes(durationSec: number, count = 6): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = (durationSec * (index + 0.5)) / count;
    times.push(Math.round(t * 1000) / 1000);
  }
  return times;
}

export function buildVisionMessages(
  edl: Edl,
  frames: readonly FrameSample[],
  facts: ReviewFacts | undefined,
): ChatMessage[] {
  const images: ChatContentPart[] = frames.map((frame) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${frame.jpegBase64}` },
  }));

  const parts: ChatContentPart[] = [
    {
      type: 'text',
      text: `Review this take.\n\n${sceneSummary(edl, facts)}`,
    },
    ...images,
  ];

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts },
  ];
}

export function meanVisionScore(scores: VisionScores): number {
  const mean = (scores.adherence + scores.pacing + scores.visualQuality + scores.watchability) / 4;
  return Math.round(mean * 10_000) / 10_000;
}
