/**
 * Synthetic frame builders for the analysis suite.
 *
 * Every helper is deterministic: the same arguments produce byte-identical frames,
 * which is what makes the determinism tests meaningful.
 */

import type { Frame, FrameMetrics } from '../src/index';

export const DEFAULT_WIDTH = 64;
export const DEFAULT_HEIGHT = 48;

export interface FrameOptions {
  index?: number;
  t?: number;
  width?: number;
  height?: number;
  colour?: Uint8Array;
}

export function makeFrame(gray: Uint8Array, opts: FrameOptions = {}): Frame {
  const frame: Frame = {
    index: opts.index ?? 0,
    t: opts.t ?? 0,
    width: opts.width ?? DEFAULT_WIDTH,
    height: opts.height ?? DEFAULT_HEIGHT,
    gray,
  };
  if (opts.colour !== undefined) frame.colour = opts.colour;
  return frame;
}

export function solidFrame(value: number, opts: FrameOptions = {}): Frame {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const gray = new Uint8Array(width * height).fill(clampByte(value));
  return makeFrame(gray, { ...opts, width, height });
}

/** Diagonal ramp: 75% of the range across the width, 25% down the height. */
export function gradientFrame(opts: FrameOptions = {}): Frame {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const gray = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const fy = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const fx = width <= 1 ? 0 : x / (width - 1);
      gray[y * width + x] = Math.round(255 * (0.75 * fx + 0.25 * fy));
    }
  }

  return makeFrame(gray, { ...opts, width, height });
}

/** 1 px checkerboard by default: maximal detail for a Laplacian. */
export function checkerboardFrame(
  opts: FrameOptions & { cell?: number; light?: number; dark?: number } = {},
): Frame {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const cell = opts.cell ?? 1;
  const light = clampByte(opts.light ?? 255);
  const dark = clampByte(opts.dark ?? 0);
  const gray = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const lit = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      gray[y * width + x] = lit ? light : dark;
    }
  }

  return makeFrame(gray, { ...opts, width, height });
}

/** Uniform per-pixel noise — sharp, but impossible to predict frame to frame. */
export function noiseFrame(seed: number, opts: FrameOptions = {}): Frame {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const random = mulberry32(seed);
  const gray = new Uint8Array(width * height);

  for (let p = 0; p < gray.length; p += 1) {
    gray[p] = Math.floor(random() * 256);
  }

  return makeFrame(gray, { ...opts, width, height });
}

/** 3×3 (or wider) box blur with clamped edges: the low-detail counterpart of a frame. */
export function boxBlurredFrame(frame: Frame, radius = 1, passes = 1): Frame {
  let current = frame;
  for (let pass = 0; pass < passes; pass += 1) current = boxBlurPass(current, radius);
  return current;
}

function boxBlurPass(frame: Frame, radius: number): Frame {
  const { width, height, gray } = frame;
  const gray2 = new Uint8Array(gray.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sy = clampIndex(y + dy, height);
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = clampIndex(x + dx, width);
          sum += gray[sy * width + sx] ?? 0;
          count += 1;
        }
      }
      gray2[y * width + x] = Math.round(sum / count);
    }
  }

  return makeFrame(gray2, {
    index: frame.index,
    t: frame.t,
    width,
    height,
  });
}

/** Translate content, leaving zero-filled edges behind (a real handheld jolt). */
export function shiftedFrame(frame: Frame, dx: number, dy: number): Frame {
  return translate(frame, dx, dy, false);
}

/** Translate content cyclically (a true pan, no edge fill to confuse the search). */
export function cyclicShiftFrame(frame: Frame, dx: number, dy: number): Frame {
  return translate(frame, dx, dy, true);
}

export function withTiming(frame: Frame, index: number, fps = 10): Frame {
  return { ...frame, index, t: index / fps };
}

/** Build a run of frames, numbering and timing them at `fps` (default 10). */
export function sequence(
  count: number,
  build: (index: number) => Frame,
  opts: { fps?: number } = {},
): Frame[] {
  const fps = opts.fps ?? 10;
  return Array.from({ length: count }, (_, index) => withTiming(build(index), index, fps));
}

export function colourBuffer(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Uint8Array {
  const colour = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const p = (y * width + x) * 3;
      colour[p] = clampByte(r);
      colour[p + 1] = clampByte(g);
      colour[p + 2] = clampByte(b);
    }
  }
  return colour;
}

/** Handcrafted metric series for segmentation tests, one frame per difference. */
export function metricSeries(diffs: readonly number[], tStep = 0.1): FrameMetrics[] {
  return diffs.map((meanAbsDiff, index) => ({
    index,
    t: Math.round(index * tStep * 1000) / 1000,
    meanAbsDiff,
    blur: 0,
    shake: 0,
    exposureClipLow: 0,
    exposureClipHigh: 0,
    motionEnergy: meanAbsDiff / 255,
    colourfulness: 0,
  }));
}

/** Indexed read that throws instead of returning `undefined` under noUncheckedIndexedAccess. */
export function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`No item at index ${index}`);
  return item;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function translate(frame: Frame, dx: number, dy: number, wrap: boolean): Frame {
  const { width, height, gray } = frame;
  const sourceColour = frame.colour;
  const nextGray = new Uint8Array(gray.length);
  const nextColour = sourceColour === undefined ? undefined : new Uint8Array(sourceColour.length);

  for (let y = 0; y < height; y += 1) {
    const sy = wrap ? mod(y - dy, height) : y - dy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = wrap ? mod(x - dx, width) : x - dx;
      if (sx < 0 || sx >= width) continue;

      const target = y * width + x;
      const source = sy * width + sx;
      nextGray[target] = gray[source] ?? 0;

      if (nextColour !== undefined && sourceColour !== undefined) {
        for (let channel = 0; channel < 3; channel += 1) {
          nextColour[target * 3 + channel] = sourceColour[source * 3 + channel] ?? 0;
        }
      }
    }
  }

  return makeFrame(nextGray, {
    index: frame.index,
    t: frame.t,
    width,
    height,
    ...(nextColour === undefined ? {} : { colour: nextColour }),
  });
}

function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clampIndex(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}
