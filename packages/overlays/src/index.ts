/**
 * Public surface of the overlay layout package.
 *
 * Everything exported here is pure: same EDL in, same boxes out. The Remotion
 * app is the only place that draws them.
 */

export type {
  BrandKit,
  CanvasSpec,
  CaptionCueFrames,
  OverlayLayout,
  TimelineSegment,
} from './types';

export {
  canvasDurationSec,
  clipTimelineSec,
  framesFor,
  timelineSegments,
} from './timeline';

export {
  LOGO_ASPECT,
  LOGO_BASE_WIDTH,
  PERMIT_STYLE,
  avoidCaptions,
  describeIssue,
  layoutOverlays,
  measureOverlay,
  permitLayout,
  scaleFor,
  subtextStyleFor,
  textStyleFor,
} from './layout';

export {
  CAPTION_MAX_CHARS,
  CAPTION_MAX_LINES,
  CAPTION_PRESETS,
  DEFAULT_CAPTION_PRESET,
  LEGACY_CAPTION_PRESETS,
  captionCues,
  captionEntrance,
  isCaptionAnimation,
  isCaptionPreset,
  normalizeCaptionAnimation,
  resolveCaptionStyle,
  splitLongCues,
  withReducedMotion,
} from './captions';
export type {
  CaptionAccent,
  CaptionAlign,
  CaptionAnimation,
  CaptionBacking,
  CaptionCase,
  CaptionColourToken,
  CaptionEntranceOptions,
  CaptionEntranceState,
  CaptionFont,
  CaptionPosition,
  CaptionPresetId,
  CaptionStyle,
  CaptionStyleInput,
} from './captions';

export {
  ANIMATION_MS,
  END_CARD_HOLD_MS,
  animationSpec,
  countUpText,
  isEndCardHold,
} from './animation';
export type { AnimationSpec } from './animation';

export {
  DEFAULT_COLOURS,
  DEFAULT_FONT_DISPLAY,
  DEFAULT_FONT_UI,
  RTL_FALLBACK_STACK,
  fontStack,
  permitText,
  resolveColours,
} from './brand';
export type { ResolvedColours } from './brand';

export {
  fallbackGradient,
  hashString,
  staticMediaPath,
} from './media';
export type { FallbackGradient } from './media';
