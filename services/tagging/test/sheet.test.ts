import { describe, expect, it } from 'vitest';
import { SHEET_COLS, SHEET_ROWS, SHEET_TILE_SIZE, sheetArgs } from '../src/index';

describe('sheetArgs', () => {
  it('builds a 3x2 grid of 512px tiles', () => {
    const args = sheetArgs('raw/clip.mp4', [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], 'out/sheet.jpg');

    expect(SHEET_COLS * SHEET_TILE_SIZE).toBe(1536);
    expect(SHEET_ROWS * SHEET_TILE_SIZE).toBe(1024);

    const filter = args[args.indexOf('-vf') + 1] ?? '';
    expect(filter).toContain('tile=3x2');
    expect(filter).toContain(`scale=${SHEET_TILE_SIZE}:${SHEET_TILE_SIZE}`);
    expect(args).toContain('raw/clip.mp4');
    expect(args[args.length - 1]).toBe('out/sheet.jpg');
  });

  it('asks for exactly one frame with one timestamp per tile', () => {
    const times = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
    const args = sheetArgs('clip.mp4', times, 'sheet.jpg');
    const filter = args[args.indexOf('-vf') + 1] ?? '';

    expect(filter.split('eq(').length - 1).toBe(6);
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
  });
});
