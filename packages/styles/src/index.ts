export type {
  StyleCaptions,
  StyleColor,
  StyleMusic,
  StyleOverlays,
  StylePack,
  StylePacing,
  StyleTransitions,
} from './types';

export {
  CAPTION_MODES,
  CAPTION_STYLES,
  OVERLAY_ANIMATIONS,
  OVERLAY_STYLES,
  STYLE_SCHEMA,
  TRANSITION_TYPES,
} from './schema';

export { StyleError } from './errors';
export type { StyleErrorCode } from './errors';

export { validateStyle } from './validate';
export type { StyleValidation } from './validate';

export { getStyle, listStyles } from './load';

export {
  MAX_EVERY_NTH_CUT,
  MAX_SHOT_SEC,
  MAX_TRANSITION_SEC,
  MIN_SHOT_SEC,
  MIN_TRANSITION_SEC,
  applyStyle,
  resolvePacing,
  resolveTransitions,
} from './apply';
export type { AppliedStyle, StyledPlanRequest } from './apply';
