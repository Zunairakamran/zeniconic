/**
 * The voice stage.
 *
 * One call builds the spoken track for a listing: Kokoro lines for the words
 * no presenter speaks, the presenter's own voice from `out/audio/speech.json`
 * where it exists, a ducked music bed, a −14 LUFS / −1.5 dBTP master, and the
 * captions that follow the placed speech.
 *
 * Everything expensive is behind a seam: the TTS engine and the mixer are
 * injected in tests, and generated lines are cached by text + voice under
 * `data/voice/` so a script tweak only re-renders the changed lines.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toCues } from '../../../packages/captions/src/cues';
import {
  canvasDurationSec,
  resolveCaptionStyle,
  splitLongCues,
  timelineSegments,
} from '../../../packages/overlays/src/index';
import type { Edl } from '../../../packages/edl/src/types';
import { voiceLinePath } from './cache';
import { createFfmpegMixer } from './mixer';
import { buildVoicePlan, presenterWindowForCue } from './plan';
import type { PresenterWindow, ScriptCue, TtsLine } from './plan';
import { createKokoroEngine, DEFAULT_VOICE } from './tts';
import type {
  PresenterClipInput,
  TtsEngine,
  VoiceMixer,
  VoiceTrackInput,
  VoiceTrackResult,
} from './types';
import { trimEdgeSilence, wavDurationSec, writeWavMono16 } from './wav';

/** The shipped bed. docs/AUDIO-VOICE.md: the catchy bed, never the calm one. */
export const DEFAULT_MUSIC_PATH = resolve('data/music/catchy-120.m4a');

/** Script pacing for a text-only EDL: docs/AUDIO-VOICE.md's 2.2 words/second. */
const WORDS_PER_SEC = 2.2;
const SENTENCE_GAP_SEC = 0.12;

interface SpeechEntry {
  startSec: number;
  endSec: number;
  wav?: string;
  transcript?: string;
}

function readSpeech(listingDir: string): Record<string, SpeechEntry> {
  const file = join(listingDir, 'out', 'audio', 'speech.json');
  if (!existsSync(file)) return {};

  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object') return {};

  const result: Record<string, SpeechEntry> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as {
      startSec?: unknown;
      endSec?: unknown;
      wav?: unknown;
      transcript?: unknown;
    };
    if (typeof entry.startSec !== 'number' || typeof entry.endSec !== 'number') continue;
    if (!Number.isFinite(entry.startSec) || !Number.isFinite(entry.endSec)) continue;
    if (entry.endSec <= entry.startSec) continue;

    result[key] = {
      startSec: entry.startSec,
      endSec: entry.endSec,
      ...(typeof entry.wav === 'string' ? { wav: entry.wav } : {}),
      ...(typeof entry.transcript === 'string' ? { transcript: entry.transcript } : {}),
    };
  }

  return result;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Fallback for EDLs that carry a script but no word timings. */
function cuesFromText(text: string, totalSec: number): ScriptCue[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const cues: ScriptCue[] = [];
  let cursor = 0.2;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter((word) => word.length > 0).length;
    const duration = Math.max(1, words / WORDS_PER_SEC);
    const end = Math.min(totalSec, cursor + duration);
    if (end <= cursor) break;

    cues.push({ text: sentence, startSec: round3(cursor), endSec: round3(end) });
    cursor = end + SENTENCE_GAP_SEC;
    if (cursor >= totalSec) break;
  }

  return cues;
}

/**
 * The spoken script, from the EDL's word timings when they exist. Cues are
 * already split to the caption line budget, so one cue is one TTS line and one
 * caption.
 */
export function scriptCues(edl: Edl): ScriptCue[] {
  const totalSec = canvasDurationSec(edl);
  const words = edl.captions.words ?? [];
  if (words.length === 0) {
    return cuesFromText(edl.audio.voice.text ?? '', totalSec);
  }

  const style = resolveCaptionStyle(edl.captions.style);
  const cues = splitLongCues(
    toCues(words, {
      maxCharsPerLine: style.maxCharsPerLine,
      maxLines: style.maxLines,
      language: edl.captions.language ?? 'en-GB',
    }),
    style.maxCharsPerLine,
    style.maxLines,
  );

  return cues
    .map((cue) => ({
      text: cue.lines.join(' ').trim(),
      startSec: cue.startSec,
      endSec: cue.endSec,
    }))
    .filter((cue) => cue.text.length > 0);
}

/**
 * Presenter windows already carrying a real voice:
 *
 * - one per EDL clip listed in `out/audio/speech.json`, placed at the first
 *   caption word after the incoming cut and trimmed to the detected speech;
 * - or the caller's explicit `presenterClips`, which win when present.
 *
 * Anchoring to the first word, not the clip start, matters: the trim includes
 * a little leading room tone, and placing that at the clip start pushes the
 * presenter's last sentence past its own window, where the splitter would
 * hand it back to Kokoro.
 */
export function presenterWindowsFor(
  edl: Edl,
  listingDir: string,
  overrides?: readonly PresenterClipInput[],
): PresenterWindow[] {
  const audioDir = join(listingDir, 'out', 'audio');
  const speech = readSpeech(listingDir);
  const segments = timelineSegments(edl);
  const spans = segments.map((segment, index) => {
    const clip = edl.clips[index];
    const previousEnd = index === 0 ? 0 : (segments[index - 1]?.endSec ?? 0);
    return {
      sourceId: clip?.sourceId ?? '',
      endSec: segment.endSec,
      /**
       * The incoming cut is fully on screen here. A transition overlap means a
       * word starting earlier belongs to the outgoing clip's narration, so the
       * presenter window starts after it.
       */
      floorSec: index === 0 ? segment.startSec : Math.max(segment.startSec, previousEnd),
    };
  });
  const words = edl.captions.words ?? [];

  /** First word spoken after the incoming cut; the span start as a fallback. */
  const firstWordStart = (floorSec: number, endSec: number): number => {
    const first = words.find(
      (word) => word.startSec >= floorSec - 0.05 && word.startSec < endSec,
    );
    return first?.startSec ?? floorSec;
  };

  if (overrides && overrides.length > 0) {
    const windows: PresenterWindow[] = [];
    for (const override of overrides) {
      const entry = speech[override.sourceId];
      const span = spans.find((item) => item.sourceId === override.sourceId);
      const wav = override.wav ?? entry?.wav ?? join(audioDir, `${override.sourceId}.wav`);
      const trimStartSec = override.startSec ?? entry?.startSec ?? 0;
      const trimEndSec =
        override.endSec ??
        entry?.endSec ??
        (existsSync(wav) ? trimStartSec + wavDurationSec(wav) : trimStartSec);
      if (trimEndSec <= trimStartSec) continue;

      const transcript = override.transcript ?? entry?.transcript;
      windows.push({
        sourceId: override.sourceId,
        startSec:
          override.timelineStartSec ??
          (span ? firstWordStart(span.floorSec, span.endSec) : 0),
        trimStartSec,
        trimEndSec,
        wav,
        ...(transcript ? { transcript } : {}),
      });
    }
    return windows;
  }

  const windows: PresenterWindow[] = [];
  for (const span of spans) {
    const entry = speech[span.sourceId];
    if (!entry) continue;
    windows.push({
      sourceId: span.sourceId,
      startSec: firstWordStart(span.floorSec, span.endSec),
      trimStartSec: entry.startSec,
      trimEndSec: entry.endSec,
      wav: entry.wav ?? join(audioDir, `${span.sourceId}.wav`),
      ...(entry.transcript ? { transcript: entry.transcript } : {}),
    });
  }
  return windows;
}

/** The cache file for one line, generating and trimming it on a miss. */
async function synthesiseLine(
  text: string,
  voice: string,
  engine: TtsEngine,
  cacheDir: string,
): Promise<TtsLine> {
  const file = voiceLinePath(cacheDir, text, voice);
  if (existsSync(file) && statSync(file).size > 44) {
    return { wav: file, durationSec: wavDurationSec(file) };
  }

  const audio = await engine.generate(text, { voice });
  if (!(audio.sampleRate > 0)) {
    throw new RangeError(`TTS returned an invalid sample rate for "${text.slice(0, 48)}"`);
  }
  const samples = trimEdgeSilence(audio.samples, audio.sampleRate);
  writeWavMono16(file, samples, audio.sampleRate);
  return { wav: file, durationSec: samples.length / audio.sampleRate };
}

function resolveMusic(music: string | null | undefined): string | null {
  if (music === null) return null;
  if (music === undefined) {
    return existsSync(DEFAULT_MUSIC_PATH) ? DEFAULT_MUSIC_PATH : null;
  }

  const explicit = resolve(music);
  if (!existsSync(explicit)) throw new Error(`Music bed not found: ${explicit}`);
  return explicit;
}

/**
 * Builds the voice track and its captions.
 *
 * Writes `<outDir>/vo.wav`, `<outDir>/voice-track.m4a` and
 * `<outDir>/captions.json` (beside the audio). The returned captions are the
 * same records, in ascending, non-overlapping order.
 */
export async function buildVoiceTrack(input: VoiceTrackInput): Promise<VoiceTrackResult> {
  const listingDir = resolve(input.listingDir);
  const audioDir = join(listingDir, 'out', 'audio');
  const outDir = input.outDir ? resolve(input.outDir) : audioDir;
  const cacheDir = input.cacheDir ? resolve(input.cacheDir) : resolve('data/voice');
  const totalSec = input.totalSec ?? canvasDurationSec(input.edl);
  if (!(totalSec > 0)) {
    throw new RangeError(`Voice track needs a positive duration, received ${totalSec}`);
  }

  const voice = input.voice ?? DEFAULT_VOICE;
  const cues = scriptCues(input.edl);
  const windows = presenterWindowsFor(input.edl, listingDir, input.presenterClips);
  const engine = input.tts ?? createKokoroEngine();
  const mixer: VoiceMixer = input.mixer ?? createFfmpegMixer();

  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const lines = new Map<string, TtsLine>();
  for (const cue of cues) {
    if (lines.has(cue.text)) continue;
    if (presenterWindowForCue(cue, windows)) continue;
    lines.set(cue.text, await synthesiseLine(cue.text, voice, engine, cacheDir));
  }

  const plan = buildVoicePlan({ cues, windows, lines, totalSec });
  const voicePath = join(outDir, 'vo.wav');
  await mixer.assemble({ segments: plan.segments, totalSec, outPath: voicePath });

  const audioPath = join(outDir, 'voice-track.m4a');
  await mixer.master({
    voicePath,
    musicPath: resolveMusic(input.music),
    totalSec,
    outPath: audioPath,
  });

  const captionsPath = join(outDir, 'captions.json');
  writeFileSync(captionsPath, `${JSON.stringify(plan.captions, null, 2)}\n`);

  return { audioPath, captions: plan.captions, durationSec: totalSec };
}
