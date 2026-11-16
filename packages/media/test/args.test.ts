import { describe, expect, it } from 'vitest';

import {
  buildContactSheetArgs,
  buildFramePipeArgs,
  buildTrimArgs,
} from '../src/index';

const INPUT = 'C:\\footage\\14 Oak Avenue\\clip 01.mov';
const OUTPUT = 'C:\\out\\sheet 01.jpg';

describe('buildFramePipeArgs', () => {
  it('builds the grey rawvideo decode pipeline', () => {
    expect(buildFramePipeArgs(INPUT, { width: 320, height: 240, fps: 30 }))
      .toEqual([
        '-v',
        'error',
        '-i',
        INPUT,
        '-an',
        '-vf',
        'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:color=black,format=gray',
        '-r',
        '30',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ]);
  });

  it('keeps fractional frame rates intact', () => {
    const args = buildFramePipeArgs('clip.mp4', {
      width: 1080,
      height: 1920,
      fps: 29.97,
    });

    expect(args[args.indexOf('-r') + 1]).toBe('29.97');
  });

  it('rejects a non-positive width', () => {
    expect(() =>
      buildFramePipeArgs('clip.mp4', { width: 0, height: 240, fps: 30 }),
    ).toThrow(RangeError);
  });
});

describe('buildContactSheetArgs', () => {
  it('builds one padded JPEG sheet with an escaped select expression', () => {
    const select =
      'eq(t\\,1.200)+eq(t\\,2.400)+eq(t\\,3.600)+eq(t\\,4.800)';

    expect(
      buildContactSheetArgs(INPUT, {
        times: [1.2, 2.4, 3.6, 4.8],
        out: OUTPUT,
        tileSize: 320,
        cols: 2,
        rows: 2,
      }),
    ).toEqual([
      '-v',
      'error',
      '-i',
      INPUT,
      '-vf',
      `select=${select},scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=black,tile=2x2`,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      OUTPUT,
    ]);
  });

  it('derives a square-ish default grid and tile size', () => {
    const args = buildContactSheetArgs('clip.mp4', {
      times: [0, 1.5, 3],
      out: 'sheet.jpg',
    });
    const filter = args[args.indexOf('-vf') + 1] ?? '';

    expect(filter).toContain('scale=160:160:');
    expect(filter).toContain('tile=2x2');
    expect(filter.startsWith('select=eq(t\\,0.000)+eq(t\\,1.500)+eq(t\\,3.000)'))
      .toBe(true);
  });

  it('rounds timestamps to three decimals', () => {
    const args = buildContactSheetArgs('clip.mp4', {
      times: [1.23456],
      out: 'sheet.jpg',
    });
    const filter = args[args.indexOf('-vf') + 1] ?? '';

    expect(filter).toContain('eq(t\\,1.235)');
  });

  it('rejects an empty timestamp list', () => {
    expect(() =>
      buildContactSheetArgs('clip.mp4', { times: [], out: 'sheet.jpg' }),
    ).toThrow(RangeError);
  });

  it('rejects a grid smaller than the timestamp count', () => {
    expect(() =>
      buildContactSheetArgs('clip.mp4', {
        times: [1, 2, 3, 4, 5],
        out: 'sheet.jpg',
        cols: 2,
        rows: 2,
      }),
    ).toThrow(RangeError);
  });
});

describe('buildTrimArgs', () => {
  const input = 'C:\\footage\\clip 01.mov';
  const output = 'C:\\out\\trim 01.mp4';

  it('re-encodes frame-accurately by default', () => {
    expect(
      buildTrimArgs(input, output, { inSec: 1.5, outSec: 3.75 }),
    ).toEqual([
      '-v',
      'error',
      '-ss',
      '1.500',
      '-i',
      input,
      '-t',
      '2.250',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      output,
    ]);
  });

  it('stream-copies when reencode is false', () => {
    expect(
      buildTrimArgs(input, output, {
        inSec: 1.5,
        outSec: 3.75,
        reencode: false,
      }),
    ).toEqual([
      '-v',
      'error',
      '-ss',
      '1.500',
      '-i',
      input,
      '-t',
      '2.250',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      output,
    ]);
  });

  it('rejects an end time that is not after the start', () => {
    expect(() =>
      buildTrimArgs(input, output, { inSec: 4, outSec: 4 }),
    ).toThrow(RangeError);
    expect(() =>
      buildTrimArgs(input, output, { inSec: 4, outSec: 3 }),
    ).toThrow(RangeError);
  });
});
