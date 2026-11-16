/**
 * Props every overlay body receives.
 *
 * The body only paints inside the box it is given: placement, opacity and
 * animation are owned by the layer, so one component cannot drift from the
 * validator's geometry.
 */

import type {
  BrandKit,
  CanvasSpec,
  OverlayLayout,
  ResolvedColours,
} from '../../../../packages/overlays/src/index';

export interface OverlayBodyProps {
  layout: OverlayLayout;
  /** Already counted up when the price is animating. */
  text: string;
  canvas: CanvasSpec;
  colours: ResolvedColours;
  brand: BrandKit;
  listingDir: string;
}

export type Alignment = 'left' | 'center' | 'right';

export function alignmentFor(layout: OverlayLayout, canvas: CanvasSpec): Alignment {
  const centre = layout.x + layout.w / 2;
  if (centre < canvas.width * 0.42) return 'left';
  if (centre > canvas.width * 0.58) return 'right';
  return 'center';
}

export function flexAlignment(alignment: Alignment): 'flex-start' | 'center' | 'flex-end' {
  if (alignment === 'left') return 'flex-start';
  if (alignment === 'right') return 'flex-end';
  return 'center';
}
