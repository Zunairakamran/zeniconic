import { describe, expect, it } from 'vitest';

import {
  TranscriptionError,
  chunkAudioBytes,
  createTranscriber,
  transcribeAudio,
} from '../src/index';
import type { AudioInput, TranscriptWord } from '../src/index';
import type { FetchLike } from '@zeniconic/ai';

const KEY = 'sk-or-v1-test-secret-value';

interface Reply {
  status: number;
  body: string;
}

function reply(status: number, body: unknown): Reply {
  return {
    status,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function fakeFetch(replies: Reply[]): {
  fetchImpl: FetchLike;
  calls: { url: string; init: Parameters<FetchLike>[1] }[];
} {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  let index = 0;

  return {
    calls,
    fetchImpl(url, init) {
      calls.push({ url, init });
      const next = replies[index] ?? replies[replies.length - 1] ?? reply(500, 'no reply');
      index += 1;
      return Promise.resolve({
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        text: () => Promise.resolve(next.body),
      });
    },
  };
}

const AUDIO: AudioInput = {
  data: new Uint8Array([1, 2, 3, 4, 5]),
  format: '.mp3',
  durationSec: 3,
};

const GOOD_REPLY = {
  text: 'A bright flat in Oak Avenue.',
  language: 'en',
  duration: 3.2,
  words: [
    { word: 'A', start: 0, end: 0.1 },
    { word: 'bright', start: 0.1, end: 0.5 },
    { word: 'flat', start: 0.5, end: 0.9 },
  ],
  segments: [{ id: 0, start: 0, end: 3.2, text: 'A bright flat in Oak Avenue.' }],
};

describe('transcribeAudio', () => {
  it('requests verbose_json with word timings and normalises the reply', async () => {
    const fake = fakeFetch([reply(200, GOOD_REPLY)]);

    const result = await transcribeAudio(AUDIO, {
      getApiKey: () => KEY,
      fetchImpl: fake.fetchImpl,
    });

    expect(result).toEqual({
      text: 'A bright flat in Oak Avenue.',
      language: 'en',
      durationSec: 3.2,
      words: [
        { word: 'A', start: 0, end: 0.1 },
        { word: 'bright', start: 0.1, end: 0.5 },
        { word: 'flat', start: 0.5, end: 0.9 },
      ],
      segments: [{ id: 0, start: 0, end: 3.2, text: 'A bright flat in Oak Avenue.' }],
    });

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(call?.init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(call?.init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(call?.init.body ?? '{}') as Record<string, unknown>;
    expect(body.model).toBe('elevenlabs/scribe-v2');
    expect(body.response_format).toBe('verbose_json');
    expect(body.timestamp_granularities).toEqual(['word']);
    expect(body.input_audio).toEqual({
      data: Buffer.from(AUDIO.data).toString('base64'),
      format: 'mp3',
    });
  });

  it('surfaces a 401 as E_AUTH without retrying or leaking the key', async () => {
    let slept = 0;
    const fake = fakeFetch([
      reply(401, { error: { message: `invalid key ${KEY}` } }),
    ]);

    const error = await transcribeAudio(AUDIO, {
      getApiKey: () => KEY,
      fetchImpl: fake.fetchImpl,
      sleep: () => {
        slept += 1;
        return Promise.resolve();
      },
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(TranscriptionError);
    expect(error).toMatchObject({ code: 'E_AUTH', status: 401 });
    expect((error as Error).message).not.toContain(KEY);
    expect(fake.calls).toHaveLength(1);
    expect(slept).toBe(0);
  });

  it('retries a 429 once and then succeeds', async () => {
    let slept = 0;
    const fake = fakeFetch([
      reply(429, { error: { message: 'slow down' } }),
      reply(200, GOOD_REPLY),
    ]);

    const result = await transcribeAudio(AUDIO, {
      getApiKey: () => KEY,
      fetchImpl: fake.fetchImpl,
      sleep: (ms) => {
        expect(ms).toBe(300);
        slept += 1;
        return Promise.resolve();
      },
    });

    expect(result.text).toBe('A bright flat in Oak Avenue.');
    expect(fake.calls).toHaveLength(2);
    expect(slept).toBe(1);
  });

  it('reads the provider-reported cost and usage from the reply', async () => {
    const fake = fakeFetch([
      reply(200, {
        ...GOOD_REPLY,
        usage: { type: 'duration', seconds: 3.2, cost: 0.0042 },
      }),
    ]);

    const result = await transcribeAudio(AUDIO, {
      getApiKey: () => KEY,
      fetchImpl: fake.fetchImpl,
    });

    expect(result.costUsd).toBeCloseTo(0.0042, 6);
    expect(result.usageSeconds).toBe(3.2);
  });

  it('leaves cost absent when the reply carries no usage', async () => {
    const fake = fakeFetch([reply(200, GOOD_REPLY)]);

    const result = await transcribeAudio(AUDIO, {
      getApiKey: () => KEY,
      fetchImpl: fake.fetchImpl,
    });

    expect(result.costUsd).toBeUndefined();
    expect(result.usageSeconds).toBeUndefined();
  });

  it('retries a 500 once and reports E_SERVER if it fails again', async () => {    const fake = fakeFetch([reply(503, 'busy'), reply(502, 'still busy')]);
    const sleep = () => Promise.resolve();

    await expect(
      transcribeAudio(AUDIO, { getApiKey: () => KEY, fetchImpl: fake.fetchImpl, sleep }),
    ).rejects.toMatchObject({ code: 'E_SERVER', status: 502 });
    expect(fake.calls).toHaveLength(2);
  });

  it('reports malformed JSON as E_JSON without retrying', async () => {
    const fake = fakeFetch([reply(200, '{not json')]);

    await expect(
      transcribeAudio(AUDIO, { getApiKey: () => KEY, fetchImpl: fake.fetchImpl }),
    ).rejects.toMatchObject({ code: 'E_JSON' });
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects an empty key before touching the network', async () => {
    const fake = fakeFetch([reply(200, GOOD_REPLY)]);

    await expect(
      transcribeAudio(AUDIO, { getApiKey: () => '   ', fetchImpl: fake.fetchImpl }),
    ).rejects.toMatchObject({ code: 'E_AUTH' });
    expect(fake.calls).toHaveLength(0);
  });

  it('normalises a sparse reply instead of inventing fields', async () => {
    const fake = fakeFetch([
      reply(200, {
        words: [{ word: 'hello', start: '0.2', end: '0.6' }],
      }),
    ]);

    const result = await transcribeAudio(AUDIO, {
      getApiKey: () => KEY,
      fetchImpl: fake.fetchImpl,
    });

    expect(result.text).toBe('hello');
    expect(result.language).toBe('und');
    expect(result.durationSec).toBe(3);
    expect(result.segments).toEqual([]);
  });
});

describe('chunking', () => {
  it('splits raw bytes into the requested maximum', () => {
    const data = new Uint8Array(10);
    const chunks = chunkAudioBytes(data, 4);

    expect(chunks.map((chunk) => chunk.length)).toEqual([4, 4, 2]);
    expect(chunks.every((chunk) => chunk.length <= 4)).toBe(true);
    expect(() => chunkAudioBytes(data, 0)).toThrow(RangeError);
  });

  it('transcribes each chunk and shifts word timings by the elapsed duration', async () => {
    const fake = fakeFetch([
      reply(200, { text: 'one', duration: 1, words: [{ word: 'one', start: 0.2, end: 0.8 }] }),
      reply(200, { text: 'two', duration: 1, words: [{ word: 'two', start: 0.2, end: 0.8 }] }),
      reply(200, { text: 'three', duration: 1, words: [{ word: 'three', start: 0.2, end: 0.8 }] }),
    ]);

    const result = await transcribeAudio(
      { data: new Uint8Array(10), format: 'mp3', durationSec: 3 },
      {
        getApiKey: () => KEY,
        fetchImpl: fake.fetchImpl,
        maxAudioBytes: 4,
      },
    );

    expect(fake.calls).toHaveLength(3);
    expect(result.text).toBe('one two three');
    expect(result.durationSec).toBe(3);

    const words = result.words.map((word: TranscriptWord) => word.start);
    expect(words).toEqual([0.2, 1.2, 2.2]);
  });

  it('uses a caller-supplied chunker for containers that cannot be byte-sliced', async () => {
    const fake = fakeFetch([
      reply(200, { text: 'first', duration: 2 }),
      reply(200, { text: 'second', duration: 2 }),
    ]);

    const result = await transcribeAudio(
      { data: new Uint8Array(10), format: 'm4a' },
      {
        getApiKey: () => KEY,
        fetchImpl: fake.fetchImpl,
        maxAudioBytes: 4,
        chunkAudio: (audio) => [
          { data: audio.data.slice(0, 5), format: 'm4a', durationSec: 2 },
          { data: audio.data.slice(5), format: 'm4a', durationSec: 2 },
        ],
      },
    );

    expect(result.text).toBe('first second');
    expect(fake.calls).toHaveLength(2);
  });
});

describe('createTranscriber', () => {
  it('reads the key lazily on every call', async () => {
    let key = '';
    const fake = fakeFetch([reply(200, GOOD_REPLY)]);
    const client = createTranscriber({ getApiKey: () => key, fetchImpl: fake.fetchImpl });

    await expect(client.transcribe(AUDIO)).rejects.toMatchObject({ code: 'E_AUTH' });

    key = KEY;
    const result = await client.transcribe(AUDIO);
    expect(result.text).toBe('A bright flat in Oak Avenue.');
  });
});
