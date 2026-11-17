/**
 * Draft preview service. The desktop agent calls `renderPreview` from its
 * `preview_render` tool; nothing else in the app should shell out for a draft.
 */

export {
  DEFAULT_PREVIEW_TIMEOUT_MS,
  PreviewError,
  draftCanvas,
  renderPreview,
  selectPreviewProfile,
} from './preview';
export type {
  PreviewDeps,
  PreviewErrorCode,
  PreviewErrorContext,
  PreviewInput,
  PreviewResult,
} from './preview';
