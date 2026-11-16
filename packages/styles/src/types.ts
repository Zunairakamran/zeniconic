/**
 * The data shape of a style pack.
 *
 * A pack is the whole creative vocabulary for one look: pacing, transitions,
 * overlay typography, captions, music character and colour. It is deliberately
 * plain JSON so a new treatment is a file under `config/styles`, not a branch
 * in the planner.
 */

import type {
  CaptionMode,
  CaptionStyle,
  OverlayAnimation,
  OverlayStyle,
  TransitionType,
} from '@zeniconic/edl';

export interface StylePacing {
  /** Shortest allowed cut, seconds. */
  minShotSec: number;
  /** Longest allowed cut, seconds. */
  maxShotSec: number;
  /** Average the planner should aim for, seconds. */
  targetAvgShotSec: number;
}

export interface StyleTransitions {
  /** Transition entering a clip. */
  in: TransitionType;
  /** Transition leaving a clip. */
  out: TransitionType;
  /** Base duration; `applyStyle` clamps it to 0.2–1.0 s. */
  durationSec: number;
  /** 1 applies the transition to every cut, 2 to every second cut, and so on. */
  everyNthCut: number;
}

export interface StyleOverlays {
  /** Overlay style for the price card. */
  price: OverlayStyle;
  /** Overlay style for the address tag. */
  address: OverlayStyle;
  /** Overlay style for room labels; omit for looks that do not label rooms. */
  roomLabel?: OverlayStyle;
  introAnimation: OverlayAnimation;
  outroAnimation: OverlayAnimation;
}

export interface StyleCaptions {
  mode: CaptionMode;
  style: CaptionStyle;
}

export interface StyleMusic {
  mood: string;
  /** 1 (sparse) to 5 (driving). */
  energy: number;
}

export interface StyleColor {
  saturation: number;
  contrast: number;
  /** Negative cools, positive warms. */
  warmth: number;
}

export interface StylePack {
  version: 1;
  id: string;
  label: string;
  pacing: StylePacing;
  transitions: StyleTransitions;
  overlays: StyleOverlays;
  captions: StyleCaptions;
  music: StyleMusic;
  color: StyleColor;
}
