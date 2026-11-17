import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previewNameFromUrl, previewResponse } from '../apps/desktop/media-protocol';

const BYTES = new Uint8Array(Array.from({ length: 1024 }, (_, index) => index % 251));

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zeniconic-media-'));
  await writeFile(join(dir, 'calm-v2-abc.mp4'), BYTES);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('previewNameFromUrl', () => {
  it('accepts only the preview host and a bare MP4 name', () => {
    expect(previewNameFromUrl('zeniconic-media://preview/calm-v2-abc.mp4')).toBe('calm-v2-abc.mp4');
    expect(previewNameFromUrl('zeniconic-media://preview/calm%20v2.mp4')).toBeUndefined();
    expect(previewNameFromUrl('zeniconic-media://other/calm-v2-abc.mp4')).toBeUndefined();
    expect(previewNameFromUrl('https://preview/calm-v2-abc.mp4')).toBeUndefined();
    expect(previewNameFromUrl('zeniconic-media://preview/../secret.mp4')).toBeUndefined();
    expect(previewNameFromUrl('zeniconic-media://preview/not-a-video.txt')).toBeUndefined();
    expect(previewNameFromUrl('not a url')).toBeUndefined();
  });
});

describe('previewResponse', () => {
  it('serves the whole file with byte metadata', async () => {
    const response = await previewResponse(
      dir,
      'zeniconic-media://preview/calm-v2-abc.mp4',
      null,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('1024');
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(1024);
    expect(body[10]).toBe(BYTES[10]);
  });

  it('answers a byte range with 206 so <video> can seek', async () => {
    const response = await previewResponse(
      dir,
      'zeniconic-media://preview/calm-v2-abc.mp4',
      'bytes=100-199',
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-length')).toBe('100');
    expect(response.headers.get('content-range')).toBe('bytes 100-199/1024');
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body[0]).toBe(BYTES[100]);
    expect(body[99]).toBe(BYTES[199]);
  });

  it('rejects an unsatisfiable range', async () => {
    const response = await previewResponse(
      dir,
      'zeniconic-media://preview/calm-v2-abc.mp4',
      'bytes=5000-6000',
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */1024');
  });

  it('returns 404 for a missing, foreign or traversal path', async () => {
    for (const url of [
      'zeniconic-media://preview/missing.mp4',
      'zeniconic-media://other/calm-v2-abc.mp4',
      'zeniconic-media://preview/..%2Fcalm-v2-abc.mp4',
    ]) {
      const response = await previewResponse(dir, url, null);
      expect(response.status).toBe(404);
    }
  });
});
