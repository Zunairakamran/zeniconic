import type { Clip, Edl, SpeedPoint } from '@zeniconic/edl';
import {
  clampOverlays,
  clipDuration,
  fail,
  findClip,
  nextClipId,
  retime,
  round3,
  timelineDuration,
  withClips,
  withTarget,
} from '../helpers';
import type { Capability } from '../types';

const CLIP_ID = { type: 'string', minLength: 1, maxLength: 64 } as const;
const TIME = { type: 'number', minimum: 0, maximum: 120 } as const;

function targetFor(edl: Edl, total: number): Edl | undefined {
  if (total < 5 || total > 90) return undefined;
  const clamped = clampOverlays(edl, total);
  return withTarget(clamped, total);
}

function withRetimedTarget(edl: Edl, total: number, keepTarget: boolean): Edl | undefined {
  if (!keepTarget) return targetFor(edl, total);
  const target = edl.format.targetDurationSec;
  return retime(edl, target);
}

export const trimClip: Capability = {
  id: 'trim_clip',
  version: '1.0.0',
  name: 'Trim a clip',
  category: 'timeline',
  description: 'Shorten or extend a clip inside its existing source window.',
  params: {
    type: 'object',
    required: ['clipId'],
    additionalProperties: false,
    properties: {
      clipId: CLIP_ID,
      inSec: TIME,
      outSec: TIME,
      /** Keep the film length by retiming other clips (default false). */
      keepTarget: { type: 'boolean' },
    },
  },
  risk: 'low',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'outSec may not exceed the clip’s current source out point; use set_clip_speed to lengthen.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    const { clip, index } = found;

    const inSec = typeof params.inSec === 'number' ? round3(params.inSec) : clip.inSec;
    const outSec = typeof params.outSec === 'number' ? round3(params.outSec) : clip.outSec;
    if (inSec < 0) return fail('/inSec', 'E_CAPABILITY_PARAM', 'inSec cannot be negative.');
    if (outSec <= inSec) return fail('/outSec', 'E_CAPABILITY_PARAM', 'outSec must be after inSec.');
    if (outSec > clip.outSec + 0.001) {
      return fail(
        '/outSec',
        'E_CAPABILITY_PARAM',
        `outSec ${outSec}s is past this clip’s source window (${clip.outSec}s). Slow it down instead.`,
      );
    }

    const clips = [...edl.clips];
    clips[index] = { ...clip, inSec, outSec };
    const total = timelineDuration(clips);
    const next = withRetimedTarget(withClips(edl, clips), total, params.keepTarget === true);
    if (next === undefined) {
      return fail('/', 'E_CAPABILITY_DURATION', `Trimming to ${total}s cannot keep a legal film length.`);
    }
    return { ok: true, edl: next, summary: `Trimmed ${clipId} to ${round3(clipDuration(clips[index]!))}s.` };
  },
};

export const splitClip: Capability = {
  id: 'split_clip',
  version: '1.0.0',
  name: 'Split a clip',
  category: 'timeline',
  description: 'Split one clip into two at a timeline second, keeping the film length.',
  params: {
    type: 'object',
    required: ['clipId', 'atSec'],
    additionalProperties: false,
    properties: { clipId: CLIP_ID, atSec: { type: 'number', minimum: 0.1, maximum: 120 } },
  },
  risk: 'low',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'atSec is measured from the start of the clip on the assembled timeline.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    if ((found.clip.speedRamp ?? []).length >= 2) {
      return fail(
        '/clipId',
        'E_CAPABILITY_GUARDRAIL',
        `${clipId} has a speed ramp; remove it before splitting, or split another shot.`,
      );
    }
    const { clip, index } = found;
    const duration = clipDuration(clip);
    const at = round3(Number(params.atSec));
    if (at <= 0.1 || at >= duration - 0.1) {
      return fail('/atSec', 'E_CAPABILITY_PARAM', `Split at ${at}s is outside ${clipId} (0.1–${round3(duration - 0.1)}s).`);
    }

    const sourceSplit = round3(clip.inSec + at * clip.speed);
    const head: Clip = { ...clip, outSec: sourceSplit };
    const tail: Clip = {
      ...clip,
      id: nextClipId(edl.clips),
      inSec: sourceSplit,
      transitionIn: { type: 'cut', durationSec: 0 },
      ...(clip.transitionOut === undefined ? {} : { transitionOut: { ...clip.transitionOut } }),
    };
    delete (head as { transitionOut?: unknown }).transitionOut;
    head.transitionIn = { ...clip.transitionIn };

    const clips = [...edl.clips];
    clips.splice(index, 1, head, tail);
    return {
      ok: true,
      edl: withClips(edl, clips),
      summary: `Split ${clipId} at ${at}s into ${clipId} and ${tail.id}.`,
    };
  },
};

export const deleteClip: Capability = {
  id: 'delete_clip',
  version: '1.0.0',
  name: 'Delete a clip',
  category: 'timeline',
  description: 'Remove a clip and keep the film length by retiming the rest.',
  params: {
    type: 'object',
    required: ['clipId'],
    additionalProperties: false,
    properties: { clipId: CLIP_ID, rebalance: { type: 'boolean' } },
  },
  risk: 'medium',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'Deleting the last remaining clip is refused.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    if (edl.clips.length <= 1) {
      return fail('/', 'E_CAPABILITY_GUARDRAIL', 'A film needs at least one clip.');
    }

    const clips = edl.clips.filter((_, index) => index !== found.index);
    // A removed clip takes its transition with it: drop the outgoing handle and
    // mirror so the seam stays a hard cut (otherwise the EDL is invalid).
    const previous = clips[found.index - 1];
    if (previous !== undefined) {
      delete (previous as { handleOutSec?: unknown }).handleOutSec;
      previous.transitionOut = { type: 'cut', durationSec: 0 };
    }
    const successor = clips[found.index];
    if (successor !== undefined) {
      successor.transitionIn = { type: 'cut', durationSec: 0 };
    }
    const total = timelineDuration(clips);
    const next =
      params.rebalance === false
        ? targetFor(withClips(edl, clips), total)
        : withRetimedTarget(withClips(edl, clips), total, true);
    if (next === undefined) {
      return fail('/', 'E_CAPABILITY_DURATION', `Removing ${clipId} leaves ${total}s, which cannot fill the target.`);
    }
    return { ok: true, edl: next, summary: `Removed ${clipId} and rebalanced the timeline.` };
  },
};

export const duplicateClip: Capability = {
  id: 'duplicate_clip',
  version: '1.0.0',
  name: 'Duplicate a clip',
  category: 'timeline',
  description: 'Insert a copy of a clip after it and extend the target length.',
  params: {
    type: 'object',
    required: ['clipId'],
    additionalProperties: false,
    properties: { clipId: CLIP_ID },
  },
  risk: 'low',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'The target duration grows by the clip length; a film longer than 90 s is refused.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    const copy: Clip = {
      ...clip(found.clip),
      id: nextClipId(edl.clips),
      transitionIn: { type: 'cut', durationSec: 0 },
    };
    const clips = [...edl.clips];
    clips.splice(found.index + 1, 0, copy);
    const total = timelineDuration(clips);
    const next = targetFor(withClips(edl, clips), total);
    if (next === undefined) {
      return fail('/', 'E_CAPABILITY_DURATION', `Duplicating ${clipId} would make the film ${total}s (5–90s allowed).`);
    }
    return { ok: true, edl: next, summary: `Duplicated ${clipId} as ${copy.id}; the film now runs ${total}s.` };
  },
};

function clip(source: Clip): Clip {
  return { ...source, transform: structuredClone(source.transform) };
}

export const reorderClips: Capability = {
  id: 'reorder_clips',
  version: '1.0.0',
  name: 'Reorder clips',
  category: 'timeline',
  description: 'Reorder every clip; the target length is unchanged.',
  params: {
    type: 'object',
    required: ['order'],
    additionalProperties: false,
    properties: {
      order: { type: 'array', minItems: 1, maxItems: 60, items: CLIP_ID },
    },
  },
  risk: 'medium',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'order must list every clip id exactly once. Overlay timings are absolute and are not moved.',
  apply(edl, params) {
    const order = params.order;
    if (!Array.isArray(order)) return fail('/order', 'E_CAPABILITY_PARAM', 'order must be an array of clip ids.');
    const ids = edl.clips.map((entry) => entry.id);
    if (order.length !== ids.length || new Set(order).size !== ids.length || !order.every((id) => ids.includes(String(id)))) {
      return fail('/order', 'E_CAPABILITY_PARAM', 'order must contain every clip id exactly once.');
    }
    const byId = new Map(edl.clips.map((entry) => [entry.id, entry]));
    const clips = order.map((id) => byId.get(String(id))!);
    return {
      ok: true,
      edl: withClips(edl, clips),
      summary: `Reordered ${clips.length} clips.`,
      warnings: ['Overlay timings are absolute; check cards that were tied to a specific room.'],
    };
  },
};

export const setClipSpeed: Capability = {
  id: 'set_clip_speed',
  version: '1.0.0',
  name: 'Change clip speed',
  category: 'timeline',
  description: 'Speed up or slow down one clip, keeping the film length by default.',
  params: {
    type: 'object',
    required: ['clipId', 'speed'],
    additionalProperties: false,
    properties: {
      clipId: CLIP_ID,
      speed: { type: 'number', minimum: 0.25, maximum: 2 },
      keepTarget: { type: 'boolean' },
    },
  },
  risk: 'low',
  cost: 'free',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'speed 0.5 is half speed, 2 is double. keepTarget defaults to true.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    const speed = round3(Number(params.speed));
    const clips = [...edl.clips];
    const nextClip: Clip = { ...found.clip, speed };
    delete (nextClip as { speedRamp?: unknown }).speedRamp;
    clips[found.index] = nextClip;
    const total = timelineDuration(clips);
    const next = withRetimedTarget(withClips(edl, clips), total, params.keepTarget !== false);
    if (next === undefined) {
      return fail('/', 'E_CAPABILITY_DURATION', `Speed ${speed}× leaves ${total}s, which cannot fill the target.`);
    }
    return { ok: true, edl: next, summary: `Set ${clipId} to ${speed}× (${round3(clipDuration(clips[found.index]!))}s).` };
  },
};

export const setClipDuration: Capability = {
  id: 'set_clip_duration',
  version: '1.0.0',
  name: 'Set clip duration',
  category: 'timeline',
  description: 'Make one clip occupy an exact number of timeline seconds.',
  params: {
    type: 'object',
    required: ['clipId', 'durationSec'],
    additionalProperties: false,
    properties: {
      clipId: CLIP_ID,
      durationSec: { type: 'number', minimum: 0.4, maximum: 20 },
      keepTarget: { type: 'boolean' },
    },
  },
  risk: 'low',
  cost: 'free',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'Length is reached by trimming or slowing the clip, never by inventing source frames.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    const wanted = round3(Number(params.durationSec));
    if ((found.clip.speedRamp ?? []).length >= 2) {
      return fail(
        '/clipId',
        'E_CAPABILITY_GUARDRAIL',
        `${clipId} has a speed ramp; remove it before setting an exact duration.`,
      );
    }
    const source = found.clip.outSec - found.clip.inSec;
    if (wanted * 4 < source) {
      return fail('/durationSec', 'E_CAPABILITY_PARAM', `That would need a speed slower than 0.25× (source is ${round3(source)}s).`);
    }
    const speed = round3(source / wanted);
    const clips = [...edl.clips];
    clips[found.index] = { ...found.clip, speed };
    const total = timelineDuration(clips);
    const next = withRetimedTarget(withClips(edl, clips), total, params.keepTarget !== false);
    if (next === undefined) {
      return fail('/', 'E_CAPABILITY_DURATION', `A ${wanted}s ${clipId} leaves ${total}s, which cannot fill the target.`);
    }
    return { ok: true, edl: next, summary: `${clipId} now runs ${wanted}s at ${speed}×.` };
  },
};

export const setTargetDuration: Capability = {  id: 'set_target_duration',
  version: '1.0.0',
  name: 'Set film length',
  category: 'timeline',
  description: 'Retime the whole edit to a target length between 5 and 90 seconds.',
  params: {
    type: 'object',
    required: ['targetSec'],
    additionalProperties: false,
    properties: { targetSec: { type: 'number', minimum: 5, maximum: 90 } },
  },
  risk: 'medium',
  cost: 'free',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'Shrinking trims clip tails; growing slows clips. Impossible targets are refused, never silently missed.',
  apply(edl, params) {
    const target = round3(Number(params.targetSec));
    const next = retime(edl, target);
    if (next === undefined) {
      return fail(
        '/targetSec',
        'E_CAPABILITY_DURATION',
        `The current shots cannot reach ${target}s within the 0.5s tolerance.`,
      );
    }
    return { ok: true, edl: next, summary: `Retimed the film to ${target}s.` };
  },
};

/**
 * A slow-fast-slow move inside one clip. Speeds are normalised so the clip's
 * timeline duration is unchanged (∫ dt/speed = 1), which keeps the EDL valid
 * without retiming the rest of the film.
 */
export const setSpeedRamp: Capability = {
  id: 'speed_ramp',
  version: '1.0.0',
  name: 'Add a speed ramp',
  category: 'timeline',
  description: 'Slow down and speed up inside one clip, e.g. a cinematic entrance.',
  params: {
    type: 'object',
    required: ['clipId', 'points'],
    additionalProperties: false,
    properties: {
      clipId: CLIP_ID,
      points: {
        type: 'array',
        minItems: 2,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['t', 'speed'],
          additionalProperties: false,
          properties: {
            t: { type: 'number', minimum: 0, maximum: 1 },
            speed: { type: 'number', minimum: 0.25, maximum: 2 },
          },
        },
      },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 't is normalised over the clip; speeds are rescaled so the clip keeps its length. Scalar speed must be 1.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);
    if (found.clip.speed !== 1) {
      return fail('/clipId', 'E_CAPABILITY_GUARDRAIL', `${clipId} has a scalar speed; reset it to 1× first.`);
    }

    const raw = params.points;
    if (!Array.isArray(raw) || raw.length < 2) {
      return fail('/points', 'E_CAPABILITY_PARAM', 'A ramp needs at least two points.');
    }
    const points: SpeedPoint[] = raw.map((entry) => {
      const point = entry as { t?: unknown; speed?: unknown };
      return { t: round3(Number(point.t)), speed: round3(Number(point.speed)) };
    });
    if (points[0]?.t !== 0 || points[points.length - 1]?.t !== 1) {
      return fail('/points', 'E_CAPABILITY_PARAM', 'The first t must be 0 and the last 1.');
    }
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      if (point.speed < 0.25 || point.speed > 2) {
        return fail('/points', 'E_CAPABILITY_PARAM', 'Speeds must stay between 0.25× and 2×.');
      }
      if (index > 0 && point.t <= points[index - 1]!.t) {
        return fail('/points', 'E_CAPABILITY_PARAM', 't must strictly increase.');
      }
    }

    // ∫ dt/speed must be 1 for the clip's length to stay unchanged.
    let integral = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
      integral += (points[index + 1]!.t - points[index]!.t) / points[index]!.speed;
    }
    const scaled = points.map((point) => ({ t: point.t, speed: round3(point.speed * integral) }));
    if (scaled.some((point) => point.speed < 0.25 || point.speed > 2)) {
      return fail(
        '/points',
        'E_CAPABILITY_GUARDRAIL',
        'Those speeds would leave the clip length unchanged only outside the 0.25×–2× range. Use a gentler ramp.',
      );
    }

    const clips = [...edl.clips];
    clips[found.index] = { ...found.clip, speed: 1, speedRamp: scaled };
    return {
      ok: true,
      edl: withClips(edl, clips),
      summary: `Added a ${scaled.length}-point speed ramp to ${clipId} (${scaled
        .map((point) => `${point.speed}×`)
        .join(' → ')}).`,
    };
  },
};
