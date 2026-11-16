import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import { STYLE_SCHEMA } from './schema';
import type { StylePack } from './types';

export interface StyleValidation {
  valid: boolean;
  issues: string[];
}

// `verbose` keeps `error.data`, so an issue can name the rejected value.
const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true });
const validateAgainstSchema = ajv.compile<StylePack>(STYLE_SCHEMA);

function primitive(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function allowedValues(params: unknown): string[] | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const value = (params as Record<string, unknown>).allowedValues;
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function schemaIssue(error: ErrorObject): string {
  const path = error.instancePath.length > 0 ? error.instancePath : '/';
  const received = primitive(error.data);
  const allowed = allowedValues(error.params);
  const detail = error.message ?? 'is invalid';
  const got = received === undefined ? '' : ` (received "${received}")`;
  const options = allowed === undefined ? '' : ` (allowed: ${allowed.join(', ')})`;
  return `${path}: ${detail}${got}${options}`;
}

/**
 * Cross-field checks that a plain JSON Schema cannot express. A pack whose
 * average sits outside its own bounds, or whose bounds are inverted, is a
 * typo, not a creative choice.
 */
function semanticIssues(pack: StylePack): string[] {
  const issues: string[] = [];
  const { minShotSec, maxShotSec, targetAvgShotSec } = pack.pacing;

  if (minShotSec > maxShotSec) {
    issues.push(
      `/pacing: minShotSec ${minShotSec} is greater than maxShotSec ${maxShotSec}`,
    );
  }
  if (targetAvgShotSec < minShotSec || targetAvgShotSec > maxShotSec) {
    issues.push(
      `/pacing/targetAvgShotSec: ${targetAvgShotSec} is outside ${minShotSec}–${maxShotSec}`,
    );
  }

  return issues;
}

/**
 * Validates an unknown value against `STYLE_SCHEMA` plus the cross-field rules.
 * Returns readable issues rather than throwing so the loader can attach the
 * file name, and callers can show a list.
 */
export function validateStyle(value: unknown): StyleValidation {
  if (!validateAgainstSchema(value)) {
    const errors = validateAgainstSchema.errors ?? [];
    return { valid: false, issues: errors.map(schemaIssue) };
  }

  const issues = semanticIssues(value as StylePack);
  return { valid: issues.length === 0, issues };
}
