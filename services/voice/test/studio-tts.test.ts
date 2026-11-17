import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createStudioEngine,
  selectVoiceEngine,
  STUDIO_MODEL_ID,
  studioVoiceReady,
  StudioVoiceError,
  voiceLinePath,
  wavIsIntact,
} from '../src/index';
import type { TtsAudio } from '../src/index';

const KEY = 'sk-or-v1-studio-test-key-123456';
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'zeniconic-studio-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tone(): TtsAudio {
  const samples = new Float32Array(4410);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 220 * index) / 44_100) * 0.1;
  }
  return { samples, sampleRate: 44_100 };
}

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: string, status = 400): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function audioResponse(bytes: Buffer, contentType = 'audio/mpeg'): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
}

describe('createStudioEngine', () => {
  it('uses PCM and a Gemini voice name for Gemini TTS models', async () => {
    const calls: Call[] = [];
    const engine = createStudioEngine({
      apiKey: KEY,
      model: 'google/gemini-3.8-flash-tts',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        // 4,800 bytes of 16-bit PCM = 2,400 samples at 24 kHz.
        return audioResponse(Buffer.alloc(4_800), 'audio/pcm');
      },
    });

    const audio = await engine.generate('Some mornings.', { voice: 'matilda' });

    expect(audio.sampleRate).toBe(24_000);
    expect(audio.samples.length).toBe(2_400);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: 'google/gemini-3.8-flash-tts',
      input: 'Some mornings.',
      voice: 'Kore',
      response_format: 'pcm',
    });
  });

  it('posts the documented body and returns decoded samples', async () => {
    const calls: Call[] = [];
    const engine = createStudioEngine({
      apiKey: KEY,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return audioResponse(Buffer.from('ID3 fake mp3 bytes'));
      },
      decode: async () => tone(),
    });

    const audio = await engine.generate('Some mornings.', { voice: 'matilda' });

    expect(audio.sampleRate).toBe(44_100);
    expect(audio.samples.length).toBe(4410);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: STUDIO_MODEL_ID,
      input: 'Some mornings.',
      voice: 'matilda',
      response_format: 'mp3',
    });
  });

  it('accepts raw pcm bytes with a pcm content type', async () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(16384, 0);
    pcm.writeInt16LE(-16384, 2);
    pcm.writeInt16LE(0, 4);
    pcm.writeInt16LE(0, 6);

    const engine = createStudioEngine({
      apiKey: KEY,
      fetchImpl: async () => audioResponse(pcm, 'audio/pcm'),
    });

    const audio = await engine.generate('Hello.', { voice: 'george' });
    expect(audio.sampleRate).toBe(44_100);
    expect(audio.samples).toHaveLength(4);
    expect(audio.samples[0]).toBeCloseTo(0.5, 4);
    expect(audio.samples[1]).toBeCloseTo(-0.5, 4);
  });

  it('caches by provider, model, voice and text so a retry never re-bills', async () => {
    const cacheDir = tempRoot();
    let requests = 0;
    const first = createStudioEngine({
      apiKey: KEY,
      cacheDir,
      fetchImpl: async () => {
        requests += 1;
        return audioResponse(Buffer.from('ID3 bytes'));
      },
      decode: async () => tone(),
    });

    await first.generate('A cached line.', { voice: 'matilda' });
    expect(requests).toBe(1);

    const file = voiceLinePath(cacheDir, 'A cached line.', 'matilda', {
      provider: 'studio',
      model: STUDIO_MODEL_ID,
    });
    expect(wavIsIntact(file)).toBe(true);

    const second = createStudioEngine({
      apiKey: KEY,
      cacheDir,
      fetchImpl: async () => {
        throw new Error('the second engine must not call the network');
      },
    });
    const cached = await second.generate('A cached line.', { voice: 'matilda' });
    expect(cached.samples.length).toBeGreaterThan(0);
    expect(requests).toBe(1);

    // A different voice is a different line and must re-request.
    await first.generate('A cached line.', { voice: 'george' });
    expect(requests).toBe(2);
  });

  it('retries a 5xx once and succeeds', async () => {
    let requests = 0;
    const engine = createStudioEngine({
      apiKey: KEY,
      retryDelayMs: 0,
      fetchImpl: async () => {
        requests += 1;
        return requests === 1
          ? jsonResponse('upstream busy', 503)
          : audioResponse(Buffer.from('ID3 bytes'));
      },
      decode: async () => tone(),
    });

    await expect(engine.generate('One line.', { voice: 'matilda' })).resolves.toMatchObject({
      sampleRate: 44_100,
    });
    expect(requests).toBe(2);
  });

  it('retries a 429 once, then reports the rate limit', async () => {
    let requests = 0;
    const engine = createStudioEngine({
      apiKey: KEY,
      retryDelayMs: 0,
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse('slow down', 429);
      },
    });

    const failure = engine.generate('One line.', { voice: 'matilda' });
    await expect(failure).rejects.toBeInstanceOf(StudioVoiceError);
    await expect(failure).rejects.toMatchObject({ code: 'E_STUDIO_RATE_LIMIT' });
    expect(requests).toBe(2);
  });

  it('does not retry a rejected key and never echoes it', async () => {
    let requests = 0;
    const engine = createStudioEngine({
      apiKey: KEY,
      retryDelayMs: 0,
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse(`invalid key ${KEY}`, 401);
      },
    });

    let message = '';
    try {
      await engine.generate('One line.', { voice: 'matilda' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(requests).toBe(1);
    expect(message).not.toContain(KEY);
    expect(message).toContain('[key]');
  });

  it('times out after the deadline', async () => {
    let requests = 0;
    const engine = createStudioEngine({
      apiKey: KEY,
      timeoutMs: 10,
      fetchImpl: async (_url, init) => {
        requests += 1;
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
      },
    });

    await expect(engine.generate('One line.', { voice: 'matilda' })).rejects.toMatchObject({
      code: 'E_STUDIO_TIMEOUT',
    });
    expect(requests).toBe(1);
  });

  it('refuses to call the provider without a key or with an unknown voice', async () => {
    let requests = 0;
    const noKey = createStudioEngine({
      apiKey: '',
      fetchImpl: async () => {
        requests += 1;
        return audioResponse(Buffer.from('ID3'));
      },
    });
    await expect(noKey.generate('Hi.', { voice: 'matilda' })).rejects.toMatchObject({
      code: 'E_STUDIO_CONFIG',
    });

    const engine = createStudioEngine({
      apiKey: KEY,
      fetchImpl: async () => {
        requests += 1;
        return audioResponse(Buffer.from('ID3'));
      },
    });
    await expect(engine.generate('Hi.', { voice: '../secrets' })).rejects.toMatchObject({
      code: 'E_STUDIO_CONFIG',
    });
    expect(requests).toBe(0);
  });
});

describe('selectVoiceEngine', () => {
  it('uses the studio when a key exists, with matilda as the default', async () => {
    const selection = await selectVoiceEngine({ getApiKey: async () => KEY });
    expect(selection.provider).toBe('studio');
    expect(selection.voice).toBe('matilda');
    expect(selection.model).toBe(STUDIO_MODEL_ID);
    expect(selection.warnings).toEqual([]);
  });

  it('honours the selected voice and rejects an unknown one', async () => {
    const selection = await selectVoiceEngine({
      getApiKey: async () => KEY,
      voiceId: 'george',
    });
    expect(selection.voice).toBe('george');

    const fallback = await selectVoiceEngine({
      getApiKey: async () => KEY,
      voiceId: 'not-a-voice',
    });
    expect(fallback.voice).toBe('matilda');
    expect(fallback.warnings.join(' ')).toContain('not in the studio catalogue');
  });

  it('falls back to Kokoro with a warning when there is no key', async () => {
    const selection = await selectVoiceEngine({ getApiKey: async () => undefined });
    expect(selection.provider).toBe('local');
    expect(selection.voice).toBe('af_heart');
    expect(selection.model).toBe('kokoro-82m');
    expect(selection.warnings).toHaveLength(1);
    expect(selection.warnings[0]).toContain('offline Kokoro');
  });

  it('keeps an explicit local request quiet', async () => {
    const selection = await selectVoiceEngine({
      provider: 'local',
      getApiKey: async () => KEY,
    });
    expect(selection.provider).toBe('local');
    expect(selection.warnings).toEqual([]);
  });

  it('warns instead of failing when the studio was requested without a key', async () => {
    const selection = await selectVoiceEngine({
      provider: 'studio',
      getApiKey: async () => undefined,
    });
    expect(selection.provider).toBe('local');
    expect(selection.warnings.join(' ')).toContain('studio voice cannot be used');
  });

  it('reports readiness without throwing', async () => {
    await expect(studioVoiceReady(async () => KEY)).resolves.toBe(true);
    await expect(studioVoiceReady(async () => '   ')).resolves.toBe(false);
    await expect(
      studioVoiceReady(async () => {
        throw new Error('no storage');
      }),
    ).resolves.toBe(false);
  });
});

describe('studio sample cache', () => {
  it('writes a readable wav line, not a byte blob', async () => {
    const cacheDir = tempRoot();
    const engine = createStudioEngine({
      apiKey: KEY,
      cacheDir,
      fetchImpl: async () => audioResponse(Buffer.from('ID3 bytes')),
      decode: async () => tone(),
    });
    await engine.generate('Cache me.', { voice: 'sarah' });

    const file = voiceLinePath(cacheDir, 'Cache me.', 'sarah', {
      provider: 'studio',
      model: STUDIO_MODEL_ID,
    });
    const bytes = readFileSync(file);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wavIsIntact(file)).toBe(true);
  });
});
