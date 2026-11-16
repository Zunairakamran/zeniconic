/**
 * Restoration chain for the voice.
 *
 * This is restoration: every step removes something that should not be there.
 * Nothing here invents detail or restores missing highs. When the measured
 * defects are fatal, the caller replaces the voice instead of running this
 * chain.
 *
 * Order is the order in `docs/AUDIO-VOICE.md`:
 *
 *   adeclip (only when requested) → DeepFilterNet (separate binary) →
 *   high-pass 90 Hz → de-ess → presence → compression
 *
 * DeepFilterNet is not an FFmpeg filter. `buildDenoiseArgs` returns its argv;
 * callers run it first and pass its output to `buildRestoreArgs`. The `denoise`
 * flag is declarative: it records that DeepFilterNet already ran, so the chain
 * must not add a second denoiser.
 */

import { assertFiniteNumber, assertNonEmptyString, formatNumber } from './format';

export interface RestoreOptions {
  /** DeepFilterNet already ran upstream; its output is the `input` argument. */
  denoise?: boolean;
  /** Mild CPU dereverb. Never claims to remove a hard room's tail. */
  dereverb?: boolean;
  deess?: boolean;
  /** Default 90; 110 for the mild de-reverb path from the reference chain. */
  highPassHz?: number;
  /** Presence lift at 3.3 kHz in dB. Omit or pass 0 for a dull-safe chain. */
  presenceDb?: number;
  /** Default true. */
  compress?: boolean;
  /** Cosmetic adeclip pass. Only for measured clipping; it recovers nothing. */
  declip?: boolean;
}

/** FFmpeg's de-esser, gentle enough to leave the words alone. */
const DEESS = 'deesser=i=0.35:m=0.5:f=0.5';
const DEESS_DEREVERB = 'deesser=i=0.45:m=0.5:f=0.5';

/** 3:1, 10 ms attack in the doc's table is expressed as 6 ms by the reference
 * chain; the reference command is authoritative for the filter string. */
const COMPRESSOR =
  'acompressor=threshold=-20dB:ratio=3:attack=6:release=180:makeup=3:knee=2.5';

/** The mild chain in `enhancement-chain.md`; partial, not a removal. */
const DEREVERB_FALLBACK = 'afftdn=nr=6:tn=1:tr=1';

const DEFAULT_HIGH_PASS_HZ = 90;
const DEREVERB_HIGH_PASS_HZ = 110;
const MIN_HIGH_PASS_HZ = 20;
const MAX_HIGH_PASS_HZ = 500;
const MAX_PRESENCE_DB = 12;

/** DeepFilterNet3, speech-preserving, 15 dB attenuation ceiling. */
export const DEEP_FILTER_POST_FILTER = '--post-filter';
export const DEEP_FILTER_ATTEN_LIM_DB = '15';

/**
 * argv for DeepFilterNet. `output` is the destination **directory** (`-o`),
 * because that is what the CLI accepts; it writes `<directory>/<basename>`.
 * Do not add `--no-delay-compensate`: that flag is for live monitoring only.
 */
export function buildDenoiseArgs(input: string, output: string): string[] {
  assertNonEmptyString('input', input);
  assertNonEmptyString('output', output);

  return [
    DEEP_FILTER_POST_FILTER,
    '--atten-lim-db',
    DEEP_FILTER_ATTEN_LIM_DB,
    '-o',
    output,
    input,
  ];
}

/**
 * FFmpeg argv for the steps FFmpeg owns. The returned array starts at the
 * ffmpeg binary's arguments (no executable token), like the other builders.
 */
export function buildRestoreArgs(
  input: string,
  output: string,
  opts: RestoreOptions = {},
): string[] {
  assertNonEmptyString('input', input);
  assertNonEmptyString('output', output);

  const filters: string[] = [];

  if (opts.declip === true) {
    // Cosmetic only: smooths the flat top, does not restore the lost peak.
    filters.push('adeclip=threshold=0.9');
  }

  if (opts.dereverb === true && opts.denoise !== true) {
    // With DeepFilterNet upstream this would be a second denoiser, which the
    // reference forbids: DFN already suppresses some tail energy.
    filters.push(DEREVERB_FALLBACK);
  }

  const highPassHz =
    opts.highPassHz ??
    (opts.dereverb === true ? DEREVERB_HIGH_PASS_HZ : DEFAULT_HIGH_PASS_HZ);
  if (!Number.isFinite(highPassHz) || highPassHz < 0 || highPassHz > MAX_HIGH_PASS_HZ) {
    throw new RangeError(
      `highPassHz must be between 0 and ${MAX_HIGH_PASS_HZ}, received ${String(opts.highPassHz)}.`,
    );
  }
  if (highPassHz >= MIN_HIGH_PASS_HZ) {
    filters.push(`highpass=f=${formatNumber(highPassHz)}:poles=2`);
  }

  if (opts.deess === true) {
    filters.push(opts.dereverb === true ? DEESS_DEREVERB : DEESS);
  }

  const presenceDb = opts.presenceDb;
  if (presenceDb !== undefined) {
    assertFiniteNumber('presenceDb', presenceDb);
    if (presenceDb < -MAX_PRESENCE_DB || presenceDb > MAX_PRESENCE_DB) {
      throw new RangeError(
        `presenceDb must be between -${MAX_PRESENCE_DB} and ${MAX_PRESENCE_DB}, received ${presenceDb}.`,
      );
    }
    if (presenceDb !== 0) {
      // A 3.3 kHz peaking EQ is the reference chain's "presence shelf"; it
      // brightens a dull mic, it does not restore missing detail.
      filters.push(`equalizer=f=3300:t=q:w=1.2:g=${formatNumber(presenceDb)}`);
    }
  }

  if (opts.compress !== false) {
    filters.push(COMPRESSOR);
  }

  const args = ['-hide_banner', '-y', '-i', input];
  if (filters.length > 0) {
    args.push('-af', filters.join(','));
  }
  args.push('-ar', '48000', '-c:a', 'pcm_s24le', output);
  return args;
}
