/**
 * The capability registry.
 *
 * Deterministic and offline: params are validated with Ajv, handlers are pure,
 * and duplicate ids are a construction error. The agent only ever sees what is
 * registered here, so "discoverable" and "executable" cannot drift apart.
 */

import Ajv from 'ajv';
import { validateEdl, durationSec } from '@zeniconic/edl';
import type { Edl } from '@zeniconic/edl';
import { ensureV2, hasV2Fields } from './helpers';
import type {
  Capability,
  CapabilityCard,
  CapabilityIssue,
  CapabilityManifest,
  CapabilityResult,
} from './types';

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

export type CapabilityFilter = {
  category?: Capability['category'];
  risk?: Capability['risk'];
  cost?: Capability['cost'];
  backend?: Capability['backends'][number];
};

export interface RegistryOptions {
  /** Optional sink for QA/logging; never given the API key or media paths. */
  onApply?: (id: string, ok: boolean, ms: number) => void;
}

export interface CapabilityRegistry {
  list(filter?: CapabilityFilter): CapabilityManifest[];
  get(id: string): Capability | undefined;
  has(id: string): boolean;
  search(query: string, limit?: number): CapabilityManifest[];
  cards(ids?: readonly string[]): CapabilityCard[];
  describe(id: string): string;
  validate(id: string, params: unknown): { ok: true; params: Record<string, unknown> } | { ok: false; issues: CapabilityIssue[] };
  apply(id: string, edl: Edl, params: unknown): CapabilityResult;
  /** Whole-EDL compatibility (schema + registered effects/transitions). */
  check(edl: Edl): CapabilityIssue[];
}

function manifestOf(capability: Capability): CapabilityManifest {
  const {
    id, version, name, category, description, params, risk, cost, backends, preview,
    requires, conflictsWith, docs,
  } = capability;
  return {
    id, version, name, category, description, params, risk, cost, backends, preview,
    ...(requires === undefined ? {} : { requires }),
    ...(conflictsWith === undefined ? {} : { conflictsWith }),
    docs,
  };
}

function ajvIssues(errors: readonly { instancePath?: string; message?: string }[] | null | undefined): CapabilityIssue[] {
  return (errors ?? []).slice(0, 8).map((error) => ({
    path: error.instancePath === undefined || error.instancePath === '' ? '/' : error.instancePath,
    code: 'E_CAPABILITY_PARAM',
    message: error.message ?? 'is invalid',
  }));
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

export function createRegistry(
  capabilities: readonly Capability[],
  options: RegistryOptions = {},
): CapabilityRegistry {
  const byId = new Map<string, Capability>();
  const validators = new Map<string, ReturnType<typeof ajv.compile>>();

  for (const capability of capabilities) {
    if (byId.has(capability.id)) {
      throw new RangeError(`Duplicate capability id "${capability.id}".`);
    }
    byId.set(capability.id, capability);
    validators.set(capability.id, ajv.compile(capability.params));
  }

  const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const list = (filter: CapabilityFilter = {}): CapabilityManifest[] =>
    sorted
      .filter(
        (capability) =>
          (filter.category === undefined || capability.category === filter.category) &&
          (filter.risk === undefined || capability.risk === filter.risk) &&
          (filter.cost === undefined || capability.cost === filter.cost) &&
          (filter.backend === undefined || capability.backends.includes(filter.backend)),
      )
      .map(manifestOf);

  const validate = (
    id: string,
    params: unknown,
  ): { ok: true; params: Record<string, unknown> } | { ok: false; issues: CapabilityIssue[] } => {
    const capability = byId.get(id);
    if (capability === undefined) {
      return { ok: false, issues: [{ path: '/id', code: 'E_CAPABILITY_UNKNOWN', message: `No capability "${id}".` }] };
    }
    const validator = validators.get(id);
    const candidate = params === undefined ? {} : params;
    if (validator === undefined || !validator(candidate)) {
      return { ok: false, issues: ajvIssues(validator?.errors) };
    }
    return { ok: true, params: candidate as Record<string, unknown> };
  };

  const apply = (id: string, edl: Edl, params: unknown): CapabilityResult => {
    const capability = byId.get(id);
    if (capability === undefined) {
      return { ok: false, issues: [{ path: '/id', code: 'E_CAPABILITY_UNKNOWN', message: `No capability "${id}".` }] };
    }
    const checked = validate(id, params);
    if (!checked.ok) return { ok: false, issues: checked.issues };

    const started = Date.now();
    const inputCheck = validateEdl(edl);
    if (!inputCheck.valid) {
      return { ok: false, issues: inputCheck.issues };
    }

    let result: CapabilityResult;
    try {
      result = capability.apply(structuredClone(edl), checked.params, {
        durationSec: durationSec(edl),
      });
    } catch (error) {
      result = {
        ok: false,
        issues: [
          {
            path: '/',
            code: 'E_CAPABILITY_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }

    if (result.ok) {
      const upgraded = hasV2Fields(result.edl) ? ensureV2(result.edl) : result.edl;
      const check = validateEdl(upgraded);
      if (!check.valid) {
        result = { ok: false, issues: check.issues };
      } else {
        result = { ...result, edl: upgraded };
      }
    }

    options.onApply?.(id, result.ok, Date.now() - started);
    return result;
  };

  const search = (query: string, limit = 8): CapabilityManifest[] => {
    const terms = tokens(query);
    if (terms.length === 0) return list().slice(0, limit);
    const scored = sorted.map((capability) => {
      const haystack = `${capability.id} ${capability.name} ${capability.category} ${capability.description} ${capability.docs} ${JSON.stringify(capability.params)}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 1;
        if (capability.id.split('_').includes(term)) score += 2;
        if (capability.category === term) score += 2;
      }
      return { capability, score };
    });
    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || (a.capability.id < b.capability.id ? -1 : 1))
      .slice(0, limit)
      .map((entry) => manifestOf(entry.capability));
  };

  const cards = (ids?: readonly string[]): CapabilityCard[] => {
    const chosen = ids === undefined ? sorted : ids.map((id) => byId.get(id)).filter((c): c is Capability => c !== undefined);
    return chosen.map((capability) => ({
      id: capability.id,
      name: capability.name,
      category: capability.category,
      description: capability.description,
      risk: capability.risk,
      cost: capability.cost,
      docs: capability.docs,
    }));
  };

  const describe = (id: string): string => {
    const capability = byId.get(id);
    if (capability === undefined) return `No capability "${id}".`;
    return [
      `${capability.id} (${capability.category}, risk ${capability.risk}, cost ${capability.cost})`,
      capability.description,
      `Params: ${JSON.stringify(capability.params)}`,
      `Docs: ${capability.docs}`,
    ].join('\n');
  };

  const check = (edl: Edl): CapabilityIssue[] => {
    const result = validateEdl(edl);
    if (result.valid) return [];
    return result.issues.map((entry) => ({
      path: entry.path,
      code: entry.code,
      message: entry.message,
    }));
  };

  return {
    list,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    search,
    cards,
    describe,
    validate,
    apply,
    check,
  };
}
