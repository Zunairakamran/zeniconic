export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type Anchor =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'center'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

const EPSILON = 1e-9;

export function safeRect(width: number, height: number, safe: SafeArea): Rect {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Canvas must be a positive size, received ${width}x${height}`);
  }
  for (const edge of [safe.top, safe.bottom, safe.left, safe.right]) {
    if (!Number.isFinite(edge) || edge < 0) {
      throw new RangeError('Safe area insets must be finite, non-negative numbers');
    }
  }

  const w = width - safe.left - safe.right;
  const h = height - safe.top - safe.bottom;
  if (w <= 0 || h <= 0) {
    throw new RangeError(`Safe area leaves no content box: ${w}x${h}`);
  }

  return { x: safe.left, y: safe.top, w, h };
}

function anchorX(anchor: Anchor, box: Size, canvas: Size, safe: SafeArea): number {
  if (anchor.endsWith('_left')) return safe.left;
  if (anchor.endsWith('_right')) return canvas.w - safe.right - box.w;
  // Centre inside the safe rect, not the full canvas: the vertical profile's
  // right inset is larger than its left, so canvas-centring sits off-centre.
  return safe.left + (canvas.w - safe.left - safe.right - box.w) / 2;
}

function anchorY(anchor: Anchor, box: Size, canvas: Size, safe: SafeArea): number {
  if (anchor.startsWith('top_')) return safe.top;
  if (anchor.startsWith('bottom_')) return canvas.h - safe.bottom - box.h;
  return safe.top + (canvas.h - safe.top - safe.bottom - box.h) / 2;
}

export function placeOverlay(
  box: Size,
  anchor: Anchor,
  canvas: Size,
  safe: SafeArea,
): { rect: Rect; valid: boolean; reasons: string[] } {
  for (const dimension of [box.w, box.h]) {
    if (!Number.isFinite(dimension) || dimension < 0) {
      throw new RangeError(`Overlay box must be a finite, non-negative size, received ${box.w}x${box.h}`);
    }
  }

  const bounds = safeRect(canvas.w, canvas.h, safe);
  const x = anchorX(anchor, box, canvas, safe);
  const y = anchorY(anchor, box, canvas, safe);
  const rect: Rect = { x, y, w: box.w, h: box.h };

  const reasons: string[] = [];
  if (box.w > bounds.w + EPSILON) reasons.push('too_wide');
  if (box.h > bounds.h + EPSILON) reasons.push('too_tall');

  const outside =
    x < bounds.x - EPSILON ||
    y < bounds.y - EPSILON ||
    x + box.w > bounds.x + bounds.w + EPSILON ||
    y + box.h > bounds.y + bounds.h + EPSILON;
  if (outside) reasons.push('out_of_bounds');

  return { rect, valid: reasons.length === 0, reasons };
}
