/**
 * The voices the studio can speak with, in one place.
 *
 * The list is deliberately provider-neutral: the id is what the renderer
 * stores (`settings.json`), what the speech request sends and what the sample
 * file is named. `matilda` is first and is the default because a warm British
 * female is the house voice for property walkthroughs.
 *
 * This module must stay free of Node imports: the sandboxed preload and the
 * Settings screen both read it.
 */

export type VoiceGender = 'female' | 'male' | 'non-binary';

export interface VoiceMeta {
  /** Stable slug; also the bundled sample's filename stem. */
  id: string;
  /** Display name, e.g. `Matilda`. */
  name: string;
  /** Plain-language accent, e.g. `British`. */
  accent: string;
  /** Short tags shown as chips on the gallery card. */
  tone: readonly string[];
  gender: VoiceGender;
}

/** The house voice. Every default and fallback points here. */
export const DEFAULT_VOICE_ID = 'matilda';

/**
 * The full catalogue: eight curated voices (six female, two male) that ship a
 * sample, then the remaining thirteen available over the API.
 */
export const VOICE_CATALOG: readonly VoiceMeta[] = Object.freeze([
  Object.freeze({
    id: 'matilda',
    name: 'Matilda',
    accent: 'British',
    tone: Object.freeze(['warm', 'calm', 'refined']),
    gender: 'female' as const,
  }),
  Object.freeze({
    id: 'sarah',
    name: 'Sarah',
    accent: 'American',
    tone: Object.freeze(['soft', 'friendly', 'clear']),
    gender: 'female' as const,
  }),
  Object.freeze({
    id: 'alice',
    name: 'Alice',
    accent: 'British',
    tone: Object.freeze(['confident', 'bright', 'crisp']),
    gender: 'female' as const,
  }),
  Object.freeze({
    id: 'bella',
    name: 'Bella',
    accent: 'American',
    tone: Object.freeze(['warm', 'gentle', 'intimate']),
    gender: 'female' as const,
  }),
  Object.freeze({
    id: 'jessica',
    name: 'Jessica',
    accent: 'American',
    tone: Object.freeze(['expressive', 'upbeat', 'social']),
    gender: 'female' as const,
  }),
  Object.freeze({
    id: 'lily',
    name: 'Lily',
    accent: 'British',
    tone: Object.freeze(['warm', 'youthful', 'bright']),
    gender: 'female' as const,
  }),
  Object.freeze({
    id: 'george',
    name: 'George',
    accent: 'British',
    tone: Object.freeze(['warm', 'assured', 'measured']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'daniel',
    name: 'Daniel',
    accent: 'British',
    tone: Object.freeze(['authoritative', 'crisp', 'newsreader']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'adam',
    name: 'Adam',
    accent: 'American',
    tone: Object.freeze(['deep', 'steady']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'bill',
    name: 'Bill',
    accent: 'American',
    tone: Object.freeze(['mature', 'plain-spoken']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'brian',
    name: 'Brian',
    accent: 'American',
    tone: Object.freeze(['deep', 'resonant']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'callum',
    name: 'Callum',
    accent: 'British',
    tone: Object.freeze(['gravelly', 'characterful']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'charlie',
    name: 'Charlie',
    accent: 'Australian',
    tone: Object.freeze(['natural', 'unhurried']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'chris',
    name: 'Chris',
    accent: 'American',
    tone: Object.freeze(['casual', 'conversational']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'eric',
    name: 'Eric',
    accent: 'American',
    tone: Object.freeze(['friendly', 'even']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'harry',
    name: 'Harry',
    accent: 'British',
    tone: Object.freeze(['mature', 'dry']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'laura',
    name: 'Laura',
    accent: 'American',
    tone: Object.freeze(['upbeat', 'bright']),
    gender: 'female' as const,
  }),
  Object.freeze({
    id: 'liam',
    name: 'Liam',
    accent: 'American',
    tone: Object.freeze(['young', 'energetic']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'river',
    name: 'River',
    accent: 'American',
    tone: Object.freeze(['neutral', 'calm']),
    gender: 'non-binary' as const,
  }),
  Object.freeze({
    id: 'roger',
    name: 'Roger',
    accent: 'American',
    tone: Object.freeze(['mature', 'relaxed']),
    gender: 'male' as const,
  }),
  Object.freeze({
    id: 'will',
    name: 'Will',
    accent: 'American',
    tone: Object.freeze(['friendly', 'wry']),
    gender: 'male' as const,
  }),
]);

/** The eight voices that ship a bundled sample, in gallery order. */
export const CURATED_VOICE_IDS: readonly string[] = Object.freeze([
  'matilda',
  'sarah',
  'alice',
  'bella',
  'jessica',
  'lily',
  'george',
  'daniel',
]);

export const VOICE_IDS: readonly string[] = Object.freeze(
  VOICE_CATALOG.map((voice) => voice.id),
);

const BY_ID = new Map(VOICE_CATALOG.map((voice) => [voice.id, voice]));

export function isVoiceId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

export function voiceById(id: string): VoiceMeta | undefined {
  return BY_ID.get(id);
}

/** True for a voice whose bundled sample should exist on disk. */
export function isCuratedVoice(id: string): boolean {
  return CURATED_VOICE_IDS.includes(id);
}

/** The one line every bundled sample speaks. */
export const SAMPLE_LINE =
  'Some mornings, the city is still asleep. This is above it.';
