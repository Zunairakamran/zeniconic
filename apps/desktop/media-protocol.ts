/**
 * Draft-preview responses for the `zeniconic-media://preview/<name>.mp4` scheme.
 *
 * Kept out of `main.ts` so the routing, containment check and range arithmetic
 * can be tested without Electron. Only files in the app's previews folder are
 * ever readable, and only by bare file name.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { resolve, sep } from 'node:path';

const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/i;

const notFound = (): Response => new Response('Not found', { status: 404 });

/** Bare preview file name from a scheme URL, or undefined when unsafe. */
export function previewNameFromUrl(value: string): string | undefined {
  // Reject traversal before `new URL` normalises it away.
  if (/(^|[/\\])\.\.([/\\]|$)/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'zeniconic-media:' || url.hostname !== 'preview') return undefined;
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return undefined;
  }
  return FILE_PATTERN.test(name) ? name : undefined;
}

/**
 * Answers one preview request. Supports byte ranges because a <video> seeks by
 * asking for them; every other shape is a 404, including traversal attempts.
 */
export async function previewResponse(
  previewsDir: string,
  requestUrl: string,
  range: string | null,
): Promise<Response> {
  try {
    const name = previewNameFromUrl(requestUrl);
    if (name === undefined) return notFound();

    const folder = resolve(previewsDir);
    const file = resolve(folder, name);
    if (!file.startsWith(`${folder}${sep}`)) return notFound();

    const info = await stat(file);
    if (!info.isFile()) return notFound();

    const total = info.size;
    const headers: Record<string, string> = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };

    if (range !== null) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (match === null) return new Response('Bad range', { status: 416 });
      const start = match[1] === '' ? 0 : Number(match[1]);
      const end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        return new Response('Bad range', {
          status: 416,
          headers: { 'Content-Range': `bytes */${String(total)}` },
        });
      }
      const stream = createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${String(start)}-${String(end)}/${String(total)}`,
        },
      });
    }

    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(total) },
    });
  } catch {
    return notFound();
  }
}
