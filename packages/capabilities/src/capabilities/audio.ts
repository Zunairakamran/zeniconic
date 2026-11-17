import type { VoiceMode } from '@zeniconic/edl';
import { fail, round3, timelineDuration } from '../helpers';
import type { Capability } from '../types';

const VOICE_MODES: VoiceMode[] = ['keep', 'clean', 'replace_tts', 'mute'];

export const setMusic: Capability = {
  id: 'set_music',
  version: '1.0.0',
  name: 'Set the music bed',
  category: 'audio',
  description: 'Change the track, gain, ducking or licence metadata of the music bed.',
  params: {
    type: 'object',
    additionalProperties: false,
    properties: {
      trackId: { type: 'string', minLength: 1, maxLength: 80 },
      src: { type: 'string', maxLength: 500 },
      gainDb: { type: 'number', minimum: -60, maximum: 0 },
      duckUnderVoiceDb: { type: 'number', minimum: -40, maximum: 0 },
      beatGrid: { type: 'array', maxItems: 2000, items: { type: 'number', minimum: 0, maximum: 600 } },
    },
  },
  risk: 'low',
  cost: 'free',
  backends: ['edl', 'native'],
  preview: false,
  requires: ['ffmpeg'],
  docs: 'Setting src to an empty string removes the bed. Licensed delivery still needs a cleared track.',
  apply(edl, params) {
    const total = timelineDuration(edl.clips);
    const src = typeof params.src === 'string' ? params.src.trim() : edl.audio.music.src;
    const trackId = typeof params.trackId === 'string' ? params.trackId.trim() : edl.audio.music.trackId;
    if (src.length === 0 && trackId.length === 0) {
      return fail('/', 'E_CAPABILITY_PARAM', 'A music change needs a trackId or a src.');
    }
    const beatGrid = Array.isArray(params.beatGrid)
      ? (params.beatGrid as number[]).map(round3).filter((beat) => beat >= 0 && beat < Math.max(total, 90))
      : edl.audio.music.beatGrid;
    return {
      ok: true,
      edl: {
        ...edl,
        audio: {
          ...edl.audio,
          music: {
            ...edl.audio.music,
            trackId,
            src,
            ...(typeof params.gainDb === 'number' ? { gainDb: round3(params.gainDb) } : {}),
            ...(typeof params.duckUnderVoiceDb === 'number' ? { duckUnderVoiceDb: round3(params.duckUnderVoiceDb) } : {}),
            beatGrid: [...beatGrid],
          },
        },
      },
      summary: `Music set to ${trackId || src}${typeof params.gainDb === 'number' ? ` at ${round3(params.gainDb)} dB` : ''}.`,
    };
  },
};

export const setAudioFades: Capability = {
  id: 'set_audio_fades',
  version: '1.0.0',
  name: 'Set audio fades',
  category: 'audio',
  description: 'Fade the music in and out at the head and tail of the film.',
  params: {
    type: 'object',
    additionalProperties: false,
    properties: {
      fadeInSec: { type: 'number', minimum: 0, maximum: 5 },
      fadeOutSec: { type: 'number', minimum: 0, maximum: 5 },
    },
  },
  risk: 'low',
  cost: 'free',
  backends: ['native'],
  preview: false,
  requires: ['ffmpeg'],
  docs: 'Fades apply to the mastered bed, not to the voice track.',
  apply(edl, params) {
    const total = timelineDuration(edl.clips);
    const fadeIn = typeof params.fadeInSec === 'number' ? round3(params.fadeInSec) : (edl.audio.fadeInSec ?? 0);
    const fadeOut = typeof params.fadeOutSec === 'number' ? round3(params.fadeOutSec) : (edl.audio.fadeOutSec ?? 0);
    if (fadeIn + fadeOut > total + 0.001) {
      return fail('/', 'E_CAPABILITY_PARAM', `Fades (${fadeIn + fadeOut}s) cannot be longer than the film (${round3(total)}s).`);
    }
    return {
      ok: true,
      edl: { ...edl, audio: { ...edl.audio, fadeInSec: fadeIn, fadeOutSec: fadeOut } },
      summary: `Audio fades: ${fadeIn}s in, ${fadeOut}s out.`,
    };
  },
};

export const setVoice: Capability = {
  id: 'set_voice',
  version: '1.0.0',
  name: 'Set the voice track',
  category: 'audio',
  description: 'Keep, clean, replace or mute the spoken track, and edit the script.',
  params: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: VOICE_MODES },
      text: { type: 'string', maxLength: 2000 },
      voiceId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  risk: 'medium',
  cost: 'cheap',
  backends: ['native'],
  preview: false,
  requires: ['tts'],
  docs: 'replace_tts spends a TTS call unless the line is cached; the export asks for approval when the cap is at risk.',
  apply(edl, params) {
    const mode = params.mode === undefined ? edl.audio.voice.mode : (String(params.mode) as VoiceMode);
    if (!VOICE_MODES.includes(mode)) return fail('/mode', 'E_CAPABILITY_PARAM', `Unknown voice mode "${String(params.mode)}".`);
    const text = typeof params.text === 'string' ? params.text.trim() : edl.audio.voice.text;
    if (mode === 'replace_tts' && (text === undefined || text.length === 0)) {
      return fail('/text', 'E_CAPABILITY_GUARDRAIL', 'A replacement voice needs a script.');
    }
    return {
      ok: true,
      edl: {
        ...edl,
        audio: {
          ...edl.audio,
          voice: {
            ...edl.audio.voice,
            mode,
            ...(text === undefined ? {} : { text }),
            ...(typeof params.voiceId === 'string' ? { voiceId: params.voiceId } : {}),
          },
        },
      },
      summary:
        mode === 'replace_tts'
          ? 'Voice will be synthesised from the script.'
          : mode === 'mute'
            ? 'Spoken track muted; music only.'
            : `Voice mode set to ${mode}.`,
    };
  },
};

export { VOICE_MODES };
