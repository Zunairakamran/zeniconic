import { describe, expect, it } from 'vitest';
import type { ChatContentPart } from '@zeniconic/ai';
import { SYSTEM_PROMPT, buildTaggingMessages } from '../src/index';

const SHEET = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function parts(content: unknown): ChatContentPart[] {
  if (!Array.isArray(content)) throw new Error('Expected array content');
  return content as ChatContentPart[];
}

describe('buildTaggingMessages', () => {
  it('sends a system prompt and one user turn with text plus the sheet', () => {
    const messages = buildTaggingMessages(SHEET, 8.25);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe(SYSTEM_PROMPT);
    expect(messages[1]?.role).toBe('user');

    const sent = parts(messages[1]?.content);
    expect(sent).toHaveLength(2);
    expect(sent.filter((part) => part.type === 'image_url')).toHaveLength(1);
    const image = sent.find((part) => part.type === 'image_url');
    expect(image).toEqual({ type: 'image_url', image_url: { url: SHEET } });
  });

  it('states the shot duration in seconds, to three decimals', () => {
    const sent = parts(buildTaggingMessages(SHEET, 8.25)[1]?.content);
    const text = sent[0];
    expect(text?.type).toBe('text');
    if (text?.type !== 'text') throw new Error('Expected a text part');
    expect(text.text).toContain('8.250 s');
    expect(text.text).toContain('0%');
    expect(text.text).toContain('100%');
  });

  it('tells the model the grid is six frames of one shot', () => {
    const system = buildTaggingMessages(SHEET, 4)[0]?.content;
    expect(typeof system).toBe('string');
    const prompt = String(system);
    expect(prompt).toContain('3x2 grid');
    expect(prompt).toContain('six frames');
    expect(prompt).toContain('ONE continuous shot');
  });

  it('tells the model to ignore filename hints and judge only the image', () => {
    const prompt = String(buildTaggingMessages(SHEET, 4)[0]?.content);
    expect(prompt).toContain('Ignore any filename');
    expect(prompt).toContain('Judge only the image');
  });

  it('requires bestIn and bestOut inside the duration', () => {
    const prompt = String(buildTaggingMessages(SHEET, 4)[0]?.content);
    expect(prompt).toContain('inside the');
    expect(prompt).toContain('shot duration');
  });

  it('asks for visible defects only and defines the score', () => {
    const prompt = String(buildTaggingMessages(SHEET, 4)[0]?.content);
    expect(prompt).toContain('clearly visible');
    expect(prompt).toContain('would a good editor use this shot');
  });

  it('refuses a non-positive duration', () => {
    expect(() => buildTaggingMessages(SHEET, 0)).toThrowError(RangeError);
    expect(() => buildTaggingMessages(SHEET, -1)).toThrowError(RangeError);
    expect(() => buildTaggingMessages(SHEET, Number.NaN)).toThrowError(RangeError);
  });

  it('refuses an empty data URL', () => {
    expect(() => buildTaggingMessages('', 4)).toThrowError(RangeError);
  });
});
