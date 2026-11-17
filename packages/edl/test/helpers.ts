import { expect } from 'vitest';
import { migrateEdl } from '../src/index';
import type { Edl } from '../src/index';
import type { ValidationResult } from '../src/validate';
import example from '../example.edl.json';

/** The committed 1.0.0 fixture, detached so tests can mutate it freely. */
export function v1Edl(): Edl {
  return structuredClone(example) as unknown as Edl;
}

/** The same fixture upgraded by `migrateEdl`, i.e. a 2.0.0 baseline. */
export function v2Edl(): Edl {
  return migrateEdl(v1Edl());
}

/** Plain JSON copy for cases the TypeScript types would reject on purpose. */
export function asJson<T = Record<string, unknown>>(edl: Edl): T {
  return JSON.parse(JSON.stringify(edl)) as T;
}

export function codes(result: ValidationResult): string[] {
  return result.issues.map((issue) => issue.code);
}

export function expectIssue(result: ValidationResult, code: string, path: string): void {
  expect(result.valid).toBe(false);
  expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

export function clipAt(edl: Edl, index: number) {
  const clip = edl.clips[index];
  if (!clip) throw new Error(`fixture has no clip at ${index}`);
  return clip;
}

export function overlayAt(edl: Edl, index: number) {
  const overlay = edl.overlays[index];
  if (!overlay) throw new Error(`fixture has no overlay at ${index}`);
  return overlay;
}
