import { clipDuration, fail, findClip, retime, round3, timelineDuration, withClips } from '../helpers';
import type { Capability } from '../types';

const TRANSITIONS = [
  'cut', 'dissolve', 'slide', 'whip', 'zoom_blur', 'luma_wipe', 'light_leak',
  'dip_black', 'dip_white', 'blur', 'directional_blur', 'push_left', 'push_right',
  'circle', 'wipe', 'glitch',
] as const;

const CLIP_ID = { type: 'string', minLength: 1, maxLength: 64 } as const;

function isCut(type: string): boolean {
  return type === 'cut';
}

export const setTransition: Capability = {
  id: 'set_transition',
  version: '1.0.0',
  name: 'Set a transition',
  category: 'transition',
  description: 'Set the transition entering one clip (the cut before it).',
  params: {
    type: 'object',
    required: ['clipId', 'type'],
    additionalProperties: false,
    properties: {
      clipId: CLIP_ID,
      type: { type: 'string', enum: [...TRANSITIONS] },
      durationSec: { type: 'number', minimum: 0, maximum: 1.5 },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'The clip must not be first. Duration defaults to 0.4s for non-cut types and is capped by the shorter neighbour.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    if (found.index === 0) {
      return fail('/clipId', 'E_CAPABILITY_GUARDRAIL', 'The first clip has no incoming cut to transition from.');
    }

    const type = String(params.type) as (typeof TRANSITIONS)[number];
    const previous = edl.clips[found.index - 1]!;
    if (!isCut(type) && (previous.speedRamp ?? []).length >= 2) {
      return fail(
        '/clipId',
        'E_CAPABILITY_GUARDRAIL',
        `${previous.id} has a speed ramp and cannot lend a transition handle. Remove the ramp first.`,
      );
    }
    const shorter = Math.min(clipDuration(previous), clipDuration(found.clip));
    const requested = typeof params.durationSec === 'number' ? Number(params.durationSec) : isCut(type) ? 0 : 0.4;
    if (!Number.isFinite(requested) || requested < 0 || requested > 1.5) {
      return fail('/durationSec', 'E_CAPABILITY_PARAM', 'A transition lasts 0–1.5s.');
    }
    if (!isCut(type) && requested > shorter + 1e-9) {
      return fail(
        '/durationSec',
        'E_CAPABILITY_PARAM',
        `${requested}s is longer than the ${round3(shorter)}s shorter neighbour.`,
      );
    }

    const clips = edl.clips.map((clip) => ({ ...clip }));
    const incoming = clips[found.index]!;
    const outgoing = clips[found.index - 1]!;

    if (!isCut(type)) {
      const need = round3(requested);
      const held = round3(outgoing.handleOutSec ?? 0);
      if (held + 1e-9 < need) {
        // No handle yet: create one by trimming the outgoing out point, so the
        // xfade overlap is paid from real source picture and the assembled film
        // keeps the edit's length. Refuse when the clip is too short to lend it.
        const available = round3(outgoing.outSec - outgoing.inSec);
        if (available - need < 0.5) {
          return fail(
            '/durationSec',
            'E_CAPABILITY_GUARDRAIL',
            `${outgoing.id} is too short to lend a ${need}s transition handle. Shorten the transition or trim another clip.`,
          );
        }
        outgoing.outSec = round3(outgoing.outSec - need);
        outgoing.handleOutSec = need;
      }
    } else {
      delete (outgoing as { handleOutSec?: unknown }).handleOutSec;
    }

    incoming.transitionIn = isCut(type) ? { type: 'cut', durationSec: 0 } : { type, durationSec: round3(requested) };
    // Mirror on the outgoing clip so any renderer that reads transitionOut agrees.
    outgoing.transitionOut = isCut(type)
      ? { type: 'cut', durationSec: 0 }
      : { ...incoming.transitionIn };

    const total = timelineDuration(clips);
    // A handle makes the assembled film exactly `total`; without one the xfade
    // would shorten it. Retime back to the edit's target when the handle trim
    // changed the total.
    const retimed = retime(withClips(edl, clips), edl.format.targetDurationSec) ?? withClips(edl, clips);
    return {
      ok: true,
      edl: retimed,
      summary: isCut(type)
        ? `Removed the transition before ${clipId}.`
        : `Set a ${round3(requested)}s ${type} before ${clipId}.`,
    };
  },
};

export const setTransitionAll: Capability = {
  id: 'set_transition_all',
  version: '1.0.0',
  name: 'Set every transition',
  category: 'transition',
  description: 'Apply one transition type and duration to every cut in the film.',
  params: {
    type: 'object',
    required: ['type'],
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: [...TRANSITIONS] },
      durationSec: { type: 'number', minimum: 0, maximum: 1.5 },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'Caps the duration at the shortest clip so no boundary is invalid.',
  apply(edl, params) {
    const type = String(params.type) as (typeof TRANSITIONS)[number];
    const requested = typeof params.durationSec === 'number' ? Number(params.durationSec) : 0.4;
    if (!Number.isFinite(requested) || requested < 0 || requested > 1.5) {
      return fail('/durationSec', 'E_CAPABILITY_PARAM', 'A transition lasts 0–1.5s.');
    }
    const shortest = Math.min(...edl.clips.map(clipDuration));
    const duration = isCut(type) ? 0 : Math.min(requested, shortest, 1.5);
    if (!isCut(type) && duration < 0.05) {
      return fail('/durationSec', 'E_CAPABILITY_PARAM', 'The clips are too short for this transition.');
    }

    const clips = edl.clips.map((clip) => ({ ...clip, transitionIn: { ...clip.transitionIn }, transitionOut: { ...(clip.transitionOut ?? { type: 'cut', durationSec: 0 }) } }));

    for (let index = 1; index < clips.length; index += 1) {
      const incoming = clips[index]!;
      const outgoing = clips[index - 1]!;
      if (isCut(type)) {
        incoming.transitionIn = { type: 'cut', durationSec: 0 };
        outgoing.transitionOut = { type: 'cut', durationSec: 0 };
        delete (outgoing as { handleOutSec?: unknown }).handleOutSec;
        continue;
      }
      const held = round3(outgoing.handleOutSec ?? 0);
      if (held + 1e-9 < duration) {
        const available = round3(outgoing.outSec - outgoing.inSec);
        if (available - duration < 0.5) {
          return fail(
            '/durationSec',
            'E_CAPABILITY_GUARDRAIL',
            `${outgoing.id} is too short to lend a ${duration}s handle for every cut.`,
          );
        }
        outgoing.outSec = round3(outgoing.outSec - duration);
        outgoing.handleOutSec = round3(duration);
      }
      incoming.transitionIn = { type, durationSec: round3(duration) };
      outgoing.transitionOut = { type, durationSec: round3(duration) };
    }

    const retimed = retime(withClips(edl, clips), edl.format.targetDurationSec) ?? withClips(edl, clips);
    return {
      ok: true,
      edl: retimed,
      summary: isCut(type) ? 'Removed every transition.' : `Applied a ${round3(duration)}s ${type} at every cut.`,
    };
  },
};
