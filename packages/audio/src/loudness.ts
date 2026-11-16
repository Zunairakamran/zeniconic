/**
 * Two-pass loudness mastering.
 *
 * Pass 1 measures, pass 2 applies the measurements linearly. Loudness is a
 * delivery promise: targets come from the render profiles in
 * `docs/CONVENTIONS.md`, never from taste. The values written back to the EDL
 * are the measured master, not the target.
 */

import {
  assertFiniteNumber,
  assertNonEmptyString,
  formatNumber,
} from './format';

export interface LoudnormResult {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
}

export type AudioErrorCode = 'E_LOUDNORM';

export class AudioError extends Error {
  readonly code: AudioErrorCode;

  constructor(code: AudioErrorCode, message: string) {
    super(message);
    this.name = 'AudioError';
    this.code = code;
  }
}

/** The first pass measures the social target; input stats are target-neutral. */
const PASS1_LUFS = -14;
const PASS1_TRUE_PEAK = -1.5;

/**
 * LRA ceilings: 9 LU for the short-form profiles, 11 LU for landscape and any
 * quieter delivery (including the −23 LUFS MLS override).
 */
function targetLra(targetLufs: number): number {
  return targetLufs <= -16 ? 11 : 9;
}

export function buildLoudnormPass1(input: string): string[] {
  assertNonEmptyString('input', input);

  return [
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-af',
    `loudnorm=I=${formatNumber(PASS1_LUFS)}:TP=${formatNumber(PASS1_TRUE_PEAK)}:print_format=json`,
    '-f',
    'null',
    '-',
  ];
}

/**
 * Pass 2. `linear=true` preserves the dynamics the cleanup earned; dynamic
 * mode is a last resort and the caller should detect a silent fallback by
 * comparing the measured output to the target.
 */
export function buildLoudnormPass2(
  input: string,
  output: string,
  targetLufs: number,
  truePeak: number,
  measured: LoudnormResult,
): string[] {
  assertNonEmptyString('input', input);
  assertNonEmptyString('output', output);
  assertFiniteNumber('targetLufs', targetLufs);
  assertFiniteNumber('truePeak', truePeak);
  if (targetLufs >= 0 || targetLufs < -60) {
    throw new RangeError(`targetLufs must be between -60 and 0, received ${targetLufs}.`);
  }
  if (truePeak > 0 || truePeak < -20) {
    throw new RangeError(`truePeak must be between -20 and 0, received ${truePeak}.`);
  }
  assertFiniteNumber('measured.inputI', measured.inputI);
  assertFiniteNumber('measured.inputTp', measured.inputTp);
  assertFiniteNumber('measured.inputLra', measured.inputLra);
  assertFiniteNumber('measured.inputThresh', measured.inputThresh);

  const filter = [
    `loudnorm=I=${formatNumber(targetLufs)}`,
    `TP=${formatNumber(truePeak)}`,
    `LRA=${targetLra(targetLufs)}`,
    `measured_I=${formatNumber(measured.inputI)}`,
    `measured_TP=${formatNumber(measured.inputTp)}`,
    `measured_LRA=${formatNumber(measured.inputLra)}`,
    `measured_thresh=${formatNumber(measured.inputThresh)}`,
    'linear=true',
    'print_format=summary',
  ].join(':');

  return [
    '-hide_banner',
    '-y',
    '-i',
    input,
    '-af',
    filter,
    '-ar',
    '48000',
    '-c:a',
    'pcm_s24le',
    output,
  ];
}

/**
 * Parse the flat JSON object FFmpeg's loudnorm filter prints to stderr. The
 * filter prints values as strings, so both strings and numbers are accepted.
 * Missing or unusable measurements are `E_LOUDNORM`, never a guessed default.
 */
export function parseLoudnormJson(stderr: string): LoudnormResult {
  const blocks = stderr.match(/\{[^{}]*\}/g) ?? [];

  // If a caller concatenates logs, the last complete block is the live pass.
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const inputI = readNumber(parsed, 'input_i');
    const inputTp = readNumber(parsed, 'input_tp');
    const inputLra = readNumber(parsed, 'input_lra');
    const inputThresh = readNumber(parsed, 'input_thresh');
    if (
      inputI === undefined ||
      inputTp === undefined ||
      inputLra === undefined ||
      inputThresh === undefined
    ) {
      continue;
    }

    return { inputI, inputTp, inputLra, inputThresh };
  }

  throw new AudioError(
    'E_LOUDNORM',
    'E_LOUDNORM: FFmpeg stderr contained no usable loudnorm JSON block.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
