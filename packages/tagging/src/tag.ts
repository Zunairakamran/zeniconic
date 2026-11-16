import { readFile } from 'node:fs/promises';
import type { ChatClient, ChatMessage } from '@zeniconic/ai';
import { cacheKey } from './cache';
import type { TaggingCache } from './cache';
import { buildTaggingMessages } from './prompt';
import { TAGGING_SCHEMA, validateTags } from './schema';
import type { ShotTags } from './types';

export interface TagShotInput {
  /** Path to the 1536x1024 JPEG contact sheet for this shot. */
  sheetPath: string;
  /** Length of the shot the sheet was sampled from, in seconds. */
  durationSec: number;
}

export interface TagShotOptions {
  client: ChatClient;
  /** Pinned model id, e.g. `google/gemini-3.8-flash:floor`. */
  model: string;
  /** Prompt version, stored in the index and mixed into the cache key. */
  promptVersion: string;
  cache?: TaggingCache;
}

/** One repair attempt, then fail closed. */
const MAX_ATTEMPTS = 2;
const MAX_OUTPUT_TOKENS = 1400;
const MAX_REPORTED_ISSUES = 5;

/**
 * The tagger could not produce a schema-valid record. `code` is stable so
 * callers branch on it rather than parsing the message.
 */
export class TaggingError extends Error {
  readonly code = 'E_TAGS';
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(
      issues.length === 0
        ? message
        : `${message}: ${issues.slice(0, MAX_REPORTED_ISSUES).join('; ')}`,
    );
    this.name = 'TaggingError';
    this.issues = issues;
  }
}

/** A reply we can repair by asking again: bad JSON or a schema violation. */
function isRecoverableReply(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'E_JSON';
}

function issuesOf(error: unknown): string[] {
  if (error instanceof SyntaxError) return ['reply is not valid JSON'];
  if (typeof error === 'object' && error !== null) {
    const issues = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      const strings = issues.filter((issue): issue is string => typeof issue === 'string');
      if (strings.length > 0) return strings;
    }
  }
  if (error instanceof Error && error.message.length > 0) return [error.message];
  return ['reply is not valid JSON'];
}

function repairMessage(issues: string[]): ChatMessage {
  return {
    role: 'user',
    content: [
      'The previous reply was rejected:',
      ...issues.map((issue) => `- ${issue}`),
      'Correct the fields above and return only JSON matching the schema.',
    ].join('\n'),
  };
}

/**
 * Turn one contact sheet into one typed `ShotTags` record.
 *
 * Reads the sheet, checks the content-addressed cache, asks the model for a
 * schema-constrained reply, validates it (schema plus cross-field invariants)
 * and retries once with the issue list when the reply is invalid. Network,
 * authentication and budget errors are not masked as `E_TAGS`; only an invalid
 * reply is.
 */
export async function tagShot(input: TagShotInput, opts: TagShotOptions): Promise<ShotTags> {
  if (!Number.isFinite(input.durationSec) || input.durationSec <= 0) {
    throw new RangeError(`Shot duration must be a positive number of seconds, got ${input.durationSec}.`);
  }

  const bytes = new Uint8Array(await readFile(input.sheetPath));
  if (bytes.length === 0) {
    throw new TaggingError(`The contact sheet at ${input.sheetPath} is empty.`, ['empty contact sheet']);
  }

  const key = cacheKey(bytes, opts.model, opts.promptVersion);
  const cached = opts.cache?.get(key);
  if (cached !== undefined) return cached;

  const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
  const base = buildTaggingMessages(dataUrl, input.durationSec);

  let issues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const messages = attempt === 1 ? base : [...base, repairMessage(issues)];

    let payload: unknown;
    try {
      const response = await opts.client.complete({
        model: opts.model,
        messages,
        jsonSchema: TAGGING_SCHEMA,
        temperature: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
      payload = response.json ?? (JSON.parse(response.text) as unknown);
    } catch (error) {
      if (!isRecoverableReply(error)) throw error;
      issues = issuesOf(error);
      continue;
    }

    const result = validateTags(payload);
    if (result.valid) {
      const tags = payload as ShotTags;
      opts.cache?.put(key, tags);
      return tags;
    }
    issues = result.issues;
  }

  throw new TaggingError(`The tagger returned invalid output after ${MAX_ATTEMPTS} attempts`, issues);
}
