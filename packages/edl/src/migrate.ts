import type { Edl } from './types';
import { EDL_VERSION } from './types';
import { EdlValidationError, validateEdl } from './validate';
import type { ValidationIssue } from './validate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Brings a document up to `EDL_VERSION`. 1.0.0 is the current schema, so a
 * current document is returned by reference; older versions get explicit
 * upgrade steps here as they are introduced.
 */
export function migrateEdl(input: unknown): Edl {
  const version = isRecord(input) ? input['edlVersion'] : undefined;

  if (version !== EDL_VERSION) {
    const found =
      version === undefined
        ? 'missing'
        : typeof version === 'string'
          ? `"${version}"`
          : 'not a string';
    const issue: ValidationIssue = {
      path: '/edlVersion',
      code: 'E_VERSION',
      message: `Unsupported EDL version ${found}; this build reads ${EDL_VERSION}`,
    };
    throw new EdlValidationError([issue]);
  }

  const result = validateEdl(input);
  if (!result.valid) {
    throw new EdlValidationError(result.issues);
  }

  return input as Edl;
}
