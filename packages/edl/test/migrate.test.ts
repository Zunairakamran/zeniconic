import { describe, expect, it } from 'vitest';
import { migrateEdl, type Edl, type ValidationIssue } from '../src/index';
import example from '../example.edl.json';

function cloneRecord(): Record<string, unknown> {
  return structuredClone(example) as unknown as Record<string, unknown>;
}

function caughtIssues(error: unknown): ValidationIssue[] {
  return (error as { issues?: ValidationIssue[] }).issues ?? [];
}

describe('migrateEdl', () => {
  it('returns 1.0.0 unchanged', () => {
    const migrated = migrateEdl(example);
    expect(migrated).toBe(example);
    expect((migrated as Edl).edlVersion).toBe('1.0.0');
  });

  it('rejects 2.0.0 with E_VERSION and throws', () => {
    const document = cloneRecord();
    document['edlVersion'] = '2.0.0';

    let caught: unknown;
    try {
      migrateEdl(document);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caughtIssues(caught)).toHaveLength(1);
    expect(caughtIssues(caught)[0]).toMatchObject({ code: 'E_VERSION', path: '/edlVersion' });
    expect((caught as Error).message).toContain('Unsupported EDL version "2.0.0"');
  });

  it('rejects a missing version with E_VERSION', () => {
    const document = cloneRecord();
    delete document['edlVersion'];

    expect(() => migrateEdl(document)).toThrow(/Unsupported EDL version missing/);
    try {
      migrateEdl(document);
    } catch (error) {
      expect(caughtIssues(error)[0]?.code).toBe('E_VERSION');
    }
  });

  it('rejects a malformed 1.0.0 document with its validation issues', () => {
    const document = cloneRecord();
    delete document['canvas'];

    let caught: unknown;
    try {
      migrateEdl(document);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caughtIssues(caught)[0]).toMatchObject({ code: 'E_SCHEMA', path: '/canvas' });
  });
});
