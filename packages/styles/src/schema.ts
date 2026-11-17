/**
 * JSON Schema for a style pack (version 1).
 *
 * The editor-facing values are validated against this schema before the pack is
 * allowed into the registry. Ranges here are deliberately wider than the
 * applied limits: a pack may ask for a 9 s transition or a 0.1 s shot, and
 * `applyStyle` clamps it to the render-safe envelope. Anything structurally
 * wrong fails at load time.
 */

import type {
  CaptionMode,
  CaptionStyle,
  OverlayAnimation,
  OverlayStyle,
  TransitionType,
} from '@zeniconic/edl';

/**
 * These lists mirror the EDL schema enums. `packages/styles/test` asserts they
 * stay in sync, so a schema bump fails a test rather than producing an EDL the
 * renderer cannot read.
 */
export const TRANSITION_TYPES: readonly TransitionType[] = [
  'cut',
  'dissolve',
  'slide',
  'whip',
  'zoom_blur',
  'luma_wipe',
  'light_leak',
  'dip_black',
  'dip_white',
  'blur',
  'directional_blur',
  'push_left',
  'push_right',
  'circle',
  'wipe',
  'glitch',
];

export const OVERLAY_STYLES: readonly OverlayStyle[] = [
  'price_lower',
  'spec_pill',
  'address_tag',
  'logo_corner',
  'cta_card',
  'caption',
  'small_print',
];

export const OVERLAY_ANIMATIONS: readonly OverlayAnimation[] = [
  'none',
  'fade',
  'rise',
  'slide_in',
  'count_up',
  'pop',
  'typewriter',
  'tracking_in',
  'blur_in',
  'scale_in',
];

export const CAPTION_MODES: readonly CaptionMode[] = ['burn', 'sidecar', 'both', 'none'];

export const CAPTION_STYLES: readonly CaptionStyle[] = [
  'clean_lower',
  'bold_center',
  'editorial_serif',
  'social_bold',
  'clean_reel',
  'editorial',
];

export const STYLE_SCHEMA: object = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://zeniconic.app/schema/style-pack-1.0.0.json',
  title: 'Zeniconic style pack',
  description:
    'Pacing, transitions, overlays, captions, music character and colour for one look.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'id', 'label', 'pacing', 'transitions', 'overlays', 'captions', 'music', 'color'],
  properties: {
    version: { const: 1 },
    id: {
      type: 'string',
      pattern: '^[a-z][a-z0-9-]*$',
      minLength: 1,
      maxLength: 48,
    },
    label: { type: 'string', minLength: 1, maxLength: 60 },
    pacing: {
      type: 'object',
      additionalProperties: false,
      required: ['minShotSec', 'maxShotSec', 'targetAvgShotSec'],
      properties: {
        minShotSec: { type: 'number', minimum: 0, maximum: 60 },
        maxShotSec: { type: 'number', minimum: 0, maximum: 60 },
        targetAvgShotSec: { type: 'number', minimum: 0, maximum: 60 },
      },
    },
    transitions: {
      type: 'object',
      additionalProperties: false,
      required: ['in', 'out', 'durationSec', 'everyNthCut'],
      properties: {
        in: { type: 'string', enum: TRANSITION_TYPES },
        out: { type: 'string', enum: TRANSITION_TYPES },
        durationSec: { type: 'number', minimum: 0, maximum: 10 },
        everyNthCut: { type: 'integer', minimum: 1, maximum: 16 },
      },
    },
    overlays: {
      type: 'object',
      additionalProperties: false,
      required: ['price', 'address', 'introAnimation', 'outroAnimation'],
      properties: {
        price: { type: 'string', enum: OVERLAY_STYLES },
        address: { type: 'string', enum: OVERLAY_STYLES },
        roomLabel: { type: 'string', enum: OVERLAY_STYLES },
        introAnimation: { type: 'string', enum: OVERLAY_ANIMATIONS },
        outroAnimation: { type: 'string', enum: OVERLAY_ANIMATIONS },
      },
    },
    captions: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'style'],
      properties: {
        mode: { type: 'string', enum: CAPTION_MODES },
        style: { type: 'string', enum: CAPTION_STYLES },
      },
    },
    music: {
      type: 'object',
      additionalProperties: false,
      required: ['mood', 'energy'],
      properties: {
        mood: { type: 'string', minLength: 1, maxLength: 40 },
        energy: { type: 'integer', minimum: 1, maximum: 5 },
      },
    },
    color: {
      type: 'object',
      additionalProperties: false,
      required: ['saturation', 'contrast', 'warmth'],
      properties: {
        saturation: { type: 'number', minimum: 0, maximum: 3 },
        contrast: { type: 'number', minimum: 0, maximum: 3 },
        warmth: { type: 'number', minimum: -1, maximum: 1 },
      },
    },
  },
};
