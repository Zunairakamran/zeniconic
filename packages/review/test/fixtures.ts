/**
 * Fixtures for the review suite.
 *
 * The four JPEGs are real 32x32 baseline JPEGs at luma 0, 64, 128 and 200. They
 * exercise the DC luma reader rather than pretending a string is an image.
 */

import type { ChatClient, ChatRequest, ChatResponse } from '@zeniconic/ai';
import type { Edl } from '@zeniconic/edl';
import { PROFILES } from '@zeniconic/render';
import type { RenderProfile } from '@zeniconic/render';
import example from '../../edl/example.edl.json';
import type { FrameSample, ReviewDeps, ReviewFacts } from '../src/index';

export const JPEG_BLACK =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooAKKKKACiiigAooooA//2Q==';

export const JPEG_GRAY64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDz+iiigAooooAKKKKACiiigD//2Q==';

export const JPEG_GRAY128 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooAKKKKACiiigAooooA/9k=';

export const JPEG_GRAY200 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0iiiigAooooAKKKKACiiigD//2Q==';

/**
 * 32x32 noise at quality 82: a stand-in for a detailed, in-focus frame. Its AC
 * detail is ~0.82, against ~0.11 for {@link JPEG_BLUR}, so the hook check has a
 * real sharp/soft pair to compare.
 */
export const JPEG_SHARP =
  '/9j/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAAgACADASIAAhEBAxEB/8QAGAABAAMBAAAAAAAAAAAAAAAABAECAwX/xAAmEAACAgICAQMEAwAAAAAAAAABAgMEERIFIRMAFCIjMTJBBjNC/8QAFwEBAQEBAAAAAAAAAAAAAAAABAMBAv/EACQRAAICAAYCAgMAAAAAAAAAAAERAiEAAxIxUWETQSJCQ4Gh/9oADAMBAAIRAxEAPwAdWfjPYtXo24JLVQs5S3XdYpn8xLhdVUyEARlATkhyDnYhZqcTy3mlvTHlbV4w9zZBYDBEuIhkFic4LNhgy4GF9Om8sNpZL4o2VlBkia3db2wYCVlLOyhgZEjD6E4bslcldMpp+blPHrWsctpP9eus8DCIsx7QBmXABjgxphVLFu8nWol+OAcWSSdkPQIRVEW/2DSM2RhLywPy29He9x8e0dNFoXje17yG2z/yCvbk8MhWOSODEUccZkaNAIVcOpR2Qg7BWBIH7It68nIPyvGVbsfGJOa91uTg0VQZcBsKVx1L+1wTlm7PSFW0YrsFpPPJdsQfQnVykqB9sEE4BDFWZGyzkksX2wu1xuTvJJceJpbU0dmw8Ub+EiRewrFiCgWNiu7gjVwgHzx6PlgiM8wAHUACFR2qwUwxwCAW3gubLyAS1C2rX19La0BxWq4rFq8M0clavdiCzTr4YEdRAItT8EiLMyM5X/LfEkyKFHzzx0E8ktcR0KMtRIht7lGEa6xI+EKE/dO8ts2sgA+mCfSLvEW4Ea3Xu35ePlm+EcbpLoGjRVsPHAwVtRHOo6P9YyTjPq3GUOMiM/kFhqQm1kMDFkEUUW4bzFgmpJEgGp7X5EDGqCYwEZFEmvYu3/D9h1Wqs8oZgakm2SNx3v2PdnnEzzJzBmTjLN6KK5XsSWY4NJF2PwZkUorOpbfOBkyOwP4dqsSy8tE1J3rV3V0jAl8Dx6sWaJyw28avozkayKS4LDB9CalZE1jl9LdOW5ceSOzIwRIUAYRtPIzaONyV1J1w2QdTgtt8fUerMvHRchxrrB5k9jcgT7IrhtdyQGjCt2diCPyONoSE5COVSAGnY9J9MctcEPuWZHLMyYq9t1puygQENOojhVj/2Q==';

/** The same noise blurred with radius 3: a soft, low-detail frame. */
export const JPEG_BLUR =
  '/9j/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAAgACADASIAAhEBAxEB/8QAGAABAAMBAAAAAAAAAAAAAAAAAwACBAH/xAAeEAACAgMBAQEBAAAAAAAAAAABAgADERIhMQQTIv/EABYBAQEBAAAAAAAAAAAAAAAAAAMBBP/EAB4RAAIDAAEFAAAAAAAAAAAAAAECAAMSERMiMUFC/9oADAMBAAIRAxEAPwDOtWgwvsSmlw22TFZcHMo1zA4ER2+BNFjZOljNkjB7AWpRZ3yKrFh2U+pStZIgBMgniZLtWLO7hV7M/wCv98HIttLWDZfJKPnyMEdjuwA0fcvUAOW8yC7JEYkWLqwlD8jVtsRyS7lZK+wmDWdqyixU5LT/2Q==';


export const FACTS: ReviewFacts = {
  address: '14 Oak Avenue',
  price: '£845,000',
  beds: 3,
  baths: 2,
};

export const PROFILE: RenderProfile = PROFILES['vertical-social'];

export function makeEdl(): Edl {
  return structuredClone(example) as unknown as Edl;
}

/** Two luma levels, alternating faster than any hold we need to detect. */
export function frameAt(t: number): FrameSample {
  const palette = [JPEG_GRAY128, JPEG_GRAY200];
  const index = Math.abs(Math.floor(t * 7)) % palette.length;
  return { t, jpegBase64: palette[index] ?? JPEG_GRAY128 };
}

export interface DepsOptions {
  durationSec?: number;
  lufs?: number;
  frames?: (t: number) => string;
  vision?: ChatClient;
  sampleError?: string;
}

export function makeDeps(options: DepsOptions = {}): ReviewDeps {
  const durationSec = options.durationSec ?? 29.9;
  const jpegFor = options.frames ?? ((t: number) => frameAt(t).jpegBase64);

  return {
    probe: async () => ({ durationSec, width: 1080, height: 1920 }),
    loudness: async () => ({ lufs: options.lufs ?? -14.1, truePeak: -1.6 }),
    sampleFrames: async (_file, times) => {
      if (options.sampleError !== undefined) throw new Error(options.sampleError);
      return times.map((t) => ({ t, jpegBase64: jpegFor(t) }));
    },
    ...(options.vision === undefined ? {} : { vision: options.vision }),
  };
}

export type VisionReply =
  | { scores: Record<string, unknown>; costUsd?: number; text?: string }
  | { text: string; costUsd?: number };

export interface VisionSpy extends ChatClient {
  readonly calls: ChatRequest[];
}

/** A client that replays prepared replies and records every request. */
export function visionSpy(replies: VisionReply[]): VisionSpy {
  const calls: ChatRequest[] = [];
  let index = 0;

  return {
    calls,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      if (reply === undefined) throw new Error('visionSpy has no replies');

      const json = 'scores' in reply ? reply.scores : undefined;
      return {
        text: reply.text ?? JSON.stringify(json ?? {}),
        ...(json === undefined ? {} : { json }),
        usage: { promptTokens: 10, completionTokens: 5 },
        costUsd: reply.costUsd ?? 0.001,
        model: 'test/reviewer',
        cachedTokens: 0,
        cacheDiscountUsd: 0,
      };
    },
  };
}

export function perfectScores(value = 0.9): Record<string, unknown> {
  return {
    adherence: value,
    pacing: value,
    visualQuality: value,
    watchability: value,
    notes: 'Hold the end card a beat longer.',
  };
}
