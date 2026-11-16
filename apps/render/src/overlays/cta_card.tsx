/**
 * End card call to action: a paper card on the footage, Bricolage 650 at 44 px.
 * Only used for the last card; the EDL's `cta` overlay decides the window.
 */

import { DISPLAY_FONT, UI_FONT, px } from '../theme';
import { alignmentFor, flexAlignment } from './types';
import type { OverlayBodyProps } from './types';

export function CtaCard({ layout, text, canvas, colours }: OverlayBodyProps) {
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
      }}
    >
      <div
        style={{
          maxWidth: '100%',
          padding: `${px(18, canvas)}px ${px(26, canvas)}px`,
          borderRadius: px(10, canvas),
          background: colours.paper,
          color: colours.ink,
          boxShadow: '0 12px 32px rgba(20, 18, 15, 0.28), 0 2px 8px rgba(20, 18, 15, 0.16)',
          display: 'flex',
          flexDirection: 'column',
          gap: px(8, canvas),
          textAlign: alignment,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: px(44, canvas),
            fontWeight: 650,
            lineHeight: 1.06,
            letterSpacing: '-0.02em',
          }}
        >
          {text}
        </div>
        {layout.subtext ? (
          <div
            style={{
              fontFamily: UI_FONT,
              fontSize: px(22, canvas),
              fontWeight: 500,
              lineHeight: 1.3,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              opacity: 0.62,
            }}
          >
            {layout.subtext}
          </div>
        ) : null}
      </div>
    </div>
  );
}
