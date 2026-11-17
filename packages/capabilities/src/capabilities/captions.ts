import type { CaptionWord, TextAnimation } from '@zeniconic/edl';
import { fail, round3, timelineDuration, withClips } from '../helpers';
import type { Capability } from '../types';

const STYLES = ['clean_lower', 'bold_center', 'editorial_serif', 'social_bold', 'clean_reel', 'editorial'] as const;
const ANIMATIONS: TextAnimation[] = [
  'none', 'fade', 'rise', 'slide_in', 'pop', 'typewriter',
  'word_by_word', 'tracking_in', 'blur_in', 'scale_in',
];
const MODES = ['burn', 'sidecar', 'both', 'none'] as const;

export const setCaptionStyle: Capability = {
  id: 'set_caption_style',
  version: '1.0.0',
  name: 'Set caption style',
  category: 'caption',
  description: 'Choose the caption look: style, font, size, box and position.',
  params: {
    type: 'object',
    additionalProperties: false,
    properties: {
      style: { type: 'string', enum: [...STYLES] },
      font: {
        type: 'object',
        additionalProperties: false,
        properties: {
          family: { type: 'string', minLength: 1, maxLength: 64 },
          weight: { type: 'number', minimum: 100, maximum: 900 },
          sizePx: { type: 'number', minimum: 12, maximum: 160 },
          uppercase: { type: 'boolean' },
        },
      },
      box: {
        type: 'object',
        additionalProperties: false,
        properties: {
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          opacity: { type: 'number', minimum: 0, maximum: 1 },
          radiusPx: { type: 'number', minimum: 0, maximum: 64 },
        },
      },
      position: {
        type: 'object',
        additionalProperties: false,
        properties: {
          anchor: { type: 'string', enum: ['bottom_center', 'center', 'top_center'] },
          offsetPx: { type: 'number', minimum: 0, maximum: 600 },
        },
      },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['remotion', 'ffmpeg'],
  preview: true,
  docs: 'Fonts must be bundled or system-safe; unknown families fall back in the renderer with a warning.',
  apply(edl, params) {
    const captions = { ...edl.captions };
    if (typeof params.style === 'string') captions.style = params.style as (typeof STYLES)[number];
    if (params.font !== undefined) captions.font = { ...(captions.font ?? {}), ...(params.font as object) };
    if (params.box !== undefined) captions.box = { ...(captions.box ?? {}), ...(params.box as object) };
    if (params.position !== undefined) captions.position = { ...(captions.position ?? {}), ...(params.position as object) };
    return { ok: true, edl: { ...edl, captions }, summary: 'Updated the caption style.' };
  },
};

export const setCaptionAnimation: Capability = {
  id: 'set_caption_animation',
  version: '1.0.0',
  name: 'Set caption animation',
  category: 'caption',
  description: 'Animate captions: word-by-word, typewriter, pop, tracking, blur or scale.',
  params: {
    type: 'object',
    required: ['animation'],
    additionalProperties: false,
    properties: {
      animation: { type: 'string', enum: ANIMATIONS },
      maxWordsPerLine: { type: 'number', minimum: 1, maximum: 8 },
      maxLines: { type: 'number', minimum: 1, maximum: 3 },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['remotion', 'ffmpeg'],
  preview: true,
  docs: 'Word-by-word and typewriter need word timings; the planner/caption stage supplies them.',
  apply(edl, params) {
    if ((edl.captions.words ?? []).length === 0 && params.animation !== 'none') {
      return fail(
        '/animation',
        'E_CAPABILITY_GUARDRAIL',
        'This edit has no caption word timings yet; transcribe or set caption words first.',
      );
    }
    const captions = {
      ...edl.captions,
      animation: params.animation as TextAnimation,
      ...(typeof params.maxWordsPerLine === 'number' ? { maxWordsPerLine: Math.round(params.maxWordsPerLine) } : {}),
      ...(typeof params.maxLines === 'number' ? { maxLines: Math.round(params.maxLines) } : {}),
    };
    return { ok: true, edl: { ...edl, captions }, summary: `Captions now animate with "${String(params.animation)}".` };
  },
};

export const setCaptionMode: Capability = {
  id: 'set_caption_mode',
  version: '1.0.0',
  name: 'Set caption mode',
  category: 'caption',
  description: 'Burn captions in, write a sidecar, both, or none.',
  params: {
    type: 'object',
    required: ['mode'],
    additionalProperties: false,
    properties: { mode: { type: 'string', enum: [...MODES] } },
  },
  risk: 'low',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'The export screen still owns the final caption choice; this sets the project default.',
  apply(edl, params) {
    return {
      ok: true,
      edl: { ...edl, captions: { ...edl.captions, mode: params.mode as (typeof MODES)[number] } },
      summary: `Captions set to ${String(params.mode)}.`,
    };
  },
};

export const upsertCaptionWords: Capability = {
  id: 'upsert_caption_words',
  version: '1.0.0',
  name: 'Set caption words',
  category: 'caption',
  description: 'Replace the caption word timings (from a transcript or a manual script).',
  params: {
    type: 'object',
    required: ['words'],
    additionalProperties: false,
    properties: {
      words: {
        type: 'array',
        minItems: 1,
        maxItems: 2000,
        items: {
          type: 'object',
          required: ['text', 'startSec', 'endSec'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 80 },
            startSec: { type: 'number', minimum: 0, maximum: 120 },
            endSec: { type: 'number', minimum: 0, maximum: 120 },
          },
        },
      },
    },
  },
  risk: 'low',
  cost: 'free',
  backends: ['edl'],
  preview: true,
  docs: 'Words must run forwards and not overlap; the EDL validator enforces it.',
  apply(edl, params) {
    const raw = params.words;
    if (!Array.isArray(raw)) return fail('/words', 'E_CAPABILITY_PARAM', 'words must be an array.');
    const total = timelineDuration(edl.clips);
    const words: CaptionWord[] = raw.map((entry) => {
      const word = entry as { text?: unknown; startSec?: unknown; endSec?: unknown };
      return {
        text: String(word.text ?? '').trim(),
        startSec: round3(Number(word.startSec ?? 0)),
        endSec: round3(Number(word.endSec ?? 0)),
      };
    });
    const bad = words.find((word) => word.text.length === 0 || word.endSec <= word.startSec);
    if (bad !== undefined) {
      return fail('/words', 'E_CAPABILITY_PARAM', `Invalid caption word "${bad.text}".`);
    }
    const late = words.find((word) => word.endSec > total + 0.001);
    if (late !== undefined) {
      return fail('/words', 'E_CAPABILITY_PARAM', `"${late.text}" ends past the ${round3(total)}s film.`);
    }
    return {
      ok: true,
      edl: { ...edl, captions: { ...edl.captions, words } },
      summary: `Set ${words.length} caption words.`,
    };
  },
};

export const setCaptionHighlight: Capability = {
  id: 'set_caption_highlight',
  version: '1.0.0',
  name: 'Highlight caption keywords',
  category: 'caption',
  description: 'Colour chosen keywords inside the captions.',
  params: {
    type: 'object',
    required: ['words'],
    additionalProperties: false,
    properties: {
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      words: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 60 } },
    },
  },
  risk: 'low',
  cost: 'render',
  backends: ['remotion', 'ffmpeg'],
  preview: true,
  docs: 'Matching is case-insensitive; words not present in the cues are ignored with a warning.',
  apply(edl, params) {
    const wanted = (params.words as string[]).map((word) => word.trim().toLowerCase()).filter(Boolean);
    const present = new Set((edl.captions.words ?? []).map((word) => word.text.toLowerCase().replace(/[^a-z0-9]/g, '')));
    const matched = wanted.filter((word) => present.has(word.toLowerCase().replace(/[^a-z0-9]/g, '')));
    if (matched.length === 0) {
      return fail('/words', 'E_CAPABILITY_GUARDRAIL', 'None of those words appear in the captions.');
    }
    return {
      ok: true,
      edl: {
        ...edl,
        captions: {
          ...edl.captions,
          highlight: {
            ...(typeof params.color === 'string' ? { color: params.color } : {}),
            words: matched,
          },
        },
      },
      summary: `Highlighting ${matched.join(', ')}.`,
    };
  },
};

export { STYLES, ANIMATIONS, MODES };
export const noop = (edl: Parameters<typeof withClips>[0]) => withClips(edl, edl.clips);
