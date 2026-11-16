import { describe, expect, it } from 'vitest';
import { parseExactFrameTimes } from '../src/frames';

/** One probe payload: `[time_base, ...ticks]`. */
function probeJson(timeBase: string, ticks: Array<number | string>): string {
  return JSON.stringify({
    streams: [{ time_base: timeBase }],
    frames: ticks.map((best_effort_timestamp) => ({ best_effort_timestamp })),
  });
}

describe('parseExactFrameTimes', () => {
  it('keeps only ticks whose seconds are exactly a three-decimal literal', () => {
    // 1/600 at 30 fps: 1.1 and 0.9 are exact, 1.2 and 1.4 are 1 bit high.
    const json = probeJson('1/600', [0, 120, 300, 540, 660, 720, 840]);

    expect(parseExactFrameTimes(json)).toEqual([0, 0.2, 0.5, 0.9, 1.1]);
  });

  it('treats a millisecond timebase as fully matchable', () => {
    const json = probeJson('1/1000', [0, 33, 167, 1700, 2333]);

    expect(parseExactFrameTimes(json)).toEqual([0, 0.033, 0.167, 1.7, 2.333]);
  });

  it('sorts and de-duplicates repeated ticks', () => {
    expect(parseExactFrameTimes(probeJson('1/1000', [2000, 500, 2000, 1250]))).toEqual([
      0.5, 1.25, 2,
    ]);
  });

  it('ignores missing, negative and non-numeric timestamps', () => {
    const json = JSON.stringify({
      streams: [{ time_base: '1/1000' }],
      frames: [{ best_effort_timestamp: -5 }, { best_effort_timestamp: 'n/a' }, {}, { best_effort_timestamp: 750 }],
    });

    expect(parseExactFrameTimes(json)).toEqual([0.75]);
  });

  it('returns an empty list for unreadable payloads', () => {
    expect(parseExactFrameTimes('')).toEqual([]);
    expect(parseExactFrameTimes('not json')).toEqual([]);
    expect(parseExactFrameTimes(JSON.stringify({ frames: [] }))).toEqual([]);
    expect(parseExactFrameTimes(probeJson('0/0', [10]))).toEqual([]);
    expect(parseExactFrameTimes(probeJson('nonsense', [10]))).toEqual([]);
  });
});
