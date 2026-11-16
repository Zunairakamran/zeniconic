import type { Edl } from '@zeniconic/edl';
import type { FootageIndex } from '../../../services/pipeline/indexer';

export type ReshootSeverity = 'blocker' | 'recommended' | 'nice_to_have';

/**
 * What the caller already knows about the footage as a whole. These values are
 * passed in rather than derived from the index so the report is cheap to build
 * and stays correct when the index was produced by an older pipeline run.
 */
export interface FootageFacts {
  clipCount: number;
  totalUsableSec: number;
  orientation: 'portrait' | 'landscape' | 'mixed';
  resolution: { width: number; height: number };
}

/**
 * One thing worth filming next time. `room` is the room token from the EDL
 * vocabulary, omitted for whole-shoot advice such as duration or resolution.
 */
export interface ReshootItem {
  id: string;
  severity: ReshootSeverity;
  room?: string;
  title: string;
  detail: string;
  why: string;
}

export interface ReshootReport {
  items: ReshootItem[];
  /** Tagged shots per room. Untagged shots are deliberately absent. */
  coverage: Record<string, number>;
  summary: string;
}

export interface ReshootInput {
  index: FootageIndex;
  edl?: Edl;
  facts: FootageFacts;
}
