/**
 * Small print: permit/disclaimer copy at Archivo 400, 24 px, held at 55%
 * opacity by the layer. It sits inside the safe area, not on the platform bar.
 */

import { UI_FONT, legibilityShadow, px } from '../theme';
import { alignmentFor } from './types';
import type { OverlayBodyProps } from './types';

export function SmallPrint({ layout, text, canvas, colours }: OverlayBodyProps) {
  const alignment = alignmentFor(layout, canvas);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        textAlign: alignment,
        color: colours.paper,
        fontFamily: UI_FONT,
        fontSize: px(24, canvas),
        fontWeight: 400,
        lineHeight: 1.3,
        letterSpacing: '0.01em',
        textShadow: legibilityShadow(),
      }}
    >
      <div>{text}</div>
      {layout.subtext ? (
        <div style={{ marginTop: px(4, canvas), opacity: 0.8 }}>{layout.subtext}</div>
      ) : null}
    </div>
  );
}
