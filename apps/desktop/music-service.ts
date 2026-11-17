/**
 * Music-bed generation through OpenRouter audio-output models (Lyria).
 *
 * Writes the MP3 under `<data>/assets/music`, selects it in settings, and
 * records the provider-reported cost. Generation is refused up front when the
 * budget or price check fails.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AiError, generateAudioWithModel } from '../../packages/ai/src/index';
import type { FetchLike } from '../../packages/ai/src/index';
import { probeAudio } from '../../packages/media/src/index';
import type { MusicGenerationDto } from '../../packages/ipc/src/index';

export interface MusicServiceOptions {
  dataDir: string;
  model: string;
  apiKey: () => Promise<string | undefined> | string | undefined;
  /** Pre-flight budget check for the per-song price. */
  canSpend?: (usd: number) => Promise<boolean> | boolean;
  onCost?: (usd: number) => Promise<void> | void;
  /** Persist the generated file as the selected bed. */
  onSelect?: (fileName: string) => Promise<void> | void;
  /** USD per generated song; defaults to the Lyria Pro price. */
  priceUsd?: number;
  fetchImpl?: FetchLike | typeof fetch;
  baseUrl?: string;
  now?: () => Date;
}

export interface MusicService {
  generate(prompt: string): Promise<MusicGenerationDto>;
}

export function musicFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `generated-${stamp}.mp3`;
}

export function createMusicService(options: MusicServiceOptions): MusicService {
  const priceUsd = options.priceUsd ?? 0.08;
  const now = options.now ?? (() => new Date());

  return {
    async generate(prompt: string): Promise<MusicGenerationDto> {
      const text = prompt.trim();
      if (text.length === 0) throw new Error('Describe the music you want.');

      if (options.canSpend !== undefined) {
        const allowed = await Promise.resolve(options.canSpend(priceUsd)).catch(() => false);
        if (!allowed) throw new Error('The model budget for today or this month is exhausted.');
      }

      const key = await options.apiKey();
      if (typeof key !== 'string' || key.trim().length === 0) {
        throw new Error('Add an OpenRouter key in Settings before generating music.');
      }

      const audio = await generateAudioWithModel({
        apiKey: key,
        model: options.model,
        prompt: text,
        fetchImpl:
          options.fetchImpl ??
          ((url: string, init: Parameters<typeof fetch>[1]) => fetch(url, init)),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      });

      const fileName = musicFileName(now());
      const dir = resolve(options.dataDir, 'assets', 'music');
      await mkdir(dir, { recursive: true });
      const path = resolve(dir, fileName);
      await writeFile(path, audio.bytes);

      let durationSec = 0;
      try {
        durationSec = (await probeAudio(path)).durationSec;
      } catch {
        durationSec = 0;
      }

      const cost = audio.costUsd > 0 ? audio.costUsd : priceUsd;
      await Promise.resolve(options.onCost?.(cost)).catch(() => undefined);
      await Promise.resolve(options.onSelect?.(fileName)).catch(() => undefined);

      return {
        fileName,
        durationSec,
        costUsd: cost,
        model: audio.model,
        bytes: audio.bytes.length,
      };
    },
  };
}

export { AiError };
