/**
 * Kokoro model download, resumable.
 *
 * The packaged app cannot ship the weights (92 MB, Apache-2.0 but not ours to
 * redistribute inside the installer). Settings offers one explicit download
 * instead, and this module makes it survivable: every file has a pinned size
 * and SHA-256, bytes land in a `.part` file, and a dropped connection or a
 * closed app resumes from the byte count already on disk with an HTTP Range
 * request.
 *
 * The finished files are written in the layout `@huggingface/transformers`
 * expects for its filesystem cache (`<cacheDir>/<repo>/<file>`), so the engine
 * finds them without a network call and without a second copy on disk.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const KOKORO_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const REVISION = 'main';
const REMOTE_ROOT = `https://huggingface.co/${KOKORO_REPO}/resolve/${REVISION}`;

export interface ModelFile {
  /** Path inside the repo, also the path inside the cache directory. */
  path: string;
  bytes: number;
  sha256: string;
}

/**
 * The four files `Kokoro.from_pretrained(..., { dtype: 'q8' })` reads. Values
 * are pinned from the published revision: a changed upstream file fails the
 * hash check instead of silently loading something else.
 */
export const KOKORO_FILES: readonly ModelFile[] = Object.freeze([
  Object.freeze({
    path: 'config.json',
    bytes: 44,
    sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
  }),
  Object.freeze({
    path: 'tokenizer.json',
    bytes: 3497,
    sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34',
  }),
  Object.freeze({
    path: 'tokenizer_config.json',
    bytes: 113,
    sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
  }),
  Object.freeze({
    path: 'onnx/model_quantized.onnx',
    bytes: 92_361_116,
    sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
  }),
]);

export const KOKORO_TOTAL_BYTES = KOKORO_FILES.reduce((sum, file) => sum + file.bytes, 0);

export type VoiceModelPhase = 'missing' | 'downloading' | 'verifying' | 'ready' | 'error';

export interface VoiceModelStatus {
  phase: VoiceModelPhase;
  /** True only when every file has passed its hash check. */
  installed: boolean;
  /** Bytes present on disk for the model right now. */
  bytes: number;
  totalBytes: number;
  /** Repo-relative path currently being fetched, while downloading. */
  file?: string;
  /** Plain-language failure; the partial file is kept unless it failed hashing. */
  error?: string;
  updatedAt: string;
}

export interface DownloadOptions {
  /** Cache root, usually `<data>/models/kokoro`. */
  root: string;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Called whenever the byte count or phase changes. */
  onStatus?: (status: VoiceModelStatus) => void;
  signal?: AbortSignal;
  /** Delay before the single retry of a transient network failure, in ms. */
  retryDelayMs?: number;
}

interface PartMeta {
  url: string;
  etag?: string;
  bytes: number;
  updatedAt: string;
}

const MARKER = '.installed.json';
const FILE_ATTEMPTS = 2;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAbort(error: unknown): boolean {
  // `DOMException` is not an `Error` in Node, and `fetch` rejects with one.
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** The first byte offset a `Content-Range: bytes 100-199/200` header names. */
function contentRangeStart(value: string | null): number | null {
  if (value === null) return null;
  const match = /^bytes\s+(\d+)-/i.exec(value.trim());
  return match === null ? null : Number(match[1]);
}

function describeWriteError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOSPC') return 'The disk is full; free some space and try again.';
  if (code === 'EACCES' || code === 'EPERM') {
    return 'The model folder is not writable; check its permissions.';
  }
  return errorMessage(error);
}

export function modelRoot(dataDir: string): string {
  return resolve(join(dataDir, 'models', 'kokoro'));
}

function fileTarget(root: string, file: ModelFile): string {
  return join(root, ...KOKORO_REPO.split('/'), ...file.path.split('/'));
}

function fileUrl(file: ModelFile): string {
  return `${REMOTE_ROOT}/${file.path}`;
}

async function sizeOf(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => done());
    stream.on('error', fail);
  });
  return hash.digest('hex');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

interface Marker {
  repo: string;
  files: Record<string, string>;
  completedAt: string;
}

/** Bytes currently on disk, counting partial files, capped per file. */
export async function presentBytes(root: string, files: readonly ModelFile[] = KOKORO_FILES): Promise<number> {
  let total = 0;
  for (const file of files) {
    const target = fileTarget(root, file);
    const final = await sizeOf(target);
    if (final >= file.bytes) {
      total += file.bytes;
      continue;
    }
    const part = Math.min(await sizeOf(`${target}.part`), file.bytes);
    total += Math.max(final, part);
  }
  return total;
}

/**
 * Ready means the marker exists and every file is still the size it was when
 * it was verified. Missing files demote the model to `missing`; the hashes are
 * re-checked only when a download finishes, so status stays cheap enough to
 * poll twice a second.
 */
export async function voiceModelStatus(
  root: string,
  extra: { phase?: VoiceModelPhase; file?: string; error?: string } = {},
  files: readonly ModelFile[] = KOKORO_FILES,
): Promise<VoiceModelStatus> {
  const marker = await readJson<Marker>(join(root, MARKER));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const bytes = await presentBytes(root, files);
  let installed = marker?.repo === KOKORO_REPO;
  if (installed && marker !== null) {
    for (const file of files) {
      const size = await sizeOf(fileTarget(root, file));
      if (size !== file.bytes) {
        installed = false;
        break;
      }
    }
  }

  const phase = extra.phase ?? (installed ? 'ready' : 'missing');
  return {
    phase: installed ? (phase === 'downloading' || phase === 'verifying' ? phase : 'ready') : phase,
    installed,
    bytes: installed ? totalBytes : bytes,
    totalBytes,
    ...(extra.file === undefined ? {} : { file: extra.file }),
    ...(extra.error === undefined ? {} : { error: extra.error }),
    updatedAt: new Date().toISOString(),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

/** One HTTP attempt for one file, appending to `part` when it already exists. */
async function fetchOne(input: {
  file: ModelFile;
  target: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  onBytes: (delta: number) => void;
}): Promise<void> {
  const part = `${input.target}.part`;
  const metaPath = `${part}.json`;
  const offset = await sizeOf(part);
  const meta = await readJson<PartMeta>(metaPath);

  const headers: Record<string, string> = {};
  if (offset > 0) {
    headers.Range = `bytes=${offset}-`;
    if (meta?.etag) headers['If-Range'] = meta.etag;
  }

  const response = await input.fetchImpl(fileUrl(input.file), {
    headers,
    signal: input.signal,
    redirect: 'follow',
  });

  if (!response.ok) {
    // 416 means our part is at least as long as the file; the hash decides
    // whether it is the right bytes. A part longer than the published file
    // cannot be salvaged, so drop it and let the retry start clean.
    if (response.status === 416) {
      if (offset > input.file.bytes) {
        await rm(part, { force: true });
        await rm(metaPath, { force: true });
        throw new Error(`The partial ${input.file.path} was longer than the published file and was discarded.`);
      }
      await response.body?.cancel().catch(() => undefined);
      return;
    }
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`The model server answered ${response.status} ${response.statusText}.`);
  }

  const resumed = response.status === 206 && offset > 0;
  let start = resumed ? offset : 0;
  if (resumed) {
    // Trust the bytes the server actually sent, not the ones we asked for.
    const sentFrom = contentRangeStart(response.headers.get('content-range'));
    if (sentFrom !== null && sentFrom !== offset) start = sentFrom;
  }
  if (start === 0 && offset > 0) {
    // The server ignored the range or the file changed: start clean.
    await rm(part, { force: true });
  }
  if (start > input.file.bytes) {
    await rm(part, { force: true });
    await rm(metaPath, { force: true });
    throw new Error(`The server started ${input.file.path} past the end of the published file.`);
  }

  const etag = response.headers.get('etag') ?? undefined;
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  const expected = start > 0 ? contentLength + start : contentLength;
  if (expected > 0 && expected !== input.file.bytes && start === 0) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `The model file is ${expected} bytes, expected ${input.file.bytes}; the published model has changed.`,
    );
  }

  await mkdir(dirname(part), { recursive: true });
  await writeJson(metaPath, {
    url: fileUrl(input.file),
    ...(etag === undefined ? {} : { etag }),
    bytes: start,
    updatedAt: new Date().toISOString(),
  } satisfies PartMeta);

  if (!response.body) throw new Error('The model server sent no body.');

  const reader = response.body.getReader();
  const sink = createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
  /**
   * A failed write (full disk, unplugged drive) is reported twice: on the
   * `write` callback and as an `'error'` event. With no listener the event
   * would crash the main process, so it is captured here and surfaced by the
   * callback instead.
   */
  let sinkFailure: Error | null = null;
  sink.on('error', (error: Error) => {
    sinkFailure ??= error;
  });
  let written = start;
  let lastMeta = Date.now();

  const flushMeta = async (): Promise<void> => {
    await writeJson(metaPath, {
      url: fileUrl(input.file),
      ...(etag === undefined ? {} : { etag }),
      bytes: written,
      updatedAt: new Date().toISOString(),
    } satisfies PartMeta);
  };

  const closeSink = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (sink.destroyed) {
        resolve();
        return;
      }
      sink.once('close', () => resolve());
      sink.end(() => resolve());
    });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      if (sinkFailure !== null) throw sinkFailure;
      await new Promise<void>((resolve, reject) => {
        sink.write(value, (error) => (error ? reject(error) : resolve()));
      });
      written += value.length;
      input.onBytes(value.length);
      if (Date.now() - lastMeta > 2_000) {
        lastMeta = Date.now();
        await flushMeta();
      }
    }
  } catch (error) {
    // Stop the transfer instead of leaving the socket and the response body
    // open for the rest of the app's life.
    await reader.cancel().catch(() => undefined);
    throw sinkFailure ?? error;
  } finally {
    await closeSink();
  }

  if (written !== input.file.bytes) {
    await flushMeta();
    throw new Error(
      `The download stopped at ${written.toLocaleString('en-GB')} of ${input.file.bytes.toLocaleString('en-GB')} bytes.`,
    );
  }

  await flushMeta();
}

/**
 * Downloads every missing file, resuming `.part` files, then verifies each
 * SHA-256 before publishing the final filename. A hash failure deletes that
 * partial so the next attempt starts clean; a network failure keeps it.
 */
export class KokoroModelDownloader {
  private readonly root: string;
  private readonly files: readonly ModelFile[];
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;
  private controller: AbortController | null = null;
  private running: Promise<VoiceModelStatus> | null = null;
  private phase: VoiceModelPhase = 'missing';
  private current: string | undefined;
  private failure: string | undefined;
  private onStatus: ((status: VoiceModelStatus) => void) | undefined;

  constructor(options: {
    root: string;
    fetchImpl?: typeof fetch;
    retryDelayMs?: number;
    /** Test seam for tiny fixtures; production uses KOKORO_FILES. */
    files?: readonly ModelFile[];
  }) {
    this.root = resolve(options.root);
    this.files = options.files ?? KOKORO_FILES;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryDelayMs = options.retryDelayMs ?? 900;
  }

  status(): Promise<VoiceModelStatus> {
    return voiceModelStatus(this.root, {
      phase: this.running === null && this.phase === 'downloading' ? 'missing' : this.phase,
      ...(this.current === undefined ? {} : { file: this.current }),
      ...(this.failure === undefined ? {} : { error: this.failure }),
    }, this.files);
  }

  /** True while an attempt owns the network. */
  get busy(): boolean {
    return this.running !== null;
  }

  async start(onStatus?: (status: VoiceModelStatus) => void): Promise<VoiceModelStatus> {
    if (this.running !== null) return this.running;
    this.onStatus = onStatus;
    this.failure = undefined;
    const controller = new AbortController();
    this.controller = controller;

    const run = async (): Promise<VoiceModelStatus> => {
      this.phase = 'downloading';
      await this.report();
      try {
        for (const file of this.files) {
          this.current = file.path;
          await this.fetchFile(file, controller.signal);
        }

        this.phase = 'verifying';
        this.current = undefined;
        await this.report();
        for (const file of this.files) {
          const target = fileTarget(this.root, file);
          const digest = await sha256Of(target);
          if (digest !== file.sha256) {
            await rm(target, { force: true });
            await rm(`${target}.part`, { force: true });
            await rm(`${target}.part.json`, { force: true });
            throw new Error(
              `The downloaded ${file.path} did not match its checksum and was deleted. Try again; if it repeats, the published model has changed.`,
            );
          }
        }

        await writeJson(join(this.root, MARKER), {
          repo: KOKORO_REPO,
          files: Object.fromEntries(this.files.map((file) => [file.path, file.sha256])),
          completedAt: new Date().toISOString(),
        } satisfies Marker);

        this.phase = 'ready';
        this.current = undefined;
        return await this.report();
      } catch (error) {
        const aborted = isAbort(error) || controller.signal.aborted;
        this.failure = aborted ? undefined : describeWriteError(error);
        // An abort is a pause: the part file is the checkpoint.
        this.phase = aborted ? 'missing' : 'error';
        return await this.report();
      } finally {
        this.controller = null;
        this.running = null;
      }
    };

    this.running = run();
    return this.running;
  }

  /** Aborts the current attempt. The partial file is kept for the next start. */
  cancel(): void {
    this.controller?.abort();
  }

  private async report(): Promise<VoiceModelStatus> {
    const status = await voiceModelStatus(this.root, {
      phase: this.phase,
      ...(this.current === undefined ? {} : { file: this.current }),
      ...(this.failure === undefined ? {} : { error: this.failure }),
    }, this.files);
    this.onStatus?.(status);
    return status;
  }

  private async fetchFile(file: ModelFile, signal: AbortSignal): Promise<void> {
    const target = fileTarget(this.root, file);
    const size = await sizeOf(target);
    if (size === file.bytes) {
      // A complete file without a marker is verified in the verify pass.
      return;
    }
    if (size > 0) await rm(target, { force: true });

    let lastError: unknown;
    for (let attempt = 1; attempt <= FILE_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      try {
        await this.fetchFileOnce(file, target, signal);
        return;
      } catch (error) {
        if (isAbort(error) || signal.aborted) throw error;
        lastError = error;
        if (attempt < FILE_ATTEMPTS) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs));
          await this.report();
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchFileOnce(
    file: ModelFile,
    target: string,
    signal: AbortSignal,
  ): Promise<void> {
    const part = `${target}.part`;
    let lastReport = Date.now();
    await fetchOne({
      file,
      target,
      fetchImpl: this.fetchImpl,
      ...(signal === undefined ? {} : { signal }),
      onBytes: () => {
        if (Date.now() - lastReport < 400) return;
        lastReport = Date.now();
        void this.report();
      },
    });

    const digest = await sha256Of(part);
    if (digest !== file.sha256) {
      await rm(part, { force: true });
      await rm(`${part}.json`, { force: true });
      throw new Error(`The downloaded ${file.path} failed its checksum.`);
    }
    await rename(part, target);
    await rm(`${part}.json`, { force: true });
    await this.report();
  }
}

/** Convenience for tests and callers that only need a status probe. */
export async function modelInstalled(root: string): Promise<boolean> {
  return (await voiceModelStatus(root)).installed;
}

/**
 * True when every pinned file is on disk at its published size. This is the
 * cheap check the engine uses before handing the folder to the loader: sizes
 * only, no hashing, so it never stalls a cold start. The downloader's marker
 * (and its SHA-256 pass) is the stronger guarantee the UI reports.
 */
export async function modelFilesComplete(
  root: string,
  files: readonly ModelFile[] = KOKORO_FILES,
): Promise<boolean> {
  for (const file of files) {
    if ((await sizeOf(fileTarget(root, file))) !== file.bytes) return false;
  }
  return true;
}

export function modelPath(root: string, file: ModelFile): string {
  return fileTarget(root, file);
}

export function hasPartial(root: string): boolean {
  return KOKORO_FILES.some((file) => existsSync(`${fileTarget(root, file)}.part`));
}
