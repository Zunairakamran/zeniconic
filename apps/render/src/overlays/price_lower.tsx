/**
 * The hero price card: Bricolage Grotesque 650, 96 px at 1080 wide, with the
 * beds/baths/area line in Archivo underneath.
 */

import { DISPLAY_FONT, UI_FONT, legibilityShadow, px } from '../theme';
import { alignmentFor, flexAlignment } from './types';
import type { OverlayBodyProps } from './types';

export function PriceLower({ layout, text, canvas, colours }: OverlayBodyProps) {
  const alignment = alignmentFor(layout, canvas);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: flexAlignment(alignment),
        textAlign: alignment,
        color: colours.paper,
        fontFamily: DISPLAY_FONT,
        textShadow: legibilityShadow(),
      }}
    >
      <div
        style={{
          fontSize: px(96, canvas),
          fontWeight: 650,
          lineHeight: 1,
          letterSpacing: '-0.025em',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
      {layout.subtext ? (
        <div
          style={{
            marginTop: px(14, canvas),
            fontFamily: UI_FONT,
            fontSize: px(34, canvas),
            fontWeight: 600,
            lineHeight: 1.2,
            letterSpacing: '0.01em',
            opacity: 0.82,
            whiteSpace: 'nowrap',
          }}
        >
          {layout.subtext}
        </div>
      ) : null}
    </div>
  );
}
