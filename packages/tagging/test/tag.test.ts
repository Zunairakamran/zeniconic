import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '@zeniconic/ai';
import { MemoryTaggingCache, TAGGING_SCHEMA, TaggingError, tagShot } from '../src/index';
import {
  DURATION,
  MODEL,
  PROMPT_VERSION,
  SHEET_PATH,
  mockClient,
  sheetBytes,
  validTags,
} from './helpers';

function imageUrlOf(req: ChatRequest): string {
  const user = req.messages.find((message) => message.role === 'user');
  if (user === undefined || !Array.isArray(user.content)) {
    throw new Error('Expected a user message with array content');
  }
  const image = user.content.find((part) => part.type === 'image_url');
  if (image === undefined || image.type !== 'image_url') throw new Error('Expected an image part');
  return image.image_url.url;
}

describe('tagShot — happy path', () => {
  it('returns the typed tags from a mocked client', async () => {
    const { client, calls } = mockClient([{ json: validTags() }]);

    const tags = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION },
    );

    expect(tags).toEqual(validTags());
    expect(tags.room).toBe('kitchen');
    expect(tags.cameraMove).toBe('push_in');
    expect(tags.sellingPoints).toHaveLength(3);
    expect(tags.score).toBe(82);
    expect(calls).toHaveLength(1);
  });

  it('asks for a strict schema with temperature 0 and the documented token cap', async () => {
    const { client, calls } = mockClient([{ json: validTags() }]);
    await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION },
    );

    const request = calls[0];
    expect(request).toBeDefined();
    expect(request?.model).toBe(MODEL);
    expect(request?.jsonSchema).toBe(TAGGING_SCHEMA);
    expect(request?.temperature).toBe(0);
    expect(request?.maxTokens).toBe(1400);
    expect(request?.messages).toHaveLength(2);
  });

  it('sends the sheet inline as one JPEG data URL', async () => {
    const { client, calls } = mockClient([{ json: validTags() }]);
    await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION },
    );

    const request = calls[0];
    if (request === undefined) throw new Error('Expected one request');
    const url = imageUrlOf(request);
    const prefix = 'data:image/jpeg;base64,';
    expect(url.startsWith(prefix)).toBe(true);
    expect(url.slice(prefix.length)).toBe(Buffer.from(sheetBytes()).toString('base64'));
  });

  it('accepts a raw JSON reply when the client did not parse it', async () => {
    const { client } = mockClient([{ text: JSON.stringify(validTags()) }]);

    const tags = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION },
    );
    expect(tags).toEqual(validTags());
  });
});

describe('tagShot — cache', () => {
  it('serves a cache hit without calling the client', async () => {
    const cache = new MemoryTaggingCache();
    const { client, calls } = mockClient([{ json: validTags() }]);

    const first = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION, cache },
    );
    const second = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION, cache },
    );

    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(cache.size).toBe(1);
  });

  it('keys a new prompt version separately', async () => {
    const cache = new MemoryTaggingCache();
    const { client, calls } = mockClient([{ json: validTags() }, { json: validTags() }]);

    await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION, cache },
    );
    await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: 'tag-1.3.1', cache },
    );

    expect(calls).toHaveLength(2);
    expect(cache.size).toBe(2);
  });
});

describe('tagShot — repair and failure', () => {
  it('rejects a bad room, retries once with the issues, then returns the repair', async () => {
    const broken = { ...validTags(), room: 'garage' };
    const { client, calls } = mockClient([{ json: broken }, { json: validTags() }]);

    const tags = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION },
    );

    expect(tags).toEqual(validTags());
    expect(calls).toHaveLength(2);

    const repair = calls[1]?.messages.at(-1);
    expect(repair?.role).toBe('user');
    expect(typeof repair?.content).toBe('string');
    expect(String(repair?.content)).toContain('rejected');
    expect(String(repair?.content)).toContain('/room');
  });

  it('throws E_TAGS after one retry on unparseable JSON', async () => {
    const cache = new MemoryTaggingCache();
    const { client, calls } = mockClient([{ text: 'not json at all' }, { text: 'still not json {' }]);

    const error = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION, cache },
    ).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(TaggingError);
    expect(error).toMatchObject({ code: 'E_TAGS' });
    expect((error as TaggingError).issues.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
    expect(cache.size).toBe(0);
  });

  it('throws E_TAGS when both replies violate the schema', async () => {
    const broken = { ...validTags(), score: 140 };
    const { client, calls } = mockClient([{ json: broken }, { json: broken }]);

    const error = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION },
    ).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(TaggingError);
    expect(error).toMatchObject({ code: 'E_TAGS' });
    expect((error as TaggingError).issues.join(' ')).toContain('/score');
    expect(calls).toHaveLength(2);
  });

  it('does not mask an authentication failure as E_TAGS', async () => {
    const authError = Object.assign(new Error('invalid key'), { code: 'E_AUTH' });
    const { client, calls } = mockClient([{ throws: authError }]);

    const error = await tagShot(
      { sheetPath: SHEET_PATH, durationSec: DURATION },
      { client, model: MODEL, promptVersion: PROMPT_VERSION },
    ).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBe(authError);
    expect((error as { code?: string }).code).toBe('E_AUTH');
    expect(calls).toHaveLength(1);
  });

  it('refuses a non-positive duration before reading or calling', async () => {
    const { client, calls } = mockClient([{ json: validTags() }]);

    await expect(
      tagShot({ sheetPath: SHEET_PATH, durationSec: 0 }, { client, model: MODEL, promptVersion: PROMPT_VERSION }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
  });
});
