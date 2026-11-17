/**
 * Editing capabilities: the discoverable vocabulary the agent composes.
 *
 * A capability is a manifest plus a pure handler. It validates its own params,
 * clones the EDL, mutates the clone and returns a human summary. It never
 * touches disk, never spawns a process and never re-reads footage — execution
 * belongs to the renderer, and that separation is what makes the agent's edits
 * testable and reversible.
 */

import type { Edl } from '@zeniconic/edl';

export type CapabilityCategory =
  | 'timeline'
  | 'transition'
  | 'effect'
  | 'caption'
  | 'overlay'
  | 'motion'
  | 'audio'
  | 'camera'
  | 'execution';

export type CapabilityRisk = 'low' | 'medium' | 'high';
export type CapabilityCost = 'free' | 'cheap' | 'render' | 'paid';
export type CapabilityBackend = 'edl' | 'ffmpeg' | 'remotion' | 'native';

/** A flat object schema; the registry compiles it with Ajv. */
export type CapabilityParamsSchema = Record<string, unknown>;

export interface CapabilityManifest {
  id: string;
  version: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  params: CapabilityParamsSchema;
  risk: CapabilityRisk;
  cost: CapabilityCost;
  backends: CapabilityBackend[];
  preview: boolean;
  requires?: string[];
  conflictsWith?: string[];
  docs: string;
}

export interface CapabilityContext {
  /** Timeline seconds of the input EDL, so handlers do not re-derive it. */
  durationSec: number;
}

export interface CapabilityIssue {
  path: string;
  code: string;
  message: string;
}

export type CapabilityResult =
  | {
      ok: true;
      edl: Edl;
      /** One sentence the user can read, e.g. "Trimmed c03 to 2.4 s." */
      summary: string;
      warnings?: string[];
    }
  | { ok: false; issues: CapabilityIssue[] };

export type CapabilityApply = (
  edl: Edl,
  params: Record<string, unknown>,
  ctx: CapabilityContext,
) => CapabilityResult;

export interface Capability extends CapabilityManifest {
  apply: CapabilityApply;
}

/** A compact card for the model's prompt; never the full schema twice. */
export interface CapabilityCard {
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  risk: CapabilityRisk;
  cost: CapabilityCost;
  docs: string;
}
