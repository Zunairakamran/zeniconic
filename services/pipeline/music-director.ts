/**
 * Music direction: brief → prompt → analysis → deterministic selection.
 *
 * The export path used to add a bundled bed after planning, so cuts could not
 * be beat-aware and nobody could say *why* a bed was chosen. This module makes
 * the decision explicit and reproducible:
 *
 *   facts ──▶ MusicBrief ──▶ Lyria prompt(s) ──▶ MusicProfile ──▶ ranked pick
 *
 * Three rules are enforced here, not left to the caller:
 * - **Facts only.** Every field of `MusicBriefFacts` is required and echoed into
 *   the prompt. Nothing about location, price or lifestyle is invented; an
 *   optional `setting` is used only when the caller supplies confirmed text.
 * - **Bounded candidates.** At most `MAX_MUSIC_CANDIDATES` (3) profiles may be
 *   scored in one run. A retry is only meaningful after the previous take has
 *   been decoded and profiled, so selection takes profiles, never files alone.
 * - **No random choice.** Scoring is a pure function of the brief and the
 *   profile; ties break on BPM error, then duration, then candidate id.
 *
 * Analysis is local and dependency-free: the bundled `ffmpeg-static` decodes to
 * mono f32le, `packages/music` estimates the beat grid, and an RMS envelope
 * gives energy. Section labels are a heuristic, not a transcription — they are
 * a coarse map for pacing decisions, and are documented as such.
 */

import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  BEAT_DECODE_SAMPLE_RATE,
  MUSIC_TAIL_SEC,
  detectBeatsFromSamples,
} from '../../packages/music/src/index';
import type { BeatDetectionOptions } from '../../packages/music/src/index';

/** Hard ceiling on candidates scored (and generated) for one listing. */
export const MAX_MUSIC_CANDIDATES = 3;

/** The four Lyria directions this module can ask for. */
export type MusicStyle =
  | 'deep_house'
  | 'sophisticated_electronic'
  | 'cinematic_ambient'
  | 'luxury_lounge';

export type PropertyType =
  | 'apartment'
  | 'villa'
  | 'penthouse'
  | 'townhouse'
  | 'commercial';

export type MusicAudience = 'buyer' | 'investor' | 'tenant' | 'agent';

export type EditPace = 'slow' | 'medium' | 'fast';

export type EmotionalTone =
  | 'serene'
  | 'aspirational'
  | 'energetic'
  | 'intimate'
  | 'dramatic';

/**
 * Everything the director is allowed to know. All fields are required so a
 * caller cannot silently rely on a default that pretends to be a fact.
 */
export interface MusicBriefFacts {
  /** 1 = everyday, 5 = ultra-luxury. */
  luxuryLevel: 1 | 2 | 3 | 4 | 5;
  propertyType: PropertyType;
  audience: MusicAudience;
  editPace: EditPace;
  emotionalTone: EmotionalTone;
  /** Picture length in seconds, excluding the music tail. */
  durationSec: number;
  hasVoiceover: boolean;
  /**
   * Optional confirmed setting, e.g. "Dubai Marina waterfront". Pass only text
   * the listing actually confirms; it is copied into the prompt verbatim.
   */
  setting?: string;
}

export type EnergyTargetLabel = 'open' | 'build' | 'lift' | 'close' | 'tail';

export interface EnergyTarget {
  /** Normalised position in the edit, 0..1. */
  at: number;
  /** Normalised RMS target, 0..1. */
  target: number;
  label: EnergyTargetLabel;
}

export interface MusicBrief {
  facts: MusicBriefFacts;
  style: MusicStyle;
  /** BPM the generated bed should aim for, already adjusted for the facts. */
  bpmTarget: number;
  /** The style's legal tempo window; `bpmTarget` is clamped inside it. */
  bpmRange: readonly [number, number];
  /** Picture + tail: the shortest bed that can cover the cut cleanly. */
  requiredDurationSec: number;
  /** Where the edit wants quiet, build, lift and settle. */
  energyTargets: readonly EnergyTarget[];
  /** Ready-to-send Lyria prompt; deterministic from the facts. */
  prompt: string;
  /** Human-readable derivation, one line per decision. */
  reasons: readonly string[];
}

interface StyleSpec {
  label: string;
  instrumentation: string;
  tone: string;
  baseBpm: number;
  range: readonly [number, number];
}

const STYLE_SPECS: Record<MusicStyle, StyleSpec> = {
  deep_house: {
    label: 'deep house',
    instrumentation:
      'warm Rhodes chords, rounded sub-bass, soft shakers and a restrained four-on-the-floor pulse',
    tone: 'warm, sophisticated and unhurried',
    baseBpm: 110,
    range: [104, 118],
  },
  sophisticated_electronic: {
    label: 'sophisticated electronic',
    instrumentation:
      'clean arpeggiated synths, muted analog bass and tight, understated percussion',
    tone: 'polished, modern and confident',
    baseBpm: 116,
    range: [110, 122],
  },
  cinematic_ambient: {
    label: 'cinematic ambient',
    instrumentation: 'felt piano, sustained strings, airy pads and a slow, breathing pulse',
    tone: 'spacious, emotional and calm',
    baseBpm: 88,
    range: [78, 96],
  },
  luxury_lounge: {
    label: 'luxury lounge',
    instrumentation:
      'nylon guitar, soft electric piano, brushed percussion and a relaxed bass line',
    tone: 'intimate, relaxed and refined',
    baseBpm: 100,
    range: [92, 106],
  },
};

const STYLE_ORDER: readonly MusicStyle[] = [
  'deep_house',
  'sophisticated_electronic',
  'cinematic_ambient',
  'luxury_lounge',
];

const PACE_POSITIONS: Record<EditPace, { build: number; lift: number; close: number }> = {
  slow: { build: 0.38, lift: 0.74, close: 0.9 },
  medium: { build: 0.32, lift: 0.72, close: 0.88 },
  fast: { build: 0.24, lift: 0.68, close: 0.86 },
};

const LUXURY_LABEL: Record<MusicBriefFacts['luxuryLevel'], string> = {
  1: 'everyday',
  2: 'comfortable',
  3: 'premium',
  4: 'high-end',
  5: 'ultra-luxury',
};

const PROPERTY_LABEL: Record<PropertyType, string> = {
  apartment: 'apartment',
  villa: 'villa',
  penthouse: 'penthouse',
  townhouse: 'townhouse',
  commercial: 'commercial space',
};

const AUDIENCE_LABEL: Record<MusicAudience, string> = {
  buyer: 'prospective buyer',
  investor: 'property investor',
  tenant: 'prospective tenant',
  agent: 'listing agent',
};

const TONE_LABEL: Record<EmotionalTone, string> = {
  serene: 'calm and unhurried',
  aspirational: 'uplifting and aspirational',
  energetic: 'driving and confident',
  intimate: 'close and intimate',
  dramatic: 'cinematic and dramatic',
};

/**
 * Transparent style scoring. Points, not a machine model: every entry here is
 * a defensible editorial rule and the winning score is printed in `reasons`.
 */
function styleScores(facts: MusicBriefFacts): Record<MusicStyle, number> {
  const scores: Record<MusicStyle, number> = {
    deep_house: 0,
    sophisticated_electronic: 0,
    cinematic_ambient: 0,
    luxury_lounge: 0,
  };

  // Tone.
  if (facts.emotionalTone === 'aspirational') {
    scores.deep_house += 3;
    scores.sophisticated_electronic += 1;
  } else if (facts.emotionalTone === 'energetic') {
    scores.sophisticated_electronic += 3;
    scores.deep_house += 1;
  } else if (facts.emotionalTone === 'serene') {
    scores.cinematic_ambient += 3;
    scores.luxury_lounge += 1;
  } else if (facts.emotionalTone === 'dramatic') {
    scores.cinematic_ambient += 2;
  } else {
    scores.luxury_lounge += 3;
  }

  // Property type.
  if (facts.propertyType === 'penthouse') {
    scores.deep_house += 2;
    scores.cinematic_ambient += 1;
  } else if (facts.propertyType === 'villa') {
    scores.deep_house += 2;
    scores.cinematic_ambient += 2;
  } else if (facts.propertyType === 'apartment') {
    scores.sophisticated_electronic += 2;
    scores.luxury_lounge += 1;
  } else if (facts.propertyType === 'commercial') {
    scores.sophisticated_electronic += 2;
  } else {
    scores.luxury_lounge += 2;
  }

  // Pace.
  if (facts.editPace === 'fast') {
    scores.sophisticated_electronic += 2;
    scores.deep_house += 1;
  } else if (facts.editPace === 'slow') {
    scores.cinematic_ambient += 3;
    scores.luxury_lounge += 1;
  } else {
    scores.deep_house += 1;
    scores.luxury_lounge += 1;
  }

  // Audience.
  if (facts.audience === 'investor') {
    scores.deep_house += 2;
  } else if (facts.audience === 'agent') {
    scores.sophisticated_electronic += 2;
  } else if (facts.audience === 'buyer') {
    scores.cinematic_ambient += 1;
  } else {
    scores.luxury_lounge += 3;
  }

  // Luxury band and narration headroom.
  if (facts.luxuryLevel >= 4) {
    scores.deep_house += 2;
    scores.cinematic_ambient += 1;
  } else if (facts.luxuryLevel <= 3) {
    scores.luxury_lounge += 1;
  }
  if (facts.hasVoiceover) {
    scores.cinematic_ambient += 3;
    scores.luxury_lounge += 1;
    scores.deep_house -= 1;
  }

  return scores;
}

function pickStyle(facts: MusicBriefFacts): MusicStyle {
  const scores = styleScores(facts);
  let winner: MusicStyle = STYLE_ORDER[0] ?? 'deep_house';
  let best = -Infinity;
  for (const style of STYLE_ORDER) {
    const score = scores[style];
    // Strictly greater keeps STYLE_ORDER as the deterministic tie-break.
    if (score > best) {
      best = score;
      winner = style;
    }
  }
  return winner;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${String(value)}`);
  }
}

function assertFacts(facts: MusicBriefFacts): void {
  if (![1, 2, 3, 4, 5].includes(facts.luxuryLevel)) {
    throw new RangeError(`luxuryLevel must be 1..5, received ${String(facts.luxuryLevel)}`);
  }
  if (!(facts.durationSec > 0)) {
    throw new RangeError(
      `durationSec must be a positive finite number, received ${String(facts.durationSec)}`,
    );
  }
  assertFiniteNumber(facts.durationSec, 'durationSec');
  if (facts.setting !== undefined && facts.setting.trim().length === 0) {
    throw new RangeError('setting, when supplied, must not be blank');
  }
}

/**
 * Maps explicit property/style facts to a style, tempo and Lyria prompt.
 *
 * The tempo starts at the style's base and is adjusted once per fact that
 * changes how much room the picture and voice need:
 * slow −5, fast +5; luxury ≥ 4 +2 / ≤ 2 −2; voiceover −5; energetic +2 /
 * serene −2. The result is clamped to the style window, so a target can never
 * fall outside the direction the prompt asks for.
 */
export function buildMusicBrief(facts: MusicBriefFacts): MusicBrief {
  assertFacts(facts);

  const style = pickStyle(facts);
  const spec = STYLE_SPECS[style];
  const scores = styleScores(facts);

  const paceAdjust = facts.editPace === 'slow' ? -5 : facts.editPace === 'fast' ? 5 : 0;
  const luxuryAdjust = facts.luxuryLevel >= 4 ? 2 : facts.luxuryLevel <= 2 ? -2 : 0;
  const voiceAdjust = facts.hasVoiceover ? -5 : 0;
  const toneAdjust =
    facts.emotionalTone === 'energetic' ? 2 : facts.emotionalTone === 'serene' ? -2 : 0;

  const bpmTarget = Math.round(
    clamp(
      spec.baseBpm + paceAdjust + luxuryAdjust + voiceAdjust + toneAdjust,
      spec.range[0],
      spec.range[1],
    ),
  );

  const positions = PACE_POSITIONS[facts.editPace];
  const liftTarget = facts.hasVoiceover ? 0.9 : 1;
  const energyTargets: EnergyTarget[] = [
    { at: 0.08, target: 0.18, label: 'open' },
    { at: positions.build, target: 0.45, label: 'build' },
    { at: positions.lift, target: liftTarget, label: 'lift' },
    { at: positions.close, target: 0.32, label: 'close' },
    { at: 0.98, target: 0.12, label: 'tail' },
  ];

  const requiredDurationSec = round3(facts.durationSec + MUSIC_TAIL_SEC);
  const settingClause =
    facts.setting === undefined ? '' : ` in ${facts.setting.trim()}`;
  const buildSec = Math.round(positions.build * facts.durationSec);
  const liftSec = Math.round(positions.lift * facts.durationSec);
  const closeSec = Math.round(positions.close * facts.durationSec);

  const prompt =
    `Instrumental ${spec.label} bed for ${article(LUXURY_LABEL[facts.luxuryLevel])} ` +
    `${LUXURY_LABEL[facts.luxuryLevel]} ${PROPERTY_LABEL[facts.propertyType]}${settingClause}, ` +
    `aimed at a ${AUDIENCE_LABEL[facts.audience]}. ${bpmTarget} BPM, ${spec.tone}. ` +
    `Instrumentation: ${spec.instrumentation}. About ${Math.round(facts.durationSec)} seconds. ` +
    `Open quietly, build from around ${buildSec} s, lift once around ${liftSec} s, ` +
    `then settle for a quiet close after ${closeSec} s. ` +
    (facts.hasVoiceover
      ? 'Leave clear space for a voiceover; the bed must never mask speech. '
      : 'No voiceover, so the bed carries the story. ') +
    'No vocals, no lyrics, no spoken word, no sudden drops, no hard stop; ' +
    'end on a settled, loop-friendly tail.';

  const scoreLine = STYLE_ORDER.map(
    (entry) => `${specFor(entry).label} ${scores[entry]}`,
  ).join(', ');

  const reasons = [
    `Facts: luxury ${facts.luxuryLevel}, ${facts.propertyType}, ${facts.audience}, ` +
      `${facts.editPace} pace, ${facts.emotionalTone}, ${round3(facts.durationSec)}s, ` +
      `${facts.hasVoiceover ? 'with voiceover' : 'no voiceover'}` +
      `${facts.setting === undefined ? '' : `, setting "${facts.setting.trim()}"`}.`,
    `Style scores (highest wins, canonical order breaks ties): ${scoreLine}.`,
    `BPM ${bpmTarget} = ${spec.baseBpm} base ${signed(paceAdjust)} pace ` +
      `${signed(luxuryAdjust)} luxury ${signed(voiceAdjust)} voiceover ` +
      `${signed(toneAdjust)} tone, clamped to ${spec.range[0]}..${spec.range[1]}.`,
    `Duration ${requiredDurationSec}s = ${round3(facts.durationSec)}s picture + ` +
      `${MUSIC_TAIL_SEC}s fade tail.`,
    `Energy curve: open 0.18, build 0.45 at ${positions.build}, lift ${liftTarget} at ` +
      `${positions.lift}, close 0.32 at ${positions.close}.`,
  ];

  return {
    facts,
    style,
    bpmTarget,
    bpmRange: spec.range,
    requiredDurationSec,
    energyTargets,
    prompt,
    reasons,
  };
}

function specFor(style: MusicStyle): StyleSpec {
  return STYLE_SPECS[style];
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Deterministic prompts for a bounded candidate run. Variation 1 lightens the
 * percussion for dialogue; variation 2 deepens the low end and the final lift.
 * No sampling, no randomness: the same brief always yields the same prompts.
 */
export function musicPromptVariants(brief: MusicBrief, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_MUSIC_CANDIDATES) {
    throw new RangeError(
      `count must be an integer 1..${MAX_MUSIC_CANDIDATES}, received ${String(count)}`,
    );
  }
  const variants = [
    brief.prompt,
    `${brief.prompt} Alternative take: slightly lighter percussion and a sparser arrangement so dialogue can sit on top.`,
    `${brief.prompt} Alternative take: slightly deeper low end and a more pronounced final lift for a bolder close.`,
  ];
  return variants.slice(0, count);
}

/* ------------------------------------------------------------------ audio */

export interface MusicSection {
  kind: 'intro' | 'body' | 'climax' | 'outro';
  startSec: number;
  endSec: number;
  /** Mean normalised RMS inside the section, 0..1. */
  meanEnergy: number;
}

export interface EnergyPoint {
  /** Window centre, seconds. */
  atSec: number;
  /** Linear RMS of the window. */
  rms: number;
  /** RMS divided by the loudest window, 0..1. */
  norm: number;
}

export interface MusicEnergy {
  /** Mean of `norm` across the track, 0..1. */
  meanNorm: number;
  /** Loudest window's linear RMS, 0..1. */
  peakRms: number;
  /** (peak − 10th percentile) / peak: how much the track moves. */
  dynamics: number;
  points: EnergyPoint[];
}

export interface MusicProfile {
  /** Decoded length, seconds, 3 dp. */
  durationSec: number;
  bpm: number | null;
  beatConfidence: number;
  beats: number[];
  energy: MusicEnergy;
  sections: MusicSection[];
  /** Length of the intro section, 0 when the track starts at full energy. */
  introSec: number;
  /** Length of the outro section, 0 when the track ends at full energy. */
  outroSec: number;
  /** Total measured climax length, 0 when the track has no lift. */
  climaxSec: number;
  /** Set only by `analyzeMusicFile`. */
  sourceFile?: string;
}

export interface MusicAnalysisOptions extends BeatDetectionOptions {
  /** RMS window length. Default 1 s. */
  energyWindowSec?: number;
  /** RMS window hop. Default 0.5 s. */
  energyHopSec?: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const a = sorted[lower] ?? 0;
  const b = sorted[upper] ?? a;
  return a + (b - a) * (position - lower);
}

function meanNormBetween(points: readonly EnergyPoint[], startSec: number, endSec: number): number {
  let total = 0;
  let count = 0;
  for (const point of points) {
    if (point.atSec < startSec || point.atSec >= endSec) continue;
    total += point.norm;
    count += 1;
  }
  return count === 0 ? 0 : round3(total / count);
}

/**
 * Section edges from the RMS envelope.
 *
 * `base` is the 10th percentile, `peak` the loudest window. The intro ends at
 * the first window at or above 30% of peak; the climax is the longest run at or
 * above 75% of peak; the outro starts at the first window after that run that
 * drops below 30% of peak, or at the end when the track never drops. A track
 * with less than 6% dynamic range is *not* split: it is one body section,
 * because calling a flat pad "climax" would be a lie.
 */
function segmentsFromEnergy(
  points: readonly EnergyPoint[],
  durationSec: number,
): MusicSection[] {
  if (points.length === 0) {
    return [{ kind: 'body', startSec: 0, endSec: durationSec, meanEnergy: 0 }];
  }

  const norms = points.map((point) => point.norm);
  const sorted = [...norms].sort((a, b) => a - b);
  const base = quantile(sorted, 0.1);
  const peak = sorted[sorted.length - 1] ?? 0;
  const range = peak - base;

  if (!(range >= 0.06)) {
    return [
      {
        kind: 'body',
        startSec: 0,
        endSec: round3(durationSec),
        meanEnergy: round3(norms.reduce((sum, value) => sum + value, 0) / norms.length),
      },
    ];
  }

  const low = 0.3 * peak;
  const high = 0.75 * peak;

  let introIdx = 0;
  for (let index = 1; index < points.length; index += 1) {
    if ((norms[index] ?? 0) >= low) {
      introIdx = index;
      break;
    }
  }
  const introEnd = points[introIdx]?.atSec ?? 0;

  let bestStart = -1;
  let bestEnd = -1;
  let runStart = -1;
  for (let index = 0; index <= points.length; index += 1) {
    const above = index < points.length && (norms[index] ?? 0) >= high;
    if (above && runStart < 0) runStart = index;
    if (!above && runStart >= 0) {
      const length = index - runStart;
      if (bestStart < 0 || length > bestEnd - bestStart) {
        bestStart = runStart;
        bestEnd = index;
      }
      runStart = -1;
    }
  }
  if (bestStart < 0) {
    const peakIdx = norms.indexOf(peak);
    bestStart = peakIdx < 0 ? 0 : peakIdx;
    bestEnd = Math.min(points.length, bestStart + 1);
  }

  const climaxStart = Math.max(introEnd, points[bestStart]?.atSec ?? introEnd);
  const climaxEnd = bestEnd < points.length ? points[bestEnd]?.atSec ?? durationSec : durationSec;

  let outroStart = durationSec;
  for (let index = bestEnd; index < points.length; index += 1) {
    if ((norms[index] ?? 0) < low) {
      outroStart = points[index]?.atSec ?? durationSec;
      break;
    }
  }
  outroStart = clamp(outroStart, climaxEnd, durationSec);

  const sections: MusicSection[] = [];
  const add = (kind: MusicSection['kind'], startSec: number, endSec: number): void => {
    if (!(endSec - startSec > 0.05)) return;
    sections.push({
      kind,
      startSec: round3(startSec),
      endSec: round3(endSec),
      meanEnergy: meanNormBetween(points, startSec, endSec),
    });
  };

  add('intro', 0, introEnd);
  add('body', introEnd, climaxStart);
  add('climax', climaxStart, outroStart);
  add('outro', outroStart, durationSec);

  if (sections.length === 0) {
    return [{ kind: 'body', startSec: 0, endSec: round3(durationSec), meanEnergy: 0 }];
  }
  return sections;
}

/**
 * Analyses mono samples: beat grid via `packages/music`, then an RMS envelope
 * and coarse sections. Pure and deterministic; no network, no model.
 */
export function analyzeMusicSamples(
  samples: Float32Array,
  sampleRate: number,
  opts: MusicAnalysisOptions = {},
): MusicProfile {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) {
    throw new RangeError(`sampleRate must be a positive finite number, received ${String(sampleRate)}`);
  }
  if (samples.length === 0) {
    throw new RangeError('samples must not be empty');
  }

  const windowSec = opts.energyWindowSec ?? 1;
  const hopSec = opts.energyHopSec ?? 0.5;
  if (!(windowSec > 0) || !Number.isFinite(windowSec)) {
    throw new RangeError(
      `energyWindowSec must be a positive finite number, received ${String(windowSec)}`,
    );
  }
  if (!(hopSec > 0) || !Number.isFinite(hopSec)) {
    throw new RangeError(
      `energyHopSec must be a positive finite number, received ${String(hopSec)}`,
    );
  }

  const durationSec = round3(samples.length / sampleRate);
  const beats = detectBeatsFromSamples(samples, sampleRate, opts);

  const windowSize = Math.max(1, Math.round(sampleRate * windowSec));
  const hopSize = Math.max(1, Math.round(sampleRate * hopSec));

  const prefix = new Float64Array(samples.length + 1);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    prefix[index + 1] = (prefix[index] ?? 0) + sample * sample;
  }

  const raw: Array<{ atSec: number; rms: number }> = [];
  for (let start = 0; start < samples.length; start += hopSize) {
    const size = Math.min(windowSize, samples.length - start);
    if (size <= 0) break;
    const meanSquare =
      ((prefix[start + size] ?? 0) - (prefix[start] ?? 0)) / size;
    const rms = Math.sqrt(Math.max(0, meanSquare));
    raw.push({ atSec: clamp((start + size / 2) / sampleRate, 0, durationSec), rms });
  }

  let maxRms = 0;
  for (const entry of raw) {
    if (entry.rms > maxRms) maxRms = entry.rms;
  }
  const points: EnergyPoint[] = raw.map((entry) => ({
    atSec: round3(entry.atSec),
    rms: round3(entry.rms),
    norm: maxRms > 0 ? round3(entry.rms / maxRms) : 0,
  }));

  const norms = points.map((point) => point.norm);
  const sortedNorms = [...norms].sort((a, b) => a - b);
  const baseNorm = quantile(sortedNorms, 0.1);
  const peakNorm = sortedNorms[sortedNorms.length - 1] ?? 0;

  const energy: MusicEnergy = {
    meanNorm:
      points.length === 0
        ? 0
        : round3(norms.reduce((sum, value) => sum + value, 0) / norms.length),
    peakRms: round3(maxRms),
    dynamics: peakNorm > 0 ? round3(clamp((peakNorm - baseNorm) / peakNorm, 0, 1)) : 0,
    points,
  };

  const sections = segmentsFromEnergy(points, durationSec);
  const intro = sections.find((section) => section.kind === 'intro');
  const outro = sections.find((section) => section.kind === 'outro');
  const climaxSec = round3(
    sections
      .filter((section) => section.kind === 'climax')
      .reduce((sum, section) => sum + (section.endSec - section.startSec), 0),
  );

  return {
    durationSec,
    bpm: beats.bpm,
    beatConfidence: beats.confidence,
    beats: beats.beats,
    energy,
    sections,
    introSec: intro === undefined ? 0 : intro.endSec,
    outroSec: outro === undefined ? 0 : round3(durationSec - outro.startSec),
    climaxSec,
  };
}

/**
 * Decodes `file` through the bundled ffmpeg to mono f32le at the beat-detection
 * rate, then runs `analyzeMusicSamples`. Throws only when the file cannot be
 * decoded or ffmpeg is missing; silent audio still returns a profile.
 */
export function analyzeMusicFile(
  file: string,
  opts: MusicAnalysisOptions = {},
): MusicProfile {
  if (typeof file !== 'string' || file.length === 0) {
    throw new TypeError('file must be a non-empty path');
  }
  if (typeof ffmpegStatic !== 'string' || ffmpegStatic.length === 0) {
    throw new Error(
      'ffmpeg-static did not resolve to a binary for this platform. ' +
        'Reinstall dependencies with "npm install" and try again.',
    );
  }

  const decoded = spawnSync(
    ffmpegStatic,
    [
      '-hide_banner',
      '-nostdin',
      '-v', 'error',
      '-i', file,
      '-vn',
      '-ac', '1',
      '-ar', String(BEAT_DECODE_SAMPLE_RATE),
      '-f', 'f32le',
      '-',
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );

  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) {
    const stderr = decoded.stderr ? decoded.stderr.toString('utf8').trim() : '';
    throw new Error(`ffmpeg could not decode "${file}" for music analysis: ${stderr}`);
  }

  const buffer: Buffer = decoded.stdout;
  const sampleCount = Math.floor(buffer.length / 4);
  if (sampleCount === 0) {
    throw new Error(`ffmpeg decoded no samples from "${file}"`);
  }
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }

  return {
    ...analyzeMusicSamples(samples, BEAT_DECODE_SAMPLE_RATE, opts),
    sourceFile: file,
  };
}

/* ---------------------------------------------------------------- scoring */

export interface EditEnergyShape {
  buildAt: number;
  liftAt: number;
  closeAt: number;
}

/** The edit shape implied by the brief, for callers that want to compare. */
export function editShapeFor(brief: MusicBrief): EditEnergyShape {
  const build = brief.energyTargets.find((target) => target.label === 'build');
  const lift = brief.energyTargets.find((target) => target.label === 'lift');
  const close = brief.energyTargets.find((target) => target.label === 'close');
  return {
    buildAt: build?.at ?? 0.32,
    liftAt: lift?.at ?? 0.72,
    closeAt: close?.at ?? 0.88,
  };
}

export interface MusicScore {
  /** Weighted total, 0..1. */
  total: number;
  /** Component scores, each 0..1. */
  bpm: number;
  energy: number;
  duration: number;
  introOutro: number;
  notes: string[];
}

export const MUSIC_SCORE_WEIGHTS = {
  bpm: 0.34,
  energy: 0.36,
  duration: 0.2,
  introOutro: 0.1,
} as const;

const BPM_FULL_CREDIT_ERROR = 12;

function nearestEnergyNorm(points: readonly EnergyPoint[], at: number): number {
  if (points.length === 0) return 0;
  let best = points[0];
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.abs(point.atSec - at);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best?.norm ?? 0;
}

/**
 * Scores one profile against the brief.
 *
 * - BPM: linear loss up to 12 BPM of error; `null` scores 0.
 * - Energy: mean absolute error between the profile's normalised RMS at each
 *   brief target position (open/build/lift/close/tail) and the target.
 * - Duration: full credit once the bed covers picture + tail; proportional
 *   below that. Extra length earns nothing.
 * - Intro/outro: a bed needs a low-energy entry (1.5 s, 2.5 s under voiceover)
 *   and a settling tail (1.2 s). Flat beds legitimately score 0 here.
 */
export function scoreMusicProfile(profile: MusicProfile, brief: MusicBrief): MusicScore {
  const notes: string[] = [];

  let bpmScore = 0;
  if (profile.bpm === null) {
    notes.push('No credible tempo was detected.');
  } else {
    const error = Math.abs(profile.bpm - brief.bpmTarget);
    bpmScore = clamp(1 - error / BPM_FULL_CREDIT_ERROR, 0, 1);
    notes.push(
      `BPM ${profile.bpm} is ${round2(error)} off ${brief.bpmTarget} (${round3(bpmScore)}).`,
    );
  }

  let errorTotal = 0;
  for (const target of brief.energyTargets) {
    const observed = nearestEnergyNorm(profile.energy.points, target.at);
    errorTotal += Math.abs(observed - target.target);
  }
  const meanError = brief.energyTargets.length === 0 ? 0 : errorTotal / brief.energyTargets.length;
  const energyScore = clamp(1 - meanError, 0, 1);
  notes.push(`Energy fit ${round3(energyScore)} (mean error ${round3(meanError)}).`);

  const durationScore = clamp(profile.durationSec / brief.requiredDurationSec, 0, 1);
  notes.push(
    `Duration ${profile.durationSec}s vs ${brief.requiredDurationSec}s required ` +
      `(${round3(durationScore)}).`,
  );

  const introWanted = brief.facts.hasVoiceover ? 2.5 : 1.5;
  const introScore = clamp(profile.introSec / introWanted, 0, 1);
  const outroScore = clamp(profile.outroSec / 1.2, 0, 1);
  const introOutro = (introScore + outroScore) / 2;
  notes.push(
    `Intro ${profile.introSec}s (wanted ${introWanted}s), outro ${profile.outroSec}s ` +
      `(wanted 1.2s) → ${round3(introOutro)}.`,
  );

  const total = round3(
    MUSIC_SCORE_WEIGHTS.bpm * bpmScore +
      MUSIC_SCORE_WEIGHTS.energy * energyScore +
      MUSIC_SCORE_WEIGHTS.duration * durationScore +
      MUSIC_SCORE_WEIGHTS.introOutro * introOutro,
  );

  return {
    total,
    bpm: round3(bpmScore),
    energy: round3(energyScore),
    duration: round3(durationScore),
    introOutro: round3(introOutro),
    notes,
  };
}

export interface MusicCandidate {
  id: string;
  file: string;
  profile: MusicProfile;
}

export interface RankedMusicCandidate {
  candidate: MusicCandidate;
  score: MusicScore;
}

export interface MusicSelection {
  chosen: RankedMusicCandidate;
  /** Chosen first, then the rest by score. */
  ranked: RankedMusicCandidate[];
}

/**
 * Deterministic pick from a bounded candidate list.
 *
 * Throws on 0 candidates (nothing to choose) and on more than
 * `MAX_MUSIC_CANDIDATES` (a generation run must stay bounded and every extra
 * take must be analysed before it can be scored). Ties: higher total, then
 * smaller BPM error, then longer bed, then candidate id ascending.
 */
export function selectMusicCandidate(
  candidates: readonly MusicCandidate[],
  brief: MusicBrief,
): MusicSelection {
  if (candidates.length === 0) {
    throw new RangeError('at least one analysed music candidate is required');
  }
  if (candidates.length > MAX_MUSIC_CANDIDATES) {
    throw new RangeError(
      `at most ${MAX_MUSIC_CANDIDATES} music candidates may be scored per run, ` +
        `received ${candidates.length}`,
    );
  }

  const seen = new Set<string>();
  const ranked: RankedMusicCandidate[] = candidates.map((candidate) => {
    if (candidate.id.trim().length === 0) {
      throw new RangeError('candidate id must not be blank');
    }
    if (candidate.file.trim().length === 0) {
      throw new RangeError(`candidate "${candidate.id}" has no file`);
    }
    if (seen.has(candidate.id)) {
      throw new RangeError(`duplicate music candidate id "${candidate.id}"`);
    }
    seen.add(candidate.id);
    return { candidate, score: scoreMusicProfile(candidate.profile, brief) };
  });

  const bpmError = (entry: RankedMusicCandidate): number => {
    const bpm = entry.candidate.profile.bpm;
    return bpm === null ? Infinity : Math.abs(bpm - brief.bpmTarget);
  };

  ranked.sort((a, b) => {
    if (a.score.total !== b.score.total) return b.score.total - a.score.total;
    const errorA = bpmError(a);
    const errorB = bpmError(b);
    if (errorA !== errorB) return errorA - errorB;
    if (a.candidate.profile.durationSec !== b.candidate.profile.durationSec) {
      return b.candidate.profile.durationSec - a.candidate.profile.durationSec;
    }
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
  });

  const chosen = ranked[0];
  if (chosen === undefined) {
    throw new RangeError('at least one analysed music candidate is required');
  }
  return { chosen, ranked };
}

/* ------------------------------------------------------------ beat helpers */

/**
 * Beats inside `[startSec, endSec]`, optionally widened by `toleranceSec` on
 * both sides so a cut just outside the shot can still be snapped to a beat.
 * Returned ascending and deduplicated. A reversed range returns `[]` rather
 * than throwing: callers routinely probe zero-length shots.
 */
export function beatsWithin(
  beats: readonly number[],
  startSec: number,
  endSec: number,
  toleranceSec = 0,
): number[] {
  assertFiniteNumber(startSec, 'startSec');
  assertFiniteNumber(endSec, 'endSec');
  assertFiniteNumber(toleranceSec, 'toleranceSec');
  if (toleranceSec < 0) {
    throw new RangeError(`toleranceSec must not be negative, received ${String(toleranceSec)}`);
  }
  if (endSec < startSec) return [];

  const low = startSec - toleranceSec;
  const high = endSec + toleranceSec;
  const seen = new Set<number>();
  for (const beat of beats) {
    if (!Number.isFinite(beat)) continue;
    if (beat < low || beat > high) continue;
    seen.add(beat);
  }
  return [...seen].sort((a, b) => a - b);
}
