import type { CropPoint, Focus, TransformMode } from '@zeniconic/edl';
import { fail, findClip, round3, withClips } from '../helpers';
import type { Capability } from '../types';

const CLIP_ID = { type: 'string', minLength: 1, maxLength: 64 } as const;
const MODES: TransformMode[] = ['cover', 'pad_blur', 'contain'];
const FOCUS: Focus[] = ['saliency', 'center', 'left', 'right', 'top', 'bottom'];

const KEYFRAME = {
  type: 'object',
  required: ['t', 'x', 'y', 'scale'],
  additionalProperties: false,
  properties: {
    t: { type: 'number', minimum: 0, maximum: 1 },
    x: { type: 'number', minimum: 0, maximum: 1 },
    y: { type: 'number', minimum: 0, maximum: 1 },
    scale: { type: 'number', minimum: 0.5, maximum: 4 },
  },
} as const;

export const setTransform: Capability = {
  id: 'set_transform',
  version: '1.0.0',
  name: 'Set the camera framing',
  category: 'camera',
  description: 'Set crop mode, focal point and an optional keyframed push for one clip.',
  params: {
    type: 'object',
    required: ['clipId'],
    additionalProperties: false,
    properties: {
      clipId: CLIP_ID,
      mode: { type: 'string', enum: MODES },
      focus: { type: 'string', enum: FOCUS },
      keyframes: { type: 'array', minItems: 2, maxItems: 8, items: KEYFRAME },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'Keyframe t runs 0..1 across the clip; x/y are focal points in normalised source space.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);

    const mode = (params.mode === undefined ? found.clip.transform.mode : String(params.mode)) as TransformMode;
    if (!MODES.includes(mode)) return fail('/mode', 'E_CAPABILITY_PARAM', `Unknown mode "${String(params.mode)}".`);
    const focus = (params.focus === undefined ? found.clip.transform.focus : String(params.focus)) as Focus;
    if (!FOCUS.includes(focus)) return fail('/focus', 'E_CAPABILITY_PARAM', `Unknown focus "${String(params.focus)}".`);

    let path: CropPoint[] = found.clip.transform.path;
    if (Array.isArray(params.keyframes)) {
      path = (params.keyframes as CropPoint[]).map((point) => ({
        t: round3(point.t),
        x: round3(point.x),
        y: round3(point.y),
        scale: round3(point.scale),
      }));
    }

    const clips = [...edl.clips];
    clips[found.index] = { ...found.clip, transform: { mode, focus, path } };
    return {
      ok: true,
      edl: withClips(edl, clips),
      summary: `Framing for ${clipId}: ${mode}, focused ${focus}${path.length > 1 ? `, ${path.length}-point move` : ''}.`,
    };
  },
};

export const kenBurns: Capability = {
  id: 'ken_burns',
  version: '1.0.0',
  name: 'Add a Ken Burns move',
  category: 'camera',
  description: 'A slow push or pull across one clip, centred or biased to one edge.',
  params: {
    type: 'object',
    required: ['clipId'],
    additionalProperties: false,
    properties: {
      clipId: CLIP_ID,
      fromScale: { type: 'number', minimum: 1, maximum: 2 },
      toScale: { type: 'number', minimum: 1, maximum: 2 },
      direction: { type: 'string', enum: ['center', 'left', 'right', 'top', 'bottom', 'in', 'out'] },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['ffmpeg', 'remotion'],
  preview: true,
  docs: 'A push-in is fromScale 1.02 → toScale 1.14; a pull-out reverses them.',
  apply(edl, params) {
    const clipId = String(params.clipId);
    const found = findClip(edl, clipId);
    if (found === undefined) return fail('/clipId', 'E_CAPABILITY_TARGET', `No clip "${clipId}".`);

    const direction = params.direction === undefined ? 'in' : String(params.direction);
    if (!['center', 'left', 'right', 'top', 'bottom', 'in', 'out'].includes(direction)) {
      return fail('/direction', 'E_CAPABILITY_PARAM', `Unknown direction "${direction}".`);
    }
    const from = typeof params.fromScale === 'number' ? round3(params.fromScale) : 1.02;
    const to = typeof params.toScale === 'number'
      ? round3(params.toScale)
      : direction === 'out' ? 1.02 : 1.14;

    const anchor = ((): { x: number; y: number } => {
      switch (direction) {
        case 'left': return { x: 0.35, y: 0.5 };
        case 'right': return { x: 0.65, y: 0.5 };
        case 'top': return { x: 0.5, y: 0.35 };
        case 'bottom': return { x: 0.5, y: 0.65 };
        default: return { x: 0.5, y: 0.5 };
      }
    })();

    const path: CropPoint[] = [
      { t: 0, x: anchor.x, y: anchor.y, scale: direction === 'out' ? to : from },
      { t: 1, x: anchor.x, y: anchor.y, scale: direction === 'out' ? from : to },
    ];
    const clips = [...edl.clips];
    clips[found.index] = {
      ...found.clip,
      transform: { mode: 'cover', focus: found.clip.transform.focus, path },
    };
    return {
      ok: true,
      edl: withClips(edl, clips),
      summary: `${direction === 'out' ? 'Pulled out' : 'Pushed in'} on ${clipId} (${path[0]!.scale}× → ${path[1]!.scale}×).`,
    };
  },
};

export const setOutput: Capability = {
  id: 'set_output',
  version: '1.0.0',
  name: 'Set output size',
  category: 'execution',
  description: 'Override output width, height and frame rate for this project.',
  params: {
    type: 'object',
    additionalProperties: false,
    properties: {
      width: { type: 'number', minimum: 320, maximum: 7680 },
      height: { type: 'number', minimum: 320, maximum: 7680 },
      fps: { type: 'number', minimum: 12, maximum: 60 },
    },
  },
  risk: 'medium',
  cost: 'render',
  backends: ['edl'],
  preview: true,
  docs: 'Render profiles remain the defaults; this only overrides the project output block.',
  apply(edl, params) {
    const output = { ...(edl.output ?? {}) };
    if (typeof params.width === 'number') output.width = Math.round(params.width);
    if (typeof params.height === 'number') output.height = Math.round(params.height);
    if (typeof params.fps === 'number') output.fps = Math.round(params.fps);
    if (Object.keys(output).length === 0) return fail('/', 'E_CAPABILITY_PARAM', 'Provide width, height or fps.');
    return { ok: true, edl: { ...edl, output }, summary: `Output set to ${output.width ?? 'auto'}×${output.height ?? 'auto'} @ ${output.fps ?? 'auto'}fps.` };
  },
};
