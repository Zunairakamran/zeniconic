// Decode a video to raw grey frames for analysis.
//
// This is the only place that streams binary stdout; the string-based `Runner`
// used for ffprobe is deliberately not reused here. Frames are yielded in order
// and the child process is killed if the consumer stops early.

import { spawn } from 'node:child_process';
import { buildFramePipeArgs } from './args';
import { ffmpegPath } from './paths';

export interface RawFrame {
  index: number;
  t: number;
  width: number;
  height: number;
  gray: Uint8Array;
}

export interface ReadFramesOpts {
  width: number;
  height: number;
  fps: number;
  /** Stop after this many frames. */
  limit?: number;
  /** Override the binary, for tests. */
  bin?: string;
}

export async function* readFrames(file: string, opts: ReadFramesOpts): AsyncGenerator<RawFrame> {
  const { width, height, fps } = opts;
  if (width <= 0 || height <= 0) throw new RangeError('width and height must be positive');
  if (fps <= 0 || fps > 120) throw new RangeError('fps must be between 0 and 120');

  const frameSize = width * height;
  const bin = opts.bin ?? ffmpegPath();
  const args = buildFramePipeArgs(file, { width, height, fps });

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });

  const queue: Buffer[] = [];
  let queued = 0;
  let done = false;
  let failure: Error | null = null;

  // Resolves when the child has actually exited. Killing is not enough on
  // Windows: the file handle stays open until the process is reaped.
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));

  const waiters: Array<() => void> = [];
  const wake = () => {
    const w = waiters.shift();
    if (w) w();
  };

  child.stdout.on('data', (chunk: Buffer) => {
    queue.push(chunk);
    queued += chunk.length;
    wake();
  });
  child.on('error', (err) => {
    failure = err;
    done = true;
    wake();
  });
  child.on('close', (code) => {
    done = true;
    if (code !== 0 && !failure) {
      failure = new Error(`ffmpeg exited with ${code}: ${stderr.trim().slice(0, 400)}`);
    }
    wake();
  });

  const take = (n: number): Buffer | null => {
    if (queued < n) return null;
    const merged = Buffer.concat(queue, queued);
    const head = merged.subarray(0, n);
    const rest = merged.subarray(n);
    queue.length = 0;
    if (rest.length) queue.push(rest);
    queued = rest.length;
    return head;
  };

  let index = 0;
  try {
    while (true) {
      while (queued < frameSize && !done) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (queued < frameSize) break;
      const raw = take(frameSize);
      if (!raw) break;

      // Copy: the underlying chunk buffer is reused by the stream.
      const gray = new Uint8Array(frameSize);
      gray.set(raw);

      yield { index, t: index / fps, width, height, gray };
      index++;
      if (opts.limit !== undefined && index >= opts.limit) break;
    }
    if (failure) throw failure;
  } finally {
    if (!child.killed) child.kill();
    await closed;
  }
}
