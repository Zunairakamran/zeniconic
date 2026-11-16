/**
 * The refine assistant: a fake model proves the whole path without a network.
 *
 * These live in the IPC suite because that is where the desktop service is
 * exercised end to end (the same place `api.test.ts` covers the renderer).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatError, createChatService } from '../../../apps/desktop/chat';
import type { ChatModelRequest, ChatServiceOptions } from '../../../apps/desktop/chat';
import { readVariantEdl } from '../../../apps/desktop/variants';
import example from '../../../packages/edl/example.edl.json';
import type { Edl } from '../../../packages/edl/src/index';

const EDL = example as unknown as Edl;
const LISTING_ID = '2026-11-15-14-oak-avenue';

let root: string;
let listingDir: string;

function reply(operations: unknown[], text = 'Done. That is the change.'): string {
  return JSON.stringify({ reply: text, operations });
}

function makeService(
  replies: string[],
  overrides: Partial<ChatServiceOptions> = {},
): { chat: ReturnType<typeof createChatService>; calls: ChatModelRequest[] } {
  const calls: ChatModelRequest[] = [];
  const times = [
    '2026-11-16T10:00:00.000Z',
    '2026-11-16T10:01:00.000Z',
    '2026-11-16T10:02:00.000Z',
  ];

  const chat = createChatService({
    listingDir: (id) => join(root, 'listings', id),
    apiKey: () => 'sk-or-v1-test-key-123456',
    model: 'openai/gpt-6-astra',
    now: () => times.shift() ?? '2026-11-16T10:09:00.000Z',
    complete: async (request) => {
      calls.push(request);
      const text = replies.shift();
      if (text === undefined) throw new Error('The fake model ran out of replies.');
      return { text };
    },
    ...overrides,
  });

  return { chat, calls };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'zeniconic-chat-'));
  listingDir = join(root, 'listings', LISTING_ID);
  await mkdir(join(listingDir, 'variants'), { recursive: true });

  await writeFile(
    join(listingDir, 'variants', 'calm.json'),
    `${JSON.stringify(EDL, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(listingDir, 'variants', 'variants.json'),
    `${JSON.stringify(
      {
        version: 1,
        variants: [
          {
            id: 'calm',
            look: 'calm',
            format: EDL.format.id,
            targetDurationSec: EDL.format.targetDurationSec,
            clipCount: EDL.clips.length,
            score: 80,
            edlPath: 'variants/calm.json',
            approved: true,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // One tagged candidate per clip, with a wide window so every existing clip is
  // still inside an indexed shot.
  await writeFile(
    join(listingDir, 'footage_index.tagged.json'),
    `${JSON.stringify({
      version: 2,
      generatedAt: '2026-11-15T09:00:00.000Z',
      clips: EDL.clips.map((clip) => ({
        id: `${clip.sourceId}_${clip.id}`,
        file: clip.src,
        name: basename(clip.src),
        shots: [
          {
            id: `${clip.sourceId}_${clip.id}_sh_001`,
            startSec: 0,
            endSec: 40,
            durationSec: 40,
            tags: { room: clip.room ?? 'unknown', score: 80 },
          },
        ],
      })),
    })}\n`,
    'utf8',
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

describe('chat service', () => {
  it('writes a new version and a diff without making it current', async () => {
    const { chat, calls } = makeService([
      reply([{ op: 'replace', path: '/clips/0/room', value: 'building' }]),
    ]);

    const result = await chat.send({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: 'Call the front shot a building rather than an exterior.',
    });

    expect(result.versionId).toBe('calm-v1');
    expect(result.diff).toContain('building');
    expect(result.warnings).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('openai/gpt-6-astra:nitro');
    expect(calls[0]?.jsonSchema).toBeDefined();
    // The prompt carries the compact edit and the candidates.
    const system = calls[0]?.messages[0];
    const user = calls[0]?.messages[1];
    expect(system?.content).toContain('JSON object');
    expect(user?.content).toContain('"candidates"');

    const version = await readJson(join(listingDir, 'variants', 'calm-v1.json'));
    expect(version['id']).toBe('edl_calm-chat_v1');
    expect(version['parentId']).toBe(EDL.id);
    expect((version['clips'] as Array<{ room: string }>)[0]?.room).toBe('building');

    // Still the planned edit until apply is called.
    const metadata = await readJson(join(listingDir, 'variants', 'variants.json'));
    expect((metadata['variants'] as Array<{ edlPath: string }>)[0]?.edlPath).toBe(
      'variants/calm.json',
    );
  });

  it('retries an invalid patch once and then fails without writing', async () => {
    const invalid = reply([
      { op: 'replace', path: '/provenance/costUsd', value: 0 },
    ]);
    const { chat, calls } = makeService([invalid, invalid]);

    await expect(
      chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Make it free.' }),
    ).rejects.toMatchObject({ code: 'E_CHAT_INVALID_EDIT' });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.at(-1)?.content).toContain('rejected');
    await expect(
      readFile(join(listingDir, 'variants', 'calm-v1.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('recovers once when the second reply is valid', async () => {
    const { chat, calls } = makeService([
      reply([{ op: 'replace', path: '/provenance/pipelineVersion', value: '9.9.9' }]),
      reply([{ op: 'replace', path: '/clips/0/room', value: 'building' }]),
    ]);

    const result = await chat.send({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: 'Call the front shot a building.',
    });

    expect(calls).toHaveLength(2);
    expect(result.versionId).toBe('calm-v1');
    expect(result.warnings).toContain('The first reply was rejected and corrected once.');
  });

  describe('semantic guardrails', () => {
    it('rejects a source that is not in the candidate index', async () => {
      const bad = reply([
        { op: 'replace', path: '/clips/0/src', value: 'raw/99_secret.mp4' },
      ]);
      const { chat, calls } = makeService([bad, bad]);

      await expect(
        chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Use another clip.' }),
      ).rejects.toMatchObject({
        code: 'E_CHAT_INVALID_EDIT',
        message: expect.stringContaining('not one of the indexed shots'),
      });
      expect(calls).toHaveLength(2);
    });

    it('rejects removing the only price card', async () => {
      const bad = reply([{ op: 'remove', path: '/overlays/2' }]);
      const { chat } = makeService([bad, bad]);

      await expect(
        chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Drop the price.' }),
      ).rejects.toMatchObject({
        code: 'E_CHAT_INVALID_EDIT',
        message: expect.stringContaining('only price card'),
      });
    });

    it('rejects removing the only disclaimer', async () => {
      const bad = reply([{ op: 'remove', path: '/overlays/4' }]);
      const { chat } = makeService([bad, bad]);

      await expect(
        chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Drop the legal line.' }),
      ).rejects.toMatchObject({
        code: 'E_CHAT_INVALID_EDIT',
        message: expect.stringContaining('only disclaimer'),
      });
    });

    it('rejects a target outside 5–90 seconds', async () => {
      const bad = reply([
        { op: 'replace', path: '/format/targetDurationSec', value: 120 },
      ]);
      const { chat } = makeService([bad, bad]);

      await expect(
        chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Make it two minutes.' }),
      ).rejects.toMatchObject({
        code: 'E_CHAT_INVALID_EDIT',
        message: expect.stringContaining('between 5 and 90 seconds'),
      });
    });

    it('rejects a total outside half a second of the target', async () => {
      const bad = reply([
        { op: 'replace', path: '/format/targetDurationSec', value: 40 },
      ]);
      const { chat } = makeService([bad, bad]);

      await expect(
        chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Make it 40 seconds.' }),
      ).rejects.toMatchObject({
        code: 'E_CHAT_INVALID_EDIT',
        message: expect.stringContaining('allowed difference is 0.5s'),
      });
    });

    it('rejects an edit that changes nothing', async () => {
      const empty = reply([
        { op: 'replace', path: '/clips/0/room', value: 'exterior' },
      ]);
      const { chat } = makeService([empty, empty]);

      await expect(
        chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Keep it as it is.' }),
      ).rejects.toMatchObject({
        code: 'E_CHAT_INVALID_EDIT',
        message: expect.stringContaining('does not change anything'),
      });
    });
  });

  it('flips the export pointer only when apply is called', async () => {
    const { chat } = makeService([
      reply([{ op: 'replace', path: '/clips/0/room', value: 'building' }]),
    ]);

    const proposed = await chat.send({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: 'Call the front shot a building.',
    });

    await expect(
      chat.apply({ listingId: LISTING_ID, variantId: 'calm', versionId: proposed.versionId }),
    ).resolves.toEqual({ ok: true });

    const metadata = await readJson(join(listingDir, 'variants', 'variants.json'));
    expect((metadata['variants'] as Array<{ edlPath: string }>)[0]?.edlPath).toBe(
      'variants/calm-v1.json',
    );

    const current = await readVariantEdl(listingDir, 'calm');
    expect(current.clips[0]?.room).toBe('building');
  });

  it('refuses to apply a version it does not know', async () => {
    const { chat } = makeService([]);
    await expect(
      chat.apply({ listingId: LISTING_ID, variantId: 'calm', versionId: 'calm-v9' }),
    ).rejects.toMatchObject({ code: 'E_CHAT_NOT_FOUND' });
  });

  it('lists versions newest first', async () => {
    const { chat } = makeService([
      reply([{ op: 'replace', path: '/clips/0/room', value: 'building' }]),
      reply([{ op: 'replace', path: '/clips/0/room', value: 'kitchen' }]),
    ]);

    const first = await chat.send({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: 'Call the front shot a building.',
    });
    const second = await chat.send({
      listingId: LISTING_ID,
      variantId: 'calm',
      message: 'Call the front shot a kitchen.',
    });

    const versions = await chat.versions(LISTING_ID, 'calm');
    expect(versions.map((version) => version.id)).toEqual([second.versionId, first.versionId]);
    expect(versions[0]?.summary).toBe(second.diff);
    expect(versions[1]?.summary).toBe(first.diff);
  });

  it('fails before building a prompt when no key is configured', async () => {
    let calls = 0;
    const chat = createChatService({
      listingDir: (id) => join(root, 'listings', id),
      apiKey: () => undefined,
      model: 'openai/gpt-6-astra',
      complete: async () => {
        calls += 1;
        return { text: reply([]) };
      },
    });

    await expect(
      chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Shorter.' }),
    ).rejects.toBeInstanceOf(ChatError);
    await expect(
      chat.send({ listingId: LISTING_ID, variantId: 'calm', message: 'Shorter.' }),
    ).rejects.toMatchObject({ code: 'E_CHAT_KEY' });
    expect(calls).toBe(0);
  });
});
