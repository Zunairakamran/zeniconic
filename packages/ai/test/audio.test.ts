import { describe, expect, it } from 'vitest';
import { generateAudioWithModel } from '../src/audio';
import { AiError } from '../src/types';

const KEY = 'sk-or-v1-audio-test-key-12345';

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function chunk(fragment: string, extra: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { audio: { data: fragment } } }],
    ...extra,
  })}\n\n`;
}

describe('generateAudioWithModel', () => {
  it('requests streaming audio and concatenates decoded fragments', async () => {
    const first = Buffer.from('ID3-first-').toString('base64');
    const second = Buffer.from('second-bytes').toString('base64');
    let body: Record<string, unknown> | undefined;

    const secondLine = `data: ${JSON.stringify({
      choices: [{ delta: { audio: { data: second } } }],
      usage: { cost: 0.04, prompt_tokens: 31, completion_tokens: 4 },
    })}\n\n`;

    const fetchImpl = async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        text: async () => '',
        body: sseStream([
          chunk(first),
          // Deliberately split the SSE line across reads.
          secondLine.slice(0, 24),
          `${secondLine.slice(24)}data: [DONE]\n\n`,
        ]),
      };
    };

    const result = await generateAudioWithModel({
      apiKey: KEY,
      model: 'google/lyria-3-pro-preview',
      prompt: 'A calm bed.',
      fetchImpl: fetchImpl as never,
    });

    expect(body).toMatchObject({
      model: 'google/lyria-3-pro-preview',
      modalities: ['text', 'audio'],
      stream: true,
    });
    expect(body).not.toHaveProperty('audio');
    expect(Buffer.from(result.bytes).toString()).toBe('ID3-first-second-bytes');
    expect(result.costUsd).toBe(0.04);
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('fails when the model streams no audio', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      body: sseStream(['data: {"choices":[{"delta":{"content":""}}]}\n\ndata: [DONE]\n\n']),
    });
    await expect(
      generateAudioWithModel({
        apiKey: KEY,
        model: 'google/lyria-3-clip-preview',
        prompt: 'x',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: 'E_JSON' });
  });

  it('maps an HTTP failure and never leaks the key', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 402,
      text: async () => `no credits for ${KEY}`,
    });
    let caught: unknown;
    try {
      await generateAudioWithModel({
        apiKey: KEY,
        model: 'google/lyria-3-pro-preview',
        prompt: 'x',
        fetchImpl: fetchImpl as never,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiError);
    expect(String(caught)).not.toContain(KEY);
    expect((caught as AiError).status).toBe(402);
  });
});
