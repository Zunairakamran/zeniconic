/**
 * Room label. The EDL styles these as `caption`; they are overlays, not burned
 * speech, so they use the display face and never enter the caption layer.
 */

import { DISPLAY_FONT, legibilityShadow, px } from '../theme';
import { alignmentFor, flexAlignment } from './types';
import type { OverlayBodyProps } from './types';

export function RoomLabel({ layout, text, canvas, colours }: OverlayBodyProps) {
  const alignment = alignmentFor(layout, canvas);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: flexAlignment(alignment),
        textAlign: alignment,
        color: colours.paper,
        fontFamily: DISPLAY_FONT,
        textShadow: legibilityShadow(),
      }}
    >
      <div style={{ width: px(16, canvas), height: Math.max(1, px(2, canvas)), background: colours.brass, marginBottom: px(10, canvas) }} />
      <div
        style={{
          fontSize: px(40, canvas),
          fontWeight: 500,
          lineHeight: 1.1,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </div>
  );
}
