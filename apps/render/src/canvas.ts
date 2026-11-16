/**
 * Canvas resolution.
 *
 * Width, height and fps always come from the destination profile. The EDL's
 * safe area is the source of truth for insets, rescaled when the EDL was cut on
 * a different canvas so one layout survives a profile change.
 */

import type { Edl, SafeArea } from '../../../packages/edl/src/types';
import type { CanvasSpec } from '../../../packages/overlays/src/types';
import { PROFILES } from '../../../packages/render/src/profiles';
import type { ProfileId, RenderProfile } from '../../../packages/render/src/profiles';

/**
 * Defaults from docs/OVERLAYS.md and the validator's profile table. Only used
 * for Studio preview before props arrive; a real render always carries an EDL
 * with its own safe area.
 */
const DEFAULT_SAFE_AREA: Record<ProfileId, SafeArea> = {
  'vertical-social': { top: 250, bottom: 340, left: 60, right: 120 },
  'feed-portrait': { top: 180, bottom: 220, left: 60, right: 60 },
  landscape: { top: 60, bottom: 90, left: 60, right: 60 },
  pin: { top: 195, bottom: 266, left: 56, right: 111 },
};

export function profileFor(id: ProfileId): RenderProfile {
  return PROFILES[id];
}

export function isProfileId(value: string): value is ProfileId {
  return value in PROFILES;
}

export function defaultCanvas(profile: ProfileId): CanvasSpec {
  const preset = PROFILES[profile];
  return {
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    safeArea: DEFAULT_SAFE_AREA[profile],
  };
}

export function canvasFor(edl: Edl | null, profile: ProfileId): CanvasSpec {
  const preset = PROFILES[profile];
  if (!edl) return defaultCanvas(profile);

  const source = edl.canvas;
  const fallback = DEFAULT_SAFE_AREA[profile];
  const ratioX = source.width > 0 ? preset.width / source.width : 1;
  const ratioY = source.height > 0 ? preset.height / source.height : 1;

  const scaleInset = (value: number | undefined, ratio: number, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
    return Math.round(value * ratio);
  };

  return {
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    safeArea: {
      top: scaleInset(source.safeArea.top, ratioY, fallback.top),
      bottom: scaleInset(source.safeArea.bottom, ratioY, fallback.bottom),
      left: scaleInset(source.safeArea.left, ratioX, fallback.left),
      right: scaleInset(source.safeArea.right, ratioX, fallback.right),
    },
  };
}
