/**
 * Per-frame quality metrics for a decoded frame stream.
 *
 * Pure by design: a frame is already-decoded luma (and optional RGB) in memory, so
 * this module never touches a decoder, the filesystem, the network or the clock.
 * Same frames in, same numbers out.
 */

export interface Frame {
  index: number;
  t: number;
  width: number;
  height: number;
  /** Luma, row-major, exactly `width * height` bytes. */
  gray: Uint8Array;
  /** Optional RGB, row-major, exactly `width * height * 3` bytes. */
  colour?: Uint8Array;
}

export interface FrameMetrics {
  index: number;
  t: number;
  /** Mean absolute luma difference from the previous frame, 0..255. First frame is 0. */
  meanAbsDiff: number;
  /** 0 is crisp detail, 1 is flat or smeared. */
  blur: number;
  /** Residual motion after the best ±radius px shift, 0..255. First frame is 0. */
  shake: number;
  /** Fraction of pixels at or below the black clip point, 0..1. */
  exposureClipLow: number;
  /** Fraction of pixels at or above the highlight clip point, 0..1. */
  exposureClipHigh: number;
  /** `meanAbsDiff / 255`, 0..1. */
  motionEnergy: number;
  /** Hasler–Süsstrunk colourfulness normalised to 0..1; 0 without colour data. */
  colourfulness: number;
}

export interface AnalysisOpts {
  /** Integer pixel radius of the shake search. Default 3. */
  searchRadius?: number;
  /** Luma at or below this counts as crushed black. Default 16. */
  clipLow?: number;
  /** Luma at or above this counts as blown highlight. Default 240. */
  clipHigh?: number;
}

const DEFAULT_SEARCH_RADIUS = 3;
const DEFAULT_CLIP_LOW = 16;
const DEFAULT_CLIP_HIGH = 240;

/** Laplacian variance at which sharpness is fully credited; above this blur is 0. */
const SHARPNESS_SCALE = 500;

/** Hasler–Süsstrunk colourfulness value that maps to 1.0. */
const COLOURFULNESS_SCALE = 100;

/** Metrics land in JSON indexes, so keep them tidy and platform-stable. */
const METRIC_SCALE = 1_000_000;

interface ResolvedOptions {
  searchRadius: number;
  clipLow: number;
  clipHigh: number;
}

interface Shift {
  dx: number;
  dy: number;
}

export function analyseFrames(frames: Frame[], opts: AnalysisOpts = {}): FrameMetrics[] {
  const options = resolveOptions(opts);
  const shifts = buildShifts(options.searchRadius);
  const metrics: FrameMetrics[] = [];
  let previous: Frame | undefined;

  for (const frame of frames) {
    assertFrame(frame);

    const pixelCount = frame.width * frame.height;
    const gray = frame.gray;

    // Exposure is one pass over luma: count both tails at once.
    let clippedLow = 0;
    let clippedHigh = 0;
    for (let p = 0; p < pixelCount; p += 1) {
      const luma = gray[p] ?? 0;
      if (luma <= options.clipLow) clippedLow += 1;
      if (luma >= options.clipHigh) clippedHigh += 1;
    }

    let rawDiff = 0;
    let shake = 0;
    if (previous !== undefined) {
      const previousGray = previous.gray;
      // Frames from one stream share a size; if they ever do not, compare the overlap.
      const overlap = Math.min(gray.length, previousGray.length);
      let diffSum = 0;
      for (let p = 0; p < overlap; p += 1) {
        diffSum += Math.abs((gray[p] ?? 0) - (previousGray[p] ?? 0));
      }
      rawDiff = overlap === 0 ? 0 : diffSum / overlap;
      shake = roundMetric(shakeResidual(frame, previous, shifts));
    }

    metrics.push({
      index: frame.index,
      t: frame.t,
      meanAbsDiff: roundMetric(rawDiff),
      blur: roundMetric(blurScore(gray, frame.width, frame.height)),
      shake,
      exposureClipLow: roundMetric(clippedLow / pixelCount),
      exposureClipHigh: roundMetric(clippedHigh / pixelCount),
      motionEnergy: roundMetric(rawDiff / 255),
      colourfulness:
        frame.colour === undefined ? 0 : roundMetric(colourfulnessScore(frame.colour, pixelCount)),
    });

    previous = frame;
  }

  return metrics;
}

/**
 * 3×3 Laplacian `[0,1,0; 1,-4,1; 0,1,0]` over the interior. Flat regions respond 0,
 * edges respond strongly, so the variance of the response measures detail. The
 * variance is credited up to 500; beyond that the frame is as sharp as we care about.
 */
function blurScore(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 1;

  const samples = (width - 2) * (height - 2);
  let sum = 0;
  let sumSquares = 0;

  for (let y = 1; y < height - 1; y += 1) {
    let p = y * width + 1;
    for (let x = 1; x < width - 1; x += 1, p += 1) {
      const response =
        4 * (gray[p] ?? 0) -
        (gray[p - 1] ?? 0) -
        (gray[p + 1] ?? 0) -
        (gray[p - width] ?? 0) -
        (gray[p + width] ?? 0);
      sum += response;
      sumSquares += response * response;
    }
  }

  const mean = sum / samples;
  const variance = Math.max(0, sumSquares / samples - mean * mean);
  return clamp01(1 - Math.min(1, variance / SHARPNESS_SCALE));
}

/**
 * Smallest mean absolute difference between this frame and the previous one over
 * every integer shift within ±radius. Motion the best shift explains (a pan) leaves
 * a residual near 0; motion it cannot explain (handheld shake) stays high.
 */
function shakeResidual(frame: Frame, previous: Frame, shifts: readonly Shift[]): number {
  const current = frame.gray;
  const earlier = previous.gray;
  const currentWidth = frame.width;
  const earlierWidth = previous.width;

  let best = Number.POSITIVE_INFINITY;

  for (const shift of shifts) {
    const { dx, dy } = shift;

    // The shifted previous frame must stay inside both frames' bounds.
    const yStart = Math.max(0, -dy);
    const yEnd = Math.min(frame.height, previous.height - dy);
    const xStart = Math.max(0, -dx);
    const xEnd = Math.min(currentWidth, earlierWidth - dx);
    if (yEnd <= yStart || xEnd <= xStart) continue;

    const samples = (yEnd - yStart) * (xEnd - xStart);
    // Remaining terms are non-negative, so a partial sum past the current best
    // cannot win the search and the rest of this shift can be skipped.
    const limit = best === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : best * samples;

    let sum = 0;
    let abandoned = false;
    for (let y = yStart; y < yEnd; y += 1) {
      const currentRow = y * currentWidth;
      const earlierRow = (y + dy) * earlierWidth;
      for (let x = xStart; x < xEnd; x += 1) {
        sum += Math.abs((current[currentRow + x] ?? 0) - (earlier[earlierRow + x + dx] ?? 0));
      }
      if (sum >= limit) {
        abandoned = true;
        break;
      }
    }
    if (abandoned) continue;

    const residual = sum / samples;
    if (residual < best) best = residual;
  }

  return best === Number.POSITIVE_INFINITY ? 0 : best;
}

/**
 * Hasler–Süsstrunk: `sqrt(σrg² + σyb²) + 0.3·sqrt(μrg² + μyb²)` with
 * `rg = R - G` and `yb = ½(R + G) - B`. One pass keeps both moments of both channels.
 */
function colourfulnessScore(colour: Uint8Array, pixelCount: number): number {
  let rgSum = 0;
  let rgSquares = 0;
  let ybSum = 0;
  let ybSquares = 0;

  for (let p = 0, i = 0; p < pixelCount; p += 1, i += 3) {
    const r = colour[i] ?? 0;
    const g = colour[i + 1] ?? 0;
    const b = colour[i + 2] ?? 0;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgSum += rg;
    rgSquares += rg * rg;
    ybSum += yb;
    ybSquares += yb * yb;
  }

  const meanRg = rgSum / pixelCount;
  const meanYb = ybSum / pixelCount;
  const varianceRg = Math.max(0, rgSquares / pixelCount - meanRg * meanRg);
  const varianceYb = Math.max(0, ybSquares / pixelCount - meanYb * meanYb);

  const value =
    Math.sqrt(varianceRg + varianceYb) +
    0.3 * Math.sqrt(meanRg * meanRg + meanYb * meanYb);

  return clamp01(value / COLOURFULNESS_SCALE);
}

function buildShifts(radius: number): Shift[] {
  const shifts: Shift[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      shifts.push({ dx, dy });
    }
  }
  // Try small corrections first: the winner is usually near zero and then bounds
  // the remaining search immediately.
  shifts.sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)));
  return shifts;
}

function resolveOptions(opts: AnalysisOpts): ResolvedOptions {
  const searchRadius = opts.searchRadius ?? DEFAULT_SEARCH_RADIUS;
  if (!Number.isInteger(searchRadius) || searchRadius < 0) {
    throw new RangeError(
      `searchRadius must be a non-negative integer, received ${String(opts.searchRadius)}`,
    );
  }

  const clipLow = opts.clipLow ?? DEFAULT_CLIP_LOW;
  if (!Number.isFinite(clipLow) || clipLow < 0 || clipLow > 255) {
    throw new RangeError(`clipLow must be within 0..255, received ${String(opts.clipLow)}`);
  }

  const clipHigh = opts.clipHigh ?? DEFAULT_CLIP_HIGH;
  if (!Number.isFinite(clipHigh) || clipHigh < 0 || clipHigh > 255) {
    throw new RangeError(`clipHigh must be within 0..255, received ${String(opts.clipHigh)}`);
  }

  return { searchRadius, clipLow, clipHigh };
}

function assertFrame(frame: Frame): void {
  const where = `Frame ${frame.index}`;

  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new RangeError(
      `${where}: width and height must be positive integers, received ${frame.width}x${frame.height}`,
    );
  }

  if (!Number.isFinite(frame.t)) {
    throw new RangeError(`${where}: t must be a finite number, received ${String(frame.t)}`);
  }

  const pixelCount = frame.width * frame.height;
  if (frame.gray.length !== pixelCount) {
    throw new RangeError(
      `${where}: gray length ${frame.gray.length} does not match ${frame.width}x${frame.height} (${pixelCount})`,
    );
  }

  if (frame.colour !== undefined && frame.colour.length !== pixelCount * 3) {
    throw new RangeError(
      `${where}: colour length ${frame.colour.length} does not match ${frame.width}x${frame.height}x3 (${pixelCount * 3})`,
    );
  }
}

function roundMetric(value: number): number {
  const rounded = Math.round(value * METRIC_SCALE) / METRIC_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
