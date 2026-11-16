import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KOKORO_REPO,
  KokoroModelDownloader,
  modelPath,
  voiceModelStatus,
} from '../src/model';
import type { ModelFile } from '../src/model';

const roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zeniconic-model-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

const SMALL = Buffer.from('{"model_type":"style_text_to_speech_2"}', 'utf8');
const BIG = Buffer.from('onnx-bytes-'.repeat(4096), 'utf8');

const FILES: readonly ModelFile[] = [
  { path: 'config.json', bytes: SMALL.length, sha256: digest(SMALL) },
  { path: 'onnx/model_quantized.onnx', bytes: BIG.length, sha256: digest(BIG) },
];

interface Call {
  path: string;
  range: string | undefined;
}

interface FakeOptions {
  /** Return 'drop' to error after this many bytes, 'fail' to reject the call. */
  behaviour?: (path: string, range: string | undefined) => 'ok' | 'fail' | number;
  hang?: boolean;
}

function fakeFetch(bodies: Record<string, Buffer>, options: FakeOptions = {}) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const path = url.split('/resolve/main/')[1] ?? url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const range = headers.Range;
    calls.push({ path, range });
    const behaviour = options.behaviour?.(path, range) ?? 'ok';
    if (behaviour === 'fail') throw new Error('network down');

    const body = bodies[path];
    if (body === undefined) return new Response('missing', { status: 404, statusText: 'Not Found' });

    const start = range === undefined ? 0 : Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
    const slice = body.subarray(start);
    const status = start > 0 ? 206 : 200;
    const responseHeaders = {
      'content-length': String(slice.length),
      etag: '"v1"',
    };

    if (typeof behaviour === 'number' || options.hang === true) {
      // Deterministic by pull, not by wall clock: a timer can beat the first
      // chunk under load and turn a "resume" test into a "start over" test.
      let delivered = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (options.hang === true) {
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
            return;
          }
          if (!delivered) {
            delivered = true;
            const cut = Math.min(typeof behaviour === 'number' ? behaviour : slice.length, slice.length);
            controller.enqueue(new Uint8Array(slice.subarray(0, cut)));
            return;
          }
          controller.error(new Error('connection lost'));
        },
      });
      return new Response(stream, { status, headers: responseHeaders });
    }

    return new Response(new Uint8Array(slice), { status, headers: responseHeaders });
  }) as typeof fetch;

  return { impl, calls };
}

const BODIES = {
  'config.json': SMALL,
  'onnx/model_quantized.onnx': BIG,
};

describe('KokoroModelDownloader', () => {
  it('downloads every file, verifies it and marks the model ready', async () => {
    const dir = root();
    const { impl, calls } = fakeFetch(BODIES);
    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });

    const status = await downloader.start();

    expect(status.phase).toBe('ready');
    expect(status.installed).toBe(true);
    expect(status.bytes).toBe(status.totalBytes);
    expect(calls.map((call) => call.path)).toEqual(['config.json', 'onnx/model_quantized.onnx']);
    expect(existsSync(modelPath(dir, FILES[1]!))).toBe(true);
    expect(readFileSync(modelPath(dir, FILES[1]!)).length).toBe(BIG.length);
    expect(existsSync(join(dir, KOKORO_REPO, 'onnx', 'model_quantized.onnx.part'))).toBe(false);

    // A second start is a no-op: nothing is fetched.
    const before = calls.length;
    await downloader.start();
    expect(calls.length).toBe(before);
  });

  it('resumes a dropped download with a Range request from the bytes on disk', async () => {
    const dir = root();
    let drop = true;
    const failing = fakeFetch(BODIES, {
      behaviour: (path) => (drop && path.endsWith('.onnx') ? 5000 : 'ok'),
    });

    const first = new KokoroModelDownloader({
      root: dir,
      fetchImpl: failing.impl,
      files: FILES,
      retryDelayMs: 0,
    });
    const firstStatus = await first.start();
    expect(firstStatus.phase).toBe('error');
    expect(firstStatus.installed).toBe(false);

    const part = `${modelPath(dir, FILES[1]!)}.part`;
    expect(existsSync(part)).toBe(true);
    const partialBytes = readFileSync(part).length;
    expect(partialBytes).toBeGreaterThan(0);

    drop = false;
    const second = new KokoroModelDownloader({
      root: dir,
      fetchImpl: failing.impl,
      files: FILES,
      retryDelayMs: 0,
    });
    const final = await second.start();

    expect(final.phase).toBe('ready');
    const resumed = failing.calls.filter((call) => call.path.endsWith('.onnx') && call.range !== undefined);
    expect(resumed.length).toBeGreaterThan(0);
    expect(resumed.some((call) => call.range === `bytes=${partialBytes}-`)).toBe(true);
  });

  it('deletes a file whose checksum does not match and keeps no final copy', async () => {
    const dir = root();
    const tamperedModel = Buffer.from(BIG);
    tamperedModel[0] = tamperedModel[0]! ^ 0xff;
    const tampered = { ...BODIES, 'onnx/model_quantized.onnx': tamperedModel };
    const { impl } = fakeFetch(tampered);
    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });

    const status = await downloader.start();

    expect(status.phase).toBe('error');
    expect(status.error).toMatch(/checksum|did not match/i);
    expect(existsSync(modelPath(dir, FILES[1]!))).toBe(false);
    expect((await voiceModelStatus(dir, {}, FILES)).installed).toBe(false);
  });

  it('pauses without deleting the partial file', async () => {
    const dir = root();
    const { impl } = fakeFetch(BODIES, { hang: true });
    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });

    const running = downloader.start();
    // Let the request open and the part file be created.
    await new Promise((resolve) => setTimeout(resolve, 60));
    downloader.cancel();
    const status = await running;

    expect(status.phase).toBe('missing');
    expect(status.error).toBeUndefined();
    expect(status.installed).toBe(false);
  });

  it('demotes a ready model when a file disappears', async () => {
    const dir = root();
    const { impl } = fakeFetch(BODIES);
    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });
    await downloader.start();

    rmSync(modelPath(dir, FILES[0]!), { force: true });
    const status = await voiceModelStatus(dir, {}, FILES);
    expect(status.installed).toBe(false);
    expect(status.phase).toBe('missing');
  });

  it('reports upstream size changes instead of writing a wrong file', async () => {
    const dir = root();
    const { impl } = fakeFetch({ ...BODIES, 'config.json': Buffer.from('a different config body') });
    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });

    const status = await downloader.start();
    expect(status.phase).toBe('error');
    expect(existsSync(modelPath(dir, FILES[0]!))).toBe(false);
  });

  it('discards a partial that is longer than the published file instead of hashing it', async () => {
    const dir = root();
    const target = modelPath(dir, FILES[1]!);
    mkdirSync(dirname(target), { recursive: true });
    // A stale part from an older, larger revision: the server answers 416.
    writeFileSync(`${target}.part`, Buffer.alloc(BIG.length + 128, 1));
    writeFileSync(
      `${target}.part.json`,
      JSON.stringify({ url: 'x', etag: '"old"', bytes: BIG.length + 128, updatedAt: '' }),
    );

    let ranges: Array<string | undefined> = [];
    const impl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.split('/resolve/main/')[1] ?? url;
      const range = ((init?.headers ?? {}) as Record<string, string>).Range;
      ranges.push(range);
      const body = BODIES[path as keyof typeof BODIES];
      if (body === undefined) return new Response('missing', { status: 404 });

      const start = range === undefined ? 0 : Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      if (start >= body.length) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${String(body.length)}` },
        });
      }
      return new Response(new Uint8Array(body.subarray(start)), {
        status: start > 0 ? 206 : 200,
        headers: {
          'content-length': String(body.length - start),
          etag: '"v1"',
          ...(start > 0 ? { 'content-range': `bytes ${String(start)}-${String(body.length - 1)}/${String(body.length)}` } : {}),
        },
      });
    }) as typeof fetch;

    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });
    const status = await downloader.start();

    expect(status.phase).toBe('ready');
    expect(readFileSync(target)).toEqual(BIG);
    expect(ranges.some((range) => range === `bytes=${String(BIG.length + 128)}-`)).toBe(true);
    expect(ranges.includes(undefined)).toBe(true);
  });

  it('does not crash when the partial file cannot be written', async () => {
    const dir = root();
    const target = modelPath(dir, FILES[1]!);
    mkdirSync(dirname(target), { recursive: true });
    // Something unusable occupies the part path: opening it for writing fails.
    mkdirSync(`${target}.part`);

    const { impl } = fakeFetch(BODIES);
    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });
    const status = await downloader.start();

    expect(status.phase).toBe('error');
    expect(status.error).toBeTruthy();
    expect(status.installed).toBe(false);
  });

  it('restarts clean when the server ignores the range and replays from byte zero', async () => {
    const dir = root();
    const target = modelPath(dir, FILES[1]!);
    mkdirSync(dirname(target), { recursive: true });
    // Half of the correct bytes, as if a previous attempt was interrupted.
    writeFileSync(`${target}.part`, BIG.subarray(0, 5000));

    let onnxCalls = 0;
    const impl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.split('/resolve/main/')[1] ?? url;
      const body = BODIES[path as keyof typeof BODIES];
      if (body === undefined) return new Response('missing', { status: 404 });
      const range = ((init?.headers ?? {}) as Record<string, string>).Range;
      const asked = range === undefined ? 0 : Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      if (path.endsWith('.onnx')) onnxCalls += 1;

      // A broken CDN: claims 206 but always sends the whole file from zero.
      return new Response(new Uint8Array(body), {
        status: 206,
        headers: {
          'content-length': String(body.length),
          etag: '"v1"',
          'content-range': `bytes 0-${String(body.length - 1)}/${String(body.length)}`,
        },
      });
    }) as typeof fetch;

    const downloader = new KokoroModelDownloader({ root: dir, fetchImpl: impl, files: FILES, retryDelayMs: 0 });
    const status = await downloader.start();

    expect(status.phase).toBe('ready');
    expect(readFileSync(target)).toEqual(BIG);
    // One request per file: the wrong offset was discarded, not appended to.
    expect(onnxCalls).toBe(1);
  });

  it('counts bytes against the file set it was given', async () => {
    const dir = root();
    const target = modelPath(dir, FILES[1]!);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.part`, BIG.subarray(0, 1000));

    const status = await voiceModelStatus(dir, {}, FILES);
    expect(status.installed).toBe(false);
    expect(status.bytes).toBe(1000);
    expect(status.totalBytes).toBe(SMALL.length + BIG.length);
  });
});
