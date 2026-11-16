/**
 * The desktop pipeline adapter.
 *
 * It is the only place in the main process that turns a folder into three
 * variants and a variant into a file. The stage runner calls `run()` once per
 * stage; export calls `exportListing()` directly. Both paths share the same
 * analysis cache.
 *
 * Everything is deterministic given the folder and the listing record: the
 * wall clock enters only through the injected `now` on a plan.
 */

import { spawn } from 'node:child_process';
import {
  access,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { buildLoudnormPass1, parseLoudnormJson } from '../../packages/audio/src/index';
import { validateEdl } from '../../packages/edl/src/index';
import type {
  CaptionStyle,
  CaptionWord,
  Clip,
  Edl,
  LookId,
} from '../../packages/edl/src/index';
import { ffmpegPath, probe } from '../../packages/media/src/index';
import type { JobRecord, Stage, StageExecutor } from '../../packages/jobs/src/index';
import { reviewRender } from '../../packages/review/src/index';
import type { FrameSample, ReviewFacts, ReviewResult } from '../../packages/review/src/index';
import type {
  CaptionMode,
  ExportQuality,
  ExportResult,
  JobProgressEvent,
  PipelinePort,
  VariantLook,
  VariantPreview,
  VariantSummary,
  VoiceMode,
} from '../../packages/ipc/src/index';
import type { Candidate, Facts as PlannerFacts } from '../../packages/planner/src/index';
import { PROFILES } from '../../packages/render/src/index';
import type { ProfileId, Quality } from '../../packages/render/src/index';
import type { Facts, ListingRecord, Store } from '../../packages/store/src/index';
import { analyseFolder, buildRequest, defaultCanvas, planEdl, renderEdl } from '../../services/pipeline/service';
import {
  renderFfmpegOverlays,
  resolveFontsDirectory,
  writeSrtFile,
} from '../../services/pipeline/ffmpeg-overlays';
import type {
  OverlayBrand,
  OverlayFacts,
} from '../../services/pipeline/ffmpeg-overlays';
import {
  buildVoiceTrack,
  createKokoroEngine,
  DEFAULT_VOICE,
  modelFilesComplete,
  KOKORO_REPO,
  presenterWindowForCue,
  presenterWindowsFor,
  scriptCues,
  voiceLinePath,
} from '../../services/voice/src/index';
import type { VoiceCaption } from '../../services/voice/src/index';
import {
  readVariantEdl,
  readVariants,
  saveVariants,
  scoreForEdl,
  setVariantApproval,
  VARIANT_LOOKS,
} from './variants';
import type { VariantPlan } from './variants';

export interface DesktopPipelineOptions {
  store: Store;
  /** Absolute store root (`.../data`); holds `tmp/` and `listings/`. */
  dataDir: string;
  /** Repository root in development, used to locate the Remotion CLI. */
  repoRoot?: string;
  /** Sends `job:progress` to the window; absent in tests. */
  onProgress?: (event: JobProgressEvent) => void;
}

interface Analysed {
  folder: string;
  candidates: Candidate[];
  clipCount: number;
}

interface SourceBinding {
  listingId: string;
  folder: string;
}

interface ProcessResult {
  code: number;
  stderr: string[];
  /** True when the runner killed the child at its deadline. */
  timedOut?: boolean;
}

interface CaptureResult {
  code: number;
  stdout: Buffer;
  stderr: string;
  timedOut?: boolean;
}

/**
 * A clip whose `src` does not resolve against the paths a listing may use.
 *
 * Named so the job log and QA output say which clip and which string failed,
 * instead of an opaque ffmpeg "No such file or directory".
 */
export class ClipSourceError extends Error {
  readonly clipId: string;
  readonly src: string;

  constructor(clipId: string, src: string, tried: readonly string[]) {
    super(
      `Clip "${clipId}" points at "${src}", but no such file exists. Tried: ${tried.join(', ')}`,
    );
    this.name = 'ClipSourceError';
    this.clipId = clipId;
    this.src = src;
  }
}

/**
 * A master that missed its delivery target. The file has already been removed
 * when this is thrown; the caller must not fall back to a silent copy.
 */
export class AudioMasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioMasterError';
  }
}

const TARGET_SECONDS = 30;
const EXPORT_PROFILE: ProfileId = 'vertical-social';
const MAX_PROCESS_LINES = 120;
/** A Remotion render that has not finished by now is not going to. */
const REMOTION_TIMEOUT_MS = 12 * 60_000;
/** The whole export must finish inside the 15-minute QA budget. */
const EXPORT_BUDGET_MS = 14 * 60_000;
/** Do not start a Remotion pass with less than this left; a fallback must fit. */
const REMOTION_MIN_REMAINING_MS = 6 * 60_000;
/** FFmpeg text passes are seconds, never minutes. */
const FFMPEG_TIMEOUT_MS = 6 * 60_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asProfile(value: string): ProfileId {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, value)) {
    throw new RangeError(`Unknown render profile "${value}".`);
  }
  return value as ProfileId;
}

function plannerFacts(facts: Facts): PlannerFacts {
  return {
    address: facts.address,
    currency: facts.currency,
    ...(facts.price === undefined ? {} : { price: facts.price }),
    ...(facts.beds === undefined ? {} : { beds: facts.beds }),
    ...(facts.baths === undefined ? {} : { baths: facts.baths }),
  };
}

function overlayFacts(facts: Facts): OverlayFacts {
  return {
    address: facts.address,
    currency: facts.currency,
    ...(facts.price === undefined ? {} : { price: facts.price }),
    ...(facts.beds === undefined ? {} : { beds: facts.beds }),
    ...(facts.baths === undefined ? {} : { baths: facts.baths }),
    ...(facts.sqft === undefined ? {} : { sqft: facts.sqft }),
  };
}

function reviewFacts(facts: Facts): ReviewFacts {
  return {
    address: facts.address,
    ...(facts.price === undefined ? {} : { price: facts.price }),
    ...(facts.beds === undefined ? {} : { beds: facts.beds }),
    ...(facts.baths === undefined ? {} : { baths: facts.baths }),
  };
}

/**
 * Export captions map onto the EDL's caption modes. `sidecar` keeps the words
 * in the document but tells the composition not to draw them; the writer's SRT
 * is the deliverable.
 */
function captionModeFor(mode: CaptionMode): Edl['captions']['mode'] {
  if (mode === 'burned' || mode === 'both') return 'burn';
  if (mode === 'srt') return 'sidecar';
  return 'none';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** FNV-1a: stable across platforms and process restarts. */
function seedFor(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 0x7fffffff;
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function labelFor(look: VariantLook): string {
  return look.charAt(0).toUpperCase() + look.slice(1);
}

const CUT_TRANSITION = { type: 'cut', durationSec: 0 } as const;

/**
 * QA: an EDL with dissolves is overlapped by the FFmpeg graph, so its `-t`
 * would be the shortened timeline (26.5 s for 30 s with 0.35 s dissolves).
 * The picture pass therefore uses a cut-only copy; Remotion owns the visible
 * crossfades, and its composition is clamped to the EDL target.
 */
function cutOnlyEdl(edl: Edl): Edl {
  return {
    ...edl,
    clips: edl.clips.map((clip) => ({
      ...clip,
      transitionIn: { ...CUT_TRANSITION },
      ...(clip.transitionOut === undefined
        ? {}
        : { transitionOut: { ...CUT_TRANSITION } }),
    })),
  };
}

function profileOrientation(profile: ProfileId): 'landscape' | 'portrait' {
  const spec = PROFILES[profile];
  return spec.width > spec.height ? 'landscape' : 'portrait';
}

function formatSeconds(value: number): string {
  return value.toFixed(2);
}

const SOCIAL_BOLD: CaptionStyle = 'social_bold';

/**
 * Expands phrase-level voice captions into the word timings the EDL and the
 * Remotion caption layer expect. It mirrors `scripts/finalize-prototype.ts`,
 * including the forward clamp that keeps caption words from overlapping.
 */
function wordsFromCaptions(captions: readonly VoiceCaption[], totalSec: number): CaptionWord[] {
  const words: CaptionWord[] = [];
  let previousEnd = 0;

  for (const caption of captions) {
    const text = caption.text.trim();
    if (text.length === 0) continue;

    const start = Math.max(caption.startSec, previousEnd);
    const end = Math.min(
      totalSec,
      Math.max(start + 0.2, caption.endSec > start ? caption.endSec : start + 0.8),
    );
    if (end <= start) continue;

    const parts = text.split(/\s+/).filter((part) => part.length > 0);
    const totalChars = parts.reduce((sum, part) => sum + part.length + 1, 0);
    let cursor = start;

    for (const part of parts) {
      const share = ((part.length + 1) / totalChars) * (end - start);
      words.push({
        text: part,
        startSec: roundTime(cursor),
        endSec: roundTime(Math.min(end, cursor + share)),
      });
      cursor += share;
    }

    previousEnd = end;
  }

  return words;
}

/**
 * A hard link is free on the same volume and keeps the bundle pointed at the
 * original bytes. A cross-volume link falls back to a copy.
 */
async function stageMedia(source: string, destination: string): Promise<void> {
  try {
    await link(resolve(source), destination);
  } catch {
    await copyFile(resolve(source), destination);
  }
}

/**
 * Kills a child and, on Windows, its browser/tool grandchildren. `child.kill()`
 * leaves Chromium running after a Remotion timeout, which in turn keeps the
 * export directory locked.
 */
function killTree(child: import('node:child_process').ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => child.kill());
    return;
  }
  child.kill('SIGKILL');
}

/**
 * Runs a child process and keeps the last lines of stderr for the UI. Remotion
 * and ffmpeg both report actionable text there. A deadline is mandatory for
 * Remotion: its browser can otherwise hold an export open indefinitely.
 */
function runProcess(
  bin: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolvePromise, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });

    const lines: string[] = [];
    let partial = '';
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, Math.max(1, options.timeoutMs));

    child.stderr.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim().length > 0) lines.push(line);
      }
      if (lines.length > MAX_PROCESS_LINES) {
        lines.splice(0, lines.length - MAX_PROCESS_LINES);
      }
    });

    child.on('error', (error) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer);
      if (partial.trim().length > 0) lines.push(partial.trim());
      if (timedOut) {
        lines.push(
          `Timed out after ${String(Math.round((options.timeoutMs ?? 0) / 1000))} s and was stopped.`,
        );
      }
      resolvePromise({
        code: timedOut ? -2 : (code ?? -1),
        stderr: lines.slice(-20),
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
  });
}

/** Same lifecycle as `runProcess`, but keeps stdout for a JPEG frame or JSON. */
function runProcessCapture(
  bin: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<CaptureResult> {
  return new Promise<CaptureResult>((resolvePromise, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });

    const chunks: Buffer[] = [];
    let stderr = '';
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, Math.max(1, options.timeoutMs));

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });

    child.on('error', (error) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolvePromise({
        code: timedOut ? -2 : (code ?? -1),
        stdout: Buffer.concat(chunks),
        stderr,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
  });
}

export class DesktopPipeline implements StageExecutor, PipelinePort {
  private readonly store: Store;
  private readonly dataDir: string;
  private readonly repoRoot: string;
  private readonly onProgress: ((event: JobProgressEvent) => void) | undefined;

  private readonly sources = new Map<string, SourceBinding>();
  private readonly analysed = new Map<string, Analysed>();
  /** Set once a Remotion pass fails so the same wall is not waited for twice. */
  private remotionUnavailable = false;

  constructor(options: DesktopPipelineOptions) {
    this.store = options.store;
    this.dataDir = options.dataDir;
    this.repoRoot = resolve(options.repoRoot ?? process.cwd());
    this.onProgress = options.onProgress;
  }

  /** Called by `analysis:start` before the runner picks the job up. */
  prepareAnalysis(input: { jobId: string; listingId: string; folder: string }): void {
    this.sources.set(input.jobId, { listingId: input.listingId, folder: input.folder });
  }

  /** One stage of the runner's `index → plan → render → review` chain. */
  async run(job: JobRecord, signal: AbortSignal): Promise<{ stage: Stage; detail?: string }> {
    if (signal.aborted) throw new Error('Job cancelled.');

    switch (job.stage) {
      case 'index': {
        const analysed = await this.analyse(job, signal);
        return {
          stage: 'index',
          detail: `${analysed.clipCount} clip${analysed.clipCount === 1 ? '' : 's'}, ${analysed.candidates.length} candidates`,
        };
      }

      case 'plan': {
        const listing = await this.requireListing(job.listingId);
        const analysed = await this.analyse(job, signal);
        const variants = await this.planVariants(listing, analysed, signal, job.id);
        this.emit(
          job.id,
          'plan',
          100,
          `${variants.length} variants · ${variants.map((variant) => variant.look).join(', ')}`,
        );
        return {
          stage: 'plan',
          detail: `${variants.length} variants planned`,
        };
      }

      case 'render': {
        const listing = await this.requireListing(job.listingId);
        const variants = await readVariants(this.store.dirFor(listing.id));
        // Warm the poster frames so Variants opens with real stills. A preview
        // failure must not fail the analysis: the edit itself is complete.
        for (const [index, variant] of variants.entries()) {
          if (signal.aborted) throw new Error('Job cancelled.');
          try {
            await this.renderPreview(listing, variant.id);
          } catch (error) {
            console.warn(`[pipeline] preview failed for ${variant.look}: ${messageOf(error)}`);
          }
          this.emit(
            job.id,
            'render',
            Math.round(((index + 1) / Math.max(1, variants.length)) * 100),
            `${labelFor(variant.look)} preview`,
          );
        }
        return { stage: 'render', detail: `${variants.length} previews ready` };
      }

      case 'review':
        return { stage: 'review', detail: 'ready' };

      case 'done':
        return { stage: 'done' };
    }
  }

  // -------------------------------------------------------------------------
  // Variants
  // -------------------------------------------------------------------------

  async listVariants(listingId: string): Promise<VariantSummary[]> {
    return readVariants(this.store.dirFor(listingId));
  }

  async approveVariant(input: {
    listingId: string;
    variantId: string;
    approved: boolean;
  }): Promise<VariantSummary> {
    return setVariantApproval(
      this.store.dirFor(input.listingId),
      input.variantId,
      input.approved,
    );
  }

  async previewVariant(input: {
    listingId: string;
    variantId: string;
  }): Promise<VariantPreview> {
    const listing = await this.requireListing(input.listingId);
    return this.renderPreview(listing, input.variantId);
  }

  private async renderPreview(
    listing: ListingRecord,
    variantId: string,
  ): Promise<VariantPreview> {
    const listingDir = this.store.dirFor(listing.id);
    const unresolved = await readVariantEdl(listingDir, variantId);
    const edl = await this.resolveClipSources(unresolved, listingDir);
    const first = edl.clips[0];
    if (first === undefined) {
      throw new Error(`The "${variantId}" variant has no shots.`);
    }

    const previewDir = join(listingDir, 'variants', 'previews');
    await mkdir(previewDir, { recursive: true });
    const stillPath = join(previewDir, `${variantId}.jpg`);
    const mid = first.inSec + Math.min(1.2, Math.max(0.1, (first.outSec - first.inSec) / 2));

    const result = await runProcess(ffmpegPath(), [
      '-y',
      '-v',
      'error',
      '-ss',
      mid.toFixed(3),
      '-i',
      first.src,
      '-frames:v',
      '1',
      '-vf',
      'scale=1080:-2',
      '-q:v',
      '2',
      stillPath,
    ]);

    if (result.code !== 0 || !(await exists(stillPath))) {
      throw new Error(
        `Could not create a preview frame for "${variantId}": ${result.stderr[result.stderr.length - 1] ?? 'ffmpeg failed.'}`,
      );
    }

    return { stillPath };
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /**
   * QA: cover-cropping a portrait shot into a landscape canvas removes most of
   * the room. For a profile whose orientation differs from the source, that
   * clip is re-framed as `pad_blur`; matching orientations keep their cover
   * crop. Probes are cached per source file.
   */
  private async edlForProfile(edl: Edl, profile: ProfileId): Promise<Edl> {
    const target = profileOrientation(profile);
    const canvas = defaultCanvas(profile);
    const cache = new Map<string, 'landscape' | 'portrait' | 'square'>();
    let changed = false;
    const clips: Clip[] = [];

    for (const clip of edl.clips) {
      let orientation = cache.get(clip.src);
      if (orientation === undefined) {
        try {
          orientation = (await probe(clip.src)).orientation;
        } catch {
          // A missing source is the renderer's problem to report; do not turn
          // a probe failure into a silent framing change.
          orientation = 'square';
        }
        cache.set(clip.src, orientation);
      }

      const mismatch =
        (orientation === 'portrait' && target === 'landscape') ||
        (orientation === 'landscape' && target === 'portrait');

      if (mismatch) {
        changed = true;
        clips.push({
          ...clip,
          transform: { ...clip.transform, mode: 'pad_blur' },
        });
      } else {
        clips.push(clip);
      }
    }

    return changed
      ? { ...edl, canvas: { profile, ...canvas }, clips }
      : { ...edl, canvas: { profile, ...canvas } };
  }

  /**
   * QA: a delivered file must match the edit. A short audio track or a
   * transition miscount removes the file rather than shipping a broken export.
   */
  private async assertDuration(file: string, target: number, label: string): Promise<void> {
    let actual: number;
    try {
      actual = (await probe(file)).durationSec;
    } catch (error) {
      await rm(file, { force: true }).catch(() => undefined);
      throw new Error(`Could not verify the ${label} export: ${messageOf(error)}`);
    }

    if (Math.abs(actual - target) > 0.1) {
      await rm(file, { force: true }).catch(() => undefined);
      throw new Error(
        `The ${label} export runs ${formatSeconds(actual)}s but the edit is ${formatSeconds(target)}s. The file was removed.`,
      );
    }
  }

  /**
   * Resolves every clip once, against the four places a `src` may legitimately
   * point: an absolute path, the listing workspace, the listing's `raw/`
   * directory (the schema contract), and the repository (development/QA EDLs).
   *
   * The returned EDL carries absolute paths, so both FFmpeg and the Remotion
   * staging step see the same bytes. A missing file is a named error, not a
   * mysterious ffmpeg exit.
   */
  private async resolveClipSources(edl: Edl, listingDir: string): Promise<Edl> {
    const cache = new Map<string, string>();
    const clips: Clip[] = [];

    for (const clip of edl.clips) {
      let absolute = cache.get(clip.src);
      if (absolute === undefined) {
        absolute = await this.resolveClipSource(clip.id, clip.src, listingDir);
        cache.set(clip.src, absolute);
      }
      clips.push({ ...clip, src: absolute });
    }

    return { ...edl, clips };
  }

  private async resolveClipSource(
    clipId: string,
    src: string,
    listingDir: string,
  ): Promise<string> {
    const raw = src.trim();
    if (raw.length === 0) throw new ClipSourceError(clipId, src, []);

    const candidates = [
      isAbsolute(raw) ? raw : undefined,
      join(listingDir, raw),
      join(listingDir, 'raw', raw),
      join(this.repoRoot, raw),
      join(process.cwd(), raw),
    ].filter((candidate): candidate is string => candidate !== undefined);

    const tried: string[] = [];
    for (const candidate of new Set(candidates)) {
      tried.push(candidate);
      if (!(await exists(candidate))) continue;
      try {
        if ((await stat(candidate)).isFile()) return resolve(candidate);
      } catch {
        // An unreadable candidate is not the file the EDL meant.
      }
    }

    throw new ClipSourceError(clipId, src, tried);
  }

  /**
   * An optional `<listing>/brand.json` with `{ agentName, agency, orn }`. The
   * export draws the agent name and permit line when this exists; without it
   * both are simply absent, which is the documented optional state.
   */
  private async readBrand(listingDir: string): Promise<OverlayBrand | undefined> {
    for (const candidate of [join(listingDir, 'brand.json'), join(listingDir, 'out', 'brand.json')]) {
      if (!(await exists(candidate))) continue;
      try {
        const parsed = JSON.parse(await readFile(candidate, 'utf8')) as Record<string, unknown>;
        const text = (key: string): string | undefined => {
          const value = parsed[key];
          return typeof value === 'string' && value.trim().length > 0
            ? value.trim()
            : undefined;
        };
        const agentName = text('agentName') ?? text('agent');
        const brand: OverlayBrand = {
          ...(agentName === undefined ? {} : { agentName }),
          ...(text('agency') === undefined ? {} : { agency: text('agency') }),
          ...(text('orn') === undefined ? {} : { orn: text('orn') }),
        };
        if (brand.agentName === undefined && brand.orn === undefined) return undefined;
        return brand;
      } catch (error) {
        console.warn(`[pipeline] could not read ${candidate}: ${messageOf(error)}`);
      }
    }
    return undefined;
  }

  /**
   * The review gate. Real probe, real loudness measurement, real sampled
   * frames; no vision client because the export owns no model budget.
   *
   * A hard failure throws (the caller deletes the file). A retry verdict is a
   * creative warning: the file exists and is shipped with the warning.
   */
  private async reviewExport(input: {
    file: string;
    edl: Edl;
    profile: ProfileId;
    facts: Facts;
  }): Promise<ReviewResult> {
    return reviewRender(
      {
        output: input.file,
        edl: input.edl,
        profile: PROFILES[input.profile],
        facts: reviewFacts(input.facts),
      },
      {
        probe: async (file) => {
          const info = await probe(file);
          return {
            durationSec: info.durationSec,
            width: info.width,
            height: info.height,
          };
        },
        loudness: (file) => this.measureLoudness(file),
        sampleFrames: (file, times) => this.sampleFrames(file, times),
      },
    );
  }

  private async measureLoudness(file: string): Promise<{ lufs: number; truePeak: number }> {
    const result = await runProcessCapture(ffmpegPath(), buildLoudnormPass1(file), {
      timeoutMs: 120_000,
    });
    if (result.code !== 0) {
      throw new Error(
        `loudness measurement failed: ${result.stderr.trim().split(/\r?\n/).at(-1) ?? `exit ${String(result.code)}`}`,
      );
    }
    const measured = parseLoudnormJson(result.stderr);
    return { lufs: measured.inputI, truePeak: measured.inputTp };
  }

  /**
   * One JPEG per requested second, base64, exactly as the reviewer expects.
   *
   * The dense scan asks for ~150 frames. Spawning ffmpeg 150 times took two
   * minutes on the real listing, so the frames are decoded once at 10 fps and
   * each request maps to the nearest decoded frame. Freeze detection still
   * works: a truly held frame encodes to identical bytes.
   */
  private async sampleFrames(file: string, times: readonly number[]): Promise<FrameSample[]> {
    if (times.length === 0) return [];

    const rate = 10;
    const dir = await mkdtemp(join(this.dataDir, 'tmp', 'review-'));
    const samples: FrameSample[] = [];

    try {
      const result = await runProcessCapture(
        ffmpegPath(),
        [
          '-y',
          '-v',
          'error',
          '-i',
          file,
          '-vf',
          `fps=${String(rate)}`,
          '-q:v',
          '6',
          join(dir, 'frame_%05d.jpg'),
        ],
        { timeoutMs: 180_000 },
      );

      if (result.code !== 0) {
        throw new Error(
          `frame sampling failed: ${result.stderr.trim().split(/\r?\n/).at(-1) ?? `exit ${String(result.code)}`}`,
        );
      }

      const frames = (await readdir(dir))
        .filter((name) => name.toLowerCase().endsWith('.jpg'))
        .sort();

      if (frames.length === 0) {
        throw new Error(`frame sampling wrote no frames for ${file}`);
      }

      for (const t of times) {
        const index = Math.min(
          frames.length - 1,
          Math.max(0, Math.round(Math.max(0, t) * rate)),
        );
        const name = frames[index];
        if (name === undefined) continue;
        const data = await readFile(join(dir, name));
        samples.push({ t, jpegBase64: data.toString('base64') });
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(
        () => undefined,
      );
    }

    return samples;
  }

  /**
   * The first frame of the end card. The price card marks the end card when the
   * plan has one; otherwise the last five seconds are the closing beat.
   */
  private async writeCover(file: string, edl: Edl): Promise<string | undefined> {
    const price = edl.overlays.find((overlay) => overlay.kind === 'price');
    const at = Math.max(
      0,
      price === undefined ? edl.format.targetDurationSec - 5.2 : price.inSec + 0.05,
    );
    const cover = file.replace(/\.mp4$/i, '_cover.jpg');

    const result = await runProcess(
      ffmpegPath(),
      [
        '-y',
        '-v',
        'error',
        '-ss',
        at.toFixed(3),
        '-i',
        file,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        cover,
      ],
      { timeoutMs: 60_000 },
    );

    if (result.code !== 0 || !(await exists(cover))) {
      console.warn(
        `[pipeline] cover frame failed for ${file}: ${result.stderr[result.stderr.length - 1] ?? 'ffmpeg failed.'}`,
      );
      return undefined;
    }
    return cover;
  }

  /**
   * Renders every approved variant for every selected profile:
   * picture (FFmpeg) → overlays (Remotion when present, FFmpeg otherwise)
   * → audio mux → review gate → sidecars.
   */
  async exportListing(input: {
    listing: ListingRecord;
    profiles: string[];
    quality: ExportQuality;
    captions: CaptionMode;
    voice: VoiceMode;
    /** Auto cover frames are written unless this is explicitly false. */
    cover?: boolean;
  }): Promise<ExportResult> {
    const startedAt = Date.now();
    const deadline = startedAt + EXPORT_BUDGET_MS;
    this.remotionUnavailable = false;
    const listing = input.listing;
    const listingDir = this.store.dirFor(listing.id);
    const quality: Quality = input.quality;
    const jobId = `export_${listing.id}`;

    const profiles = [...new Set(input.profiles.map(asProfile))];
    if (profiles.length === 0) throw new Error('Choose at least one output shape.');

    const variants = (await readVariants(listingDir)).filter((variant) => variant.approved);
    if (variants.length === 0) {
      throw new Error('Approve at least one variant before exporting.');
    }

    const tmpDir = join(this.dataDir, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const workDir = await mkdtemp(join(tmpDir, 'export-'));
    const total = variants.length * profiles.length;
    const files: string[] = [];
    const warnings: string[] = [];
    const fontsDir = resolveFontsDirectory(this.repoRoot);
    const brand = await this.readBrand(listingDir);
    const facts = overlayFacts(listing.facts);
    let done = 0;
    let captionWordCount = 0;

    try {
      // The voice stage runs once per listing, not once per profile. Every
      // profile reuses the same mastered audio and caption words.
      const leadVariant = variants[0];
      if (leadVariant === undefined) {
        throw new Error('Approve at least one variant before exporting.');
      }
      const leadEdl = await readVariantEdl(listingDir, leadVariant.id);
      const voice = await this.buildAudioForListing({
        listing,
        listingDir,
        edl: leadEdl,
        mode: input.voice,
        workDir,
      });
      warnings.push(...voice.warnings);

      for (const variant of variants) {
        const unresolved = await readVariantEdl(listingDir, variant.id);
        // Resolve once per render: every profile and every renderer sees the
        // same absolute source, and a missing file fails before ffmpeg starts.
        const sourceEdl = await this.resolveClipSources(unresolved, listingDir);

        for (const profile of profiles) {
          this.emit(
            jobId,
            'render',
            Math.floor((done / total) * 100),
            `${labelFor(variant.look)} · ${profile} · ${done + 1} of ${total}`,
          );

          // Profile-specific framing: a portrait source into a landscape
          // canvas becomes blurred bars, never a horizontal centre crop.
          const profileEdl = await this.edlForProfile(sourceEdl, profile);

          // Captions follow the spoken track when the voice stage produced
          // words; otherwise the EDL's curated words are the caption source.
          // Dropping both is how an export used to ship picture-only.
          const words =
            voice.captions.length > 0 ? voice.captions : (profileEdl.captions.words ?? []);
          captionWordCount = Math.max(captionWordCount, words.length);
          const captionedEdl: Edl = {
            ...profileEdl,
            captions: {
              mode: captionModeFor(input.captions),
              language: profileEdl.captions.language ?? 'en-GB',
              style: SOCIAL_BOLD,
              ...(words.length === 0 ? {} : { words }),
            },
          };

          // QA: cut-only picture pass so FFmpeg never shortens the timeline by
          // overlapping dissolves. Remotion applies the visible crossfades.
          const pictureEdl = cutOnlyEdl(captionedEdl);
          const picture = join(workDir, `${variant.look}_${profile}_picture.mp4`);
          const output = await this.outputPath(listing, variant.look, profile);

          try {
            await renderEdl(pictureEdl, profile, quality, picture, {
              // The picture pass is the one long FFmpeg step; it gets what is
              // left of the budget, not an open-ended slot.
              timeoutMs: Math.max(60_000, deadline - Date.now()),
            });
          } catch (error) {
            throw new Error(
              `Could not render the ${labelFor(variant.look)} ${profile} video: ${messageOf(error)}`,
            );
          }

          const overlay = await this.renderOverlays({
            edl: captionedEdl,
            profile,
            quality,
            picture,
            workDir,
            captions: input.captions,
            brand,
            facts,
            deadline,
            fontsDir,
          });
          if (overlay.warning !== undefined) warnings.push(overlay.warning);

          if (voice.audioPath !== undefined) {
            try {
              await this.muxVoice(
                overlay.output,
                voice.audioPath,
                output,
                profile,
                sourceEdl.format.targetDurationSec,
              );
            } catch (error) {
              // A mastering failure is not an audio enhancement that can be
              // dropped: it already deleted the file and must stop the export.
              if (error instanceof AudioMasterError) throw error;
              // Audio is an enhancement, not a reason to lose the picture.
              warnings.push(
                `The audio track could not be added (${messageOf(error)}); exporting silent video.`,
              );
              await copyFile(overlay.output, output);
            }
          } else {
            await copyFile(overlay.output, output);
          }

          if (!(await exists(output))) {
            throw new Error(`The ${labelFor(variant.look)} ${profile} file was not written.`);
          }

          await this.assertDuration(
            output,
            sourceEdl.format.targetDurationSec,
            `${labelFor(variant.look)} ${profile}`,
          );

          // The review gate runs on the finished file, not the plan.
          const review = await this.reviewExport({
            file: output,
            edl: profileEdl,
            profile,
            facts: listing.facts,
          });

          if (review.verdict === 'fail') {
            const failed = review.checks.filter((check) => !check.passed);
            await rm(output, { force: true }).catch(() => undefined);
            throw new Error(
              `The ${labelFor(variant.look)} ${profile} export failed review and was deleted:\n- ${failed
                .map((check) => `${check.id}: ${check.detail}`)
                .join('\n- ')}`,
            );
          }
          if (review.verdict === 'retry') {
            warnings.push(
              `The ${labelFor(variant.look)} ${profile} export passed the file checks but review asked for another pass: ${
                review.feedback ?? 'adjust the edit and re-export.'
              }`,
            );
          }

          files.push(output);

          if (input.captions === 'srt' || input.captions === 'both') {
            const srtPath = output.replace(/\.mp4$/i, '.srt');
            const srt = await writeSrtFile(captionedEdl, srtPath);
            if (srt.cueCount === 0) {
              warnings.push(
                `The ${labelFor(variant.look)} ${profile} export has no caption words, so no .srt was written.`,
              );
            } else {
              files.push(srt.path);
            }
          }

          if (input.cover !== false) {
            const cover = await this.writeCover(output, profileEdl);
            if (cover !== undefined) files.push(cover);
          }

          done += 1;
          this.emit(
            jobId,
            'render',
            Math.floor((done / total) * 100),
            `${labelFor(variant.look)} · ${profile} · ${done} of ${total}`,
          );
        }
      }

      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.emit(
        jobId,
        'render',
        100,
        `${files.length} file${files.length === 1 ? '' : 's'} written · ${captionWordCount} caption words · ${seconds} s`,
      );
      const exportDir = join(listingDir, 'exports');
      return warnings.length > 0 ? { files, exportDir, warnings } : { files, exportDir };
    } finally {
      // Remotion's browser can hold a handle for a moment after it exits.
      await rm(workDir, {
        recursive: true,
        force: true,
        maxRetries: 6,
        retryDelay: 250,
      }).catch((error: unknown) => {
        console.warn(`[pipeline] could not remove ${workDir}: ${messageOf(error)}`);
      });
    }
  }

  /** The shipped catchy bed; `data/assets` wins over the legacy `data/music`. */
  private async findMusicTrack(): Promise<string | undefined> {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const packaged =
      typeof resourcesPath === 'string' && resourcesPath.length > 0
        ? join(resourcesPath, 'assets', 'music', 'catchy-120.m4a')
        : undefined;
    const candidates = [
      packaged,
      join(this.dataDir, 'assets', 'music', 'catchy-120.m4a'),
      join(this.dataDir, 'music', 'catchy-120.m4a'),
      join(this.repoRoot, 'data', 'assets', 'music', 'catchy-120.m4a'),
      join(this.repoRoot, 'data', 'music', 'catchy-120.m4a'),
    ].filter((candidate): candidate is string => candidate !== undefined);
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
    return undefined;
  }

  /** A short, factual script for the Kokoro bridge lines. */
  private scriptForListing(listing: ListingRecord, edl: Edl): string {
    const facts = listing.facts;
    const parts: string[] = [`${listing.address}.`];

    if (facts.beds !== undefined && facts.baths !== undefined) {
      parts.push(`${facts.beds} bedroom, ${facts.baths} bathroom.`);
    } else if (facts.beds !== undefined) {
      parts.push(`${facts.beds} bedroom.`);
    }

    const rooms = [...new Set(edl.clips.flatMap((clip) => (clip.room ? [clip.room] : [])))]
      .slice(0, 4)
      .map((room) => room.replace(/_/g, ' '));
    if (rooms.length > 0) parts.push(`A ${rooms.join(', ')} walkthrough.`);

    if (facts.price !== undefined && facts.price.trim().length > 0) {
      parts.push(`Offered at ${facts.price.trim()}.`);
    }

    return parts.join(' ');
  }

  /** The cache root the Kokoro loader can actually read, or undefined. */
  private async resolveVoiceModelDir(modelDir: string): Promise<string | undefined> {
    // The Settings download is the packaged path and the only one with a
    // verified marker.
    if (await modelFilesComplete(modelDir)) return modelDir;

    // A developer's pre-existing library cache is still useful, but only via
    // the cache root the library reads (`<cacheDir>/<repo>/<file>`), never the
    // HF hub layout, which this library cannot open. Claiming a model is
    // present when the loader cannot see it is how an export ends up fetching
    // 92 MB mid-render.
    const repoPath = [...KOKORO_REPO.split('/')];
    const roots = [
      join(this.repoRoot, 'node_modules', '@huggingface', 'transformers', '.cache'),
      join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache'),
      join(this.repoRoot, '.cache'),
    ];
    for (const root of roots) {
      if (await modelFilesComplete(join(root, ...repoPath))) return root;
    }
    return undefined;
  }

  /**
   * A cache miss must not hold an export hostage to a 90 MB download. If every
   * line is cached the model is never touched; otherwise the export uses music
   * until the voice stage has been run once.
   */
  private async voiceIsReady(
    edl: Edl,
    listingDir: string,
    cacheDir: string,
    modelDir: string | undefined,
  ): Promise<boolean> {
    if (modelDir !== undefined) return true;

    const cues = scriptCues(edl);
    const windows = presenterWindowsFor(edl, listingDir);
    for (const cue of cues) {
      if (presenterWindowForCue(cue, windows) !== null) continue;
      if (!(await exists(voiceLinePath(cacheDir, cue.text, DEFAULT_VOICE)))) return false;
    }
    return true;
  }

  /**
   * One voice pass per listing. `restore` uses presenter audio when it exists;
   * `music` skips speech. A failed model load never fails the export: the
   * mastered bed (or silence) is used and the caller gets a warning.
   */
  private async buildAudioForListing(input: {
    listing: ListingRecord;
    listingDir: string;
    edl: Edl;
    mode: VoiceMode;
    workDir: string;
  }): Promise<{ audioPath?: string; captions: CaptionWord[]; warnings: string[] }> {
    const music = await this.findMusicTrack();
    const totalSec = input.edl.format.targetDurationSec;
    const cacheDir = join(this.dataDir, 'voice');
    const modelDir = join(this.dataDir, 'models', 'kokoro');
    const outDir = join(input.workDir, 'voice');
    const withMusic = (): { audioPath?: string } => (music === undefined ? {} : { audioPath: music });

    const presenter = await exists(join(input.listingDir, 'out', 'audio', 'speech.json'));
    if (input.mode === 'restore' && !presenter) {
      return {
        ...withMusic(),
        captions: [],
        warnings: ['No presenter audio was found; exporting with music only.'],
      };
    }

    const preparedEdl: Edl =
      input.mode === 'music'
        ? {
            ...input.edl,
            captions: { mode: 'none' },
            audio: { ...input.edl.audio, voice: { mode: 'keep' } },
          }
        : {
            ...input.edl,
            audio: {
              ...input.edl.audio,
              voice: {
                mode: 'keep',
                text: this.scriptForListing(input.listing, input.edl),
              },
            },
          };

    let voiceReady = true;
    let modelCache: string | undefined;
    if (input.mode !== 'music') {
      try {
        modelCache = await this.resolveVoiceModelDir(modelDir);
        voiceReady = await this.voiceIsReady(preparedEdl, input.listingDir, cacheDir, modelCache);
      } catch (error) {
        console.warn(`[pipeline] voice preflight failed: ${messageOf(error)}`);
        voiceReady = false;
      }
    }

    if (!voiceReady) {
      // Never fetch 92 MB behind the user's back: Settings owns that decision.
      // The export stays music-only and says what to do next.
      return {
        ...withMusic(),
        captions: [],
        warnings: [
          modelCache !== undefined
            ? 'The voice model is installed, but this listing has no speech cache yet. Re-export to use the voice, or keep music.'
            : 'The voice model is not downloaded. Open Settings → Voice model to get it; this export uses music only.',
        ],
      };
    }

    try {
      const result = await buildVoiceTrack({
        edl: preparedEdl,
        listingDir: input.listingDir,
        ...(music === undefined ? {} : { music }),
        cacheDir,
        ...(modelCache === undefined ? {} : { modelDir: modelCache }),
        outDir,
        totalSec,
      });

      return {
        audioPath: result.audioPath,
        captions:
          input.mode === 'music'
            ? []
            : wordsFromCaptions(result.captions, totalSec),
        warnings: [],
      };
    } catch (error) {
      const reason = messageOf(error);
      console.warn(`[pipeline] voice stage failed: ${reason}`);
      return {
        ...withMusic(),
        captions: [],
        warnings: [
          input.mode === 'music' || music === undefined
            ? `The music bed could not be mastered (${reason}); exporting without audio.`
            : `The voice track could not be built (${reason}); exporting with music only.`,
        ],
      };
    }
  }

  /**
   * Remotion owns the visible picture (crossfades included) and the text when
   * its CLI is present and there is time left in the export budget.
   *
   * The source clips are hard-linked into an export-local public directory, so
   * footage can live on any drive while the bundle stays small and no listing
   * file is modified. When Remotion is absent (packaged), fails, or times out,
   * the FFmpeg overlay path burns the same captions and cards onto the
   * already-cut picture. A timeout marks Remotion unusable for the rest of the
   * export: waiting for the same wall twice is how a 30 s film takes 15 min.
   */
  private async renderOverlays(input: {
    edl: Edl;
    profile: ProfileId;
    quality: Quality;
    picture: string;
    workDir: string;
    captions: CaptionMode;
    brand: OverlayBrand | undefined;
    facts: OverlayFacts;
    deadline: number;
    fontsDir: string;
  }): Promise<{ output: string; warning?: string }> {
    const tsxCli = join(this.repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const overlayCli = join(this.repoRoot, 'apps', 'render', 'src', 'cli.ts');
    const forced = process.env.ZENICONIC_REMOTION;
    const cliPresent = (await exists(tsxCli)) && (await exists(overlayCli));
    const remaining = input.deadline - Date.now();
    let warning: string | undefined;

    if (
      forced !== 'off' &&
      cliPresent &&
      (!this.remotionUnavailable || forced === 'on') &&
      remaining > REMOTION_MIN_REMAINING_MS &&
      input.edl.clips.length > 0
    ) {
      try {
        const publicDir = join(input.workDir, `public-${input.profile}`);
        await mkdir(publicDir, { recursive: true });

        const clips: Clip[] = [];
        for (const [index, clip] of input.edl.clips.entries()) {
          const extension = extname(clip.src).toLowerCase() || '.mp4';
          const name = `clip_${String(index).padStart(2, '0')}${extension}`;
          await stageMedia(clip.src, join(publicDir, name));
          clips.push({ ...clip, src: name });
        }

        const output = await this.runOverlayRender(
          { ...input.edl, clips },
          { ...input, publicDir, suffix: 'source' },
          tsxCli,
          overlayCli,
          Math.min(this.remotionTimeoutMs(), Math.max(1, remaining)),
        );
        return { output };
      } catch (error) {
        const reason = messageOf(error);
        this.remotionUnavailable = true;
        console.warn(`[pipeline] Remotion overlay pass failed: ${reason}`);
        warning = `Remotion could not draw the overlays (${reason}); the export used the FFmpeg text path.`;
      }
    }

    if (forced !== 'off' && cliPresent && !this.remotionUnavailable && remaining <= REMOTION_MIN_REMAINING_MS) {
      // Not an error, but not a silent downgrade either: the viewer is told
      // why this export's text looks like the FFmpeg path.
      warning =
        'Remotion was skipped because the export budget was nearly spent; the FFmpeg text path drew the overlays.';
    }

    try {
      const output = join(input.workDir, `${input.profile}_text.mp4`);
      await renderFfmpegOverlays({
        // A fallback that outlives the budget is the same failure as a
        // timeout: the pass gets what is left, and no more.
        timeoutMs: Math.max(30_000, Math.min(remaining, FFMPEG_TIMEOUT_MS)),
        edl: input.edl,
        profile: input.profile,
        quality: input.quality,
        picture: input.picture,
        output,
        workDir: input.workDir,
        burnCaptions: input.captions === 'burned' || input.captions === 'both',
        facts: input.facts,
        ...(input.brand === undefined ? {} : { brand: input.brand }),
        fontsDir: input.fontsDir,
      });
      return {
        output,
        ...(warning === undefined ? {} : { warning }),
      };
    } catch (error) {
      throw new Error(
        `The picture rendered, but neither the Remotion nor the FFmpeg text pass succeeded: ${messageOf(error)}${
          warning === undefined ? '' : ` (${warning})`
        }`,
      );
    }
  }

  /**
   * The Remotion deadline, overridable for QA so the timeout path can be
   * proved without waiting twelve minutes.
   */
  private remotionTimeoutMs(): number {
    const override = Number(process.env.ZENICONIC_REMOTION_TIMEOUT_MS);
    return Number.isFinite(override) && override > 0
      ? Math.min(REMOTION_TIMEOUT_MS, override)
      : REMOTION_TIMEOUT_MS;
  }

  private async runOverlayRender(
    edl: Edl,
    input: {
      profile: ProfileId;
      quality: Quality;
      workDir: string;
      publicDir: string;
      captions: CaptionMode;
      suffix: string;
      brand: OverlayBrand | undefined;
    },
    tsxCli: string,
    overlayCli: string,
    timeoutMs: number,
  ): Promise<string> {
    const check = validateEdl(edl);
    if (!check.valid) {
      throw new Error(check.issues[0]?.message ?? 'invalid overlay plan');
    }

    const edlPath = join(input.workDir, `${input.profile}_${input.suffix}.edl.json`);
    const output = join(input.workDir, `${input.profile}_${input.suffix}.mp4`);
    await writeFile(edlPath, `${JSON.stringify(edl, null, 2)}\n`, 'utf8');

    const args = [
      tsxCli,
      overlayCli,
      '--edl',
      edlPath,
      '--profile',
      input.profile,
      '--listing',
      input.publicDir,
      '--out',
      output,
      '--quality',
      input.quality,
    ];
    if (input.captions === 'burned' || input.captions === 'both') args.push('--captions');
    if (input.brand?.agentName !== undefined) args.push('--agent', input.brand.agentName);
    if (input.brand?.agency !== undefined) args.push('--agency', input.brand.agency);
    if (input.brand?.orn !== undefined) args.push('--orn', input.brand.orn);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TEMP: join(this.dataDir, 'tmp'),
      TMP: join(this.dataDir, 'tmp'),
    };

    const result = await runProcess(process.execPath, args, {
      cwd: this.repoRoot,
      env,
      timeoutMs,
    });

    if (result.code !== 0 || !(await exists(output))) {
      const tail = result.stderr.slice(-5).join(' | ');
      throw new Error(
        result.timedOut === true
          ? `Remotion timed out after ${String(Math.round(timeoutMs / 1000))} s. ${tail}`
          : (tail || 'Remotion exited early.'),
      );
    }
    return output;
  }

  /**
   * The delivery master: measured two-pass `loudnorm`, padded to the timeline,
   * then verified with `ebur128`.
   *
   * Pass 1 (`loudnorm … print_format=json -f null -`) measures the track. Pass
   * 2 applies those measurements with `linear=true` and `apad=whole_dur` so a
   * short bed can never shorten the video. `-shortest` is gone: `-t` is the
   * exact timeline and the pad fills anything short of it.
   *
   * A master outside ±0.5 LU of the profile target, or above the −1.5 dBTP
   * ceiling, deletes the file and fails loudly. Shipping a quiet or clipped
   * mix is worse than an export that says why it stopped.
   */
  private async muxVoice(
    picture: string,
    voice: string,
    output: string,
    profile: ProfileId,
    durationSec: number,
  ): Promise<void> {
    const spec = PROFILES[profile];
    const targetLufs = spec.lufs;
    const ceiling = spec.truePeak;

    // Pass 1: measure at the delivery target so the JSON names the same mode
    // the app will apply.
    const pass1 = await runProcessCapture(
      ffmpegPath(),
      [
        '-hide_banner',
        '-nostats',
        '-i',
        voice,
        '-af',
        `loudnorm=I=${targetLufs}:TP=${ceiling}:print_format=json`,
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: 120_000 },
    );
    if (pass1.code !== 0) {
      throw new Error(
        `The audio could not be measured for mastering: ${
          pass1.stderr.trim().split(/\r?\n/).at(-1) ?? `ffmpeg exited ${String(pass1.code)}`
        }`,
      );
    }
    const measured = parseLoudnormJson(pass1.stderr);

    // Master 0.3 dB under the ceiling: rounding in AAC and ebur128 otherwise
    // reports −1.49 dBTP against a −1.5 limit.
    const masterPeak = Math.min(ceiling, -0.1) - 0.3;
    // Loudnorm options are `:`-separated; filters are `,`-separated.
    const loudnorm = [
      `loudnorm=I=${targetLufs}`,
      `TP=${masterPeak.toFixed(2)}`,
      'LRA=11',
      `measured_I=${measured.inputI}`,
      `measured_TP=${measured.inputTp}`,
      `measured_LRA=${measured.inputLra}`,
      `measured_thresh=${measured.inputThresh}`,
      'linear=true',
    ].join(':');
    let correctionDb = 0;
    let delivered: { lufs: number; truePeak: number } | undefined;

    // Two attempts: the measured pass usually lands within 0.1 LU, but a bed
    // trimmed to the timeline can sit half a LU off. One corrective `volume`
    // pass closes that without re-running the whole analysis.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const filters = [loudnorm];
      if (Math.abs(correctionDb) >= 0.05) {
        filters.push(`volume=${correctionDb.toFixed(2)}dB`);
      }
      filters.push(`apad=whole_dur=${durationSec.toFixed(3)}`);

      const result = await runProcess(
        ffmpegPath(),
        [
          '-y',
          '-v',
          'error',
          '-i',
          picture,
          '-i',
          voice,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          spec.audioBitrate,
          '-ar',
          '48000',
          '-af',
          filters.join(','),
          '-t',
          durationSec.toFixed(3),
          '-movflags',
          '+faststart',
          output,
        ],
        { timeoutMs: FFMPEG_TIMEOUT_MS },
      );

      if (result.code !== 0) {
        throw new Error(
          `Could not add the voice track: ${result.stderr[result.stderr.length - 1] ?? 'ffmpeg failed.'}`,
        );
      }

      delivered = await this.measureDeliveredAudio(output);
      if (delivered === undefined) break;

      const loudnessDelta = targetLufs - delivered.lufs;
      const peakRoom = ceiling - 0.1 - delivered.truePeak;
      const acceptable =
        Math.abs(loudnessDelta) <= 0.4 + 1e-9 && delivered.truePeak <= ceiling - 0.05 + 1e-9;
      if (acceptable) break;

      // Never raise the level if there is no true-peak headroom for it.
      correctionDb += Math.max(-3, Math.min(3, Math.min(loudnessDelta, peakRoom)));
    }

    if (delivered === undefined) {
      await rm(output, { force: true }).catch(() => undefined);
      throw new AudioMasterError(
        `The ${profile} master has no readable audio after muxing. The file was removed.`,
      );
    }

    const loudnessError = Math.abs(delivered.lufs - targetLufs);
    if (loudnessError > 0.5 + 1e-9 || delivered.truePeak > ceiling + 1e-9) {
      await rm(output, { force: true }).catch(() => undefined);
      throw new AudioMasterError(
        `The ${profile} master is outside delivery: ${delivered.lufs.toFixed(2)} LUFS (target ${targetLufs.toFixed(
          1,
        )} ±0.5), true peak ${delivered.truePeak.toFixed(2)} dBTP (limit ${ceiling.toFixed(
          1,
        )}). The file was removed.`,
      );
    }
  }

  /** `ebur128` summary of the finished file: integrated LUFS and true peak. */
  private async measureDeliveredAudio(
    file: string,
  ): Promise<{ lufs: number; truePeak: number } | undefined> {
    const result = await runProcessCapture(
      ffmpegPath(),
      [
        '-hide_banner',
        '-nostats',
        '-i',
        file,
        '-map',
        '0:a:0',
        '-af',
        'ebur128=peak=true',
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: 120_000 },
    );
    if (result.code !== 0) return undefined;

    const lufsMatches = [...result.stderr.matchAll(/I:\s*(-?[0-9.]+)\s*LUFS/g)];
    const peakMatches = [...result.stderr.matchAll(/Peak:\s*(-?[0-9.]+)\s*dBFS/g)];
    const lufs = Number(lufsMatches.at(-1)?.[1]);
    const truePeak = Number(peakMatches.at(-1)?.[1]);
    if (!Number.isFinite(lufs) || !Number.isFinite(truePeak)) return undefined;
    return { lufs, truePeak };
  }

  // -------------------------------------------------------------------------
  // Stages
  // -------------------------------------------------------------------------

  private async analyse(job: JobRecord, signal: AbortSignal): Promise<Analysed> {
    const binding = this.sources.get(job.id);
    const folder =
      binding?.folder ??
      this.analysed.get(job.listingId)?.folder ??
      join(this.store.dirFor(job.listingId), 'media');

    const analysed = await this.indexFolder(job.listingId, folder, (event) =>
      this.forward(job.id, event),
    );
    if (signal.aborted) throw new Error('Job cancelled.');
    return analysed;
  }

  private async indexFolder(
    listingId: string,
    folder: string,
    emit: (event: { stage: string; percent: number; detail?: string }) => void,
  ): Promise<Analysed> {
    const cached = this.analysed.get(listingId);
    if (cached !== undefined && cached.folder === folder) return cached;

    emit({ stage: 'index', percent: 0, detail: `Indexing ${folder}` });

    let result;
    try {
      result = await analyseFolder(folder, { onProgress: emit });
    } catch (error) {
      throw new Error(`Could not analyse "${folder}": ${messageOf(error)}`, { cause: error });
    }

    const analysed: Analysed = {
      folder,
      candidates: result.candidates,
      clipCount: result.index.clips.length,
    };
    this.analysed.set(listingId, analysed);

    await this.store.update(listingId, { clipCount: analysed.clipCount });
    emit({
      stage: 'index',
      percent: 100,
      detail: `${analysed.clipCount} clips, ${analysed.candidates.length} candidates`,
    });

    return analysed;
  }

  /**
   * Plans the three creative directions. Each look changes the pacing and each
   * seed changes only deterministic tie-breaks, so they can share a candidate
   * pool without producing the same cut.
   */
  private async planVariants(
    listing: ListingRecord,
    analysed: Analysed,
    signal: AbortSignal,
    jobId: string,
  ): Promise<VariantSummary[]> {
    const plans: VariantPlan[] = [];

    for (const [index, look] of VARIANT_LOOKS.entries()) {
      if (signal.aborted) throw new Error('Job cancelled.');

      const edl = this.plan(
        listing,
        analysed,
        EXPORT_PROFILE,
        look,
        seedFor(`${listing.id}:${look}`),
      );
      plans.push({
        summary: {
          id: look,
          look,
          format: edl.format.id,
          targetDurationSec: edl.format.targetDurationSec,
          clipCount: edl.clips.length,
          score: scoreForEdl(edl),
          // `saveVariants` fills the absolute path after writing.
          edlPath: '',
          approved: false,
        },
        edl,
      });

      this.emit(
        jobId,
        'plan',
        Math.round(((index + 1) / VARIANT_LOOKS.length) * 100),
        `${labelFor(look)} · ${edl.clips.length} shots`,
      );
    }

    return saveVariants(this.store.dirFor(listing.id), plans);
  }

  private plan(
    listing: ListingRecord,
    analysed: Analysed,
    profile: ProfileId,
    look: LookId,
    seed: number,
  ): Edl {
    if (analysed.candidates.length === 0) {
      throw new Error(`No usable shots in "${listing.address}". Add footage and analyse again.`);
    }

    const request = buildRequest({
      listingId: listing.id,
      candidates: analysed.candidates,
      facts: plannerFacts(listing.facts),
      // The music bank is a later stage; an empty src means no audio track.
      music: { trackId: 'none', src: '', beatGrid: [], gainDb: -18, duckUnderVoiceDb: -12 },
      profile,
      targetSec: TARGET_SECONDS,
      look,
      seed,
      now: new Date().toISOString(),
    });

    return planEdl(request);
  }

  private async requireListing(id: string): Promise<ListingRecord> {
    const listing = await this.store.get(id);
    if (listing === undefined) throw new Error(`Listing "${id}" was not found.`);
    return listing;
  }

  /**
   * FR-51: deterministic stem, never overwrite an existing file. A re-export
   * lands beside the first one with the next version number.
   */
  private async outputPath(
    listing: ListingRecord,
    look: VariantLook,
    profile: ProfileId,
  ): Promise<string> {
    const directory = join(this.store.dirFor(listing.id), 'exports');
    await mkdir(directory, { recursive: true });

    let version = 1;
    let candidate = join(directory, `${listing.id}_${look}_${profile}_v${version}.mp4`);
    while (await exists(candidate)) {
      version += 1;
      candidate = join(directory, `${listing.id}_${look}_${profile}_v${version}.mp4`);
    }
    return candidate;
  }

  // -------------------------------------------------------------------------
  // Progress
  // -------------------------------------------------------------------------

  private forward(
    jobId: string,
    event: { stage: string; percent: number; detail?: string },
  ): void {
    this.emit(jobId, event.stage, event.percent, event.detail);
  }

  private emit(jobId: string, stage: string, percent: number, detail?: string): void {
    if (this.onProgress === undefined) return;

    const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
    this.onProgress({
      jobId,
      stage,
      percent: clamped,
      ...(detail === undefined ? {} : { detail }),
    });
  }
}
