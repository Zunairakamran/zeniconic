import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/index';
import { formatTimestamp, toSrt } from '../src/index';

const cues: Cue[] = [
  { startSec: 0, endSec: 1.75, lines: ['Marina Gate 1,', 'Dubai Marina'] },
  { startSec: 1.83, endSec: 3.2, lines: ['Three bedrooms'] },
  { startSec: 3.5, endSec: 4.9, lines: ['Two baths'] },
];

describe('toSrt', () => {
  it('matches the three-cue SRT snapshot', () => {
    expect(toSrt(cues)).toMatchSnapshot();
  });

  it('uses LF endings, one blank line between blocks and a trailing newline', () => {
    const srt = toSrt(cues);

    expect(srt).not.toContain('\r');
    expect(srt.startsWith('1\n')).toBe(true);
    expect(srt).toContain('\n\n2\n');
    expect(srt).toContain('\n\n3\n');
    expect(srt.endsWith('\n')).toBe(true);
    expect(srt.endsWith('\n\n')).toBe(false);
  });

  it('numbers cues from one and accepts a single cue', () => {
    const srt = toSrt([{ startSec: 1.5, endSec: 2, lines: ['Hello'] }]);
    expect(srt).toBe('1\n00:00:01,500 --> 00:00:02,000\nHello\n');
  });

  it('returns an empty string for no cues', () => {
    expect(toSrt([])).toBe('');
  });

  it('rejects an inverted cue', () => {
    expect(() => toSrt([{ startSec: 2, endSec: 1, lines: ['No'] }])).toThrow(RangeError);
  });
});

describe('formatTimestamp', () => {
  it('formats zero, seconds, minutes and hours', () => {
    expect(formatTimestamp(0)).toBe('00:00:00,000');
    expect(formatTimestamp(1.234)).toBe('00:00:01,234');
    expect(formatTimestamp(61.5)).toBe('00:01:01,500');
    expect(formatTimestamp(3661.007)).toBe('01:01:01,007');
  });

  it('rounds to the nearest millisecond without losing a minute', () => {
    expect(formatTimestamp(59.9996)).toBe('00:01:00,000');
  });

  it('rejects negative and non-finite values', () => {
    expect(() => formatTimestamp(-1)).toThrow(RangeError);
    expect(() => formatTimestamp(Number.NaN)).toThrow(RangeError);
    expect(() => formatTimestamp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
