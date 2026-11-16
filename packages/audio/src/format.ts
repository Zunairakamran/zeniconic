/** Small numeric and string guards shared by the audio builders. */

export function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received ${String(value)}.`);
  }
}

export function assertNonEmptyString(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${name} must be a non-empty string.`);
  }
}

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Round half away from zero and normalise `-0`. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * FFmpeg filter values are text. Keep them free of trailing zeros so `-16.00`
 * and `-16` never produce two different filter graphs for the same setting.
 */
export function formatNumber(value: number, decimals = 2): string {
  return String(roundTo(value, decimals));
}
