import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Local beat detection for music beds.
 *
 * This is deliberately dependency-free and deterministic: an energy-flux onset
 * envelope on a 2.5 ms hop over a 40 ms sliding window, normalised
 * autocorrelation of that envelope across the requested tempo range, then a
 * comb search for the exact period and phase. It is a tempo *estimator*, not a
 * transcription tool — it reports one dominant tempo and an evenly spaced beat
 * list rounded to 3 dp, which is exactly what `snapCuts` consumes.
 *
 * Silence, near-silence and clips shorter than `minSec` return
 * `{ bpm: null, beats: [], confidence: 0 }` rather than throwing.
 */

export interface BeatDetectionOptions {
  /** Lower tempo search bound. Default 60. */
  minBpm?: number;
  /** Upper tempo search bound. Default 180. */
  maxBpm?: number;
  /** Clips shorter than this are rejected. Default 0.6 s. */
  minSec?: number;
}

export interface BeatDetectionResult {
  /** Estimated tempo rounded to 2 dp, or null when no tempo is credible. */
  bpm: number | null;
  /** Beat onsets in seconds, ascending, 3 dp, strictly inside the clip. */
  beats: number[];
  /** Share of onset energy that lands on the detected grid, 0..1. */
  confidence: number;
}

const DEFAULT_MIN_BPM = 60;
const DEFAULT_MAX_BPM = 180;
const DEFAULT_MIN_SEC = 0.6;
/** Onset-envelope hop. Frames overlap; see `WINDOW_SEC`. */
const HOP_SEC = 0.0025;
/** Analysis window: long enough to average several cycles of a bass note. */
const WINDOW_SEC = 0.04;
const EPS = 1e-12;
/** Priors keep the estimator from doubling/halving a clear pulse. */
const PRIOR_CENTRE_BPM = 120;
const PRIOR_OCTAVE_WIDTH = 0.9;

/** Decode rate used by `detectBeatsFromFile`; low enough to stay fast and local. */
export const BEAT_DECODE_SAMPLE_RATE = 22_050;

function emptyResult(): BeatDetectionResult {
  return { bpm: null, beats: [], confidence: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number, received ${String(value)}`);
  }
}

function resolveOptions(opts: BeatDetectionOptions): {
  minBpm: number;
  maxBpm: number;
  minSec: number;
} {
  const minBpm = opts.minBpm ?? DEFAULT_MIN_BPM;
  const maxBpm = opts.maxBpm ?? DEFAULT_MAX_BPM;
  const minSec = opts.minSec ?? DEFAULT_MIN_SEC;

  assertPositiveFinite(minBpm, 'minBpm');
  assertPositiveFinite(maxBpm, 'maxBpm');
  if (maxBpm <= minBpm) {
    throw new RangeError(`maxBpm (${maxBpm}) must be greater than minBpm (${minBpm})`);
  }
  if (!Number.isFinite(minSec) || minSec < 0) {
    throw new RangeError(`minSec must be a non-negative finite number, received ${String(minSec)}`);
  }

  return { minBpm, maxBpm, minSec };
}

/**
 * Tempo estimate and beat times from raw mono samples.
 *
 * The pipeline is:
 * 1. frame energy over a 40 ms sliding window, advanced on a 2.5 ms hop;
 * 2. positive log-energy flux — the onset envelope;
 * 3. normalised autocorrelation over the lag range for `minBpm..maxBpm`,
 *    weighted by a gentle octave prior around 120 BPM, then a fractional-lag
 *    search so the period is not rounded to a whole hop;
 * 4. a comb search over period and phase for the exact grid;
 * 5. an evenly spaced beat list at that period and phase.
 *
 * Tempi outside the search range are not reported: a 40 BPM click track either
 * resolves to an in-range multiple or is rejected as `bpm: null`.
 */
export function detectBeatsFromSamples(
  samples: Float32Array,
  sampleRate: number,
  opts: BeatDetectionOptions = {},
): BeatDetectionResult {
  assertPositiveFinite(sampleRate, 'sampleRate');
  const { minBpm, maxBpm, minSec } = resolveOptions(opts);

  const durationSec = samples.length / sampleRate;
  if (!Number.isFinite(durationSec) || durationSec < minSec) return emptyResult();

  const hopSize = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const windowSize = Math.max(hopSize, Math.round(sampleRate * WINDOW_SEC));
  if (samples.length < windowSize + hopSize * 8) return emptyResult();

  const blockCount = Math.floor((samples.length - windowSize) / hopSize) + 1;
  if (blockCount < 8) return emptyResult();

  // Frames advance by `hopSec` but measure a 40 ms window. A window shorter
  // than one cycle of the bass note makes the block RMS ripple at the note's
  // own frequency, which drowns the beat. The rise caused by energy entering
  // the window happens one window early, so onset times add `windowSec` back.
  const blockSec = hopSize / sampleRate;
  const windowSec = windowSize / sampleRate;

  // 1. Frame energy via prefix sums: O(n) regardless of window length.
  const energyPrefix = new Float64Array(samples.length + 1);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    energyPrefix[index + 1] = (energyPrefix[index] ?? 0) + sample * sample;
  }

  const energy = new Float64Array(blockCount);
  for (let block = 0; block < blockCount; block += 1) {
    const start = block * hopSize;
    energy[block] =
      ((energyPrefix[start + windowSize] ?? 0) - (energyPrefix[start] ?? 0)) / windowSize;
  }

  // 2. Positive log-energy flux. Equal (silent) neighbours contribute nothing.
  const onset = new Float64Array(blockCount);
  let maxOnset = 0;
  for (let block = 1; block < blockCount; block += 1) {
    const rise = Math.log((energy[block] ?? 0) + EPS) - Math.log((energy[block - 1] ?? 0) + EPS);
    const value = rise > 0 ? rise : 0;
    onset[block] = value;
    if (value > maxOnset) maxOnset = value;
  }
  // No energy change anywhere: silence, DC, or a perfectly flat tone. There is
  // no tempo to report, so do not guess one.
  if (!(maxOnset > 0)) return emptyResult();

  // 3. Autocorrelation over the legal lags, with a gentle tempo prior.
  const lagMin = Math.max(1, Math.round(60 / (maxBpm * blockSec)));
  const lagMax = Math.min(blockCount - 1, Math.round(60 / (minBpm * blockSec)));
  if (lagMax < lagMin) return emptyResult();

  const priorWeight = (tempo: number): number => {
    const octaves = Math.log2(tempo / PRIOR_CENTRE_BPM) / PRIOR_OCTAVE_WIDTH;
    return Math.exp(-0.5 * octaves * octaves);
  };

  const rawScores = new Float64Array(lagMax - lagMin + 1);
  for (let lag = lagMin; lag <= lagMax; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;

    for (let index = 0; index + lag < blockCount; index += 1) {
      const a = onset[index] ?? 0;
      const b = onset[index + lag] ?? 0;
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const norm = Math.sqrt(energyA * energyB);
    rawScores[lag - lagMin] = norm > 0 ? numerator / norm : 0;
  }

  const scoreAt = (lag: number): number => {
    if (lag < lagMin || lag > lagMax) return 0;
    return rawScores[lag - lagMin] ?? 0;
  };

  // A real beat period rarely lands on an integer block count, so an exact
  // lag is split across two neighbouring lags. Summing three adjacent lags
  // before comparing candidates keeps e.g. 120 BPM from losing to its 60 BPM
  // half-time (two-beat) multiple.
  let coarseLag = lagMin;
  let coarseBest = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag += 1) {
    const smoothed = scoreAt(lag - 1) + scoreAt(lag) + scoreAt(lag + 1);
    const weighted = smoothed * priorWeight(60 / (lag * blockSec));
    if (weighted > coarseBest) {
      coarseBest = weighted;
      coarseLag = lag;
    }
  }

  // 4. Fractional-lag search. Interpolating the onset envelope lets the score
  // peak at a non-integer lag instead of rounding the tempo.
  const onsetAt = (index: number): number => {
    if (index < 0 || index >= blockCount - 1) return 0;
    const base = Math.floor(index);
    const fraction = index - base;
    const a = onset[base] ?? 0;
    const b = onset[base + 1] ?? 0;
    return a + (b - a) * fraction;
  };

  const correlation = (periodBlocks: number): number => {
    const last = Math.floor(blockCount - periodBlocks);
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index <= last; index += 1) {
      const a = onset[index] ?? 0;
      const b = onsetAt(index + periodBlocks);
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const norm = Math.sqrt(energyA * energyB);
    return norm > 0 ? numerator / norm : 0;
  };

  let periodBlocks = coarseLag;
  let bestWeighted = -Infinity;
  let bestRaw = 0;
  const fineMin = Math.max(1, coarseLag - 1.5);
  const fineMax = coarseLag + 1.5;
  for (let candidate = fineMin; candidate <= fineMax + 1e-9; candidate += 0.05) {
    const raw = correlation(candidate);
    const weighted = raw * priorWeight(60 / (candidate * blockSec));
    if (weighted > bestWeighted) {
      bestWeighted = weighted;
      bestRaw = raw;
      periodBlocks = candidate;
    }
  }

  if (!(bestRaw > 1e-6)) return emptyResult();

  const periodSec = periodBlocks * blockSec;
  if (!Number.isFinite(periodSec) || periodSec <= 0) return emptyResult();

  // Require a few clear onset peaks above mean + 0.5 standard deviations before
  // trusting a tempo. A flat pad or DC offset has none, and must not be given a
  // made-up grid.
  let sum = 0;
  let sumSquares = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const value = onset[block] ?? 0;
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / blockCount;
  const variance = Math.max(0, sumSquares / blockCount - mean * mean);
  const threshold = mean + 0.5 * Math.sqrt(variance);

  const peakTimes: number[] = [];
  for (let block = 1; block < blockCount - 1; block += 1) {
    const value = onset[block] ?? 0;
    if (value < threshold) continue;
    if (value < (onset[block - 1] ?? 0) || value <= (onset[block + 1] ?? 0)) continue;
    // Energy enters the window one window early; adding `windowSec` back puts
    // the onset at the true attack time.
    peakTimes.push(block * blockSec + windowSec);
  }

  if (peakTimes.length < 3) return emptyResult();

  // 5. Comb search. The autocorrelation gives the right neighbourhood, but a
  // long clip exposes a 0.2–0.4% tempo error: the grid drifts by a tenth of a
  // second across 35 s, which is enough to cost a snap. So score candidate
  // periods by the onset energy they put on the grid and keep the best
  // (period, phase) pair. Phase is searched on the hop grid; the ±1 frame
  // window keeps a sharp attack from being lost between hops.
  const onGridEnergy = (periodSec: number, phaseSec: number): number => {
    let total = 0;
    for (let beat = 0; ; beat += 1) {
      const time = phaseSec + beat * periodSec;
      if (time >= durationSec) break;
      const frame = Math.round((time - windowSec) / blockSec);
      let local = 0;
      for (let offset = -1; offset <= 1; offset += 1) {
        const index = frame + offset;
        if (index < 0 || index >= blockCount) continue;
        const value = onset[index] ?? 0;
        if (value > local) local = value;
      }
      total += local;
    }
    return total;
  };

  const bestPhaseFor = (periodSec: number): { phase: number; score: number } => {
    const steps = Math.max(1, Math.round(periodSec / blockSec));
    let best = { phase: 0, score: -1 };
    for (let step = 0; step < steps; step += 1) {
      const phase = step * blockSec;
      const score = onGridEnergy(periodSec, phase);
      if (score > best.score) best = { phase, score };
    }
    return best;
  };

  let beatPeriod = periodSec;
  let grid = bestPhaseFor(beatPeriod);

  // Coarse then fine: ±3% at 0.3% steps reaches the true tempo even when the
  // autocorrelation peak is pulled by envelope shape (a 1.5% error is normal on
  // a pad), then ±0.3% at 0.03% steps locks the exact period.
  const searchPeriod = (min: number, max: number, step: number): void => {
    for (let candidate = min; candidate <= max + 1e-12; candidate += step) {
      const evaluated = bestPhaseFor(candidate);
      if (evaluated.score > grid.score) {
        grid = evaluated;
        beatPeriod = candidate;
      }
    }
  };
  searchPeriod(beatPeriod * 0.97, beatPeriod * 1.03, beatPeriod * 0.003);
  searchPeriod(beatPeriod * 0.997, beatPeriod * 1.003, beatPeriod * 0.0003);

  if (!(grid.score > 0)) return emptyResult();

  // Beats start at the estimated phase, not necessarily at 0, and stay strictly
  // inside the clip — same rule as `beatGridFromBpm`.
  const bpm = Math.round((60 / beatPeriod) * 100) / 100;
  if (!Number.isFinite(bpm) || bpm < minBpm || bpm > maxBpm) return emptyResult();

  const beats: number[] = [];
  const firstIndex = Math.ceil(-grid.phase / beatPeriod);
  for (let index = firstIndex; ; index += 1) {
    const time = grid.phase + index * beatPeriod;
    if (time >= durationSec) break;
    const rounded = round3(time);
    if (rounded >= 0 && rounded < durationSec) beats.push(rounded);
  }

  if (beats.length < 3) return emptyResult();

  const sorted = [...new Set(beats)].sort((a, b) => a - b);

  // Confidence = the share of onset energy that lands on the detected grid.
  // A clean pulse scores near 1; a pad whose energy is mostly between beats
  // scores low even when the period is unambiguous. This is more honest than
  // raw autocorrelation, which double-counts interpolated impulses.
  const tolerance = beatPeriod * 0.25;
  let gridEnergy = 0;
  let totalEnergy = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const value = onset[block] ?? 0;
    totalEnergy += value;
    if (value === 0) continue;
    const time = block * blockSec + windowSec;
    const phase = (((time - grid.phase) % beatPeriod) + beatPeriod) % beatPeriod;
    const distance = Math.min(phase, beatPeriod - phase);
    if (distance <= tolerance) gridEnergy += value;
  }
  const confidence =
    totalEnergy > 0 ? round3(clamp(gridEnergy / totalEnergy, 0, 1)) : 0;

  return { bpm, beats: sorted, confidence };
}

/**
 * Beat detection for an audio file on disk.
 *
 * Decodes through the bundled `ffmpeg-static` binary to mono f32le at
 * `BEAT_DECODE_SAMPLE_RATE`, then runs the pure detector. No network, no model,
 * no extra dependency. Throws only when the file cannot be decoded; a silent
 * but decodable file returns `bpm: null`.
 */
export function detectBeatsFromFile(
  file: string,
  opts: BeatDetectionOptions = {},
): BeatDetectionResult {
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
    { maxBuffer: 512 * 1024 * 1024 },
  );

  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) {
    const stderr = decoded.stderr ? decoded.stderr.toString('utf8').trim() : '';
    throw new Error(`ffmpeg could not decode "${file}" for beat detection: ${stderr}`);
  }

  const buffer: Buffer = decoded.stdout;
  const sampleCount = Math.floor(buffer.length / 4);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }

  return detectBeatsFromSamples(samples, BEAT_DECODE_SAMPLE_RATE, opts);
}
