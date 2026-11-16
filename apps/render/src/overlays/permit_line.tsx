/**
 * Permit line: `Permit No. 12345 · ORN 67890`, Archivo 500 at 22 px.
 *
 * Off by default. The layout package only emits this box when the brand kit
 * carries an ORN (or the export toggles a `permit` overlay on).
 */

import { UI_FONT, legibilityShadow, px } from '../theme';
import { alignmentFor } from './types';
import type { OverlayBodyProps } from './types';

export function PermitLine({ layout, text, canvas, colours }: OverlayBodyProps) {
  const alignment = alignmentFor(layout, canvas);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: alignment === 'left' ? 'flex-start' : alignment === 'right' ? 'flex-end' : 'center',
        color: colours.paper,
        fontFamily: UI_FONT,
        fontSize: px(22, canvas),
        fontWeight: 500,
        lineHeight: 1.2,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        textShadow: legibilityShadow(),
      }}
    >
      {text}
    </div>
  );
}
