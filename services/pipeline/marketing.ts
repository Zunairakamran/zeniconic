/**
 * The FFmpeg-first marketing render.
 *
 * A 38 s Remotion pass does not fit the 14-minute export budget (a 30 s pass
 * already took 11m40s), so the marketing format renders picture, transitions,
 * captions and overlay cards in **one** FFmpeg job:
 *
 *   trim / scale / xfade / concat   →  libass captions  →  drawtext cards
 *
 * Remotion stays available for every other format and for the marketing cut
 * when it is explicitly forced (`ZENICONIC_REMOTION=on`), but the default path
 * here is measured in seconds, not minutes.
 *
 * Audio is deliberately not part of this pass. The desktop export muxes the
 * mastered track through its existing two-pass `loudnorm` stage, which is the
 * only place that is allowed to guess a gain.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cue } from '../../packages/captions/src/index';
import type { Edl } from '../../packages/edl/src/index';
import { ffmpegPath, probe } from '../../packages/media/src/index';
import {
  PROFILES,
  buildGraphForRender,
  buildRenderArgs,
  renderProfileFor,
} from '../../packages/render/src/index';
import type { ProfileId, Quality } from '../../packages/render/src/index';
import {
  buildAssDocument,
  buildFilterGraph,
  planDrawTexts,
} from './ffmpeg-overlays';
import type { DrawTextSpec, OverlayBrand, OverlayFacts } from './ffmpeg-overlays';

/** The marketing caption contract: six words a line, two lines a cue. */
export const MARKETING_WORDS_PER_LINE = 6;
export const MARKETING_MAX_LINES = 2;
/** A pause this long between words starts a new cue. */
export const MARKETING_CUE_GAP_SEC = 0.5;
/** The delivered picture may miss its target by this much, and no more. */
export const MARKETING_DURATION_TOLERANCE_SEC = 0.1;

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Wraps words into at most two lines of six words, dropping the overflow. */
export function wrapMarketingLines(words: readonly string[]): string[] {
  const kept = words.slice(0, MARKETING_WORDS_PER_LINE * MARKETING_MAX_LINES);
  const lines: string[] = [];
  for (let index = 0; index < kept.length; index += MARKETING_WORDS_PER_LINE) {
    lines.push(kept.slice(index, index + MARKETING_WORDS_PER_LINE).join(' '));
  }
  return lines.filter((line) => line.trim().length > 0);
}

/**
 * Builds cue lines straight from the EDL's caption words.
 *
 * The packaged overlay path uses `toCues`, which wraps at 20 characters — too
 * tight for marketing copy. This reads the planner's word timings directly and
 * groups on a pause, so one beat is one claim.
 */
export function marketingCaptionCues(edl: Edl): Cue[] {
  const words = (edl.captions.words ?? []).filter(
    (word) => word.endSec > word.startSec && word.text.trim().length > 0,
  );
  if (words.length === 0) return [];

  const cues: Cue[] = [];
  let current: typeof words = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    if (first === undefined || last === undefined) {
      current = [];
      return;
    }
    const lines = wrapMarketingLines(current.map((word) => word.text));
    if (lines.length > 0) {
      cues.push({
        startSec: round3(first.startSec),
        endSec: round3(last.endSec),
        lines,
      });
    }
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    if (
      current.length >= MARKETING_WORDS_PER_LINE * MARKETING_MAX_LINES ||
      (previous !== undefined && word.startSec - previous.endSec > MARKETING_CUE_GAP_SEC)
    ) {
      flush();
    }
    current.push(word);
  }
  flush();

  return cues;
}

interface FfmpegResult {
  code: number;
  stderr: string[];
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<FfmpegResult> {
  return new Promise<FfmpegResult>((resolvePromise, reject) => {
    const child = spawn(ffmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const lines: string[] = [];
    let partial = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, timeoutMs));

    child.stderr.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim().length > 0) lines.push(line);
      }
      if (lines.length > 120) lines.splice(0, lines.length - 120);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (partial.trim().length > 0) lines.push(partial.trim());
      if (timedOut) {
        lines.push(`FFmpeg timed out after ${String(Math.round(timeoutMs / 1000))} s.`);
      }
      resolvePromise({ code: timedOut ? -2 : (code ?? -1), stderr: lines.slice(-20) });
    });
  });
}

export interface MarketingRenderOptions {
  edl: Edl;
  profile: ProfileId;
  quality: Quality;
  output: string;
  /** Scratch directory owned by the caller; always removed by the caller. */
  workDir: string;
  /** Directory holding Archivo.ttf and BricolageGrotesque.ttf. */
  fontsDir: string;
  facts?: OverlayFacts;
  brand?: OverlayBrand;
  /** Skip caption burn-in even when the EDL carries words. */
  burnCaptions?: boolean;
  /** Hard ceiling for the single FFmpeg pass. */
  timeoutMs?: number;
}

export interface MarketingRenderResult {
  output: string;
  /** Duration the filter graph was built for. */
  plannedDurationSec: number;
  /** Duration ffprobe read from the written file. */
  durationSec: number;
  assPath?: string;
  cueCount: number;
  textLayers: string[];
  /** Wall time of the single FFmpeg pass. */
  renderMs: number;
}

function scaleSpecs(specs: readonly DrawTextSpec[], scale: number): DrawTextSpec[] {
  if (Math.abs(scale - 1) < 1e-6) return [...specs];
  return specs.map((spec) => ({
    ...spec,
    fontSize: Math.max(8, Math.round(spec.fontSize * scale)),
    x: Math.round(spec.x * scale),
    y: Math.round(spec.y * scale),
  }));
}

/**
 * Renders the whole marketing film, picture and all, in FFmpeg.
 *
 * The graph is built before a process starts, so a plan that cannot assemble to
 * its own target fails without spending a render. After the pass the file is
 * probed and removed if it missed the target by more than 0.1 s — a marketing
 * cut with a drifting tail is not worth shipping quietly.
 */
export async function renderMarketingFilm(
  options: MarketingRenderOptions,
): Promise<MarketingRenderResult> {
  const spec = PROFILES[options.profile];
  if (spec === undefined) {
    throw new RangeError(`Unknown render profile "${options.profile}".`);
  }
  if (options.output.trim().length === 0) {
    throw new RangeError('A render needs an output path.');
  }

  const target = round3(options.edl.format.targetDurationSec);
  const rendered = renderProfileFor(spec, options.quality);

  const overlayDir = join(options.workDir, 'marketing');
  await mkdir(overlayDir, { recursive: true });

  const burnCaptions = options.burnCaptions ?? options.edl.captions.mode !== 'none';
  const cues = burnCaptions ? marketingCaptionCues(options.edl) : [];
  let assPath: string | undefined;

  if (cues.length > 0) {
    assPath = join(overlayDir, `marketing-${options.profile}.ass`);
    await writeFile(assPath, buildAssDocument(options.edl, cues, options.profile), 'utf8');
  }

  const nominalSpecs = planDrawTexts({
    edl: options.edl,
    profile: options.profile,
    cues,
    ...(options.facts === undefined ? {} : { facts: options.facts }),
    ...(options.brand === undefined ? {} : { brand: options.brand }),
  });
  const scale = spec.width > 0 ? rendered.width / spec.width : 1;
  const specs = scaleSpecs(nominalSpecs, scale);

  const textFiles = new Map<string, string>();
  for (const entry of specs) {
    const file = join(overlayDir, `${entry.id}.txt`);
    await writeFile(file, entry.text, { encoding: 'utf8' });
    textFiles.set(entry.id, file);
  }

  const drawText = buildFilterGraph({
    fontsDir: options.fontsDir,
    specs,
    canvasWidth: rendered.width,
    textFiles,
  });

  const args = buildRenderArgs(options.edl, spec, {
    quality: options.quality,
    output: options.output,
    // Audio is mastered and muxed by the caller's two-pass stage.
    audio: 'none',
    ...(assPath === undefined ? {} : { captionsPath: assPath }),
    ...(drawText === 'null' ? {} : { postFilters: [drawText] }),
  });

  // Fail before spawning when the graph itself cannot hit the target.
  const planned = buildGraphForRender(
    options.edl,
    rendered,
    assPath,
    drawText === 'null' ? undefined : [drawText],
  );
  if (Math.abs(planned.durationSec - target) > MARKETING_DURATION_TOLERANCE_SEC + 1e-9) {
    throw new RangeError(
      `The marketing graph assembles to ${planned.durationSec.toFixed(3)} s, not ${target.toFixed(3)} s.`,
    );
  }

  const startedAt = Date.now();
  const result = await runFfmpeg(args, options.timeoutMs ?? 6 * 60_000);
  const renderMs = Date.now() - startedAt;

  if (result.code !== 0) {
    throw new Error(
      `The FFmpeg marketing pass failed: ${result.stderr[result.stderr.length - 1] ?? `exit ${String(result.code)}`}`,
    );
  }

  const info = await probe(options.output);
  if (Math.abs(info.durationSec - target) > MARKETING_DURATION_TOLERANCE_SEC + 1e-9) {
    await rm(options.output, { force: true }).catch(() => undefined);
    throw new Error(
      `The marketing render runs ${info.durationSec.toFixed(2)} s against a ${target.toFixed(2)} s target; the file was removed.`,
    );
  }

  return {
    output: options.output,
    plannedDurationSec: planned.durationSec,
    durationSec: info.durationSec,
    ...(assPath === undefined ? {} : { assPath }),
    cueCount: cues.length,
    textLayers: nominalSpecs.map((entry) => entry.id),
    renderMs,
  };
}
