import type { Overlay, OverlayKind } from '@zeniconic/edl';
import { fail, nextOverlayId, round3, timelineDuration } from '../helpers';
import type { Capability } from '../types';

const KINDS: OverlayKind[] = [
  'price', 'spec_row', 'address', 'logo', 'lower_third', 'cta', 'disclaimer', 'room_label',
];
const ANCHORS = ['top_left', 'top_center', 'top_right', 'center', 'bottom_left', 'bottom_center', 'bottom_right'] as const;
const STYLES = ['price_lower', 'spec_pill', 'address_tag', 'logo_corner', 'cta_card', 'caption', 'small_print'] as const;
const ANIMATIONS = [
  'none', 'fade', 'rise', 'slide_in', 'count_up', 'pop', 'typewriter', 'tracking_in', 'blur_in', 'scale_in',
] as const;
const EXITS = ['none', 'fade', 'slide_out'] as const;

const TEXT = { type: 'string', maxLength: 90 } as const;

const KEYFRAMES = {
  type: 'array',
  minItems: 1,
  maxItems: 8,
  items: {
    type: 'object',
    required: ['t'],
    additionalProperties: false,
    properties: {
      t: { type: 'number', minimum: 0, maximum: 1 },
      x: { type: 'number', minimum: 0, maximum: 1 },
      y: { type: 'number', minimum: 0, maximum: 1 },
      scale: { type: 'number', minimum: 0.1, maximum: 4 },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      rotation: { type: 'number', minimum: -180, maximum: 180 },
    },
  },
} as const;

export const addOverlay: Capability = {
  id: 'add_overlay',
  version: '1.0.0',
  name: 'Add an overlay',
  category: 'overlay',
  description: 'Add a title, price card, spec pill, lower third, CTA or logo with optional animation.',
  params: {
    type: 'object',
    required: ['kind', 'inSec', 'outSec'],
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: KINDS },
      text: TEXT,
      subtext: TEXT,
      inSec: { type: 'number', minimum: 0, maximum: 120 },
      outSec: { type: 'number', minimum: 0, maximum: 120 },
      anchor: { type: 'string', enum: [...ANCHORS] },
      style: { type: 'string', enum: [...STYLES] },
      animation: { type: 'string', enum: [...ANIMATIONS] },
      exitAnimation: { type: 'string', enum: [...EXITS] },
      maxWidthPct: { type: 'number', minimum: 10, maximum: 100 },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      rotation: { type: 'number', minimum: -180, maximum: 180 },
      keyframes: KEYFRAMES,
      font: {
        type: 'object',
        additionalProperties: false,
        properties: {
          family: { type: 'string', minLength: 1, maxLength: 64 },
          weight: { type: 'number', minimum: 100, maximum: 900 },
          sizePx: { type: 'number', minimum: 10, maximum: 200 },
        },
      },
      background: {
        type: 'object',
        additionalProperties: false,
        properties: {
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          opacity: { type: 'number', minimum: 0, maximum: 1 },
          radiusPx: { type: 'number', minimum: 0, maximum: 64 },
        },
      },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['remotion', 'ffmpeg'],
  preview: true,
  docs: 'Windows must sit inside the film; the renderer keeps text inside the profile safe area.',
  apply(edl, params) {
    const total = timelineDuration(edl.clips);
    const inSec = round3(Number(params.inSec));
    const outSec = round3(Number(params.outSec));
    if (outSec <= inSec) return fail('/outSec', 'E_CAPABILITY_PARAM', 'outSec must be after inSec.');
    if (outSec > total + 0.001) return fail('/outSec', 'E_CAPABILITY_PARAM', `The film is ${round3(total)}s long.`);
    if (inSec < 0) return fail('/inSec', 'E_CAPABILITY_PARAM', 'inSec cannot be negative.');

    const kind = params.kind as OverlayKind;
    const style = (typeof params.style === 'string' ? params.style : defaultStyleFor(kind)) as (typeof STYLES)[number];
    const overlay: Overlay = {
      id: nextOverlayId(edl),
      kind,
      ...(typeof params.text === 'string' ? { text: params.text } : {}),
      ...(typeof params.subtext === 'string' ? { subtext: params.subtext } : {}),
      inSec,
      outSec,
      anchor: (typeof params.anchor === 'string' ? params.anchor : 'bottom_center') as (typeof ANCHORS)[number],
      style,
      maxWidthPct: typeof params.maxWidthPct === 'number' ? round3(params.maxWidthPct) : 84,
      opacity: typeof params.opacity === 'number' ? round3(params.opacity) : 1,
      animation: (typeof params.animation === 'string' ? params.animation : 'fade') as (typeof ANIMATIONS)[number],
      ...(typeof params.exitAnimation === 'string' ? { exitAnimation: params.exitAnimation as (typeof EXITS)[number] } : {}),
      ...(typeof params.color === 'string' ? { color: params.color } : {}),
      ...(typeof params.rotation === 'number' ? { rotation: round3(params.rotation) } : {}),
      ...(Array.isArray(params.keyframes) ? { keyframes: params.keyframes as Overlay['keyframes'] } : {}),
      ...(params.font !== undefined ? { font: params.font as Overlay['font'] } : {}),
      ...(params.background !== undefined ? { background: params.background as Overlay['background'] } : {}),
    };
    return {
      ok: true,
      edl: { ...edl, overlays: [...edl.overlays, overlay] },
      summary: `Added a ${kind} overlay (${inSec}–${outSec}s).`,
    };
  },
};

function defaultStyleFor(kind: OverlayKind): string {
  switch (kind) {
    case 'price': return 'price_lower';
    case 'spec_row': return 'spec_pill';
    case 'address': return 'address_tag';
    case 'logo': return 'logo_corner';
    case 'cta': return 'cta_card';
    case 'disclaimer': return 'small_print';
    default: return 'caption';
  }
}

export const updateOverlay: Capability = {
  id: 'update_overlay',
  version: '1.0.0',
  name: 'Update an overlay',
  category: 'overlay',
  description: 'Change an overlay’s text, timing, style, animation or keyframes.',
  params: {
    type: 'object',
    required: ['overlayId'],
    additionalProperties: false,
    properties: {
      overlayId: { type: 'string', minLength: 1, maxLength: 64 },
      text: TEXT,
      subtext: TEXT,
      inSec: { type: 'number', minimum: 0, maximum: 120 },
      outSec: { type: 'number', minimum: 0, maximum: 120 },
      anchor: { type: 'string', enum: [...ANCHORS] },
      style: { type: 'string', enum: [...STYLES] },
      animation: { type: 'string', enum: [...ANIMATIONS] },
      exitAnimation: { type: 'string', enum: [...EXITS] },
      maxWidthPct: { type: 'number', minimum: 10, maximum: 100 },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      rotation: { type: 'number', minimum: -180, maximum: 180 },
      keyframes: KEYFRAMES,
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['remotion', 'ffmpeg'],
  preview: true,
  docs: 'Only listed fields change; omitted fields keep their current value.',
  apply(edl, params) {
    const id = String(params.overlayId);
    const index = edl.overlays.findIndex((overlay) => overlay.id === id);
    if (index < 0) return fail('/overlayId', 'E_CAPABILITY_TARGET', `No overlay "${id}".`);
    const current = edl.overlays[index]!;
    const next: Overlay = { ...current };
    for (const key of ['text', 'subtext', 'anchor', 'style', 'animation', 'exitAnimation', 'color'] as const) {
      const value = params[key];
      if (typeof value === 'string') (next as unknown as Record<string, unknown>)[key] = value;
    }
    for (const key of ['inSec', 'outSec', 'maxWidthPct', 'opacity', 'rotation'] as const) {
      const value = params[key];
      if (typeof value === 'number') (next as unknown as Record<string, unknown>)[key] = round3(value);
    }
    if (Array.isArray(params.keyframes)) next.keyframes = params.keyframes as Overlay['keyframes'];
    if (next.outSec <= next.inSec) return fail('/outSec', 'E_CAPABILITY_PARAM', 'outSec must be after inSec.');
    const total = timelineDuration(edl.clips);
    if (next.outSec > total + 0.001) return fail('/outSec', 'E_CAPABILITY_PARAM', `The film is ${round3(total)}s long.`);
    const overlays = [...edl.overlays];
    overlays[index] = next;
    return { ok: true, edl: { ...edl, overlays }, summary: `Updated ${id}.` };
  },
};

export const removeOverlay: Capability = {
  id: 'remove_overlay',
  version: '1.0.0',
  name: 'Remove an overlay',
  category: 'overlay',
  description: 'Remove an overlay, keeping the mandatory price and disclaimer.',
  params: {
    type: 'object',
    required: ['overlayId'],
    additionalProperties: false,
    properties: { overlayId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  risk: 'medium',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'The last price card and the last disclaimer cannot be removed through the agent.',
  apply(edl, params) {
    const id = String(params.overlayId);
    const found = edl.overlays.find((overlay) => overlay.id === id);
    if (found === undefined) return fail('/overlayId', 'E_CAPABILITY_TARGET', `No overlay "${id}".`);
    const required = found.kind === 'price' || found.kind === 'disclaimer';
    if (required && edl.overlays.filter((overlay) => overlay.kind === found.kind).length <= 1) {
      return fail(
        '/overlayId',
        'E_CAPABILITY_GUARDRAIL',
        `The only ${found.kind} overlay cannot be removed. Change it instead.`,
      );
    }
    return {
      ok: true,
      edl: { ...edl, overlays: edl.overlays.filter((overlay) => overlay.id !== id) },
      summary: `Removed ${id}.`,
    };
  },
};
