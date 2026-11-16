import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildContactSheetArgs, ffmpegPath } from '../../../packages/media/src/index';

/**
 * The sheet geometry `tagShot` was calibrated on: 3x2 tiles of 512 px, i.e. a
 * 1536x1024 JPEG. Changing any of these changes every cache key.
 */
export const SHEET_COLS = 3;
export const SHEET_ROWS = 2;
export const SHEET_TILE_SIZE = 512;

const MAX_STDERR_LINES = 200;
const REPORTED_STDERR_LINES = 20;

/** A non-zero ffmpeg exit while building a sheet, with the stderr tail. */
export class SheetError extends Error {
  readonly code = 'E_SHEET';
  readonly exitCode: number;
  /** The last 20 non-empty stderr lines, oldest first. */
  readonly stderr: string[];

  constructor(exitCode: number, stderr: string[]) {
    const tail = stderr[stderr.length - 1];
    super(`ffmpeg exited with code ${exitCode} while building a contact sheet${tail ? `: ${tail}` : '.'}`);
    this.name = 'SheetError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** The exact argv for one sheet; exported so a test can assert the geometry. */
export function sheetArgs(file: string, times: number[], out: string): string[] {
  return buildContactSheetArgs(file, {
    times,
    out,
    cols: SHEET_COLS,
    rows: SHEET_ROWS,
    tileSize: SHEET_TILE_SIZE,
  });
}

interface FfmpegResult {
  code: number;
  stderr: string[];
}

/**
 * Spawn the bundled ffmpeg with an argv array and no shell. Arguments are never
 * concatenated into a command line, so filenames with spaces or quotes are just
 * filenames.
 */
function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  const bin = ffmpegPath();
  return new Promise<FfmpegResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const lines: string[] = [];
    let partial = '';

    child.stderr.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim().length > 0) lines.push(line);
      }
      if (lines.length > MAX_STDERR_LINES) lines.splice(0, lines.length - MAX_STDERR_LINES);
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (partial.trim().length > 0) lines.push(partial.trim());
      resolve({ code: code ?? -1, stderr: lines.slice(-REPORTED_STDERR_LINES) });
    });
  });
}

/**
 * Build one contact sheet by decoding `times` in a single ffmpeg pass.
 *
 * The output directory is created if missing. The caller owns the file and is
 * expected to delete it after tagging.
 */
export async function renderSheet(file: string, times: number[], out: string): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const result = await runFfmpeg(sheetArgs(file, times, out));
  if (result.code !== 0) throw new SheetError(result.code, result.stderr);
}
