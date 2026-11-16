/**
 * Overlay layout: measure, place, refuse if it does not fit.
 *
 * Every box is measured with the validator's `estimateTextBox` and placed with
 * `placeOverlay`. If the result leaves the safe area the overlay is omitted and
 * a sentence is returned for the user; nothing is clipped silently.
 */

import { placeOverlay } from '../../core/src/geometry';
import type { Rect, Size } from '../../core/src/geometry';
import { estimateTextBox, OVERLAY_STYLES } from '../../core/src/text';
import type { TextStyle } from '../../core/src/text';
import type { Edl, Overlay } from '../../edl/src/types';
import { canvasDurationSec, framesFor } from './timeline';
import type { BrandKit, CanvasSpec, OverlayLayout } from './types';

const BASE_CANVAS_W = 1080;
const DEFAULT_MAX_WIDTH_PCT = 90;
const MIN_MAX_WIDTH_PCT = 20;
const MAX_MAX_WIDTH_PCT = 100;

/** 120 px wide at a 1080-wide canvas, as specified in docs/OVERLAYS.md. */
export const LOGO_BASE_WIDTH = 120;
/** A lockup is usually wider than tall; this keeps the reserved box honest. */
export const LOGO_ASPECT = 0.52;

/** permit_line is not an EDL overlay style, so it carries its own metrics. */
export const PERMIT_STYLE: TextStyle = { size: 22, advance: 0.52, weight: 500, pad: 8 };

const REASON_TEXT: Record<string, string> = {
  too_wide: 'too wide',
  too_tall: 'too tall',
  out_of_bounds: 'outside the safe area',
};

export function scaleFor(canvas: Pick<CanvasSpec, 'width'>): number {
  return canvas.width / BASE_CANVAS_W;
}

export function textStyleFor(style: string): TextStyle {
  return OVERLAY_STYLES[style] ?? PERMIT_STYLE;
}

/** Secondary line: smaller, lighter, same face. */
export function subtextStyleFor(base: TextStyle): TextStyle {
  return {
    size: base.size * 0.42,
    advance: base.advance,
    weight: 400,
    pad: Math.max(2, base.pad * 0.5),
  };
}

function clampPct(pct: number | undefined): number {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return DEFAULT_MAX_WIDTH_PCT;
  return Math.min(MAX_MAX_WIDTH_PCT, Math.max(MIN_MAX_WIDTH_PCT, pct));
}

/**
 * Measures the box for one overlay. The logo is sized from the spec rather
 * than from its pixels: the file's intrinsic size is unknown at layout time,
 * and the renderer fits the image inside the reserved box.
 */
export function measureOverlay(overlay: Overlay, canvas: CanvasSpec): Size {
  const maxWidthPct = clampPct(overlay.maxWidthPct);
  const scale = scaleFor(canvas);

  if (overlay.style === 'logo_corner') {
    const maxW = (maxWidthPct / 100) * canvas.width;
    const w = Math.round(Math.min(LOGO_BASE_WIDTH * scale, maxW));
    return { w: Math.max(1, w), h: Math.max(1, Math.round(w * LOGO_ASPECT)) };
  }

  const style = textStyleFor(overlay.style);
  const primary = estimateTextBox(overlay.text ?? '', style, canvas.width, maxWidthPct);
  if (!overlay.subtext) return primary;

  const sub = estimateTextBox(overlay.subtext, subtextStyleFor(style), canvas.width, maxWidthPct);
  const gap = Math.round(10 * scale);
  return {
    w: Math.max(primary.w, sub.w),
    h: primary.h + gap + sub.h,
  };
}

/** True for the reverse-logical-order kinds we know about. */
function isPermitKind(overlay: Overlay): boolean {
  // `permit` is not in the EDL 1.0 enum yet; the export toggle can still add it.
  return (overlay.kind as string) === 'permit';
}

/** Human sentence for a placement failure. */
export function describeIssue(id: string, kind: string, reasons: readonly string[]): string {
  const friendly = reasons.map((reason) => REASON_TEXT[reason] ?? reason).join(', ');
  return `Overlay "${id}" (${kind}) does not fit inside the safe area (${friendly}) and was left out.`;
}

function shiftRect(rect: Rect, dy: number): Rect {
  return { ...rect, y: rect.y + dy };
}

function insideSafeArea(rect: Rect, canvas: CanvasSpec): boolean {
  const { safeArea } = canvas;
  return (
    rect.x >= safeArea.left - 1e-9 &&
    rect.y >= safeArea.top - 1e-9 &&
    rect.x + rect.w <= canvas.width - safeArea.right + 1e-9 &&
    rect.y + rect.h <= canvas.height - safeArea.bottom + 1e-9
  );
}

function overlapsInTime(a: OverlayLayout, b: OverlayLayout): boolean {
  return a.inFrame < b.outFrame && b.inFrame < a.outFrame;
}

function intersects(a: OverlayLayout, b: OverlayLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Separates boxes that share both a moment and a place.
 *
 * The smaller box is lifted above the larger one; if there is no room under the
 * safe-area top it is omitted with an issue. Two centred text blocks that
 * overlap are a layout mistake, not an acceptable crop.
 */
function separate(layouts: OverlayLayout[], canvas: CanvasSpec, issues: string[]): OverlayLayout[] {
  const gap = Math.round(16 * scaleFor(canvas));
  const dropped = new Set<string>();
  const guard = layouts.length * layouts.length + 2;

  for (let pass = 0; pass < guard; pass += 1) {
    let changed = false;

    for (let i = 0; i < layouts.length && !changed; i += 1) {
      const a = layouts[i];
      if (!a || dropped.has(a.id)) continue;

      for (let j = i + 1; j < layouts.length; j += 1) {
        const b = layouts[j];
        if (!b || dropped.has(b.id)) continue;
        if (!overlapsInTime(a, b) || !intersects(a, b)) continue;

        const areaA = a.w * a.h;
        const areaB = b.w * b.h;
        const liftA = areaA < areaB || (areaA === areaB && i > j);
        const target = liftA ? a : b;
        const anchor = liftA ? b : a;
        const nextY = anchor.y - target.h - gap;

        if (nextY < canvas.safeArea.top) {
          dropped.add(target.id);
          issues.push(
            `Overlay "${target.id}" (${target.style}) overlaps "${anchor.id}" (${anchor.style}) and cannot be lifted inside the safe area, so it was left out.`,
          );
        } else {
          target.y = nextY;
        }

        changed = true;
        break;
      }
    }

    if (!changed) break;
  }

  return layouts.filter((layout) => !dropped.has(layout.id));
}

/**
 * Lifts bottom-anchored overlays clear of burned captions.
 *
 * Captions own the line at `height − safeArea.bottom`; a lower third scheduled
 * over speech would otherwise print on top of them. The lift is the height of
 * the tallest overlapping cue plus a gap, and is skipped when it would leave the
 * safe area.
 */
export function avoidCaptions(
  layouts: OverlayLayout[],
  cues: Array<{ startFrame: number; endFrame: number; lines: string[] }>,
  canvas: CanvasSpec,
): OverlayLayout[] {
  if (cues.length === 0) return layouts;

  const scale = scaleFor(canvas);
  const lineHeight = 40 * 1.12 * scale;
  const gap = 16 * scale;
  const bottomEdge = canvas.height - canvas.safeArea.bottom;

  return layouts.map((layout) => {
    if (layout.style === 'caption') return layout;
    if (layout.y + layout.h <= bottomEdge - 1) return layout;

    const overlapping = cues.filter(
      (cue) => layout.inFrame < cue.endFrame && cue.startFrame < layout.outFrame,
    );
    if (overlapping.length === 0) return layout;

    const lines = Math.max(...overlapping.map((cue) => Math.max(1, cue.lines.length)), 1);
    const y = Math.round(layout.y - (lines * lineHeight + gap));
    if (y < canvas.safeArea.top) return layout;

    return { ...layout, y };
  });
}

/**
 * Lays out every EDL overlay against the safe area.
 *
 * Windows are clipped to the composition. An overlay that starts after the
 * end, or ends before it starts, is omitted with an issue: the renderer never
 * draws an overlay outside the timeline it was given.
 */
export function layoutOverlays(
  edl: Edl,
  canvas: CanvasSpec,
): { layouts: OverlayLayout[]; issues: string[] } {
  if (!Number.isFinite(canvas.width) || canvas.width <= 0 || !Number.isFinite(canvas.height) || canvas.height <= 0) {
    throw new RangeError(`Canvas must be a positive size, received ${canvas.width}x${canvas.height}`);
  }
  if (!Number.isFinite(canvas.fps) || canvas.fps <= 0) {
    throw new RangeError(`Canvas fps must be a positive number, received ${canvas.fps}`);
  }

  const durationSec = canvasDurationSec(edl);
  const totalFrames = framesFor(durationSec, canvas.fps);
  if (totalFrames <= 0) {
    return { layouts: [], issues: ['The timeline is empty, so no overlays were laid out.'] };
  }

  const layouts: OverlayLayout[] = [];
  const issues: string[] = [];

  for (const overlay of edl.overlays) {
    const style = isPermitKind(overlay) ? 'permit_line' : overlay.style;
    const needsText = style !== 'logo_corner';
    const text = (overlay.text ?? '').trim();

    if (needsText && text.length === 0) {
      issues.push(`Overlay "${overlay.id}" (${overlay.kind}) has no text and was left out.`);
      continue;
    }

    const rawIn = framesFor(overlay.inSec, canvas.fps);
    const rawOut = framesFor(overlay.outSec, canvas.fps);
    if (rawOut <= rawIn) {
      issues.push(
        `Overlay "${overlay.id}" (${overlay.kind}) ends before it starts (${overlay.inSec}–${overlay.outSec} s) and was left out.`,
      );
      continue;
    }
    if (rawIn >= totalFrames) {
      issues.push(
        `Overlay "${overlay.id}" (${overlay.kind}) starts after the end of the video (${overlay.inSec} s of ${durationSec.toFixed(1)} s) and was left out.`,
      );
      continue;
    }

    const inFrame = Math.max(0, rawIn);
    const outFrame = Math.min(rawOut, totalFrames);
    if (outFrame <= inFrame) {
      issues.push(`Overlay "${overlay.id}" (${overlay.kind}) has no visible frames and was left out.`);
      continue;
    }

    const box = measureOverlay(overlay, canvas);
    const placed = placeOverlay(
      box,
      overlay.anchor,
      { w: canvas.width, h: canvas.height },
      canvas.safeArea,
    );

    if (!placed.valid) {
      issues.push(describeIssue(overlay.id, overlay.kind, placed.reasons));
      continue;
    }

    layouts.push({
      id: overlay.id,
      style,
      text,
      ...(overlay.subtext ? { subtext: overlay.subtext } : {}),
      x: Math.round(placed.rect.x),
      y: Math.round(placed.rect.y),
      w: Math.round(placed.rect.w),
      h: Math.round(placed.rect.h),
      inFrame,
      outFrame,
      animation: overlay.animation ?? 'fade',
      opacity: overlay.opacity ?? 1,
    });
  }

  layouts.sort((a, b) => a.inFrame - b.inFrame || a.id.localeCompare(b.id));
  return { layouts: separate(layouts, canvas, issues), issues };
}

/**
 * The optional permit/ORN footnote.
 *
 * Off unless the brand kit carries an ORN. `reserveBottomPx` lifts it clear of
 * a price card that already owns the bottom centre; if the lift would leave the
 * safe area the line is dropped with an issue rather than drawn over the notch.
 */
export function permitLayout(
  brand: BrandKit | undefined,
  canvas: CanvasSpec,
  totalFrames: number,
  reserveBottomPx = 0,
): { layout: OverlayLayout | null; issues: string[] } {
  const orn = brand?.orn?.trim();
  if (!brand || !orn) return { layout: null, issues: [] };
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return { layout: null, issues: [] };

  const text = `ORN ${orn}`;
  const box = estimateTextBox(text, PERMIT_STYLE, canvas.width, 70);
  const placed = placeOverlay(
    box,
    'bottom_center',
    { w: canvas.width, h: canvas.height },
    canvas.safeArea,
  );
  const lifted = shiftRect(placed.rect, -Math.max(0, Math.round(reserveBottomPx)));

  if (!placed.valid || !insideSafeArea(lifted, canvas)) {
    return {
      layout: null,
      issues: ['The permit line does not fit inside the safe area and was left out.'],
    };
  }

  return {
    layout: {
      id: 'permit_line',
      style: 'permit_line',
      text,
      x: Math.round(lifted.x),
      y: Math.round(lifted.y),
      w: Math.round(lifted.w),
      h: Math.round(lifted.h),
      inFrame: 0,
      outFrame: Math.round(totalFrames),
      animation: 'fade',
      opacity: 1,
      muted: true,
    },
    issues: [],
  };
}
