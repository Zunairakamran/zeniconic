/**
 * Brand kit resolution.
 *
 * Colours fall back to the design tokens, never to a literal inside a
 * component, so the video and the app cannot drift apart.
 */

import type { BrandKit } from './types';

export interface ResolvedColours {
  brass: string;
  ink: string;
  paper: string;
}

/** Warm paper, near-black ink and brass, from docs/design/tokens.css. */
export const DEFAULT_COLOURS: ResolvedColours = Object.freeze({
  brass: '#B08A4A',
  ink: '#14120F',
  paper: '#F7F4EF',
});

export const DEFAULT_FONT_DISPLAY = 'Bricolage Grotesque';
export const DEFAULT_FONT_UI = 'Archivo';

/** Arabic needs a face Archivo does not carry; the system face is the fallback. */
export const RTL_FALLBACK_STACK = "'Noto Sans Arabic', 'Segoe UI', 'Arial', sans-serif";

export function resolveColours(brand?: BrandKit): ResolvedColours {
  return {
    brass: brand?.colours?.brass ?? DEFAULT_COLOURS.brass,
    ink: brand?.colours?.ink ?? DEFAULT_COLOURS.ink,
    paper: brand?.colours?.paper ?? DEFAULT_COLOURS.paper,
  };
}

export function fontStack(family: string, fallback = 'Archivo'): string {
  return `'${family}', '${fallback}', 'Helvetica Neue', Arial, sans-serif`;
}

/** `Permit No. 12345 · ORN 67890`, minus the permit number we do not collect. */
export function permitText(brand: BrandKit): string | null {
  const orn = brand.orn?.trim();
  return orn ? `ORN ${orn}` : null;
}
