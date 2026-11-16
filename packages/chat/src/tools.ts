/**
 * The model-facing tool registry.
 *
 * The chat has no intent enum. It composes these typed primitives over the
 * EDL, and the system prompt is generated from this registry so the model
 * always sees the current surface.
 */

export type ToolName =
  | 'read_edl'
  | 'list_shots'
  | 'patch_edl'
  | 'set_look'
  | 'set_music'
  | 'set_captions'
  | 'set_voice'
  | 'set_profile'
  | 'regenerate_variant'
  | 'preview'
  | 'render'
  | 'explain';

export interface ToolDefinition {
  name: ToolName;
  /** Model-facing description. One sentence, plain language. */
  description: string;
  /** JSON Schema for the arguments object. */
  inputSchema: object;
  mutates: boolean;
  latency: 'instant' | 'draft' | 'render';
}

const ROOMS = [
  'exterior',
  'building',
  'entry',
  'living',
  'kitchen',
  'dining',
  'bedroom',
  'bathroom',
  'balcony',
  'view',
  'amenity',
  'unknown',
] as const;

const REVIEW_CHECKS = [
  'duration',
  'no_black_frames',
  'no_freeze',
  'text_safe_area',
  'cta_legible',
  'room_order',
  'loudness',
  'no_repeated_shot',
  'hook_visible',
  'facts_present',
] as const;

const PROFILES = ['vertical-social', 'feed-portrait', 'landscape', 'pin'] as const;

const readEdlSchema = {
  type: 'object',
  properties: {
    include: {
      type: 'array',
      description: 'Sections to return; omit for the full editing view.',
      items: {
        type: 'string',
        enum: ['timeline', 'shots', 'overlays', 'audio', 'captions'],
      },
      uniqueItems: true,
      maxItems: 5,
    },
  },
  additionalProperties: false,
};

const listShotsSchema = {
  type: 'object',
  properties: {
    rooms: {
      type: 'array',
      description: 'Only return shots tagged with one of these rooms.',
      items: { type: 'string', enum: ROOMS },
      uniqueItems: true,
      maxItems: 12,
    },
    clipIds: {
      type: 'array',
      description: 'Only return these clips.',
      items: { type: 'string', pattern: '^c[0-9]{2,3}$' },
      maxItems: 40,
      uniqueItems: true,
    },
    limit: { type: 'integer', minimum: 1, maximum: 40 },
  },
  additionalProperties: false,
};

const patchEdlSchema = {
  type: 'object',
  properties: {
    ops: {
      type: 'array',
      description: 'RFC 6902 operations against allowlisted EDL paths.',
      minItems: 1,
      maxItems: 20,
      items: {
        oneOf: [
          {
            type: 'object',
            required: ['op', 'path'],
            additionalProperties: false,
            properties: {
              op: { const: 'remove' },
              path: { type: 'string', pattern: '^/' },
            },
          },
          {
            type: 'object',
            required: ['op', 'path', 'value'],
            additionalProperties: false,
            properties: {
              op: { type: 'string', enum: ['add', 'replace'] },
              path: { type: 'string', pattern: '^/' },
              value: {},
            },
          },
        ],
      },
    },
  },
  required: ['ops'],
  additionalProperties: false,
};

const setLookSchema = {
  type: 'object',
  properties: {
    lookId: { type: 'string', enum: ['calm', 'social', 'walkthrough', 'editorial'] },
  },
  required: ['lookId'],
  additionalProperties: false,
};

const setMusicSchema = {
  type: 'object',
  properties: {
    trackId: { type: 'string', minLength: 1, maxLength: 64 },
    gainDb: { type: 'number', minimum: -40, maximum: 12 },
    duckUnderVoiceDb: { type: 'number', minimum: -30, maximum: 0 },
    snapCutsToBeat: { type: 'boolean' },
  },
  required: ['trackId'],
  additionalProperties: false,
};

const setCaptionsSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['burn', 'sidecar', 'both', 'none'] },
    style: { type: 'string', enum: ['clean_lower', 'bold_center', 'editorial_serif'] },
    language: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' },
    wordEdits: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['index', 'text'],
        additionalProperties: false,
        properties: {
          index: { type: 'integer', minimum: 0 },
          text: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  },
  required: ['mode'],
  additionalProperties: false,
};

const setVoiceSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['keep', 'clean', 'replace_tts', 'mute'] },
    voiceId: { type: 'string', minLength: 1, maxLength: 64 },
    text: { type: 'string', maxLength: 1200 },
    enhance: {
      type: 'object',
      additionalProperties: false,
      properties: {
        denoise: { type: 'boolean' },
        dereverb: { type: 'boolean' },
        isolate: { type: 'boolean' },
        deess: { type: 'boolean' },
      },
    },
  },
  required: ['mode'],
  additionalProperties: false,
};

const setProfileSchema = {
  type: 'object',
  properties: {
    profile: { type: 'string', enum: PROFILES },
    safeArea: {
      type: 'object',
      required: ['top', 'bottom', 'left', 'right'],
      additionalProperties: false,
      properties: {
        top: { type: 'integer', minimum: 0, maximum: 4096 },
        bottom: { type: 'integer', minimum: 0, maximum: 4096 },
        left: { type: 'integer', minimum: 0, maximum: 4096 },
        right: { type: 'integer', minimum: 0, maximum: 4096 },
      },
    },
  },
  required: ['profile'],
  additionalProperties: false,
};

const regenerateVariantSchema = {
  type: 'object',
  properties: {
    seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
    keepLook: { type: 'boolean' },
    keepMusic: { type: 'boolean' },
  },
  required: ['seed'],
  additionalProperties: false,
};

const previewSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['stills', 'draft'] },
    clipId: { type: 'string', pattern: '^c[0-9]{2,3}$' },
    offsetSec: { type: 'number', minimum: 0 },
  },
  required: ['mode', 'clipId', 'offsetSec'],
  additionalProperties: false,
};

const renderSchema = {
  type: 'object',
  properties: {
    profile: { type: 'string', enum: PROFILES },
    dryRun: { type: 'boolean' },
    confirmOverBudget: { type: 'boolean' },
  },
  required: ['profile'],
  additionalProperties: false,
};

const explainSchema = {
  type: 'object',
  properties: {
    subject: {
      type: 'string',
      enum: ['shot', 'check', 'duration', 'music', 'captions', 'look'],
    },
    clipId: { type: 'string', pattern: '^c[0-9]{2,3}$' },
    checkId: { type: 'string', enum: REVIEW_CHECKS },
    question: { type: 'string', maxLength: 200 },
  },
  required: ['subject'],
  additionalProperties: false,
};

/**
 * Exactly twelve tools. Order is the order the model sees them in.
 */
export const TOOLS: readonly ToolDefinition[] = Object.freeze([
  {
    name: 'read_edl',
    description: 'Return the current edit, its shot list and a timeline summary.',
    inputSchema: readEdlSchema,
    mutates: false,
    latency: 'instant',
  },
  {
    name: 'list_shots',
    description: 'List indexed shots with their room, score, duration and selection reason.',
    inputSchema: listShotsSchema,
    mutates: false,
    latency: 'instant',
  },
  {
    name: 'patch_edl',
    description:
      'Apply an allowlisted JSON Patch changeset and return the validated edit with its diff.',
    inputSchema: patchEdlSchema,
    mutates: true,
    latency: 'instant',
  },
  {
    name: 'set_look',
    description: 'Change the typography, pacing and transition vocabulary by choosing a look.',
    inputSchema: setLookSchema,
    mutates: true,
    latency: 'instant',
  },
  {
    name: 'set_music',
    description: 'Change the music track, gain and ducking, then re-snap cuts to its beat grid.',
    inputSchema: setMusicSchema,
    mutates: true,
    latency: 'instant',
  },
  {
    name: 'set_captions',
    description: 'Change the caption mode, style, language or individual words.',
    inputSchema: setCaptionsSchema,
    mutates: true,
    latency: 'instant',
  },
  {
    name: 'set_voice',
    description: 'Change the voiceover mode, voice and script text.',
    inputSchema: setVoiceSchema,
    mutates: true,
    latency: 'instant',
  },
  {
    name: 'set_profile',
    description: 'Change the canvas and safe area, which triggers a new reframe plan.',
    inputSchema: setProfileSchema,
    mutates: true,
    latency: 'instant',
  },
  {
    name: 'regenerate_variant',
    description: 'Build a fresh variant from the same listing and creative constraints.',
    inputSchema: regenerateVariantSchema,
    mutates: true,
    latency: 'instant',
  },
  {
    name: 'preview',
    description: 'Show three stills or an eight-second draft at a point inside one shot.',
    inputSchema: previewSchema,
    mutates: false,
    latency: 'draft',
  },
  {
    name: 'render',
    description: 'Render the current edit at a render profile after checking the budget.',
    inputSchema: renderSchema,
    mutates: false,
    latency: 'render',
  },
  {
    name: 'explain',
    description: 'Explain why a shot or review check produced its result, citing scores and alternatives.',
    inputSchema: explainSchema,
    mutates: false,
    latency: 'instant',
  },
]);

/**
 * OpenAI/OpenRouter-style function manifest. Schemas are cloned so a caller
 * cannot mutate the registry through the manifest.
 */
export function toolManifest(): Array<{
  name: string;
  description: string;
  parameters: object;
}> {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: structuredClone(tool.inputSchema),
  }));
}
