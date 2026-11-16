/**
 * Types for the overlay layer.
 *
 * The renderer draws these boxes without measuring the DOM, so a layout that
 * does not fit is refused here rather than clipped on the take. Nothing in this
 * module reads the clock, the network or the file system.
 */

import type { SafeArea } from '../../core/src/geometry';

/** The client's brand kit. Every field except the name is optional. */
export interface BrandKit {
  agentName: string;
  agency: string;
  /** Dubai broker registration number. The permit line is off without it. */
  orn?: string;
  /** Path to an SVG or PNG lockup, relative to the listing workspace. */
  logo?: string;
  colours?: { brass?: string; ink?: string; paper?: string };
  /** Bundled woff2 id, not a URL. Defaults to Bricolage Grotesque. */
  fontDisplay?: string;
  /** Bundled woff2 id, not a URL. Defaults to Archivo. */
  fontUi?: string;
}

/** Canvas geometry, always taken from the render profile plus the EDL. */
export interface CanvasSpec {
  width: number;
  height: number;
  fps: number;
  safeArea: SafeArea;
}

/**
 * One placed overlay. `x`/`y` are the top-left corner in canvas pixels and
 * already include the safe-area inset; the composition only reads these
 * numbers, it never re-derives the anchor.
 */
export interface OverlayLayout {
  id: string;
  /** An `OverlayStyle`, or `permit_line` for the synthetic legal footnote. */
  style: string;
  text: string;
  subtext?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  inFrame: number;
  outFrame: number;
  animation: string;
  /** EDL opacity, 1 when absent. */
  opacity?: number;
  /** Set for the permit line so the renderer can draw it at 55% opacity. */
  muted?: boolean;
}

/** A caption cue resolved to frames, ready for the composition. */
export interface CaptionCueFrames {
  startFrame: number;
  endFrame: number;
  lines: string[];
  rtl: boolean;
}

/** A clip's position on the assembled timeline, after speed and overlaps. */
export interface TimelineSegment {
  clipId: string;
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  overlapSec: number;
}
