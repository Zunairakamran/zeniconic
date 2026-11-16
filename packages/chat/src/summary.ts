/**
 * Human diff summary for the chat and the review panel.
 *
 * Grammar (docs and the interaction grammar):
 *   `3 changes: balcony at 8.0s, kitchen removed, 30.0s → 28.0s`
 *
 * Clauses are in timeline order, seconds use one decimal, at most four clauses
 * are shown and the rest collapse to `and N more`.
 */

import { roundTime, totalDuration } from '@zeniconic/core';
import type { Clip, Edl, Overlay, OverlayKind, Room } from '@zeniconic/edl';

interface Clause {
  text: string;
  position: number;
}

const ROOM_LABELS: Record<Room, string> = {
  exterior: 'exterior',
  building: 'building',
  entry: 'entry',
  living: 'living room',
  kitchen: 'kitchen',
  dining: 'dining room',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  balcony: 'balcony',
  view: 'view',
  amenity: 'amenity',
  unknown: 'shot',
};

const OVERLAY_LABELS: Record<OverlayKind, string> = {
  price: 'price card',
  spec_row: 'spec row',
  address: 'address',
  logo: 'logo',
  lower_third: 'lower third',
  cta: 'cta',
  disclaimer: 'disclaimer',
  room_label: 'room label',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqual(value, right[index]));
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
    );
  }

  return false;
}

function clipSpan(clip: Clip): number {
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  const span = clip.outSec - clip.inSec;
  return span > 0 ? span / speed : 0;
}

function edlDuration(edl: Edl): number {
  try {
    return totalDuration(edl.clips);
  } catch {
    return roundTime(edl.clips.reduce((total, clip) => total + clipSpan(clip), 0));
  }
}

function timelineStarts(clips: readonly Clip[]): Map<string, number> {
  const starts = new Map<string, number>();
  let cursor = 0;

  for (const clip of clips) {
    if (!starts.has(clip.id)) starts.set(clip.id, roundTime(cursor));
    cursor += clipSpan(clip);
  }

  return starts;
}

function formatSeconds(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(safe * 10) / 10;
  const normalised = Object.is(rounded, -0) ? 0 : rounded;
  return normalised.toFixed(1);
}

function clipLabel(clip: Clip): string {
  return clip.room === undefined ? 'shot' : (ROOM_LABELS[clip.room] ?? 'shot');
}

function overlayLabel(overlay: Overlay): string {
  return OVERLAY_LABELS[overlay.kind] ?? 'overlay';
}

function overlayPosition(overlay: Overlay): number {
  return Number.isFinite(overlay.inSec) ? overlay.inSec : 0;
}

function bpmFrom(beats: readonly number[]): number | null {
  if (beats.length < 2) return null;

  const intervals: number[] = [];
  for (let index = 1; index < beats.length; index += 1) {
    const previous = beats[index - 1];
    const current = beats[index];
    if (previous === undefined || current === undefined) continue;
    const interval = current - previous;
    if (Number.isFinite(interval) && interval > 0) intervals.push(interval);
  }

  if (intervals.length === 0) return null;

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median === undefined || median <= 0) return null;

  return Math.round(60 / median);
}

/**
 * Pair a removed item with an added item that is deep-equal, so remove-then-add
 * is not reported as two changes. Returns the unmatched items in input order.
 */
function cancelPairs<T>(removed: readonly T[], added: readonly T[]): { removed: T[]; added: T[] } {
  const remainingRemoved = [...removed];
  const remainingAdded: T[] = [];

  for (const candidate of added) {
    const match = remainingRemoved.findIndex((other) => deepEqual(other, candidate));
    if (match >= 0) {
      remainingRemoved.splice(match, 1);
    } else {
      remainingAdded.push(candidate);
    }
  }

  return { removed: remainingRemoved, added: remainingAdded };
}

function collectClipClauses(before: Edl, after: Edl): Clause[] {
  const clauses: Clause[] = [];
  const beforeById = new Map(before.clips.map((clip) => [clip.id, clip]));
  const afterById = new Map(after.clips.map((clip) => [clip.id, clip]));
  const beforeStarts = timelineStarts(before.clips);
  const afterStarts = timelineStarts(after.clips);

  const removed = before.clips.filter((clip) => !afterById.has(clip.id));
  const added = after.clips.filter((clip) => !beforeById.has(clip.id));
  const unmatched = cancelPairs(removed, added);

  for (const clip of unmatched.removed) {
    clauses.push({
      text: `${clipLabel(clip)} removed`,
      position: beforeStarts.get(clip.id) ?? 0,
    });
  }

  for (const clip of unmatched.added) {
    clauses.push({
      text: `${clipLabel(clip)} at ${formatSeconds(afterStarts.get(clip.id) ?? 0)}s`,
      position: afterStarts.get(clip.id) ?? 0,
    });
  }

  const commonBefore = before.clips.filter((clip) => afterById.has(clip.id));
  const commonAfter = after.clips.filter((clip) => beforeById.has(clip.id));
  const beforeOrder = new Map(commonBefore.map((clip, index) => [clip.id, index]));
  const afterOrder = new Map(commonAfter.map((clip, index) => [clip.id, index]));

  for (const current of commonAfter) {
    const previous = beforeById.get(current.id);
    if (previous === undefined) continue;

    const position = afterStarts.get(current.id) ?? 0;
    const fromLabel = clipLabel(previous);
    const toLabel = clipLabel(current);

    if (previous.sourceId !== current.sourceId || previous.src !== current.src) {
      clauses.push({
        text: fromLabel === toLabel ? `${toLabel} swapped` : `${fromLabel} → ${toLabel}`,
        position,
      });
      continue;
    }

    if (previous.room !== current.room) {
      clauses.push({
        text: fromLabel === toLabel ? `${toLabel} updated` : `${fromLabel} → ${toLabel}`,
        position,
      });
      continue;
    }

    if (beforeOrder.get(current.id) !== afterOrder.get(current.id)) {
      clauses.push({
        text: `${toLabel} at ${formatSeconds(position)}s`,
        position,
      });
    }
  }

  return clauses;
}

function collectOverlayClauses(before: Edl, after: Edl): Clause[] {
  const clauses: Clause[] = [];
  const beforeById = new Map(before.overlays.map((overlay) => [overlay.id, overlay]));
  const afterById = new Map(after.overlays.map((overlay) => [overlay.id, overlay]));

  const removed = before.overlays.filter((overlay) => !afterById.has(overlay.id));
  const added = after.overlays.filter((overlay) => !beforeById.has(overlay.id));
  const unmatched = cancelPairs(removed, added);

  for (const overlay of unmatched.removed) {
    clauses.push({
      text: `${overlayLabel(overlay)} removed`,
      position: overlayPosition(overlay),
    });
  }

  for (const overlay of unmatched.added) {
    clauses.push({
      text: `${overlayLabel(overlay)} at ${formatSeconds(overlay.inSec)}s`,
      position: overlayPosition(overlay),
    });
  }

  for (const current of after.overlays) {
    const previous = beforeById.get(current.id);
    if (previous === undefined) continue;

    const fromLabel = overlayLabel(previous);
    const toLabel = overlayLabel(current);

    if (previous.kind !== current.kind) {
      clauses.push({ text: `${fromLabel} → ${toLabel}`, position: overlayPosition(current) });
      continue;
    }

    if (previous.inSec !== current.inSec) {
      clauses.push({
        text: `${toLabel} at ${formatSeconds(current.inSec)}s`,
        position: overlayPosition(current),
      });
      continue;
    }

    if (previous.text !== current.text || previous.subtext !== current.subtext) {
      clauses.push({ text: `${toLabel} text updated`, position: overlayPosition(current) });
      continue;
    }

    if (!deepEqual(previous, current)) {
      clauses.push({ text: `${toLabel} updated`, position: overlayPosition(current) });
    }
  }

  return clauses;
}

function collectOtherClauses(before: Edl, after: Edl): Clause[] {
  const clauses: Clause[] = [];
  const end = Number.POSITIVE_INFINITY;

  if (
    before.audio.music.trackId !== after.audio.music.trackId ||
    before.audio.music.gainDb !== after.audio.music.gainDb ||
    before.audio.music.duckUnderVoiceDb !== after.audio.music.duckUnderVoiceDb ||
    !deepEqual(before.audio.music.beatGrid, after.audio.music.beatGrid) ||
    !deepEqual(before.audio.music.license, after.audio.music.license)
  ) {
    if (before.audio.music.trackId !== after.audio.music.trackId) {
      const bpm = bpmFrom(after.audio.music.beatGrid);
      clauses.push({
        text:
          bpm === null
            ? `music: ${after.audio.music.trackId}`
            : `music: ${after.audio.music.trackId} at ${bpm} BPM`,
        position: end,
      });
    } else {
      clauses.push({ text: 'music level updated', position: end });
    }
  }

  if (before.look.id !== after.look.id) {
    clauses.push({ text: `${before.look.id} → ${after.look.id}`, position: end });
  } else if (before.look.label !== after.look.label || before.look.description !== after.look.description) {
    clauses.push({ text: 'look updated', position: end });
  }

  if (before.format.id !== after.format.id) {
    clauses.push({
      text: `${before.format.label} → ${after.format.label}`,
      position: end,
    });
  } else if (
    before.format.label !== after.format.label ||
    before.format.targetDurationSec !== after.format.targetDurationSec
  ) {
    clauses.push({ text: 'format updated', position: end });
  }

  if (!deepEqual(before.captions, after.captions)) {
    if (before.captions.mode !== after.captions.mode) {
      if (after.captions.mode === 'none') {
        clauses.push({ text: 'captions removed', position: end });
      } else if (before.captions.mode === 'none') {
        clauses.push({ text: 'captions added', position: end });
      } else {
        clauses.push({
          text: `captions: ${before.captions.mode} → ${after.captions.mode}`,
          position: end,
        });
      }
    } else {
      clauses.push({ text: 'captions updated', position: end });
    }
  }

  if (!deepEqual(before.audio.voice, after.audio.voice)) {
    clauses.push({
      text: after.audio.voice.mode === 'mute' ? 'voice muted' : 'voice updated',
      position: end,
    });
  }

  if (before.canvas.profile !== after.canvas.profile) {
    clauses.push({
      text: `profile: ${before.canvas.profile} → ${after.canvas.profile}`,
      position: end,
    });
  } else if (!deepEqual(before.canvas, after.canvas)) {
    clauses.push({ text: 'frame updated', position: end });
  }

  return clauses;
}

function formatClauses(clauses: readonly Clause[]): string {
  if (clauses.length === 0) return 'Nothing to change';

  const shown = clauses.slice(0, 4).map((clause) => clause.text);
  if (clauses.length > 4) {
    shown.push(`and ${clauses.length - 4} more`);
  }

  const header = clauses.length === 1 ? '1 change' : `${clauses.length} changes`;
  return `${header}: ${shown.join(', ')}`;
}

/**
 * The one-line diff a user reads before applying. Identical edits produce no
 * clauses, so remove-then-add collapses to `Nothing to change`.
 */
export function summariseDiff(before: Edl, after: Edl): string {
  const clauses: Clause[] = [
    ...collectClipClauses(before, after),
    ...collectOverlayClauses(before, after),
    ...collectOtherClauses(before, after),
  ];

  const durationBefore = edlDuration(before);
  const durationAfter = edlDuration(after);
  if (durationBefore !== durationAfter) {
    clauses.push({
      text: `${formatSeconds(durationBefore)}s → ${formatSeconds(durationAfter)}s`,
      position: Number.POSITIVE_INFINITY,
    });
  }

  // Stable sort: non-timed clauses keep their deterministic order, and the
  // duration clause stays last because it is appended after them.
  clauses.sort((left, right) => {
    if (left.position < right.position) return -1;
    if (left.position > right.position) return 1;
    return 0;
  });

  return formatClauses(clauses);
}
