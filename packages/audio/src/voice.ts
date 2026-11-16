/**
 * Voice verdict from measured metrics.
 *
 * The trust boundary from `docs/AUDIO-VOICE.md`: FFmpeg measures, this module
 * bands, and a model never supplies a number that reaches the EDL. Restoration
 * can remove what should not be there; it cannot add information, so clipping
 * and a hard room are replacement decisions, not cleanup decisions.
 */

import { assertFiniteNumber, clamp01, roundTo } from './format';

export interface VoiceMetrics {
  lufs: number;
  truePeak: number;
  noiseFloorDb: number;
  snrDb: number;
  reverbTailSec: number;
  clippedSamples: number;
  speechRatio: number;
  wordsPerMinute: number;
  fillerRatio: number;
}

export interface VoiceVerdict {
  band: 'keep' | 'clean' | 'replace';
  reasons: string[];
  /**
   * Measured-only composite, 0.000–1.000. The judged metrics (intelligibility,
   * facts, on-topic) live in the review layer and are deliberately absent here.
   * The band is the contract; the score is diagnostics.
   */
  score: number;
}

/**
 * Fatal thresholds. Any one forces `replace`, because no chain repairs it:
 * clipping destroys the waveform, a long tail smears every consonant, and a
 * voice buried under noise is already gone. `500` samples is about 0.05% of a
 * 20 s, 48 kHz mono take — the same fatal line the review uses.
 */
const REPLACE_SNR_DB = 12;
const REPLACE_REVERB_SEC = 0.6;
const REPLACE_CLIPPED_SAMPLES = 500;
const REPLACE_SPEECH_RATIO = 0.2;

/**
 * Cleanable thresholds. Below these a single pass of DeepFilterNet, a
 * high-pass and a gentle compressor earn their keep; above them, doing nothing
 * is the better edit. Pace and fillers are script problems, but the band still
 * says "clean up" so the card can offer a re-read.
 */
const CLEAN_SNR_DB = 20;
const CLEAN_NOISE_FLOOR_DB = -45;
const CLEAN_WPM = 190;
const CLEAN_FILLER_RATIO = 0.08;

/** Score anchors: 1.0 at or beyond these values, 0.0 at the fatal line. */
const SNR_FLOOR_DB = 8;
const SNR_CEILING_DB = 32;
const NOISE_SCORE_ZERO_DB = -35;
const NOISE_SCORE_ONE_DB = -60;
const PACE_SLOW_WPM = 100;
const PACE_FAST_WPM = 190;
const PACE_MIN_WPM = 120;
const PACE_MAX_WPM = 165;
const COVERAGE_FLOOR = 0.2;
const COVERAGE_CEILING = 0.6;

export function assessVoice(m: VoiceMetrics): VoiceVerdict {
  assertMetrics(m);

  const replaceReasons: string[] = [];
  if (m.snrDb < REPLACE_SNR_DB) {
    replaceReasons.push('The voice is buried in noise; cleanup would not rescue it.');
  }
  if (m.reverbTailSec > REPLACE_REVERB_SEC) {
    replaceReasons.push('The room echoes; a re-recording would be better.');
  }
  if (m.clippedSamples > REPLACE_CLIPPED_SAMPLES) {
    replaceReasons.push('The mic clips on loud words, and clipping cannot be repaired.');
  }
  if (m.speechRatio < REPLACE_SPEECH_RATIO) {
    replaceReasons.push('There is too little speech here to carry a voiceover.');
  }

  if (replaceReasons.length > 0) {
    return {
      band: 'replace',
      reasons: replaceReasons,
      score: boundedScore('replace', m),
    };
  }

  const cleanReasons: string[] = [];
  if (m.snrDb < CLEAN_SNR_DB) {
    cleanReasons.push('There is audible hiss under the words; it can be cleaned up.');
  }
  if (m.noiseFloorDb > CLEAN_NOISE_FLOOR_DB) {
    cleanReasons.push('The background noise is audible on phone speakers.');
  }
  if (m.wordsPerMinute > CLEAN_WPM) {
    cleanReasons.push('The delivery is rushed; slow the read down.');
  }
  if (m.fillerRatio > CLEAN_FILLER_RATIO) {
    cleanReasons.push('Too many filler words make the take sound unrehearsed.');
  }

  if (cleanReasons.length > 0) {
    return {
      band: 'clean',
      reasons: cleanReasons,
      score: boundedScore('clean', m),
    };
  }

  return {
    band: 'keep',
    reasons: ['The recording is clean enough to use as it is.'],
    score: boundedScore('keep', m),
  };
}

/**
 * The composite follows the measured sub-scores only. Weights favour the
 * defects a cleanup chain can actually address; coverage gets a small weight
 * because a fragment of a voice is an editing problem as much as an audio one.
 */
function compositeScore(m: VoiceMetrics): number {
  const snr = clamp01((m.snrDb - SNR_FLOOR_DB) / (SNR_CEILING_DB - SNR_FLOOR_DB));
  const noise = clamp01(
    (NOISE_SCORE_ZERO_DB - m.noiseFloorDb) / (NOISE_SCORE_ZERO_DB - NOISE_SCORE_ONE_DB),
  );
  const reverb = clamp01(1 - m.reverbTailSec / REPLACE_REVERB_SEC);
  const clipping = clamp01(1 - m.clippedSamples / REPLACE_CLIPPED_SAMPLES);
  const pace = paceScore(m.wordsPerMinute);
  const filler = clamp01(1 - m.fillerRatio / CLEAN_FILLER_RATIO);
  const coverage = clamp01(
    (m.speechRatio - COVERAGE_FLOOR) / (COVERAGE_CEILING - COVERAGE_FLOOR),
  );

  return (
    0.3 * snr +
    0.15 * noise +
    0.15 * reverb +
    0.15 * clipping +
    0.1 * pace +
    0.1 * filler +
    0.05 * coverage
  );
}

/**
 * Keep the score inside the band it describes: the UI shows one word and one
 * score, and a "replace" verdict reading 82 would undermine both.
 */
function boundedScore(band: VoiceVerdict['band'], m: VoiceMetrics): number {
  const raw = compositeScore(m);
  if (band === 'replace') return roundTo(Math.min(raw, 0.54), 3);
  if (band === 'clean') return roundTo(Math.min(0.77, Math.max(0.55, raw)), 3);
  return roundTo(Math.max(0.78, raw), 3);
}

function paceScore(wpm: number): number {
  if (wpm >= PACE_MIN_WPM && wpm <= PACE_MAX_WPM) return 1;
  if (wpm < PACE_MIN_WPM) {
    return clamp01((wpm - PACE_SLOW_WPM) / (PACE_MIN_WPM - PACE_SLOW_WPM));
  }
  return clamp01((PACE_FAST_WPM - wpm) / (PACE_FAST_WPM - PACE_MAX_WPM));
}

function assertMetrics(m: VoiceMetrics): void {
  assertFiniteNumber('lufs', m.lufs);
  assertFiniteNumber('truePeak', m.truePeak);
  assertFiniteNumber('noiseFloorDb', m.noiseFloorDb);
  assertFiniteNumber('snrDb', m.snrDb);
  assertFiniteNumber('reverbTailSec', m.reverbTailSec);
  assertFiniteNumber('clippedSamples', m.clippedSamples);
  assertFiniteNumber('speechRatio', m.speechRatio);
  assertFiniteNumber('wordsPerMinute', m.wordsPerMinute);
  assertFiniteNumber('fillerRatio', m.fillerRatio);
}
