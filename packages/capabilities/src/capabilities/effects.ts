import type { Effect, EffectType, Edl } from '@zeniconic/edl';
import { fail, findClip, nextEffectId, round3, timelineDuration, withClips } from '../helpers';
import type { Capability } from '../types';

const EFFECT_TYPES: EffectType[] = [
  'blur', 'motion_blur', 'grain', 'vignette', 'sharpen',
  'chromatic_aberration', 'saturation', 'exposure', 'contrast', 'lut',
];

const PRESETS = [
  'none', 'warm_cinematic', 'cool_cinematic', 'luxury',
  'natural', 'vivid', 'noir',
] as const;

const CLIP_ID = { type: 'string', minLength: 1, maxLength: 64 } as const;

export const applyEffect: Capability = {
  id: 'apply_effect',
  version: '1.0.0',
  name: 'Apply an effect',
  category: 'effect',
  description: 'Apply a visual effect to one clip or to the whole timeline.',
  params: {
    type: 'object',
    required: ['target', 'type'],
    additionalProperties: false,
    properties: {
      target: { type: 'string', enum: ['clip', 'timeline'] },
      clipId: CLIP_ID,
      type: { type: 'string', enum: EFFECT_TYPES },
      amount: { type: 'number', minimum: 0, maximum: 100 },
      params: { type: 'object' },
      inSec: { type: 'number', minimum: 0, maximum: 120 },
      outSec: { type: 'number', minimum: 0, maximum: 120 },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'Effects render in a fixed order: spatial, then colour, then temporal. LUT needs a .cube under data/luts.',
  apply(edl, params) {
    const type = String(params.type) as EffectType;
    const target = String(params.target);
    const effectParams = params.params;
    if (effectParams !== undefined && (typeof effectParams !== 'object' || effectParams === null || Array.isArray(effectParams))) {
      return fail('/params', 'E_CAPABILITY_PARAM', 'params must be an object.');
    }

    if (target === 'timeline') {
      const effect: Effect = {
        id: nextEffectId(edl),
        type,
        ...(typeof params.amount === 'number' ? { amount: round3(params.amount) } : {}),
        ...(typeof params.inSec === 'number' ? { inSec: round3(params.inSec) } : {}),
        ...(typeof params.outSec === 'number' ? { outSec: round3(params.outSec) } : {}),
        ...(effectParams === undefined ? {} : { params: effectParams as Record<string, number | string | boolean> }),
        enabled: true,
      };
      return {
        ok: true,
        edl: { ...edl, effects: [...(edl.effects ?? []), effect] },
        summary: `Added a ${type} effect to the whole film.`,
      };
    }

    if (typeof params.clipId !== 'string') {
      return fail('/clipId', 'E_CAPABILITY_PARAM', 'A clip effect needs clipId.');
    }
    const found = findClip(edl, String(params.clipId));
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${String(params.clipId)}".`);

    const effect: Effect = {
      id: nextEffectId(edl, found.clip),
      type,
      ...(typeof params.amount === 'number' ? { amount: round3(params.amount) } : {}),
      ...(typeof params.inSec === 'number' ? { inSec: round3(params.inSec) } : {}),
      ...(typeof params.outSec === 'number' ? { outSec: round3(params.outSec) } : {}),
      ...(effectParams === undefined ? {} : { params: effectParams as Record<string, number | string | boolean> }),
      enabled: true,
    };
    const clips = [...edl.clips];
    clips[found.index] = { ...found.clip, effects: [...(found.clip.effects ?? []), effect] };
    return {
      ok: true,
      edl: withClips(edl, clips),
      summary: `Added a ${type} effect to ${found.clip.id}.`,
    };
  },
};

export const removeEffect: Capability = {
  id: 'remove_effect',
  version: '1.0.0',
  name: 'Remove an effect',
  category: 'effect',
  description: 'Remove one effect by id from a clip or the timeline.',
  params: {
    type: 'object',
    required: ['effectId'],
    additionalProperties: false,
    properties: { effectId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  risk: 'low',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'Effect ids are unique; the handler searches the root and every clip.',
  apply(edl, params) {
    const effectId = String(params.effectId);
    const root = edl.effects ?? [];
    if (root.some((effect) => effect.id === effectId)) {
      return {
        ok: true,
        edl: { ...edl, effects: root.filter((effect) => effect.id !== effectId) },
        summary: `Removed the ${effectId} timeline effect.`,
      };
    }
    const clips = [...edl.clips];
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index]!;
      if (!(clip.effects ?? []).some((effect) => effect.id === effectId)) continue;
      clips[index] = { ...clip, effects: (clip.effects ?? []).filter((effect) => effect.id !== effectId) };
      return { ok: true, edl: withClips(edl, clips), summary: `Removed ${effectId} from ${clip.id}.` };
    }
    return fail('/effectId', 'E_CAPABILITY_TARGET', `No effect "${effectId}".`);
  },
};

export const applyGrade: Capability = {
  id: 'apply_grade',
  version: '1.0.0',
  name: 'Apply a colour grade',
  category: 'effect',
  description: 'Apply a cinematic colour grade to one clip or the whole film.',
  params: {
    type: 'object',
    required: ['target'],
    additionalProperties: false,
    properties: {
      target: { type: 'string', enum: ['clip', 'timeline'] },
      clipId: CLIP_ID,
      preset: { type: 'string', enum: [...PRESETS] },
      intensity: { type: 'number', minimum: 0, maximum: 1 },
      look: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exposure: { type: 'number', minimum: -2, maximum: 2 },
          contrast: { type: 'number', minimum: 0.5, maximum: 2 },
          saturation: { type: 'number', minimum: 0, maximum: 2 },
          temperature: { type: 'number', minimum: -1, maximum: 1 },
          tint: { type: 'number', minimum: -1, maximum: 1 },
          highlights: { type: 'number', minimum: -1, maximum: 1 },
          shadows: { type: 'number', minimum: -1, maximum: 1 },
          vibrance: { type: 'number', minimum: -1, maximum: 1 },
          lut: { type: 'string', pattern: '^[A-Za-z0-9._/-]+\\.cube$' },
        },
      },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'Presets are starting points; explicit look fields override them. Global grade runs after clip grade.',
  apply(edl, params) {
    const preset = params.preset === undefined ? undefined : String(params.preset);
    const look = (params.look ?? {}) as Record<string, number | string>;
    const intensity = typeof params.intensity === 'number' ? round3(params.intensity) : 1;
    const grade = {
      ...(preset === undefined ? {} : { preset: preset as (typeof PRESETS)[number] }),
      ...look,
      intensity,
    };

    if (String(params.target) === 'timeline') {
      return {
        ok: true,
        edl: { ...edl, grade: { ...(edl.grade ?? {}), ...grade } },
        summary: `Applied a ${preset ?? 'custom'} grade to the whole film.`,
      };
    }

    if (typeof params.clipId !== 'string') {
      return fail('/clipId', 'E_CAPABILITY_PARAM', 'A clip grade needs clipId.');
    }
    const found = findClip(edl, String(params.clipId));
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${String(params.clipId)}".`);
    const clips = [...edl.clips];
    clips[found.index] = { ...found.clip, grade: { ...(found.clip.grade ?? {}), ...grade } };
    return { ok: true, edl: withClips(edl, clips), summary: `Graded ${found.clip.id} (${preset ?? 'custom'}).` };
  },
};

export const clearEffects: Capability = {
  id: 'clear_effects',
  version: '1.0.0',
  name: 'Clear effects',
  category: 'effect',
  description: 'Remove all effects (and optionally the grade) from the film.',
  params: {
    type: 'object',
    additionalProperties: false,
    properties: { includeGrade: { type: 'boolean' } },
  },
  risk: 'medium',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'Clips keep their pacing and transitions.',
  apply(edl, params) {
    const includeGrade = params.includeGrade === true;
    const clips = edl.clips.map((clip) => {
      const next = { ...clip, effects: [] };
      if (includeGrade) delete (next as { grade?: unknown }).grade;
      return next;
    });
    return {
      ok: true,
      edl: {
        ...edl,
        clips,
        effects: [],
        ...(includeGrade ? { grade: undefined } : {}),
      },
      summary: includeGrade ? 'Cleared effects and grades.' : 'Cleared effects.',
    };
  },
};

export { EFFECT_TYPES, PRESETS };

/** Whole-film duration, exported so tests can assert handlers never retime. */
export const durationOf = (edl: Edl): number => round3(timelineDuration(edl.clips));
