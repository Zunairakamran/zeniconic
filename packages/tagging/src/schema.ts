import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import type { Room } from '@zeniconic/edl';
import type { CameraMove, Defect } from './types';

/**
 * Runtime mirrors of the closed sets in `types.ts`.
 *
 * `edl` exports the `Room` type but no value array, so the list is repeated
 * here and guarded at compile time: if `edl` grows a room, the coverage checks
 * below stop typechecking instead of silently rejecting it at runtime.
 */
export const ROOM_VALUES = [
  'exterior',
  'building',
  'entry',
  'living',
  'kitchen',
  'dining',
  'bedroom',
  'bathroom',
  'balcony',
  'view',
  'amenity',
  'unknown',
] as const satisfies readonly Room[];

export const CAMERA_MOVE_VALUES = [
  'static',
  'pan_left',
  'pan_right',
  'push_in',
  'pull_out',
  'orbit',
  'handheld',
  'drone',
] as const satisfies readonly CameraMove[];

export const DEFECT_VALUES = [
  'shaky',
  'blurry',
  'too_dark',
  'blown_windows',
  'lens_flare',
  'lens_dust',
  'clutter',
  'camera_in_mirror',
  'people',
  'reflection',
] as const satisfies readonly Defect[];

type AssertNever<T extends never> = T;
type RoomsCovered = AssertNever<Exclude<Room, (typeof ROOM_VALUES)[number]>>;
type CameraMovesCovered = AssertNever<Exclude<CameraMove, (typeof CAMERA_MOVE_VALUES)[number]>>;
type DefectsCovered = AssertNever<Exclude<Defect, (typeof DEFECT_VALUES)[number]>>;

export const MAX_SELLING_POINTS = 4;
export const MAX_SELLING_POINT_CHARS = 40;
export const MAX_DEFECTS = 4;

/** Largest tolerated `x + w` for a subject box; above it the model used corners. */
const MAX_BOX_SUM = 1.05;

/**
 * The wire contract for one tagging call. Strict: no extra properties, closed
 * enums, bounded numbers.
 *
 * `bestInSec`, `bestOutSec` and `subjectBox` stay optional because the prompt
 * tells the model to omit a subject box when there is no single subject, and a
 * shot boundary is a suggestion, not a required fact. Schema failures are
 * retried once with the issue list attached, then fail closed as `E_TAGS`.
 */
export const TAGGING_SCHEMA: object = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['room', 'cameraMove', 'sellingPoints', 'defects', 'score', 'confidence'],
  properties: {
    room: { type: 'string', enum: [...ROOM_VALUES] },
    cameraMove: { type: 'string', enum: [...CAMERA_MOVE_VALUES] },
    sellingPoints: {
      type: 'array',
      maxItems: MAX_SELLING_POINTS,
      items: { type: 'string', minLength: 1, maxLength: MAX_SELLING_POINT_CHARS },
    },
    defects: {
      type: 'array',
      maxItems: MAX_DEFECTS,
      items: { type: 'string', enum: [...DEFECT_VALUES] },
    },
    bestInSec: { type: 'number', minimum: 0 },
    bestOutSec: { type: 'number', minimum: 0 },
    score: { type: 'number', minimum: 0, maximum: 100 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    subjectBox: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'w', 'h'],
      properties: {
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        w: { type: 'number', minimum: 0, maximum: 1 },
        h: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateAgainstSchema = ajv.compile(TAGGING_SCHEMA);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function enumValues(error: ErrorObject): string {
  const allowed = (error.params as { allowedValues?: unknown }).allowedValues;
  return Array.isArray(allowed) ? ` (allowed: ${allowed.join(', ')})` : '';
}

function issueOf(error: ErrorObject): string {
  const path = error.instancePath === '' ? '/' : error.instancePath;
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: unknown }).missingProperty;
    return typeof missing === 'string' ? `${path === '/' ? '' : path}/${missing} is required` : `${path} is invalid`;
  }
  if (error.keyword === 'enum') {
    return `${path} must be one of the allowed values${enumValues(error)}`;
  }
  return `${path} ${error.message ?? 'is invalid'}`;
}

/** Invariants JSON Schema cannot express. Only called once the schema passes. */
function crossFieldIssues(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const issues: string[] = [];

  const inSec = value['bestInSec'];
  const outSec = value['bestOutSec'];
  if (typeof inSec === 'number' && typeof outSec === 'number' && !(inSec < outSec)) {
    issues.push(`/bestOutSec must be after /bestInSec (${inSec}s >= ${outSec}s)`);
  }

  const box = value['subjectBox'];
  if (isRecord(box)) {
    const x = box['x'];
    const w = box['w'];
    if (typeof x === 'number' && typeof w === 'number' && x + w > MAX_BOX_SUM) {
      issues.push('/subjectBox x + w exceeds 1.05; coordinates must be fractions of the tile, not corners');
    }
  }

  return issues;
}

/**
 * Validate a parsed model reply. Returns issue strings rather than throwing so
 * `tagShot` can attach them to a single retry.
 */
export function validateTags(value: unknown): { valid: boolean; issues: string[] } {
  if (!validateAgainstSchema(value)) {
    return { valid: false, issues: (validateAgainstSchema.errors ?? []).map(issueOf) };
  }
  const issues = crossFieldIssues(value);
  return { valid: issues.length === 0, issues };
}
