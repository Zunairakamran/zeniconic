/**
 * The variant catalogue the desktop pipeline plans.
 *
 * One entry per creative direction the app can approve and export. The three
 * 30-second looks are the original set and keep their ids (which are also their
 * look ids) so a project planned by an older build still resolves its EDL file.
 * The fourth entry is the 38-second marketing cut: it is a campaign, not a room
 * tour, so it has its own format (`marketing_38`) and its own beat sheet.
 *
 * This module is pure data: no React, no Electron, no filesystem. The pipeline
 * turns each spec into a `PlanRequest` and asks `planRequest` for the EDL.
 */

import type { FormatId, LookId } from '@zeniconic/edl';
import { MARKETING_DURATION_SEC, MARKETING_FORMAT_ID, MARKETING_LABEL } from './marketing';

/**
 * Stable persisted id for the marketing cut.
 *
 * Kept as a slug because it is also the EDL file name
 * (`<listing>/variants/marketing38.json`) and the id the IPC layer accepts:
 * `^[a-z0-9][a-z0-9-]*$`, so no underscore and no dot.
 */
export const MARKETING_VARIANT_ID = 'marketing38';

/** The 30-second default every non-marketing variant still targets. */
export const DEFAULT_VARIANT_TARGET_SEC = 30;

/** Formats the variant planner knows how to assemble. */
export type VariantFormatId = Extract<FormatId, 'cinematic_hero' | 'marketing_38'>;

/**
 * The looks a persisted variant may carry. `LookId` also has `editorial`, which
 * the app never planned; keeping this narrow means a catalogue entry can be
 * written straight into a `VariantSummary` without a cast.
 */
export type VariantLookId = Extract<LookId, 'calm' | 'social' | 'walkthrough'> | 'marketing';

export interface PlannedVariantSpec {
  /** Persisted id; the EDL file is named after this. */
  id: string;
  /** Creative look the renderer and the chat layer read. */
  look: VariantLookId;
  /** Human label for logs and progress ("Marketing 38"). */
  label: string;
  /** Which assembly builds it. */
  format: VariantFormatId;
  /** Length that format owns; the marketing sheet is not a knob. */
  targetDurationSec: number;
  /** Shown in the UI/agent copy and kept next to the plan in tests. */
  note: string;
}

/**
 * The order is the planning order. The first three entries are frozen: their
 * id, look and target are what old projects' `variants.json` already point at.
 */
export const PLANNED_VARIANTS: readonly PlannedVariantSpec[] = [
  {
    id: 'calm',
    look: 'calm',
    label: 'Calm',
    format: 'cinematic_hero',
    targetDurationSec: DEFAULT_VARIANT_TARGET_SEC,
    note: 'A quiet look at the light.',
  },
  {
    id: 'walkthrough',
    look: 'walkthrough',
    label: 'Walkthrough',
    format: 'cinematic_hero',
    targetDurationSec: DEFAULT_VARIANT_TARGET_SEC,
    note: 'From the door to the view.',
  },
  {
    id: 'social',
    look: 'social',
    label: 'Social',
    format: 'cinematic_hero',
    targetDurationSec: DEFAULT_VARIANT_TARGET_SEC,
    note: 'Just listed.',
  },
  {
    id: MARKETING_VARIANT_ID,
    look: 'marketing',
    label: MARKETING_LABEL,
    format: MARKETING_FORMAT_ID,
    targetDurationSec: MARKETING_DURATION_SEC,
    note: 'The 38 s campaign: hook, light, ritual, craft, space, entrance, price, close.',
  },
];
