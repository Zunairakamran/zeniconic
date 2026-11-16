/**
 * Crop path sampling.
 *
 * The EDL stores a short path of centres and scales in normalised frame
 * coordinates. The composition evaluates it at the clip's local progress,
 * linearly, with no easing: the planner already chose the move.
 */

import type { Clip, Focus } from '../../../packages/edl/src/types';

export interface CropFrame {
  x: number;
  y: number;
  scale: number;
}

const FOCUS_POINTS: Record<Focus, CropFrame> = {
  saliency: { x: 0.5, y: 0.5, scale: 1 },
  center: { x: 0.5, y: 0.5, scale: 1 },
  left: { x: 0.35, y: 0.5, scale: 1 },
  right: { x: 0.65, y: 0.5, scale: 1 },
  top: { x: 0.5, y: 0.38, scale: 1 },
  bottom: { x: 0.5, y: 0.62, scale: 1 },
};

export function cropAt(clip: Clip, progress: number): CropFrame {
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const path = clip.transform.path;

  if (path.length === 0) {
    return { ...FOCUS_POINTS[clip.transform.focus] };
  }

  const first = path[0];
  if (!first) return { ...FOCUS_POINTS[clip.transform.focus] };
  if (path.length === 1) return { x: first.x, y: first.y, scale: first.scale };

  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    if (!start || !end) continue;
    if (t <= end.t) {
      const span = end.t - start.t;
      const local = span <= 0 ? 0 : (t - start.t) / span;
      return {
        x: start.x + (end.x - start.x) * local,
        y: start.y + (end.y - start.y) * local,
        scale: start.scale + (end.scale - start.scale) * local,
      };
    }
  }

  const last = path[path.length - 1];
  return last ? { x: last.x, y: last.y, scale: last.scale } : { ...FOCUS_POINTS[clip.transform.focus] };
}

/**
 * CSS transform that keeps the requested point at the viewport centre.
 * `translate` percentages are relative to the element, so the scale is applied
 * to the offset as well as to the picture.
 */
export function cropTransform(crop: CropFrame): string {
  const translateX = (0.5 - crop.x) * crop.scale * 100;
  const translateY = (0.5 - crop.y) * crop.scale * 100;
  return `translate(${translateX.toFixed(4)}%, ${translateY.toFixed(4)}%) scale(${crop.scale.toFixed(4)})`;
}
