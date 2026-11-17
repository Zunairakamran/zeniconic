/**
 * Compositions, one per render profile.
 *
 * Dimensions and fps come from `packages/render/src/profiles`; nothing here
 * hardcodes 1080×1920. Studio gets a placeholder EDL so the composition opens
 * without props, while a real render always passes the full EDL.
 */

import { Composition } from 'remotion';
import { canvasDurationSec } from '../../../packages/overlays/src/index';
import { PROFILES } from '../../../packages/render/src/profiles';
import type { ProfileId } from '../../../packages/render/src/profiles';
import { VideoComposition } from './Composition';
import type { VideoCompositionProps } from './Composition';
import { BrandIntro } from './BrandIntro';
import { DEFAULT_BRAND } from './types';

const PLACEHOLDER_FRAMES = 10;

export function compositionId(profile: ProfileId): string {
  return `zeniconic-${profile}`;
}

export function RemotionRoot() {
  const profiles = Object.keys(PROFILES) as ProfileId[];

  return (
    <>
      <Composition
        id="brand-intro"
        component={BrandIntro}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={150}
      />
      {profiles.map((profile) => {
        const preset = PROFILES[profile];
        const defaultProps: VideoCompositionProps = {
          edl: null,
          profile,
          brand: DEFAULT_BRAND,
          captions: false,
          listingDir: '',
          missingClipIds: [],
          // Studio preview draws full motion; a render passes the real setting.
          reduceMotion: false,
        };

        return (
          <Composition
            key={profile}
            id={compositionId(profile)}
            component={VideoComposition}
            width={preset.width}
            height={preset.height}
            fps={preset.fps}
            durationInFrames={preset.fps * PLACEHOLDER_FRAMES}
            defaultProps={defaultProps}
            calculateMetadata={({ props }) => ({
              durationInFrames: props.edl
                ? Math.max(1, Math.round(canvasDurationSec(props.edl) * preset.fps))
                : preset.fps * PLACEHOLDER_FRAMES,
            })}
          />
        );
      })}
    </>
  );
}
