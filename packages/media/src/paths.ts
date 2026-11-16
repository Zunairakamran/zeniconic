import { normalize } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

/**
 * Absolute path to the bundled ffmpeg binary.
 *
 * `ffmpeg-static` exports the path directly and resolves to `null` on an
 * unsupported platform/arch, so the failure is surfaced with an actionable
 * message instead of letting `spawn(null)` fail later.
 */
export function ffmpegPath(): string {
  if (typeof ffmpegStatic !== 'string' || ffmpegStatic.length === 0) {
    throw new Error(
      'ffmpeg-static did not resolve to a binary for this platform. ' +
        'Reinstall dependencies with "npm install" (or set FFMPEG_BIN) and try again.',
    );
  }
  return normalize(ffmpegStatic);
}

/**
 * Absolute path to the bundled ffprobe binary.
 *
 * `ffprobe-static` exports `{ path }` rather than a bare string.
 */
export function ffprobePath(): string {
  const resolved: string | null =
    typeof ffprobeStatic === 'object' && ffprobeStatic !== null
      ? ffprobeStatic.path
      : null;

  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error(
      'ffprobe-static did not resolve to a binary for this platform. ' +
        'Reinstall dependencies with "npm install" and try again.',
    );
  }
  return normalize(resolved);
}
