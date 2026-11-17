/**
 * Desktop adapter for rendered-output inspection.
 *
 * Samples six JPEGs with FFmpeg, sends them through OpenRouter, and records the
 * model cost in the ledger. Deterministic checks remain the gate; this is the
 * "what does it actually look like" pass.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ChatClient } from '../../packages/ai/src/index';
import { ffmpegPath, probe } from '../../packages/media/src/index';
import { inspectRender, InspectError, inspectTimes } from '../../packages/review/src/index';
import type { FrameSample, InspectResult } from '../../packages/review/src/index';

export interface ReviewServiceOptions {
  dataDir: string;
  client: () => Promise<ChatClient | undefined>;
  model: string;
  onCost?: (usd: number) => Promise<void> | void;
}

export interface ReviewService {
  inspect(input: { file: string; facts?: Record<string, string | number | undefined> }): Promise<InspectResult>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sampleFrames(file: string, times: number[], workDir: string): Promise<FrameSample[]> {
  const samples: FrameSample[] = [];
  for (const [index, t] of times.entries()) {
    const out = join(workDir, `frame_${String(index).padStart(2, '0')}.jpg`);
    await promisify(execFile)(ffmpegPath(), [
      '-y', '-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
      '-vf', 'scale=720:-2', '-q:v', '4', out,
    ]);
    samples.push({ t, jpegBase64: (await readFile(out)).toString('base64') });
  }
  return samples;
}

export function createReviewService(options: ReviewServiceOptions): ReviewService {
  return {
    async inspect({ file, facts }): Promise<InspectResult> {
      const root = resolve(options.dataDir);
      const target = resolve(file);
      if (!target.startsWith(`${root}${sep}`)) {
        throw new InspectError('E_INSPECT_MODEL', 'Only exports inside the app data folder can be inspected.');
      }
      const info = await stat(target).catch(() => undefined);
      if (info === undefined || !info.isFile()) {
        throw new InspectError('E_INSPECT_NO_FRAMES', 'That export file no longer exists.');
      }

      const client = await options.client();
      if (client === undefined) {
        throw new InspectError('E_INSPECT_MODEL', 'Add an OpenRouter key in Settings to inspect renders.');
      }

      const workDir = await mkdtemp(join(options.dataDir, 'tmp', 'inspect-'));
      try {
        const media = await probe(target);
        const times = inspectTimes(media.durationSec);
        const result = await inspectRender(
          { file: target, ...(facts === undefined ? {} : { facts }) },
          {
            probe: async () => ({ durationSec: media.durationSec }),
            sampleFrames: (source, requested) => sampleFrames(source, requested, workDir),
            client,
            model: options.model,
          },
        );
        if (result.costUsd > 0) {
          await Promise.resolve(options.onCost?.(result.costUsd)).catch((error: unknown) => {
            console.warn(`[review] could not record spend: ${messageOf(error)}`);
          });
        }
        return result;
      } finally {
        await rm(workDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(
          () => undefined,
        );
      }
    },
  };
}
