import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatClient } from '@zeniconic/ai';
import { tagShot } from '../../../packages/tagging/src/index';
import type { ShotTags, TaggingCache } from '../../../packages/tagging/src/index';
import type { FootageIndex, IndexedShot } from '../../pipeline/indexer';
import { exactFrameTimes } from './frames';
import { probedSheetTimes, sheetTimes } from './sample';
import { renderSheet } from './sheet';

/** Three in flight: enough to hide latency, few enough to stay inside rate limits. */
export const DEFAULT_CONCURRENCY = 3;

export interface TagOptions {
  client: ChatClient;
  /** Resolved model id, e.g. `google/gemini-3.8-flash:floor`. */
  model: string;
  promptVersion: string;
  cache?: TaggingCache;
  /** In-flight cap. Defaults to {@link DEFAULT_CONCURRENCY}. */
  concurrency?: number;
  /** Directory for the temporary contact sheets; created if missing. */
  workDir: string;
  onProgress?: (done: number, total: number, shotId: string) => void;
  /**
   * Called once per billed model call with the net cost the provider reported.
   * A shot that needs a repair attempt reports twice; a shot whose call never
   * returned reports nothing. The run's total lands in
   * {@link TagReport.costUsd} whether or not this hook is supplied.
   */
  onCost?: (usd: number) => void;
}

export interface TagFailure {
  shotId: string;
  message: string;
}

export interface TagReport {
  total: number;
  tagged: number;
  /** Shots left without `tags`; the run continues past each of them. */
  failed: number;
  failures: TagFailure[];
  /**
   * The provider-reported cost of the run in USD: the sum of every billed
   * call, repair attempts included. `0` when the client reports no cost. This
   * is the actual figure; {@link estimateTaggingCost} stays the pre-flight
   * estimate.
   */
  costUsd: number;
}

export interface TagRun {
  index: FootageIndex;
  report: TagReport;
}

interface Job {
  file: string;
  fps: number;
  shot: IndexedShot;
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    return `${code}: ${message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Shot ids are already filename-safe; this keeps a hand-edited index honest. */
function sheetName(shotId: string): string {
  return `${shotId.replace(/[^A-Za-z0-9._-]+/g, '_')}.jpg`;
}

/**
 * Samples the shot, builds its 3x2 sheet, tags it and always removes the sheet
 * afterwards — a failed ffmpeg run or model call must not leave JPEGs behind.
 */
async function tagOne(
  job: Job,
  frames: number[] | undefined,
  options: TagOptions,
): Promise<ShotTags> {
  const { shot } = job;
  const fallback = (): number[] => sheetTimes(shot.startSec, shot.endSec, job.fps);
  const times =
    frames === undefined
      ? fallback()
      : (probedSheetTimes(shot.startSec, shot.endSec, frames) ?? fallback());
  const sheetPath = join(options.workDir, sheetName(shot.id));
  const durationSec = shot.durationSec > 0 ? shot.durationSec : shot.endSec - shot.startSec;

  try {
    await renderSheet(job.file, times, sheetPath);
    return await tagShot(
      { sheetPath, durationSec },
      {
        client: options.client,
        model: options.model,
        promptVersion: options.promptVersion,
        ...(options.cache === undefined ? {} : { cache: options.cache }),
        ...(options.onCost === undefined ? {} : { onCost: options.onCost }),
      },
    );
  } finally {
    await rm(sheetPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Tags every shot in the index and returns a new index with `shot.tags` filled
 * in. Existing fields and shot order are untouched; a shot that fails stays
 * untagged (its object is reused as-is) while the rest of the run continues.
 */
export async function tagIndex(index: FootageIndex, options: TagOptions): Promise<FootageIndex> {
  const { index: tagged } = await tagIndexWithReport(index, options);
  return tagged;
}

/**
 * `tagIndex` with the run's arithmetic: how many shots were tagged, which ones
 * failed and why, and what the provider charged. The CLI prints this; the app
 * can persist it in the job log.
 */
export async function tagIndexWithReport(
  index: FootageIndex,
  options: TagOptions,
): Promise<TagRun> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`Concurrency must be a positive integer, got ${concurrency}.`);
  }
  if (options.workDir.trim().length === 0) {
    throw new RangeError('Tagging needs a work directory for its contact sheets.');
  }

  await mkdir(options.workDir, { recursive: true });

  // One probe per source clip, shared by every shot in it. Probes run inside
  // the worker pool, so a folder of 100 clips never starts 100 ffprobe
  // processes. A failed probe falls back to the nominal frame grid rather than
  // aborting the run.
  const framesByFile = new Map<string, Promise<number[] | undefined>>();
  const framesFor = (file: string): Promise<number[] | undefined> => {
    const existing = framesByFile.get(file);
    if (existing !== undefined) return existing;
    const pending = exactFrameTimes(file).catch(() => undefined);
    framesByFile.set(file, pending);
    return pending;
  };

  const jobs: Job[] = [];
  for (const clip of index.clips) {
    for (const shot of clip.shots) {
      jobs.push({ file: clip.file, fps: clip.probe.fps, shot });
    }
  }

  const tags = new Map<string, ShotTags>();
  const failures: TagFailure[] = [];
  let done = 0;
  let next = 0;
  let costUsd = 0;

  // Workers interleave but never inside this handler, so a plain sum is safe.
  const addCost = (usd: number): void => {
    if (!Number.isFinite(usd)) return;
    costUsd += usd;
    options.onCost?.(usd);
  };
  const runOptions: TagOptions = { ...options, onCost: addCost };

  const worker = async (): Promise<void> => {
    for (;;) {
      const jobIndex = next;
      next += 1;
      const job = jobs[jobIndex];
      if (job === undefined) return;

      try {
        tags.set(job.shot.id, await tagOne(job, await framesFor(job.file), runOptions));
      } catch (error) {
        // One bad sheet must not abort a listing: record it and keep going.
        failures.push({ shotId: job.shot.id, message: messageOf(error) });
      }

      done += 1;
      options.onProgress?.(done, jobs.length, job.shot.id);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const clips = index.clips.map((clip) => ({
    ...clip,
    shots: clip.shots.map((shot) => {
      const shotTags = tags.get(shot.id);
      return shotTags === undefined ? shot : { ...shot, tags: shotTags };
    }),
  }));

  return {
    index: { ...index, clips },
    report: {
      total: jobs.length,
      tagged: tags.size,
      failed: failures.length,
      failures,
      costUsd,
    },
  };
}
