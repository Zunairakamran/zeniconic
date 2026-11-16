/**
 * Props shared by the composition, the CLI and the tests.
 *
 * The EDL is passed whole: it is already serialisable, and freezing a
 * projection of it here would make the preview and the take disagree.
 */

import type { Edl } from '../../../packages/edl/src/types';
import type { BrandKit } from '../../../packages/overlays/src/types';
import type { ProfileId } from '../../../packages/render/src/profiles';

export type VideoProps = {
  /** Null only in Studio before props are supplied; the composition draws a card. */
  edl: Edl | null;
  profile: ProfileId;
  brand: BrandKit;
  /** Burn captions. `renderOverlayVideo` also checks `captions.mode`. */
  captions: boolean;
  /** Absolute path to the listing workspace; the bundle's public directory. */
  listingDir: string;
  /** Clips whose source is missing from the listing workspace. */
  missingClipIds?: string[];
};

export const DEFAULT_BRAND: BrandKit = Object.freeze({
  agentName: 'Your name',
  agency: 'Your agency',
});
