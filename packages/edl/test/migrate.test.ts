import { describe, expect, it } from 'vitest';
import { EDL_VERSION, EDL_VERSION_2, migrateEdl, type Edl, type ValidationIssue } from '../src/index';
import example from '../example.edl.json';

function cloneRecord(): Record<string, unknown> {
  return structuredClone(example) as unknown as Record<string, unknown>;
}

function caughtIssues(error: unknown): ValidationIssue[] {
  return (error as { issues?: ValidationIssue[] }).issues ?? [];
}

describe('migrateEdl', () => {
  it('stages the export constants: writers still emit 1.0.0, v2 is opt-in', () => {
    expect(EDL_VERSION).toBe('1.0.0');
    expect(EDL_VERSION_2).toBe('2.0.0');
  });

  it('upgrades 1.0.0 to 2.0.0 and preserves every other field', () => {
    const migrated = migrateEdl(example);

    expect((migrated as Edl).edlVersion).toBe(EDL_VERSION_2);
    const { edlVersion: _before, ...restOfSource } = example as unknown as Record<string, unknown>;
    const { edlVersion: _after, ...restOfMigrated } = migrated as unknown as Record<string, unknown>;
    expect(restOfMigrated).toEqual(restOfSource);
    // Byte-level equality of the untouched payload.
    expect(JSON.stringify({ ...restOfMigrated })).toBe(JSON.stringify(restOfSource));
  });

  it('does not mutate the 1.0.0 input while migrating', () => {
    const document = cloneRecord();
    const snapshot = JSON.stringify(document);

    migrateEdl(document);

    expect(document['edlVersion']).toBe('1.0.0');
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  it('accepts 2.0.0 and returns it by reference (idempotent)', () => {
    const once = migrateEdl(example);
    const twice = migrateEdl(once);

    expect(twice).toBe(once);
    expect((twice as Edl).edlVersion).toBe(EDL_VERSION_2);
    expect(migrateEdl(twice)).toBe(twice);
  });

  it('rejects an unknown major with E_VERSION and throws', () => {
    const document = cloneRecord();
    document['edlVersion'] = '3.0.0';

    let caught: unknown;
    try {
      migrateEdl(document);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caughtIssues(caught)).toHaveLength(1);
    expect(caughtIssues(caught)[0]).toMatchObject({ code: 'E_VERSION', path: '/edlVersion' });
    expect((caught as Error).message).toContain('Unsupported EDL version "3.0.0"');
  });

  it('rejects a future minor it does not know with E_VERSION', () => {
    const document = cloneRecord();
    document['edlVersion'] = '2.1.0';

    try {
      migrateEdl(document);
      throw new Error('expected migrateEdl to throw');
    } catch (error) {
      expect(caughtIssues(error)[0]?.code).toBe('E_VERSION');
    }
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

  it('validates a migrated document against the v2 rules', () => {
    const document = cloneRecord();
    document['grade'] = { exposure: 5 };

    let caught: unknown;
    try {
      migrateEdl(document);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caughtIssues(caught)).toContainEqual(
      expect.objectContaining({ code: 'E_GRADE_RANGE', path: '/grade/exposure' }),
    );
  });
});
