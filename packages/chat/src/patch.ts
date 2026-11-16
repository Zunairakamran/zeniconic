/**
 * JSON Patch (RFC 6902) with a hard allowlist.
 *
 * The model may trim a clip, replace an overlay or change audio fields. It may
 * not touch identity, provenance, unknown keys or the schema version. Every
 * applied changeset is validated with the same `validateEdl` the renderer uses.
 */

import { validateEdl } from '@zeniconic/edl';
import type { Edl, ValidationIssue } from '@zeniconic/edl';

export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown };

type PathNode =
  | { kind: 'object'; keys: Readonly<Record<string, PathNode>>; whole: boolean }
  | { kind: 'array'; item: PathNode; whole: boolean }
  | { kind: 'leaf' };

const leaf: PathNode = { kind: 'leaf' };

function objectNode(keys: Readonly<Record<string, PathNode>>, whole = true): PathNode {
  return { kind: 'object', keys, whole };
}

function arrayNode(item: PathNode, whole = true): PathNode {
  return { kind: 'array', item, whole };
}

const CROP_POINT = objectNode({ t: leaf, x: leaf, y: leaf, scale: leaf });
const TRANSFORM = objectNode({
  mode: leaf,
  focus: leaf,
  path: arrayNode(CROP_POINT),
});
const TRANSITION = objectNode({ type: leaf, durationSec: leaf });

const CLIP = objectNode({
  sourceId: leaf,
  src: leaf,
  inSec: leaf,
  outSec: leaf,
  speed: leaf,
  volumeDb: leaf,
  room: leaf,
  transform: TRANSFORM,
  transitionIn: TRANSITION,
  transitionOut: TRANSITION,
  reason: leaf,
  scoreAtSelection: leaf,
});

const OVERLAY = objectNode({
  kind: leaf,
  text: leaf,
  subtext: leaf,
  inSec: leaf,
  outSec: leaf,
  anchor: leaf,
  style: leaf,
  maxWidthPct: leaf,
  opacity: leaf,
  animation: leaf,
});

const LICENSE = objectNode({ source: leaf, licenseId: leaf, attribution: leaf });

const MUSIC = objectNode({
  trackId: leaf,
  src: leaf,
  gainDb: leaf,
  duckUnderVoiceDb: leaf,
  beatGrid: arrayNode(leaf),
  license: LICENSE,
});

const VOICE_ENHANCE = objectNode({
  denoise: leaf,
  dereverb: leaf,
  isolate: leaf,
  deess: leaf,
});

const VOICE = objectNode({
  mode: leaf,
  src: leaf,
  text: leaf,
  voiceId: leaf,
  enhance: VOICE_ENHANCE,
});

const CAPTION_WORD = objectNode({ text: leaf, startSec: leaf, endSec: leaf });

const CAPTIONS = objectNode({
  mode: leaf,
  style: leaf,
  language: leaf,
  words: arrayNode(CAPTION_WORD),
});

const LOOK = objectNode({ id: leaf, label: leaf, description: leaf });
const FORMAT = objectNode({ id: leaf, label: leaf, targetDurationSec: leaf });

const ROOT = objectNode(
  {
    clips: arrayNode(CLIP, false),
    overlays: arrayNode(OVERLAY, false),
    audio: objectNode(
      {
        music: MUSIC,
        voice: VOICE,
      },
      false,
    ),
    captions: CAPTIONS,
    look: LOOK,
    format: FORMAT,
  },
  false,
);

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const CANONICAL_INDEX = /^(0|[1-9][0-9]*)$/;

function decodeSegment(segment: string): string | null {
  let decoded = '';

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character !== '~') {
      decoded += character ?? '';
      continue;
    }

    const next = segment[index + 1];
    if (next === '0') {
      decoded += '~';
      index += 1;
    } else if (next === '1') {
      decoded += '/';
      index += 1;
    } else {
      return null;
    }
  }

  return decoded;
}

/** Parse an RFC 6901 pointer into decoded, unescaped segments. */
function parsePointer(path: string): string[] | null {
  if (!path.startsWith('/')) return null;

  const parts = path.slice(1).split('/');
  const segments: string[] = [];

  for (const part of parts) {
    const decoded = decodeSegment(part);
    if (decoded === null) return null;
    segments.push(decoded);
  }

  return segments;
}

function hasForbiddenSegment(segments: readonly string[]): boolean {
  return segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()));
}

function isCanonicalIndex(segment: string): boolean {
  return CANONICAL_INDEX.test(segment);
}

function segmentsAllowed(segments: readonly string[]): boolean {
  let node: PathNode = ROOT;
  const lastIndex = segments.length - 1;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) return false;

    if (node.kind === 'object') {
      if (!Object.prototype.hasOwnProperty.call(node.keys, segment)) return false;
      const next = node.keys[segment];
      if (next === undefined) return false;
      node = next;
      continue;
    }

    if (node.kind === 'array') {
      if (segment === '-') {
        // An append marker is only meaningful at the end of a path.
        if (index !== lastIndex) return false;
      } else if (!isCanonicalIndex(segment)) {
        return false;
      }
      node = node.item;
      continue;
    }

    return false;
  }

  if (node.kind === 'leaf') return true;
  return node.whole;
}

/**
 * True when a JSON Pointer addresses a writable leaf, or a whole object/array
 * the chat is allowed to replace. Identity and provenance are never writable.
 */
export function isAllowedPath(path: string): boolean {
  if (typeof path !== 'string') return false;

  const segments = parsePointer(path);
  if (segments === null || segments.length === 0) return false;
  if (hasForbiddenSegment(segments)) return false;

  return segmentsAllowed(segments);
}

interface NormalisedOp {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

interface NormaliseFailure {
  ok: false;
  issue: ValidationIssue;
}

interface NormaliseSuccess {
  ok: true;
  op: NormalisedOp;
}

type NormaliseResult = NormaliseFailure | NormaliseSuccess;

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseOp(input: unknown, index: number): NormaliseResult {
  const where = `/ops/${index}`;

  if (!isRecord(input)) {
    return {
      ok: false,
      issue: issue(where, 'E_PATCH_OP', 'Each patch operation must be an object'),
    };
  }

  const operation = input['op'];
  if (operation !== 'add' && operation !== 'remove' && operation !== 'replace') {
    return {
      ok: false,
      issue: issue(where, 'E_PATCH_OP', 'The op must be add, remove or replace'),
    };
  }

  const path = input['path'];
  if (typeof path !== 'string' || path.length === 0) {
    return {
      ok: false,
      issue: issue(where, 'E_PATCH_OP', 'The path must be a non-empty JSON Pointer'),
    };
  }

  if (operation === 'remove') {
    return { ok: true, op: { op: operation, path } };
  }

  if (!Object.prototype.hasOwnProperty.call(input, 'value')) {
    return {
      ok: false,
      issue: issue(where, 'E_PATCH_OP', `The ${operation} op needs a value`),
    };
  }

  return { ok: true, op: { op: operation, path, value: input['value'] } };
}

function parseArrayIndex(segment: string): number | null {
  if (!isCanonicalIndex(segment)) return null;
  const value = Number(segment);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Apply one normalised op to the cloned document. Returns an issue instead of
 * throwing when the target is malformed or out of bounds.
 */
function applyOne(root: Edl, op: NormalisedOp, index: number): ValidationIssue | null {
  const segments = parsePointer(op.path);
  if (
    segments === null ||
    segments.length === 0 ||
    hasForbiddenSegment(segments) ||
    !segmentsAllowed(segments)
  ) {
    return issue(
      op.path,
      'E_PATCH_PATH',
      `The path ${op.path} is not on the patch allowlist`,
    );
  }

  let parent: unknown = root;
  const lastIndex = segments.length - 1;

  for (let depth = 0; depth < lastIndex; depth += 1) {
    const segment = segments[depth];
    if (segment === undefined) {
      return issue(op.path, 'E_PATCH_PATH', 'The path is incomplete');
    }

    if (Array.isArray(parent)) {
      const array = parent as unknown[];
      if (segment === '-') {
        return issue(op.path, 'E_PATCH_INDEX', 'An array append is only valid at the end of a path');
      }
      const numeric = parseArrayIndex(segment);
      if (numeric === null) {
        return issue(op.path, 'E_PATCH_PATH', `"${segment}" is not an array index`);
      }
      if (numeric >= array.length) {
        return issue(
          op.path,
          'E_PATCH_INDEX',
          `Index ${numeric} is past the end of an array of length ${array.length}`,
        );
      }
      parent = array[numeric];
      continue;
    }

    if (isRecord(parent)) {
      if (!Object.prototype.hasOwnProperty.call(parent, segment)) {
        return issue(op.path, 'E_PATCH_TARGET', `The path ${op.path} does not exist`);
      }
      parent = parent[segment];
      continue;
    }

    return issue(op.path, 'E_PATCH_TARGET', `The path ${op.path} does not exist`);
  }

  const last = segments[lastIndex];
  if (last === undefined) {
    return issue(op.path, 'E_PATCH_PATH', 'The path is incomplete');
  }

  if (Array.isArray(parent)) {
    const array = parent as unknown[];

    if (op.op === 'add') {
      const numeric = last === '-' ? array.length : parseArrayIndex(last);
      if (numeric === null) {
        return issue(op.path, 'E_PATCH_PATH', `"${last}" is not an array index`);
      }
      if (numeric > array.length) {
        return issue(
          op.path,
          'E_PATCH_INDEX',
          `Cannot insert at ${numeric}; the array has ${array.length} items`,
        );
      }
      array.splice(numeric, 0, op.value);
      return null;
    }

    const numeric = parseArrayIndex(last);
    if (numeric === null) {
      return issue(op.path, 'E_PATCH_PATH', `"${last}" is not an array index`);
    }
    if (numeric >= array.length) {
      return issue(
        op.path,
        'E_PATCH_INDEX',
        `Index ${numeric} is past the end of an array of length ${array.length}`,
      );
    }

    if (op.op === 'remove') {
      array.splice(numeric, 1);
      return null;
    }

    array[numeric] = op.value;
    return null;
  }

  if (isRecord(parent)) {
    const exists = Object.prototype.hasOwnProperty.call(parent, last);

    if (op.op === 'add') {
      parent[last] = op.value;
      return null;
    }

    if (!exists) {
      return issue(op.path, 'E_PATCH_TARGET', `The path ${op.path} does not exist`);
    }

    if (op.op === 'remove') {
      delete parent[last];
      return null;
    }

    parent[last] = op.value;
    return null;
  }

  return issue(
    `/ops/${index}`,
    'E_PATCH_TARGET',
    `The path ${op.path} cannot be written`,
  );
}

/**
 * Apply ops in order to a clone, then validate. User input never throws: a
 * malformed op returns the untouched input plus an issue list.
 */
export function applyPatch(
  edl: Edl,
  ops: PatchOp[],
): { edl: Edl; issues: ValidationIssue[] } {
  let draft: Edl;

  try {
    draft = structuredClone(edl);
  } catch {
    return {
      edl,
      issues: [issue('/', 'E_PATCH_VALUE', 'The edit could not be copied for patching')],
    };
  }

  for (let index = 0; index < ops.length; index += 1) {
    const normalised = normaliseOp(ops[index], index);
    if (!normalised.ok) {
      return { edl, issues: [normalised.issue] };
    }

    const failure = applyOne(draft, normalised.op, index);
    if (failure !== null) {
      return { edl, issues: [failure] };
    }
  }

  return { edl: draft, issues: validateEdl(draft).issues };
}
