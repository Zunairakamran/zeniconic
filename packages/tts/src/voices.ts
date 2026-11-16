import type { Engine, Language, Voice } from './types';

/**
 * The voice bank.
 *
 * Kokoro-82M is licensed under Apache-2.0. It runs locally on CPU, costs nothing
 * per character and is safe for commercial listing work, so it is the default
 * English bank. Nine Kokoro voices ship in the default set; the tenth English
 * entry is the optional ElevenLabs voice, which needs a paid commercial licence
 * and is therefore not free to use and not the default.
 *
 * Arabic is split between SILMA TTS (bilingual AR/EN, open source) and Qwen3-TTS
 * (open source). Two voices from each engine cover Gulf-neutral and
 * Levantine-neutral male and female reads. XTTS is deliberately absent: its
 * Coqui Public Model Licence is not a commercial grant.
 *
 * IDs are kebab-case and stable. They are part of the preview cache key, so
 * renaming one invalidates its cached preview.
 */
export const VOICES: readonly Voice[] = [
  // English — en-GB (Kokoro bf_/bm_ voices, Apache-2.0)
  {
    id: 'emma-gb',
    name: 'Emma',
    language: 'en-GB',
    gender: 'female',
    engine: 'kokoro',
    tone: 'warm, clear, unhurried',
    commercialUse: true,
  },
  {
    id: 'isabella-gb',
    name: 'Isabella',
    language: 'en-GB',
    gender: 'female',
    engine: 'kokoro',
    tone: 'bright, polished, confident',
    commercialUse: true,
  },
  {
    id: 'george-gb',
    name: 'George',
    language: 'en-GB',
    gender: 'male',
    engine: 'kokoro',
    tone: 'measured, reassuring, editorial',
    commercialUse: true,
  },
  {
    id: 'fable-gb',
    name: 'Fable',
    language: 'en-GB',
    gender: 'male',
    engine: 'kokoro',
    tone: 'relaxed, storytelling, human',
    commercialUse: true,
  },
  // English — en-US (Kokoro af_/am_ voices, Apache-2.0)
  {
    id: 'heart-us',
    name: 'Heart',
    language: 'en-US',
    gender: 'female',
    engine: 'kokoro',
    tone: 'warm, natural, conversational',
    commercialUse: true,
  },
  {
    id: 'bella-us',
    name: 'Bella',
    language: 'en-US',
    gender: 'female',
    engine: 'kokoro',
    tone: 'bright, upbeat, confident',
    commercialUse: true,
  },
  {
    id: 'nicole-us',
    name: 'Nicole',
    language: 'en-US',
    gender: 'female',
    engine: 'kokoro',
    tone: 'soft, intimate, late-evening',
    commercialUse: true,
  },
  {
    id: 'michael-us',
    name: 'Michael',
    language: 'en-US',
    gender: 'male',
    engine: 'kokoro',
    tone: 'calm, trustworthy, plain-spoken',
    commercialUse: true,
  },
  {
    id: 'fenrir-us',
    name: 'Fenrir',
    language: 'en-US',
    gender: 'male',
    engine: 'kokoro',
    tone: 'deep, cinematic, deliberate',
    commercialUse: true,
  },
  // English — optional premium voice. ElevenLabs is paid and requires a
  // commercial licence; it is never the default and is shown with its cost.
  {
    id: 'ava-elevenlabs',
    name: 'Ava (optional)',
    language: 'en-GB',
    gender: 'female',
    engine: 'elevenlabs',
    tone: 'premium, natural; paid licence required',
    commercialUse: false,
  },
  // Arabic — SILMA TTS (open source, commercial use)
  {
    id: 'layla-ar',
    name: 'Layla',
    language: 'ar-AE',
    gender: 'female',
    engine: 'silma',
    tone: 'warm, Gulf-neutral, unhurried',
    commercialUse: true,
  },
  {
    id: 'omar-ar',
    name: 'Omar',
    language: 'ar-AE',
    gender: 'male',
    engine: 'silma',
    tone: 'calm, Gulf-neutral, authoritative',
    commercialUse: true,
  },
  // Arabic — Qwen3-TTS (open source, commercial use)
  {
    id: 'noura-ar',
    name: 'Noura',
    language: 'ar-AE',
    gender: 'female',
    engine: 'qwen3',
    tone: 'bright, Levantine-neutral, modern',
    commercialUse: true,
  },
  {
    id: 'khalid-ar',
    name: 'Khalid',
    language: 'ar-AE',
    gender: 'male',
    engine: 'qwen3',
    tone: 'steady, Levantine-neutral, documentary',
    commercialUse: true,
  },
];

/** Voices for one language, in catalogue order. */
export function voicesFor(language: Language): Voice[] {
  return VOICES.filter((voice) => voice.language === language);
}

/**
 * The first commercially usable voice in a language. English resolves to a
 * Kokoro voice; Arabic resolves to SILMA. The paid ElevenLabs entry is skipped
 * even if it appears first.
 */
export function defaultVoice(language: Language): Voice {
  const candidates = voicesFor(language);
  const preferred =
    candidates.find((voice) => voice.commercialUse && voice.engine !== 'elevenlabs') ??
    candidates.find((voice) => voice.commercialUse) ??
    candidates[0];

  if (preferred === undefined) {
    throw new Error(`No voice is configured for ${language}`);
  }

  return preferred;
}

/** Engines represented in the default bank, useful for a UI licence summary. */
export const ENGINES: readonly Engine[] = ['kokoro', 'silma', 'qwen3', 'elevenlabs'];
