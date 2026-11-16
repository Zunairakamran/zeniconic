import { spawn } from 'node:child_process';
import { ffprobePath } from '../../../packages/media/src/index';

/**
 * Real frame timestamps from the source, restricted to those that survive the
 * three-decimal formatting in `buildContactSheetArgs`.
 *
 * That builder selects frames with `eq(t\,<seconds>)`, an exact double
 * comparison. A frame only matches if `pts * time_base` is already exactly the
 * double that the three-decimal literal parses to — and that is not something a
 * nominal frame rate predicts. At 30 fps, `1.2` misses on a `1/600` timebase
 * while `1.1` matches, because `720 * (1/600)` rounds to `1.2000000000000002`.
 * Phone footage is also frequently variable-rate. So the timestamps are read
 * once per clip and the arithmetic is repeated here in IEEE double, exactly as
 * ffmpeg does it.
 *
 * `best_effort_timestamp` is in stream timebase ticks; printing seconds from
 * ffprobe would round to six decimals and hide the discrepancy we need to see.
 */

interface ProbeJson {
  streams?: Array<{ time_base?: string }>;
  frames?: Array<{ best_effort_timestamp?: number | string }>;
}

function parseTimeBase(value: string | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (match === null) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  // `av_q2d`: numerator / (double) denominator, then multiplied by pts.
  return numerator / denominator;
}

/**
 * Parse the JSON from `exactFrameTimes`. Keeps only timestamps that are exactly
 * their own three-decimal literal, sorted and de-duplicated.
 */
export function parseExactFrameTimes(stdout: string): number[] {
  let payload: ProbeJson;
  try {
    payload = JSON.parse(stdout) as ProbeJson;
  } catch {
    return [];
  }

  const scale = parseTimeBase(payload.streams?.[0]?.time_base);
  if (scale === undefined) return [];

  const seen = new Set<number>();
  const times: number[] = [];

  for (const frame of payload.frames ?? []) {
    const raw = frame.best_effort_timestamp;
    const ticks = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof ticks !== 'number' || !Number.isFinite(ticks) || ticks < 0) continue;

    const value = ticks * scale;
    const rounded = Math.round(value * 1000) / 1000;
    // Strict equality, not a tolerance: `eq` compares doubles.
    if (rounded !== value) continue;
    if (seen.has(rounded)) continue;

    seen.add(rounded);
    times.push(rounded);
  }

  return times.sort((left, right) => left - right);
}

function runFfprobe(file: string): Promise<string> {
  const bin = ffprobePath();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      bin,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_streams',
        '-show_frames',
        '-show_entries',
        'stream=time_base:frame=best_effort_timestamp',
        '-of',
        'json',
        file,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code ?? -1}${stderr.trim() ? `: ${stderr.trim()}` : '.'}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** One ffprobe pass over the clip. Throws when the file cannot be read. */
export async function exactFrameTimes(file: string): Promise<number[]> {
  return parseExactFrameTimes(await runFfprobe(file));
}
