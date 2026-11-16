/**
 * Address tag: Archivo 600, 32 px, small caps with wide tracking, plus an
 * optional district line. A short brass rule anchors it to the left margin.
 */

import { UI_FONT, legibilityShadow, px } from '../theme';
import { alignmentFor, flexAlignment } from './types';
import type { OverlayBodyProps } from './types';

export function AddressTag({ layout, text, canvas, colours }: OverlayBodyProps) {
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
        color: colours.paper,
        fontFamily: UI_FONT,
        textShadow: legibilityShadow(),
      }}
    >
      <div
        style={{
          width: px(28, canvas),
          height: Math.max(1, px(2, canvas)),
          background: colours.brass,
          marginBottom: px(12, canvas),
        }}
      />
      <div
        style={{
          fontSize: px(32, canvas),
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
      {layout.subtext ? (
        <div
          style={{
            marginTop: px(6, canvas),
            fontSize: px(22, canvas),
            fontWeight: 400,
            letterSpacing: '0.02em',
            opacity: 0.72,
            whiteSpace: 'nowrap',
          }}
        >
          {layout.subtext}
        </div>
      ) : null}
    </div>
  );
}
