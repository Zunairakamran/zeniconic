/**
 * User edits on a persisted remix storyboard: slot order and room tags.
 *
 * Both functions are pure and return new arrays: the caller owns persistence.
 * Validation is strict on purpose — a stale UI must fail loudly instead of
 * silently reordering a different storyboard or tagging a shot that is gone.
 */

import type { Room } from '../../../packages/edl/src/index';
import { isRemixRoom } from './rooms';
import type { RemixRoom } from './rooms';
import type { RemixSlotDto } from './store';

export type RemixEditErrorCode =
  | 'E_UNKNOWN_ROOM'
  | 'E_UNKNOWN_SHOT'
  | 'E_BAD_ORDER';

export class RemixEditError extends Error {
  readonly code: RemixEditErrorCode;

  constructor(code: RemixEditErrorCode, message: string) {
    super(message);
    this.name = 'RemixEditError';
    this.code = code;
  }
}

export const MAX_REMIX_ORDER = 200;

/**
 * Reorders a preset's slots to `order` (a list of shot ids) and renumbers
 * `order` from zero. Every id must name a slot exactly once; duplicates,
 * unknown ids and missing ids are refused.
 */
export function reorderSlots(
  slots: readonly RemixSlotDto[],
  order: readonly string[],
): RemixSlotDto[] {
  if (order.length === 0) {
    throw new RemixEditError('E_BAD_ORDER', 'A slot order cannot be empty.');
  }
  if (order.length > MAX_REMIX_ORDER) {
    throw new RemixEditError('E_BAD_ORDER', `A slot order supports at most ${MAX_REMIX_ORDER} slots.`);
  }
  if (order.length !== slots.length) {
    throw new RemixEditError(
      'E_BAD_ORDER',
      `The new order has ${order.length} slots but the storyboard has ${slots.length}.`,
    );
  }

  const byId = new Map<string, RemixSlotDto>();
  for (const slot of slots) {
    if (byId.has(slot.shotId)) {
      throw new RemixEditError(
        'E_BAD_ORDER',
        `The storyboard lists shot "${slot.shotId}" more than once.`,
      );
    }
    byId.set(slot.shotId, slot);
  }

  const seen = new Set<string>();
  const next: RemixSlotDto[] = [];
  order.forEach((shotId, index) => {
    if (typeof shotId !== 'string' || shotId.trim().length === 0) {
      throw new RemixEditError('E_BAD_ORDER', 'Every slot id must be a non-empty string.');
    }
    if (seen.has(shotId)) {
      throw new RemixEditError('E_BAD_ORDER', `Shot "${shotId}" appears more than once in the order.`);
    }
    const slot = byId.get(shotId);
    if (slot === undefined) {
      throw new RemixEditError('E_BAD_ORDER', `Shot "${shotId}" is not part of this preset.`);
    }
    seen.add(shotId);
    next.push({ ...slot, order: index });
  });

  return next;
}

/** Sets the room on every slot that points at `shotId`. */
export function setSlotRoom(
  slots: readonly RemixSlotDto[],
  shotId: string,
  room: RemixRoom,
): RemixSlotDto[] {
  return slots.map((slot) => (slot.shotId === shotId ? { ...slot, room } : slot));
}

/** Fails unless `room` is in the EDL vocabulary. */
export function requireRoom(value: unknown): RemixRoom {
  if (!isRemixRoom(value)) {
    throw new RemixEditError(
      'E_UNKNOWN_ROOM',
      `"${String(value)}" is not a room. Choose one of the imported scene labels.`,
    );
  }
  return value;
}

/** Narrows a stored room string to the EDL type without inventing a value. */
export function asRoom(value: string): Room {
  return isRemixRoom(value) ? value : 'unknown';
}
