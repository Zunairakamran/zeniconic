import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import schema from '../schema.json';
import type { Clip, Edl } from './types';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** A gap smaller than this is treated as float noise, not a missing segment. */
const GAP_EPSILON_SEC = 0.001;
const TIME_EPSILON_SEC = 1e-9;
const DURATION_TOLERANCE_SEC = 0.5;
const MAX_TRANSITION_SEC = 1.5;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateAgainstSchema = ajv.compile<Edl>(schema);

export class EdlValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const shown = issues.slice(0, 5).map((issue) => {
      const where = issue.path || '/';
      return `${issue.code} at ${where}: ${issue.message}`;
    });
    const remaining = issues.length - shown.length;
    const suffix = remaining > 0 ? ` (+${remaining} more)` : '';
    super(`Invalid EDL: ${shown.join('; ')}${suffix}`);
    this.name = 'EdlValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringParam(params: unknown, key: string): string | undefined {
  if (!isRecord(params)) return undefined;
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function mapSchemaError(error: ErrorObject): ValidationIssue {
  const missingProperty =
    error.keyword === 'required' ? stringParam(error.params, 'missingProperty') : undefined;
  // Ajv points at the parent for a missing property; name the property itself
  // so callers can highlight the exact field.
  const path = missingProperty ? `${error.instancePath}/${missingProperty}` : error.instancePath;
  const detail = error.message ?? 'is invalid';
  const message = missingProperty ? `Missing required property "${missingProperty}"` : detail;
  return { path, code: 'E_SCHEMA', message };
}

function clipDuration(clip: Clip): number {
  return (clip.outSec - clip.inSec) / clip.speed;
}

export function durationSec(edl: Edl): number {
  let total = 0;
  for (const clip of edl.clips) {
    total += clipDuration(clip);
  }
  const rounded = Math.round(total * 1000) / 1000;
  // Normalise -0 so equality and JSON output stay stable across platforms.
  return Object.is(rounded, -0) ? 0 : rounded;
}

function runtimeIssues(edl: Edl): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const total = durationSec(edl);

  // 1. Every clip must consume a positive interval.
  edl.clips.forEach((clip, index) => {
    if (clip.outSec <= clip.inSec) {
      issues.push({
        path: `/clips/${index}/outSec`,
        code: 'E_OUT_LE_IN',
        message: `Clip ${clip.id} ends at ${clip.outSec}s, which is not after its start at ${clip.inSec}s`,
      });
    }
  });

  // 2. Contiguity. The schema has no explicit gap marker, so the only
  // meaningful gap is between consecutive cuts of the same source file: the
  // next segment should start where the previous one ended.
  for (let index = 1; index < edl.clips.length; index += 1) {
    const previous = edl.clips[index - 1];
    const clip = edl.clips[index];
    const sameSource =
      previous !== undefined &&
      clip !== undefined &&
      (previous.sourceId === clip.sourceId || previous.src === clip.src);
    if (!previous || !clip || !sameSource) continue;
    const gap = clip.inSec - previous.outSec;
    if (gap > GAP_EPSILON_SEC) {
      issues.push({
        path: `/clips/${index}/inSec`,
        code: 'E_CLIP_GAP',
        message: `Clip ${clip.id} starts ${Number(gap.toFixed(3))}s after clip ${previous.id} ends, with no gap marker`,
      });
    }
  }

  // 3. Total runtime must match the format's target within half a second.
  const target = edl.format.targetDurationSec;
  if (Math.abs(total - target) > DURATION_TOLERANCE_SEC + TIME_EPSILON_SEC) {
    issues.push({
      path: '/format/targetDurationSec',
      code: 'E_DURATION',
      message: `Timeline runs ${total}s; target is ${target}s±${DURATION_TOLERANCE_SEC}s`,
    });
  }

  // 4. Overlays must be a positive interval that finishes on the timeline.
  edl.overlays.forEach((overlay, index) => {
    if (overlay.outSec <= overlay.inSec) {
      issues.push({
        path: `/overlays/${index}/outSec`,
        code: 'E_OVERLAY_RANGE',
        message: `Overlay ${overlay.id} ends at ${overlay.outSec}s, which is not after its start at ${overlay.inSec}s`,
      });
      return;
    }
    if (overlay.outSec > total + TIME_EPSILON_SEC) {
      issues.push({
        path: `/overlays/${index}/outSec`,
        code: 'E_OVERLAY_RANGE',
        message: `Overlay ${overlay.id} ends at ${overlay.outSec}s, beyond the ${total}s timeline`,
      });
    }
  });

  // 5. Transitions cannot outlast either side of the cut they straddle. At the
  // timeline edges the clip itself is the only neighbour available.
  edl.clips.forEach((clip, index) => {
    const own = clipDuration(clip);
    const previous = index > 0 ? edl.clips[index - 1] : undefined;
    const next = index + 1 < edl.clips.length ? edl.clips[index + 1] : undefined;

    const check = (transition: { durationSec: number } | undefined, shorter: number, path: string): void => {
      if (!transition) return;
      if (transition.durationSec > MAX_TRANSITION_SEC + TIME_EPSILON_SEC) {
        issues.push({
          path,
          code: 'E_TRANSITION',
          message: `Transition lasts ${transition.durationSec}s; the maximum is ${MAX_TRANSITION_SEC}s`,
        });
        return;
      }
      if (transition.durationSec > shorter + TIME_EPSILON_SEC) {
        issues.push({
          path,
          code: 'E_TRANSITION',
          message: `Transition lasts ${transition.durationSec}s, longer than the ${Number(shorter.toFixed(3))}s shorter neighbour`,
        });
      }
    };

    const inNeighbour = previous ? Math.min(own, clipDuration(previous)) : own;
    const outNeighbour = next ? Math.min(own, clipDuration(next)) : own;
    check(clip.transitionIn, inNeighbour, `/clips/${index}/transitionIn/durationSec`);
    check(clip.transitionOut, outNeighbour, `/clips/${index}/transitionOut/durationSec`);

    // A transition handle only has a job when the clip actually hands over to a
    // non-cut transition, and it can never exceed that transition's length.
    const handle = clip.handleOutSec;
    if (handle !== undefined && handle > TIME_EPSILON_SEC) {
      const outgoing = clip.transitionOut;
      if (outgoing === undefined || outgoing.type === 'cut') {
        issues.push({
          path: `/clips/${index}/handleOutSec`,
          code: 'E_HANDLE',
          message: `Clip ${clip.id} carries a ${Number(handle.toFixed(3))}s handle but has no outgoing transition to spend it on`,
        });
      } else if (handle > outgoing.durationSec + TIME_EPSILON_SEC) {
        issues.push({
          path: `/clips/${index}/handleOutSec`,
          code: 'E_HANDLE',
          message: `Clip ${clip.id} borrows ${Number(handle.toFixed(3))}s for a ${Number(outgoing.durationSec.toFixed(3))}s transition`,
        });
      }
    }
  });

  // 6. Caption words must run forwards and must not overlap.
  const words = edl.captions.words ?? [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    if (word.endSec < word.startSec) {
      issues.push({
        path: `/captions/words/${index}/endSec`,
        code: 'E_CAPTION_ORDER',
        message: `Word "${word.text}" ends before it starts`,
      });
      continue;
    }
    const previous = index > 0 ? words[index - 1] : undefined;
    if (previous && word.startSec < previous.startSec) {
      issues.push({
        path: `/captions/words/${index}/startSec`,
        code: 'E_CAPTION_ORDER',
        message: `Word "${word.text}" starts before the previous word`,
      });
    } else if (previous && word.startSec < previous.endSec) {
      issues.push({
        path: `/captions/words/${index}/startSec`,
        code: 'E_CAPTION_ORDER',
        message: `Word "${word.text}" starts before the previous word ends`,
      });
    }
  }

  return issues;
}

export function validateEdl(input: unknown): ValidationResult {
  const schemaValid = validateAgainstSchema(input);
  if (!schemaValid) {
    const errors = validateAgainstSchema.errors ?? [];
    return {
      valid: false,
      issues: errors.map(mapSchemaError),
    };
  }

  const issues = runtimeIssues(input);
  return { valid: issues.length === 0, issues };
}

export function assertEdl(input: unknown): asserts input is Edl {
  const result = validateEdl(input);
  if (!result.valid) {
    throw new EdlValidationError(result.issues);
  }
}
