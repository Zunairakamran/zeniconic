/**
 * Type and colour helpers for the composition.
 *
 * Sizes are specified at a 1080-wide canvas and scaled from there, per
 * docs/OVERLAYS.md. Nothing here reads a design token at runtime; the values
 * are the tokens, copied once.
 */

import type { CanvasSpec } from '../../../packages/overlays/src/types';

const BASE_CANVAS_W = 1080;

export function scaleFor(canvas: Pick<CanvasSpec, 'width'>): number {
  return canvas.width / BASE_CANVAS_W;
}

/** Rounds a 1080-width size to this canvas. */
export function px(base: number, canvas: Pick<CanvasSpec, 'width'>): number {
  return Math.round(base * scaleFor(canvas));
}

export const DISPLAY_FONT = "'Bricolage Grotesque', 'Archivo', 'Helvetica Neue', Arial, sans-serif";
export const UI_FONT = "'Archivo', 'Helvetica Neue', Arial, sans-serif";

export const STAGE = '#0E0D0B';

/** A shadow dark enough to hold paper type over a bright window. */
export function legibilityShadow(strength: 'normal' | 'strong' = 'normal'): string {
  if (strength === 'strong') {
    return '0 2px 20px rgba(20, 18, 15, 0.78), 0 1px 4px rgba(20, 18, 15, 0.6)';
  }
  return '0 2px 14px rgba(20, 18, 15, 0.55), 0 1px 3px rgba(20, 18, 15, 0.4)';
}
