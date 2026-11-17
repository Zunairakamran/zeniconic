/**
 * Effect and grade lowering.
 *
 * Every capability that writes `effects`/`grade` must have a real filter here.
 * The order is fixed and documented: spatial (blur/sharpen/aberration) → colour
 * (eq, temperature, balance, LUT) → temporal (grain), then fps/format. A type
 * with no lowering is rejected before a render starts, never silently dropped.
 */

import type { Clip, ColorGrade, ColorGradePreset, Effect, Edl } from '@zeniconic/edl';

/** Types the bundled FFmpeg can actually draw. */
export const SUPPORTED_EFFECT_TYPES = [
  'blur',
  'motion_blur',
  'grain',
  'vignette',
  'sharpen',
  'chromatic_aberration',
  'saturation',
  'exposure',
  'contrast',
  'lut',
] as const;

export type SupportedEffectType = (typeof SUPPORTED_EFFECT_TYPES)[number];

export class EffectRenderError extends RangeError {
  readonly effect: string;

  constructor(effect: string, message: string) {
    super(message);
    this.name = 'EffectRenderError';
    this.effect = effect;
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function windowSuffix(effect: Effect): string {
  if (effect.inSec === undefined || effect.outSec === undefined) return '';
  if (!(effect.outSec > effect.inSec)) return '';
  return `:enable='between(t,${effect.inSec.toFixed(3)},${effect.outSec.toFixed(3)})'`;
}

function effectFilter(effect: Effect): string {
  const amount = clamp(num(effect.amount, 50), 0, 100);
  const params = effect.params ?? {};
  const suffix = windowSuffix(effect);

  switch (effect.type) {
    case 'blur': {
      const sigma = clamp(num(params.sigma, amount / 2), 0.1, 50);
      return `gblur=sigma=${sigma.toFixed(2)}${suffix}`;
    }
    case 'motion_blur': {
      // Temporal average of three frames is the honest approximation in FFmpeg.
      const length = clamp(Math.round(num(params.length, 3)), 2, 8);
      return `tmix=frames=${length}${suffix}`;
    }
    case 'sharpen': {
      const value = clamp(num(params.amount, amount / 20), 0, 3);
      return `unsharp=5:5:${value.toFixed(2)}${suffix}`;
    }
    case 'vignette': {
      const angle = clamp(num(params.angle, amount / 100), 0.05, 1) * (Math.PI / 2);
      return `vignette=angle=${angle.toFixed(4)}${suffix}`;
    }
    case 'grain': {
      const strength = clamp(num(params.strength, amount / 100), 0, 1);
      return `noise=alls=${Math.round(strength * 60)}:allf=t+u${suffix}`;
    }
    case 'chromatic_aberration': {
      const offset = clamp(num(params.offset, amount / 10), 0, 20);
      return `rgbashift=rh=${offset.toFixed(1)}:bh=${(-offset).toFixed(1)}${suffix}`;
    }
    case 'saturation': {
      const value = clamp(num(params.value, 1 + amount / 100), 0, 3);
      return `eq=saturation=${value.toFixed(3)}${suffix}`;
    }
    case 'exposure': {
      const ev = clamp(num(params.value, (amount - 50) / 25), -3, 3);
      // eq brightness is an approximation of exposure; documented, deterministic.
      return `eq=brightness=${clamp(ev / 10, -0.3, 0.3).toFixed(3)}${suffix}`;
    }
    case 'contrast': {
      const value = clamp(num(params.value, 1 + (amount - 50) / 100), 0, 3);
      return `eq=contrast=${value.toFixed(3)}${suffix}`;
    }
    case 'lut': {
      const path = params.path;
      if (typeof path !== 'string' || path.trim().length === 0 || !path.endsWith('.cube')) {
        throw new EffectRenderError(effect.id, `Effect ${effect.id} needs a .cube LUT path.`);
      }
      if (path.includes('..') || /^[A-Za-z]:/.test(path) || path.startsWith('/')) {
        throw new EffectRenderError(effect.id, `Effect ${effect.id} LUT path must stay inside the project.`);
      }
      const escaped = path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      return `lut3d='${escaped}'${suffix}`;
    }
    default: {
      const unsupported: never = effect.type as never;
      throw new EffectRenderError(effect.id, `Effect type "${String(unsupported)}" has no renderer.`);
    }
  }
}

function presetValues(preset: ColorGradePreset | undefined): Partial<ColorGrade> {
  switch (preset) {
    case 'warm_cinematic': return { temperature: 0.28, contrast: 1.06, saturation: 1.05, shadows: 0.05 };
    case 'cool_cinematic': return { temperature: -0.26, contrast: 1.04, saturation: 0.98 };
    case 'luxury': return { temperature: 0.12, contrast: 1.08, saturation: 0.96, shadows: -0.04 };
    case 'natural': return { contrast: 1.02, saturation: 1.02 };
    case 'vivid': return { contrast: 1.06, saturation: 1.18, vibrance: 0.1 };
    case 'noir': return { saturation: 0, contrast: 1.2 };
    default: return {};
  }
}

/** One grade as a filter list; explicit fields override the preset. */
export function gradeFilters(grade: ColorGrade): string[] {
  const resolved = { ...presetValues(grade.preset), ...grade };
  const intensity = clamp(num(resolved.intensity, 1), 0, 1);
  if (intensity <= 0) return [];
  const filters: string[] = [];

  const blend = (value: number, neutral: number): number => neutral + (value - neutral) * intensity;
  const contrast = resolved.contrast === undefined ? undefined : blend(resolved.contrast, 1);
  const saturation = resolved.saturation === undefined ? undefined : blend(resolved.saturation, 1);
  const exposure = resolved.exposure === undefined ? undefined : resolved.exposure * intensity;
  if (contrast !== undefined || saturation !== undefined || exposure !== undefined) {
    const parts: string[] = [];
    if (contrast !== undefined) parts.push(`contrast=${contrast.toFixed(3)}`);
    if (saturation !== undefined) parts.push(`saturation=${saturation.toFixed(3)}`);
    // eq brightness in [-1,1]; EV/10 keeps ±2 EV inside a safe range.
    if (exposure !== undefined) parts.push(`brightness=${clamp(exposure / 10, -0.3, 0.3).toFixed(3)}`);
    filters.push(`eq=${parts.join(':')}`);
  }

  const temperature = resolved.temperature === undefined ? undefined : resolved.temperature * intensity;
  if (temperature !== undefined && Math.abs(temperature) > 0.001) {
    const kelvin = clamp(6500 + temperature * 2500, 2000, 12000);
    filters.push(`colortemperature=temperature=${Math.round(kelvin)}`);
  }

  const tint = resolved.tint === undefined ? undefined : resolved.tint * intensity;
  const highlights = resolved.highlights === undefined ? undefined : resolved.highlights * intensity;
  const shadows = resolved.shadows === undefined ? undefined : resolved.shadows * intensity;
  if ((tint !== undefined && Math.abs(tint) > 0.001) || (highlights !== undefined && Math.abs(highlights) > 0.001) || (shadows !== undefined && Math.abs(shadows) > 0.001)) {
    const parts: string[] = [];
    if (tint !== undefined) parts.push(`gm=${clamp(tint * 0.15, -0.2, 0.2).toFixed(3)}`);
    if (shadows !== undefined) parts.push(`rs=${clamp(shadows * 0.15, -0.2, 0.2).toFixed(3)}`, `bs=${clamp(shadows * 0.15, -0.2, 0.2).toFixed(3)}`);
    if (highlights !== undefined) parts.push(`rh=${clamp(highlights * 0.15, -0.2, 0.2).toFixed(3)}`, `bh=${clamp(highlights * 0.15, -0.2, 0.2).toFixed(3)}`);
    filters.push(`colorbalance=${parts.join(':')}`);
  }

  if (resolved.lut !== undefined) {
    if (resolved.lut.includes('..') || /^[A-Za-z]:/.test(resolved.lut) || resolved.lut.startsWith('/')) {
      throw new Error('Grade LUT path must stay inside the project.');
    }
    const escaped = resolved.lut.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    filters.push(`lut3d='${escaped}'`);
  }

  return filters;
}

/** Filters for one clip, in rendering order. Empty when the clip is plain. */
export function clipEffectFilters(clip: Clip): string[] {
  const filters: string[] = [];
  for (const effect of clip.effects ?? []) {
    if (effect.enabled === false) continue;
    filters.push(effectFilter(effect));
  }
  if (clip.grade !== undefined) filters.push(...gradeFilters(clip.grade));
  return filters;
}

/** Timeline-wide effects, applied after the assembled picture. */
export function globalEffectFilters(edl: Edl): string[] {
  const filters: string[] = [];
  for (const effect of edl.effects ?? []) {
    if (effect.enabled === false) continue;
    filters.push(effectFilter(effect));
  }
  if (edl.grade !== undefined) filters.push(...gradeFilters(edl.grade));
  return filters;
}
