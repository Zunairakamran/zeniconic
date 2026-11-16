import type { Size } from './geometry';

export interface TextStyle {
  size: number;
  advance: number;
  weight: number;
  pad: number;
}

export const OVERLAY_STYLES: Record<string, TextStyle> = {
  price_lower: { size: 96, advance: 0.58, weight: 700, pad: 18 },
  cta_card: { size: 44, advance: 0.52, weight: 600, pad: 20 },
  spec_pill: { size: 34, advance: 0.52, weight: 500, pad: 14 },
  address_tag: { size: 32, advance: 0.52, weight: 500, pad: 12 },
  room_label: { size: 40, advance: 0.5, weight: 500, pad: 10 },
  caption: { size: 40, advance: 0.5, weight: 500, pad: 0 },
  small_print: { size: 24, advance: 0.52, weight: 400, pad: 6 },
};

const BASE_CANVAS_W = 1080;
const LINE_HEIGHT = 1.15;
const DEFAULT_MAX_WIDTH_PCT = 90;

export function estimateTextBox(
  text: string,
  style: TextStyle,
  canvasW: number,
  maxWidthPct: number = DEFAULT_MAX_WIDTH_PCT,
): Size {
  if (!Number.isFinite(canvasW) || canvasW <= 0) {
    throw new RangeError(`Canvas width must be a positive number, received ${canvasW}`);
  }
  if (!Number.isFinite(maxWidthPct) || maxWidthPct <= 0 || maxWidthPct > 100) {
    throw new RangeError(`maxWidthPct must be within (0, 100], received ${maxWidthPct}`);
  }
  if (!Number.isFinite(style.size) || style.size <= 0 || !Number.isFinite(style.advance) || style.advance <= 0) {
    throw new RangeError('Text style needs a positive size and advance');
  }

  const scale = canvasW / BASE_CANVAS_W;
  const fontSize = style.size * scale;
  const advance = style.advance * fontSize;
  const maxWidth = (maxWidthPct / 100) * canvasW;
  const charsPerLine = Math.max(1, Math.floor(maxWidth / advance));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  const padding = 2 * style.pad * scale;

  const w = Math.round(Math.min(maxWidth, text.length * advance) + padding);
  const h = Math.round(lines * fontSize * LINE_HEIGHT + padding);

  return { w: Math.max(1, w), h: Math.max(1, h) };
}
