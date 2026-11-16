/**
 * Spec pills: up to three facts in a row, Archivo 600 at 34 px. A fourth fact
 * is folded into the last pill rather than pushed onto another line, which
 * would break the measured height.
 */

import { UI_FONT, legibilityShadow, px } from '../theme';
import { alignmentFor, flexAlignment } from './types';
import type { OverlayBodyProps } from './types';

const SEPARATOR = /\s*[·|•]\s*/;

export function specPills(text: string): string[] {
  const parts = text
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length <= 3) return parts;
  const head = parts.slice(0, 2);
  return [...head, parts.slice(2).join(' · ')];
}

export function SpecPill({ layout, text, canvas, colours }: OverlayBodyProps) {
  const alignment = alignmentFor(layout, canvas);
  const pills = specPills(text);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: flexAlignment(alignment),
        alignItems: 'center',
        gap: px(12, canvas),
        fontFamily: UI_FONT,
        textShadow: legibilityShadow(),
      }}
    >
      {pills.map((pill, index) => (
        <div
          key={`${pill}-${index}`}
          style={{
            padding: `${px(8, canvas)}px ${px(20, canvas)}px`,
            borderRadius: 999,
            border: `1px solid ${colours.brass}`,
            background: 'rgba(20, 18, 15, 0.42)',
            color: colours.paper,
            fontSize: px(34, canvas),
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          {pill}
        </div>
      ))}
    </div>
  );
}
