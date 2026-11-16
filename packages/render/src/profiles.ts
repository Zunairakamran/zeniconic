/**
 * Render profiles — the four output specs every destination collapses into.
 *
 * Values are copied from `docs/SPEC.md` §9.1 and `docs/CONVENTIONS.md`, not
 * invented here. A fifth profile is a schema change, not a settings toggle.
 */

export type ProfileId = 'vertical-social' | 'feed-portrait' | 'landscape' | 'pin';

export interface RenderProfile {
  id: ProfileId;
  width: number;
  height: number;
  fps: number;
  videoBitrate: string;
  maxBitrate: string;
  audioBitrate: string;
  lufs: number;
  truePeak: number;
}

/**
 * H.264 High, yuv420p, 2 s GOP for every profile. `pin` is High@4.0 on paper,
 * but level is derived by the encoder from the canvas and bitrate; the profile
 * carries only what can differ per destination without a schema change.
 */
export const PROFILES: Record<ProfileId, RenderProfile> = {
  'vertical-social': {
    id: 'vertical-social',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: '12M',
    maxBitrate: '16M',
    audioBitrate: '320k',
    lufs: -14,
    truePeak: -1.5,
  },
  'feed-portrait': {
    id: 'feed-portrait',
    width: 1080,
    height: 1350,
    fps: 30,
    videoBitrate: '10M',
    maxBitrate: '14M',
    audioBitrate: '320k',
    lufs: -14,
    truePeak: -1.5,
  },
  landscape: {
    id: 'landscape',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: '16M',
    maxBitrate: '20M',
    audioBitrate: '320k',
    lufs: -16,
    truePeak: -1.5,
  },
  pin: {
    id: 'pin',
    width: 1000,
    height: 1500,
    fps: 30,
    videoBitrate: '8M',
    maxBitrate: '12M',
    audioBitrate: '320k',
    lufs: -14,
    truePeak: -1.5,
  },
};
