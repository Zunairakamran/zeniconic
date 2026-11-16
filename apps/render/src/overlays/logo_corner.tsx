/**
 * Logo corner: the brand kit's lockup, 120 px wide at 1080. When the file is not
 * inside the listing workspace (or no logo was supplied) the wordmark is drawn
 * from the agent and agency names, so the corner is never empty.
 */

import { Img, staticFile } from 'remotion';
import { staticMediaPath } from '../../../../packages/overlays/src/index';
import { DISPLAY_FONT, UI_FONT, legibilityShadow, px } from '../theme';
import type { OverlayBodyProps } from './types';

export function LogoCorner({ layout, canvas, brand, colours, listingDir }: OverlayBodyProps) {
  const logoPath = brand.logo ? staticMediaPath(brand.logo, listingDir) : null;

  if (logoPath) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-start' }}>
        <Img
          src={staticFile(logoPath)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'left top',
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        gap: px(4, canvas),
        textShadow: legibilityShadow(),
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 650,
          fontSize: px(26, canvas),
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: colours.paper,
        }}
      >
        {brand.agentName}
      </div>
      <div
        style={{
          fontFamily: UI_FONT,
          fontWeight: 600,
          fontSize: px(13, canvas),
          lineHeight: 1.1,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: colours.brass,
        }}
      >
        {brand.agency}
      </div>
    </div>
  );
}
