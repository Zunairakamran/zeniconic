import type { Clip, Edl } from '@zeniconic/edl';
import type { CapabilityIssue, CapabilityResult } from './types';

/** Timeline seconds of one clip, using the same maths as the validator. */
export function clipDuration(clip: Clip): number {
  const speed = clip.speed > 0 ? clip.speed : 1;
  return (clip.outSec - clip.inSec) / speed;
}

export function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function timelineDuration(clips: readonly Clip[]): number {
  return round3(clips.reduce((sum, clip) => sum + clipDuration(clip), 0));
}

export function issue(path: string, code: string, message: string): CapabilityIssue {
  return { path, code, message };
}

export function fail(path: string, code: string, message: string): CapabilityResult {
  return { ok: false, issues: [issue(path, code, message)] };
}

export function findClip(edl: Edl, clipId: string): { clip: Clip; index: number } | undefined {
  const index = edl.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return undefined;
  const clip = edl.clips[index];
  return clip === undefined ? undefined : { clip, index };
}

/** A stable unused clip id (`c07` style) given the current ids. */
export function nextClipId(clips: readonly Clip[]): string {
  let highest = 0;
  for (const clip of clips) {
    const match = /^c(\d+)$/.exec(clip.id);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  return `c${String(highest + 1).padStart(2, '0')}`;
}

export function nextOverlayId(edl: Edl): string {
  let highest = 0;
  for (const overlay of edl.overlays) {
    const match = /^o(\d+)$/.exec(overlay.id);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  return `o${String(highest + 1).padStart(2, '0')}`;
}

export function nextEffectId(edl: Edl, clip?: Clip): string {
  let highest = 0;
  const scan = (effects: readonly { id: string }[] | undefined): void => {
    for (const effect of effects ?? []) {
      const match = /^e(\d+)$/.exec(effect.id);
      if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
    }
  };
  scan(edl.effects);
  if (clip !== undefined) scan(clip.effects);
  return `e${String(highest + 1).padStart(2, '0')}`;
}

export function withClips(edl: Edl, clips: Clip[]): Edl {
  return { ...edl, clips };
}

/**
 * Documents that use a v2-only field declare 2.0.0. Capabilities upgrade on
 * write; the render pipeline migrates defensively as well.
 */
export function ensureV2(edl: Edl): Edl {
  return edl.edlVersion === '2.0.0' ? edl : { ...edl, edlVersion: '2.0.0' as Edl['edlVersion'] };
}

/** True when a document carries any field that only exists in EDL 2.0.0. */
export function hasV2Fields(edl: Edl): boolean {
  if (edl.effects !== undefined || edl.grade !== undefined || edl.output !== undefined) return true;
  if (edl.audio.fadeInSec !== undefined || edl.audio.fadeOutSec !== undefined) return true;
  const captions = edl.captions as Edl['captions'] & { animation?: unknown; highlight?: unknown; font?: unknown; box?: unknown; position?: unknown };
  if (captions.animation !== undefined || captions.highlight !== undefined || captions.font !== undefined || captions.box !== undefined || captions.position !== undefined) return true;
  return edl.clips.some(
    (clip) =>
      clip.effects !== undefined ||
      clip.grade !== undefined ||
      clip.speedRamp !== undefined ||
      (clip as { keyframes?: unknown }).keyframes !== undefined,
  );
}

export function withTarget(edl: Edl, targetSec: number): Edl {
  return {
    ...edl,
    format: { ...edl.format, targetDurationSec: round3(targetSec) },
  };
}

/**
 * Keeps overlays on the timeline after a retime. An overlay that starts after
 * the new end is dropped; one that overruns is trimmed to the new end.
 */
export function clampOverlays(edl: Edl, totalSec: number): Edl {
  const overlays = [];
  let changed = false;
  for (const overlay of edl.overlays) {
    if (overlay.inSec >= totalSec - 0.001) {
      changed = true;
      continue;
    }
    const outSec = Math.min(overlay.outSec, totalSec);
    if (outSec <= overlay.inSec) {
      changed = true;
      continue;
    }
    if (outSec !== overlay.outSec) {
      changed = true;
      overlays.push({ ...overlay, outSec: round3(outSec) });
    } else {
      overlays.push(overlay);
    }
  }
  return changed ? { ...edl, overlays } : edl;
}

/**
 * Retimes the edit to a target length.
 *
 * Shrinking trims the tail of clips (never below 0.5 s). Growing slows clips
 * down (never below 0.25×) so no source frame is invented and no source window
 * is exceeded. Returns `undefined` when the pool cannot reach the target.
 */
export function retime(edl: Edl, targetSec: number): Edl | undefined {
  const current = timelineDuration(edl.clips);
  let delta = round3(targetSec - current);
  if (Math.abs(delta) < 0.001) return withTarget(edl, targetSec);

  const clips = edl.clips.map((clip) => ({ ...clip }));

  if (delta < 0) {
    for (let index = clips.length - 1; index >= 0 && delta < 0; index -= 1) {
      const clip = clips[index];
      if (clip === undefined) continue;
      // A clip that already lends a transition handle keeps its out point:
      // moving it would invalidate the overlap arithmetic.
      if ((clip.handleOutSec ?? 0) > 0) continue;
      const duration = clipDuration(clip);
      const take = Math.min(-delta, Math.max(0, duration - 0.5));
      if (take <= 0.0005) continue;
      const nextDuration = round3(duration - take);
      clip.outSec = round3(clip.inSec + nextDuration * clip.speed);
      delta = round3(delta + take);
    }
  } else {
    // Grow by slowing the longest clips first; the source window is unchanged.
    const order = clips
      .map((clip, index) => ({ index, duration: clipDuration(clip) }))
      .sort((a, b) => b.duration - a.duration);
    for (const entry of order) {
      if (delta <= 0.0005) break;
      const clip = clips[entry.index];
      if (clip === undefined) continue;
      if ((clip.handleOutSec ?? 0) > 0) continue;
      // A speed ramp owns its timing; changing the scalar speed would invalidate it.
      if ((clip.speedRamp ?? []).length >= 2) continue;
      const duration = clipDuration(clip);
      const source = clip.outSec - clip.inSec;
      const slowest = source * 4; // speed 0.25
      const room = round3(slowest - duration);
      if (room <= 0.0005) continue;
      const add = Math.min(delta, room);
      const nextDuration = round3(duration + add);
      clip.speed = round3(source / nextDuration);
      delta = round3(delta - add);
    }
  }

  const total = timelineDuration(clips);
  if (Math.abs(total - targetSec) > 0.5) return undefined;
  return clampOverlays(withTarget(withClips(edl, clips), total), total);
}

export interface CloneResult {
  edl: Edl;
}

export function cloneEdl(edl: Edl): CloneResult {
  return { edl: structuredClone(edl) };
}
