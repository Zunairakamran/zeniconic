/**
 * Draft preview: a real, cheap render of an agent-edited EDL.
 *
 * This is neither a still frame nor an export. One FFmpeg picture pass at the
 * `draft` quality rung (half the profile canvas, CRF 28, `veryfast`) and — only
 * when the document actually carries text — one `drawtext`/libass pass. No
 * Remotion, no loudness mastering, no segment cache. The result is what the
 * agent loop can afford to run after every few edits.
 *
 * Why a separate module rather than a flag on `renderEdl`: the preview owns
 * three things the export does not — source resolution against a listing
 * folder, a width cap, and an all-or-nothing scratch directory. Keeping those
 * out of `services/pipeline/service.ts` means the export path stays untouched.
 *
 * Invariants
 * ----------
 * - The caller's EDL is never mutated; a clone carries the resolved paths.
 * - Every write happens inside `dirname(output)`; the scratch directory is a
 *   hidden sibling of the output and is always removed.
 * - The final file is probed before it is reported, so `width`, `height` and
 *   `durationSec` describe the bytes on disk, not the plan.
 * - A preview may be silent. Loudness is not asserted or normalised.
 */

import { mkdir, mkdtemp, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Edl } from '../../../packages/edl/src/index';
import { probe as probeFile } from '../../../packages/media/src/index';
import type { ProbeResult } from '../../../packages/media/src/index';
import {
  buildGraphWithDiagnostics,
  PROFILES,
  renderProfileFor,
} from '../../../packages/render/src/index';
import type { ProfileId, Quality, RenderProfile } from '../../../packages/render/src/index';
import { RenderError, renderEdl } from '../../pipeline/service';
import {
  captionCuesForExport,
  planDrawTexts,
  renderFfmpegOverlays,
} from '../../pipeline/ffmpeg-overlays';
import type {
  OverlayBrand,
  OverlayFacts,
  OverlayRenderOptions,
  OverlayRenderResult,
} from '../../pipeline/ffmpeg-overlays';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type PreviewErrorCode = 'E_SOURCE' | 'E_RENDER' | 'E_TIMEOUT' | 'E_PROBE';

/**
 * A preview failure with a code the desktop can branch on and a sentence it
 * may show. `context` carries the machine-readable detail (clip id, tried
 * paths) so the UI never has to parse the message.
 */
export class PreviewError extends Error {
  readonly code: PreviewErrorCode;
  readonly context: PreviewErrorContext;

  constructor(
    code: PreviewErrorCode,
    message: string,
    context: PreviewErrorContext = {},
  ) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = 'PreviewError';
    this.code = code;
    this.context = context;
  }
}

export interface PreviewErrorContext {
  /** The clip whose source could not be resolved (`E_SOURCE`). */
  clipId?: string;
  /** Every path the resolver tried, in order (`E_SOURCE`). */
  tried?: string[];
  cause?: unknown;
}

export interface PreviewInput {
  /** The edited document. Sources may be absolute or listing-relative. */
  edl: Edl;
  /** Root of the listing footage; relative `clip.src` values resolve under it. */
  listingDir?: string;
  /** MP4 path to write. Its directory is created and is the only write root. */
  output: string;
  /**
   * Upper bound in pixels for the preview's **draft** width. Draft encodes are
   * half the profile canvas, so this selects a profile from the ladder; it
   * never stretches pixels. When the cap is below the smallest draft rung the
   * requested profile is kept and a warning says so. Omit for the EDL's own
   * profile.
   */
  width?: number;
  /** Wall-clock ceiling for both passes together. Default 180 s. */
  timeoutMs?: number;
  /** Confirmed listing facts, used for the text pass. Never invented here. */
  facts?: { address?: string; price?: string; beds?: number; baths?: number };
  brand?: { agentName?: string; agency?: string; orn?: string };
  /** Directory holding Archivo.ttf (and friends). Default: repo dev path. */
  fontsDir?: string;
}

export interface PreviewResult {
  /** Absolute path of the finished draft. */
  path: string;
  /** Probed duration of the file, seconds. */
  durationSec: number;
  width: number;
  height: number;
  /** True only when the text pass ran and drew at least one layer. */
  renderedOverlays: boolean;
  warnings: string[];
}

export interface PreviewDeps {
  /** Test seams; production uses the pipeline renderer. */
  renderEdl?: typeof renderEdl;
  renderOverlays?: (options: OverlayRenderOptions) => Promise<OverlayRenderResult>;
  probe?: (file: string) => Promise<ProbeResult>;
  now?: () => number;
}

/** A preview that outlives this budget is not a preview any more. */
export const DEFAULT_PREVIEW_TIMEOUT_MS = 180_000;

/** The draft rung: half the profile canvas, even on both axes. */
const PREVIEW_QUALITY: Quality = 'draft';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function isFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function isProfileId(value: string): value is ProfileId {
  return Object.prototype.hasOwnProperty.call(PROFILES, value);
}

/** The canvas a draft encode really produces. */
export function draftCanvas(profile: ProfileId): { width: number; height: number } {
  const draft: RenderProfile = renderProfileFor(PROFILES[profile], PREVIEW_QUALITY);
  return { width: draft.width, height: draft.height };
}

/**
 * Picks the profile the preview encodes.
 *
 * The draft ladder is half-size, and `renderEdl` only accepts a profile id, so
 * a width cap can be honoured by choosing a narrower profile — never by
 * re-sampling the graph (which would either stretch or silently crop).
 *
 * Rules, in order:
 *   1. No `width` (or a non-positive one): the EDL's profile, or
 *      `vertical-social` when the canvas names something unknown.
 *   2. `width` at or above the requested profile's draft width: keep it. The
 *      draft cannot be larger than half the canvas, and upscaling a preview is
 *      not useful.
 *   3. Otherwise prefer a profile with the **same orientation and aspect**
 *      whose draft width fits (within 1 %). Framing stays identical.
 *   4. Failing that, a profile with the same orientation whose draft width
 *      fits; the change is reported because the framing changes with it.
 *   5. Failing that, keep the requested profile and say the cap is below the
 *      smallest draft rung. Nothing is stretched to pretend otherwise.
 */
export function selectPreviewProfile(
  profile: string,
  width?: number,
): { profile: ProfileId; warnings: string[] } {
  const warnings: string[] = [];
  const requested: ProfileId = isProfileId(profile) ? profile : 'vertical-social';
  if (!isProfileId(profile)) {
    warnings.push(
      `Unknown canvas profile "${profile}"; the preview uses ${requested}.`,
    );
  }

  if (width === undefined || !Number.isFinite(width) || width <= 0) {
    return { profile: requested, warnings };
  }

  const requestedDims = draftCanvas(requested);
  if (width > requestedDims.width) {
    warnings.push(
      `Preview width ${String(Math.round(width))} px is at or above the ${requested} draft rung; ` +
        `rendering at ${String(requestedDims.width)}x${String(requestedDims.height)} (draft is half the profile canvas).`,
    );
    return { profile: requested, warnings };
  }

  const portrait = requestedDims.height > requestedDims.width;
  const requestedAspect = requestedDims.width / requestedDims.height;

  const candidates = (Object.keys(PROFILES) as ProfileId[])
    .map((id) => ({ id, ...draftCanvas(id) }))
    .filter(
      (candidate) =>
        (portrait ? candidate.height > candidate.width : candidate.width > candidate.height) &&
        candidate.width <= width,
    );

  if (candidates.length === 0) {
    warnings.push(
      `No preview profile is ${String(Math.round(width))} px wide or less; keeping ${requested} at ` +
        `${String(requestedDims.width)}x${String(requestedDims.height)}. The preview never stretches pixels to reach a width.`,
    );
    return { profile: requested, warnings };
  }

  const sameAspect = candidates.filter(
    (candidate) => Math.abs(candidate.width / candidate.height - requestedAspect) < 0.01,
  );
  const pool = (sameAspect.length > 0 ? sameAspect : candidates)
    .slice()
    .sort((left, right) => right.width - left.width);

  const chosen = pool[0];
  if (chosen === undefined) {
    return { profile: requested, warnings };
  }

  if (chosen.id !== requested) {
    warnings.push(
      `Preview width ${String(Math.round(width))} px cannot be met by ${requested}; using ${chosen.id} at ` +
        `${String(chosen.width)}x${String(chosen.height)}. Framing follows the chosen canvas (cover/contain per the EDL); pixels are never stretched.`,
    );
  }

  return { profile: chosen.id, warnings };
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

interface ResolvedSource {
  src: string;
  tried: string[];
}

function sourceCandidates(src: string, listingDir: string | undefined): string[] {
  const candidates: string[] = [];
  // 1. An absolute path that exists. `isAbsolute` keeps a Windows `D:\…`
  //    value from being treated as listing-relative.
  if (isAbsolute(src)) candidates.push(src);
  // 2./3. Listing-relative, flat and in the conventional `raw/` subfolder.
  if (listingDir !== undefined) {
    candidates.push(join(listingDir, src));
    candidates.push(join(listingDir, 'raw', src));
  }
  return uniqueStrings(candidates);
}

async function resolveSource(
  clipId: string,
  src: string,
  listingDir: string | undefined,
): Promise<ResolvedSource> {
  const tried: string[] = [];
  for (const candidate of sourceCandidates(src, listingDir)) {
    tried.push(candidate);
    if (await isFile(candidate)) return { src: candidate, tried };
  }

  const where = tried.length === 0 ? 'there is no listing directory and the path is not absolute' : tried.join(' | ');
  throw new PreviewError(
    'E_SOURCE',
    `Preview cannot find the footage for clip "${clipId}" (src "${src}"). Tried: ${where}.`,
    { clipId, tried },
  );
}

/**
 * Resolves every clip once (a source reused by two clips is one lookup) and
 * returns a cloned EDL whose `src` values are absolute paths.
 */
async function withResolvedSources(
  edl: Edl,
  listingDir: string | undefined,
): Promise<Edl> {
  const uniqueSources = uniqueStrings(edl.clips.map((clip) => clip.src));
  const resolved = new Map<string, string>();

  await Promise.all(
    uniqueSources.map(async (src) => {
      // The clip id in the error is the first clip that names this source.
      const owner = edl.clips.find((clip) => clip.src === src);
      const result = await resolveSource(owner?.id ?? 'unknown', src, listingDir);
      resolved.set(src, result.src);
    }),
  );

  return {
    ...edl,
    clips: edl.clips.map((clip) => {
      const next = resolved.get(clip.src);
      return next === undefined ? clip : { ...clip, src: next };
    }),
  };
}

/**
 * The music bed is advisory: a preview may be silent, and a missing track is a
 * warning, never a failed preview. Found tracks play; nothing is downloaded.
 */
async function resolveMusic(
  edl: Edl,
  listingDir: string | undefined,
  warnings: string[],
): Promise<Edl> {
  const src = edl.audio.music.src.trim();
  if (src.length === 0) return edl;

  for (const candidate of sourceCandidates(src, listingDir)) {
    if (await isFile(candidate)) {
      if (candidate === src) return edl;
      return { ...edl, audio: { ...edl.audio, music: { ...edl.audio.music, src: candidate } } };
    }
  }

  warnings.push(
    `The music bed "${src}" was not found; this preview is silent. The edit itself is unchanged.`,
  );
  return { ...edl, audio: { ...edl.audio, music: { ...edl.audio.music, src: '' } } };
}

// ---------------------------------------------------------------------------
// Text pass
// ---------------------------------------------------------------------------

/** The font that ships with the app and that `drawtext` always names. */
const PREVIEW_FONT = 'Archivo.ttf';

/**
 * Dev default: the repo root's bundled fonts. `process.cwd()` is the repository
 * when the tests, the CLI harnesses and `electron .` run, and it keeps this
 * module free of `import.meta` (the electron main bundle is CommonJS, where
 * `import.meta` is empty). A packaged app must pass `fontsDir` —
 * `resolveFontsDirectory(appRoot)` from the overlay path — because its cwd is
 * not the app root; the `E_RENDER` below says exactly that when it is missed.
 */
function defaultFontsDir(): string {
  return join(process.cwd(), 'apps', 'desktop', 'electron', 'assets', 'fonts');
}

function overlayFacts(facts: PreviewInput['facts']): OverlayFacts | undefined {
  if (facts === undefined) return undefined;
  return {
    address: facts.address ?? '',
    ...(facts.price === undefined ? {} : { price: facts.price }),
    ...(facts.beds === undefined ? {} : { beds: facts.beds }),
    ...(facts.baths === undefined ? {} : { baths: facts.baths }),
  };
}

function overlayBrand(brand: PreviewInput['brand']): OverlayBrand | undefined {
  if (brand === undefined) return undefined;
  return {
    ...(brand.agentName === undefined ? {} : { agentName: brand.agentName }),
    ...(brand.agency === undefined ? {} : { agency: brand.agency }),
    ...(brand.orn === undefined ? {} : { orn: brand.orn }),
  };
}

/** Captions are burned only when the document itself asks for burned text. */
function shouldBurnCaptions(edl: Edl, warnings: string[]): boolean {
  const words = edl.captions.words ?? [];
  if (words.length === 0) return false;
  const mode = edl.captions.mode;
  if (mode === 'burn' || mode === 'both') return true;
  warnings.push(
    `Caption words are present but mode is "${mode}", so this preview does not burn them. ` +
      'The sidecar is still the export contract.',
  );
  return false;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function isTimeout(error: unknown): boolean {
  // `runFfmpeg` reports its own deadline as -2 in both passes; the overlay
  // pass also words it as "timed out" in stderr.
  if (error instanceof RenderError) {
    return error.exitCode === -2 || /was stopped after/i.test(error.message);
  }
  const message = messageOf(error);
  return /timed out|was stopped after/i.test(message);
}

function renderFailure(error: unknown, timeoutMs: number, stage: string): PreviewError {
  if (error instanceof PreviewError) return error;
  if (isTimeout(error)) {
    return new PreviewError(
      'E_TIMEOUT',
      `The draft preview ${stage} did not finish within ${String(Math.round(timeoutMs / 1000))} s.`,
      { cause: error },
    );
  }
  return new PreviewError(
    'E_RENDER',
    `The draft preview ${stage} failed: ${messageOf(error)}`,
    { cause: error },
  );
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Renders a draft preview of `input.edl` to `input.output`.
 *
 * Order of operations:
 *   1. clone, resolve clip sources (throw `E_SOURCE`), resolve the music bed;
 *   2. pick the profile from the canvas, narrowed by `input.width`;
 *   3. one draft picture pass into a scratch directory inside the output dir;
 *   4. if the document has overlays or burnable caption words, one text pass
 *      onto that picture, using the probed picture duration as the timeline;
 *   5. otherwise move the picture into place, then probe the finished file.
 *
 * Throws `PreviewError` with `E_SOURCE`, `E_RENDER`, `E_TIMEOUT` or `E_PROBE`.
 */
export async function renderPreview(
  input: PreviewInput,
  deps: PreviewDeps = {},
): Promise<PreviewResult> {
  const now = deps.now ?? Date.now;
  const probe = deps.probe ?? probeFile;
  const runEdl = deps.renderEdl ?? renderEdl;
  const runOverlays = deps.renderOverlays ?? renderFfmpegOverlays;

  if (typeof input.output !== 'string' || input.output.trim().length === 0) {
    throw new PreviewError('E_RENDER', 'A preview needs an output path.');
  }

  const timeoutMs =
    input.timeoutMs === undefined || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0
      ? DEFAULT_PREVIEW_TIMEOUT_MS
      : input.timeoutMs;
  const deadline = now() + timeoutMs;
  const remaining = (): number => Math.max(0, deadline - now());

  const outputPath = resolve(input.output);
  const outputDir = dirname(outputPath);

  const warnings: string[] = [];
  const selection = selectPreviewProfile(input.edl.canvas.profile, input.width);
  warnings.push(...selection.warnings);
  const profile = selection.profile;

  // `structuredClone` keeps the caller's document untouched; resolution then
  // overwrites only `clip.src`, `music.src` and nothing else.
  let edl = await withResolvedSources(structuredClone(input.edl), input.listingDir);
  edl = await resolveMusic(edl, input.listingDir, warnings);

  const burnCaptions = shouldBurnCaptions(edl, warnings);

  const facts = overlayFacts(input.facts);
  const brand = overlayBrand(input.brand);
  const fontsDir = input.fontsDir ?? defaultFontsDir();

  // The same planner the export uses decides whether there is anything to
  // paint. An overlay that is only, say, a logo yields no text layers, and the
  // preview then skips the second encode entirely instead of paying for a
  // `-vf null` pass.
  const intentCues = burnCaptions ? captionCuesForExport(edl) : [];
  const hasTextIntent = edl.overlays.length > 0 || intentCues.length > 0;
  const plannedTexts = hasTextIntent
    ? planDrawTexts({
        edl,
        profile,
        cues: intentCues,
        ...(facts === undefined ? {} : { facts }),
        ...(brand === undefined ? {} : { brand }),
      })
    : [];
  const needsTextPass = intentCues.length > 0 || plannedTexts.length > 0;
  if (hasTextIntent && !needsTextPass) {
    warnings.push('The document has overlays but no drawable text for this preview; picture only.');
  }

  if (needsTextPass && !(await isFile(join(fontsDir, PREVIEW_FONT)))) {
    throw new PreviewError(
      'E_RENDER',
      `The preview text pass needs ${PREVIEW_FONT} in "${fontsDir}", which is missing. ` +
        'Pass fontsDir (electron: resolveFontsDirectory(appRoot)); a packaged build cannot read fonts from app.asar.',
    );
  }

  // Design contradictions (a mirrored transitionOut, an over-long overlap) are
  // warnings, exactly as the export reports them. A pure graph build, no I/O.
  try {
    warnings.push(...buildGraphWithDiagnostics(edl, PROFILES[profile]).warnings);
  } catch {
    // The render below will produce the actionable failure; diagnostics are
    // best-effort by definition.
  }

  let workDir: string;
  try {
    await mkdir(outputDir, { recursive: true });
    workDir = await mkdtemp(join(outputDir, '.zeniconic-preview-'));
  } catch (error) {
    throw new PreviewError(
      'E_RENDER',
      `The preview could not create its output directory "${outputDir}": ${messageOf(error)}`,
      { cause: error },
    );
  }
  const picture = join(workDir, 'picture.mp4');

  let wroteOutput = false;
  let renderedOverlays = false;

  try {
    if (remaining() <= 0) {
      throw new PreviewError('E_TIMEOUT', 'The draft preview ran out of time before encoding started.');
    }

    try {
      await runEdl(edl, profile, PREVIEW_QUALITY, picture, { timeoutMs: remaining() });
    } catch (error) {
      throw renderFailure(error, timeoutMs, 'picture pass');
    }

    if (needsTextPass) {
      // Pin the text timeline to the picture that actually exists: `-t` in the
      // overlay pass comes from `format.targetDurationSec`, and a stale target
      // would truncate (or pad) the preview.
      let pictureInfo: ProbeResult;
      try {
        pictureInfo = await probe(picture);
      } catch (error) {
        throw new PreviewError(
          'E_PROBE',
          `The draft picture was written but could not be probed: ${messageOf(error)}`,
          { cause: error },
        );
      }

      const textEdl: Edl = {
        ...edl,
        format: { ...edl.format, targetDurationSec: pictureInfo.durationSec },
      };

      // Windows come from the same planner the export uses, so the preview
      // cannot invent a card the export would not draw.
      const textOutput = join(workDir, 'text.mp4');

      if (remaining() <= 0) {
        throw new PreviewError('E_TIMEOUT', 'The draft preview ran out of time before the text pass.');
      }

      let overlayResult: OverlayRenderResult;
      try {
        overlayResult = await runOverlays({
          edl: textEdl,
          profile,
          quality: PREVIEW_QUALITY,
          picture,
          output: textOutput,
          workDir,
          burnCaptions,
          ...(facts === undefined ? {} : { facts }),
          ...(brand === undefined ? {} : { brand }),
          fontsDir,
          timeoutMs: remaining(),
        });
      } catch (error) {
        throw renderFailure(error, timeoutMs, 'text pass');
      }

      // Publish only a finished file: the output path never holds a partial
      // encode, and a failed preview leaves an earlier draft in place.
      await rename(textOutput, outputPath);
      wroteOutput = true;
      renderedOverlays = overlayResult.cueCount > 0 || overlayResult.textLayers.length > 0;
      if (!renderedOverlays) {
        warnings.push('The text pass produced no visible layers; the preview is picture only.');
      }
    } else {
      // No text to draw: the silent picture is the preview. A rename inside the
      // same directory tree keeps the old output intact until the new one is
      // complete.
      await rename(picture, outputPath);
      wroteOutput = true;
    }

    let info: ProbeResult;
    try {
      info = await probe(outputPath);
    } catch (error) {
      if (wroteOutput) {
        wroteOutput = false;
        await unlink(outputPath).catch(() => undefined);
      }
      throw new PreviewError(
        'E_PROBE',
        `The preview was written to "${outputPath}" but ffprobe could not read it: ${messageOf(error)}`,
        { cause: error },
      );
    }

    return {
      path: outputPath,
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
      renderedOverlays,
      warnings,
    };
  } catch (error) {
    // The scratch directory holds the only intermediate we ever create. The
    // output is left untouched unless this call wrote it.
    if (wroteOutput) {
      await unlink(outputPath).catch(() => undefined);
    }
    throw error instanceof PreviewError
      ? error
      : new PreviewError('E_RENDER', `The draft preview failed: ${messageOf(error)}`, {
          cause: error,
        });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
