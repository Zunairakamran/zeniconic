import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Room } from '../../../packages/edl/src/index';
import type { PresetId, TimelineSlot } from './presets';

export const REMIX_STORYBOARD_FILE = 'storyboard.json';

export interface RemixShotDto {
  shotId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface RemixSlotDto {
  order: number;
  beat: string;
  shotId: string;
  room: string;
  inSec: number;
  outSec: number;
  targetSec: number;
  reason: string;
}

/**
 * What the transcription pass cost and where the number came from.
 *
 * `provider` means OpenRouter reported a cost; `estimated` means a configured
 * rate was applied to the audio seconds; `unreported` means neither exists, so
 * nothing was written to the ledger and the UI says so.
 */
export interface RemixTranscriptionDto {
  words: number;
  durationSec: number;
  costUsd?: number;
  costSource: 'provider' | 'estimated' | 'unreported';
  model: string;
  recordedAt: string;
}

export interface RemixStoryboard {
  version: 1;
  file: string;
  fileName: string;
  analyzedAt: string;
  durationSec: number;
  fps: number;
  orientation: 'portrait' | 'landscape' | 'square';
  shots: RemixShotDto[];
  presets: Record<PresetId, RemixSlotDto[]>;
  warnings: string[];
  /** Source-timeline transcript words, when transcription ran. */
  words?: Array<{ word: string; start: number; end: number }>;
  /** Shot id → room, written by `remix:retag`. */
  rooms?: Record<string, Room>;
  /** Saved manual order per preset, as shot ids. */
  orders?: Partial<Record<PresetId, string[]>>;
  /** Preset the current `remix` variant was built from, when one exists. */
  activePreset?: PresetId;
  /** Transcription cost/status, written by the analysis pass. */
  transcription?: RemixTranscriptionDto;
}

export function slotToDto(slot: TimelineSlot): RemixSlotDto {
  return {
    order: slot.order,
    beat: slot.beat,
    shotId: slot.shotId,
    room: slot.room,
    inSec: slot.inSec,
    outSec: slot.outSec,
    targetSec: slot.targetSec,
    reason: slot.reason,
  };
}

export async function saveStoryboard(
  listingDir: string,
  storyboard: RemixStoryboard,
): Promise<string> {
  const path = join(listingDir, 'remix', REMIX_STORYBOARD_FILE);
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(storyboard, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new Error(
      `The remix storyboard could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return path;
}

export async function readStoryboard(listingDir: string): Promise<RemixStoryboard | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(listingDir, 'remix', REMIX_STORYBOARD_FILE), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Partial<RemixStoryboard>;
    if (record.version !== 1) return undefined;
    if (typeof record.file !== 'string' || typeof record.fileName !== 'string') return undefined;
    if (!Array.isArray(record.shots) || typeof record.presets !== 'object' || record.presets === null) {
      return undefined;
    }
    return record as RemixStoryboard;
  } catch {
    return undefined;
  }
}

export async function clearStoryboard(listingDir: string): Promise<void> {
  await rm(join(listingDir, 'remix'), { recursive: true, force: true });
}
