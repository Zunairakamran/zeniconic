import type { Edl } from './types';
import { EDL_VERSION, EDL_VERSION_2 } from './types';
import { EdlValidationError, validateEdl } from './validate';
import type { ValidationIssue } from './validate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SUPPORTED_VERSIONS = [EDL_VERSION, EDL_VERSION_2] as const;

/**
 * Brings a document up to `EDL_VERSION_2`.
 *
 * - `2.0.0` is returned by reference once it validates (idempotent).
 * - `1.0.0` is upgraded by changing `edlVersion` only; every other field is
 *   preserved verbatim, so a v1 document renders byte-identically.
 * - Anything else throws `E_VERSION`; unknown majors are never guessed at.
 */
export function migrateEdl(input: unknown): Edl {
  const version = isRecord(input) ? input['edlVersion'] : undefined;

  if (version !== EDL_VERSION && version !== EDL_VERSION_2) {
    const found =
      version === undefined
        ? 'missing'
        : typeof version === 'string'
          ? `"${version}"`
          : 'not a string';
    const issue: ValidationIssue = {
      path: '/edlVersion',
      code: 'E_VERSION',
      message: `Unsupported EDL version ${found}; this build reads ${SUPPORTED_VERSIONS.join(' and ')}`,
    };
    throw new EdlValidationError([issue]);
  }

  // v1 -> v2 is additive: no field is renamed, added or dropped. The copy keeps
  // the caller's object untouched so migrations never mutate a loaded document.
  const candidate: unknown =
    version === EDL_VERSION ? { ...(input as Record<string, unknown>), edlVersion: EDL_VERSION_2 } : input;

  const result = validateEdl(candidate);
  if (!result.valid) {
    throw new EdlValidationError(result.issues);
  }

  return candidate as Edl;
}
