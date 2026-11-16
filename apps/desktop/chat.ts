/**
 * The refine assistant.
 *
 * The model never edits a file directly. It returns a typed JSON changeset,
 * the service applies it with the same allowlisted `applyPatch` the rest of the
 * chat uses, adds the semantic guardrails the JSON Pointer allowlist cannot
 * express, and writes a new EDL version. The version is inert until `apply`
 * flips the variant's pointer, which is what export reads.
 *
 * The model call and the key provider are injected, so tests (and offline QA)
 * never touch the network.
 */

import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { AiError, parseJsonReply, resolveModelId } from '../../packages/ai/src/index';
import type { ChatMessage } from '../../packages/ai/src/index';
import { applyPatch, summariseDiff } from '../../packages/chat/src/index';
import type { PatchOp } from '../../packages/chat/src/index';
import { durationSec, validateEdl } from '../../packages/edl/src/index';
import type { Edl, OverlayKind } from '../../packages/edl/src/index';
import type { VariantSummary } from '../../packages/ipc/src/index';
import { readVariantEdl, readVariants, setVariantEdlPath } from './variants';

export interface ChatRequest {
  listingId: string;
  variantId: string;
  message: string;
}

export interface ChatResult {
  reply: string;
  diff: string;
  versionId: string;
  warnings: string[];
}

export interface ChatService {
  send(request: ChatRequest): Promise<ChatResult>;
  apply(input: {
    listingId: string;
    variantId: string;
    versionId: string;
  }): Promise<{ ok: boolean }>;
  versions(
    listingId: string,
    variantId: string,
  ): Promise<Array<{ id: string; createdAt: string; summary: string }>>;
}

/** The request the service hands to the injected model call. */
export interface ChatModelRequest {
  model: string;
  messages: ChatMessage[];
  jsonSchema: object;
  temperature?: number;
  maxTokens?: number;
}

export type ChatComplete = (request: ChatModelRequest) => Promise<{ text: string }>;

export interface ChatServiceOptions {
  /** Absolute listing workspace: `<data>/listings/<listingId>`. */
  listingDir: (listingId: string) => string;
  /** Injected model call. Tests pass a fake; main passes OpenRouter. */
  complete: ChatComplete;
  /** Key provider. A missing key fails before any prompt is built. */
  apiKey: () => Promise<string | undefined> | string | undefined;
  /** Planning model slug, before the `:nitro` suffix. */
  model: string;
  /** ISO clock, injected so version ordering is testable. */
  now?: () => string;
  /** Cap on candidate shots included in the prompt. */
  maxCandidates?: number;
}

export type ChatErrorCode =
  | 'E_CHAT_INPUT'
  | 'E_CHAT_KEY'
  | 'E_CHAT_MODEL'
  | 'E_CHAT_INVALID_EDIT'
  | 'E_CHAT_GUARDRAIL'
  | 'E_CHAT_NOT_FOUND'
  | 'E_CHAT_IO';

/** Stable codes for logs and QA; `message` is the sentence the UI shows. */
export class ChatError extends Error {
  readonly code: ChatErrorCode;

  constructor(code: ChatErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ChatError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Guardrail constants
// ---------------------------------------------------------------------------

/** A format may ask for anything in this range, and nothing outside it. */
export const MIN_TARGET_DURATION_SEC = 5;
export const MAX_TARGET_DURATION_SEC = 90;
/** Same half-second tolerance the EDL validator enforces. */
export const DURATION_TOLERANCE_SEC = 0.5;

/** The overlays a listing may not lose entirely. */
const REQUIRED_OVERLAY_KINDS: readonly OverlayKind[] = ['price', 'disclaimer'];

const MAX_CONTEXT_CHARS = 16_000;
const MAX_CANDIDATES = 120;
const MAX_MESSAGE_LENGTH = 2_000;
/** A repair turn re-sends the rejected reply; cap it so a rogue provider cannot blow the prompt. */
const MAX_REPLY_CHARS = 4_000;
const MAX_MODEL_ATTEMPTS = 2;
const MAX_TOKENS = 1_600;

// ---------------------------------------------------------------------------
// Reply schema
// ---------------------------------------------------------------------------

const PATCH_OPERATION_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      required: ['op', 'path'],
      additionalProperties: false,
      properties: {
        op: { const: 'remove' },
        path: { type: 'string', pattern: '^/' },
      },
    },
    {
      type: 'object',
      required: ['op', 'path', 'value'],
      additionalProperties: false,
      properties: {
        op: { type: 'string', enum: ['add', 'replace'] },
        path: { type: 'string', pattern: '^/' },
        value: {},
      },
    },
  ],
} as const;

/**
 * The model is asked for exactly this object. `parseJsonReply` validates it
 * with Ajv in addition to the provider's structured-output enforcement.
 */
const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'operations'],
  properties: {
    reply: {
      type: 'string',
      minLength: 1,
      maxLength: 600,
      description: 'One or two plain sentences describing the change.',
    },
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: PATCH_OPERATION_SCHEMA,
    },
  },
} as const;

const ALLOWED_PATHS = [
  '/clips/<i>/(inSec|outSec|speed|volumeDb|room|reason|sourceId|src)',
  '/clips/<i>/(transform|transitionIn|transitionOut)',
  '/overlays',
  '/overlays/<i>/(kind|text|subtext|inSec|outSec|anchor|style|maxWidthPct|opacity|animation)',
  '/audio/music/(trackId|src|gainDb|duckUnderVoiceDb|beatGrid|license)',
  '/audio/voice/(mode|src|text|voiceId|enhance)',
  '/captions/(mode|style|language|words)',
  '/look/(id|label|description)',
  '/format/(id|label|targetDurationSec)',
].join('\n');

const SYSTEM_PROMPT = `You are the edit assistant for Zeniconic, a property video app. A real estate agent asks for a change in plain language; you return a small, typed edit.

Reply with ONE JSON object and nothing else:
{"reply":"one or two plain sentences","operations":[ ...RFC 6902 patch operations... ]}

Rules:
1. "operations" must be non-empty. Use add, remove or replace with a JSON Pointer path.
2. Only these paths are writable:
${ALLOWED_PATHS}
   Never touch edlVersion, id, listingId, createdAt, parentId, provenance, canvas.profile, or any unknown key.
3. A clip's "src" may only become one of the candidate "src" values in the context. When you swap a shot, set src, sourceId, inSec and outSec together to the candidate's values.
4. Keep at least one overlay with kind "price" and one with kind "disclaimer" if the current edit has them.
5. Keep format.targetDurationSec between ${MIN_TARGET_DURATION_SEC} and ${MAX_TARGET_DURATION_SEC} seconds, and keep the timeline within ${DURATION_TOLERANCE_SEC} s of that target.
6. Timestamps must stay inside a candidate shot's [in, out] window. Do not invent times.
7. Prefer the smallest edit that satisfies the request. Do not restate the whole EDL.
8. "reply" is what the agent reads before the diff. Say what changes, not how the JSON works. No markdown, no code fences.
9. If the request cannot be made safely, return the closest safe edit you can and say what you left alone. Never return an empty operations list.`;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Path comparison that survives Windows' separators and drive-letter case. */
function srcKey(value: string): string {
  const normalised = value.replace(/\\/g, '/').replace(/^\.\//, '');
  return process.platform === 'win32' ? normalised.toLowerCase() : normalised;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new ChatError(
      'E_CHAT_IO',
      `The edit could not be saved: ${messageOf(error)}`,
      { cause: error },
    );
  }
}

function versionNumber(id: string): number | null {
  const match = /^[a-z0-9][a-z0-9-]*-v([1-9][0-9]*)$/.exec(id);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Footage index
// ---------------------------------------------------------------------------

interface IndexedCandidate {
  shotId: string;
  sourceId: string;
  src: string;
  room: string;
  inSec: number;
  outSec: number;
}

function parseIndex(value: unknown): IndexedCandidate[] {
  if (!isRecord(value) || !Array.isArray(value.clips)) return [];

  const candidates: IndexedCandidate[] = [];
  for (const clip of value.clips) {
    if (!isRecord(clip)) continue;

    const sourceId = typeof clip.id === 'string' ? clip.id.trim() : '';
    const file =
      typeof clip.file === 'string' && clip.file.trim().length > 0
        ? clip.file.trim()
        : typeof clip.name === 'string'
          ? clip.name.trim()
          : '';
    if (sourceId.length === 0 || file.length === 0 || !Array.isArray(clip.shots)) continue;

    for (const shot of clip.shots) {
      if (!isRecord(shot)) continue;
      const shotId = typeof shot.id === 'string' ? shot.id.trim() : '';
      const inSec = shot.startSec;
      const outSec = shot.endSec;
      if (
        shotId.length === 0 ||
        typeof inSec !== 'number' ||
        typeof outSec !== 'number' ||
        !Number.isFinite(inSec) ||
        !Number.isFinite(outSec) ||
        outSec <= inSec
      ) {
        continue;
      }

      const tags = isRecord(shot.tags) ? shot.tags : undefined;
      const room = tags !== undefined && typeof tags.room === 'string' ? tags.room : 'unknown';
      candidates.push({ shotId, sourceId, src: file, room, inSec, outSec });
    }
  }

  return candidates.slice(0, 200);
}

/**
 * Reads the tagged index (falling back to the untagged one). A missing file is
 * not fatal: the chat still edits overlays, audio and existing clips, but the
 * source guardrail refuses any `src` it cannot prove is indexed.
 */
async function readCandidateIndex(listingDir: string): Promise<{
  candidates: IndexedCandidate[];
  warning?: string;
}> {
  const files = [
    { name: 'footage_index.tagged.json', untagged: false },
    { name: 'footage_index.json', untagged: true },
  ] as const;

  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(join(listingDir, file.name), 'utf8');
    } catch {
      continue;
    }

    try {
      const candidates = parseIndex(JSON.parse(raw));
      return {
        candidates,
        ...(file.untagged
          ? {
              warning:
                'No tagged footage index was found; shot rooms are unknown and source swaps stay restricted.',
            }
          : {}),
      };
    } catch {
      return {
        candidates: [],
        warning: `The footage index ${file.name} could not be read; swapping shots is disabled.`,
      };
    }
  }

  return {
    candidates: [],
    warning: 'No footage index was found; swapping shots is disabled.',
  };
}

// ---------------------------------------------------------------------------
// Prompt context
// ---------------------------------------------------------------------------

function buildEditContext(edl: Edl, candidates: IndexedCandidate[]): string {
  const context = {
    durationSec: durationSec(edl),
    format: { id: edl.format.id, targetDurationSec: edl.format.targetDurationSec },
    look: edl.look.id,
    audio: {
      musicTrack: edl.audio.music.trackId,
      musicGainDb: edl.audio.music.gainDb,
      voiceMode: edl.audio.voice.mode,
    },
    captions: edl.captions.mode,
    clips: edl.clips.map((item) => ({
      id: item.id,
      room: item.room ?? 'unknown',
      src: basename(item.src.replace(/\\/g, '/')),
      in: item.inSec,
      out: item.outSec,
      speed: item.speed,
    })),
    overlays: edl.overlays.map((overlay) => ({
      id: overlay.id,
      kind: overlay.kind,
      text: overlay.text === undefined ? '' : clip(overlay.text, 60),
      in: overlay.inSec,
      out: overlay.outSec,
    })),
  };

  const candidateRows = candidates.map((candidate) => ({
    id: candidate.shotId,
    source: candidate.sourceId,
    room: candidate.room,
    src: candidate.src,
    in: candidate.inSec,
    out: candidate.outSec,
  }));

  let limit = candidateRows.length;
  while (true) {
    const body = JSON.stringify({
      ...context,
      candidates: candidateRows.slice(0, limit),
    });
    if (body.length <= MAX_CONTEXT_CHARS || limit === 0) return body;
    limit = Math.max(0, limit - 10);
  }
}

// ---------------------------------------------------------------------------
// Reply evaluation and guardrails
// ---------------------------------------------------------------------------

interface GuardrailViolation {
  code: string;
  message: string;
}

function guardrails(
  before: Edl,
  after: Edl,
  candidates: readonly IndexedCandidate[],
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  // 1. A clip source may only change to a file the footage index knows about.
  //    Unchanged clips are skipped below, so an existing source that predates
  //    the index does not need to be in this set.
  const allowedSources = new Set<string>(
    candidates.map((candidate) => srcKey(candidate.src)),
  );
  const beforeById = new Map(before.clips.map((item) => [item.id, item]));

  for (const item of after.clips) {
    // A malformed replacement is reported by `validateEdl`; do not let it
    // crash the guardrail pass first.
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.src !== 'string'
    ) {
      continue;
    }
    const previous = beforeById.get(item.id);
    if (previous !== undefined && srcKey(previous.src) === srcKey(item.src)) continue;
    if (!allowedSources.has(srcKey(item.src))) {
      violations.push({
        code: 'E_CHAT_SRC',
        message: `Clip "${item.id}" would point at "${item.src}", which is not one of the indexed shots.`,
      });
    }
  }

  // 2. The last price card and the last disclaimer are not removable.
  for (const kind of REQUIRED_OVERLAY_KINDS) {
    const beforeCount = before.overlays.filter((overlay) => overlay.kind === kind).length;
    const afterCount = after.overlays.filter((overlay) => overlay.kind === kind).length;
    if (beforeCount > 0 && afterCount === 0) {
      const label = kind === 'price' ? 'price card' : 'disclaimer';
      violations.push({
        code: 'E_CHAT_OVERLAY',
        message: `The edit would remove the only ${label}.`,
      });
    }
  }

  // 3. Format bounds and the half-second timeline tolerance.
  const target = after.format.targetDurationSec;
  if (
    !Number.isFinite(target) ||
    target < MIN_TARGET_DURATION_SEC ||
    target > MAX_TARGET_DURATION_SEC
  ) {
    violations.push({
      code: 'E_CHAT_DURATION',
      message: `The target duration must stay between ${MIN_TARGET_DURATION_SEC} and ${MAX_TARGET_DURATION_SEC} seconds.`,
    });
  } else {
    const total = durationSec(after);
    if (Math.abs(total - target) > DURATION_TOLERANCE_SEC + 1e-9) {
      violations.push({
        code: 'E_CHAT_DURATION',
        message: `The timeline would run ${total.toFixed(1)}s against a ${target.toFixed(1)}s target; the allowed difference is ${DURATION_TOLERANCE_SEC}s.`,
      });
    }
  }

  return violations;
}

type EditOutcome =
  | { ok: true; edl: Edl; diff: string }
  | { ok: false; reason: string };

function describeIssues(issues: readonly { path: string; code: string; message: string }[]): string {
  if (issues.length === 0) return 'The edit could not be applied.';
  return issues
    .slice(0, 6)
    .map((issue) => `${issue.code} at ${issue.path || '/'}: ${issue.message}`)
    .join('; ');
}

function evaluateEdit(
  before: Edl,
  operations: readonly PatchOp[],
  candidates: readonly IndexedCandidate[],
): EditOutcome {
  if (operations.length === 0) {
    return { ok: false, reason: 'The edit contained no operations.' };
  }

  const applied = applyPatch(before, [...operations]);
  const after = applied.edl;

  // A failed operation leaves the original document; there is nothing to
  // guardrail until the patch itself is structurally valid.
  if (after === before) {
    return { ok: false, reason: describeIssues(applied.issues) };
  }

  const violations = guardrails(before, after, candidates);
  if (violations.length > 0) {
    return { ok: false, reason: violations.map((violation) => violation.message).join(' ') };
  }

  if (applied.issues.length > 0) {
    return { ok: false, reason: describeIssues(applied.issues) };
  }

  const diff = summariseDiff(before, after);
  if (diff === 'Nothing to change') {
    return { ok: false, reason: 'The edit does not change anything.' };
  }

  return { ok: true, edl: after, diff };
}

function repairMessage(reason: string): string {
  return `That edit was rejected: ${reason}\nReply again with one corrected JSON object only. Use the allowed paths, keep the price and disclaimer, keep the target between ${MIN_TARGET_DURATION_SEC} and ${MAX_TARGET_DURATION_SEC} seconds, and keep the timeline within ${DURATION_TOLERANCE_SEC}s of it.`;
}

function modelFailure(error: unknown): ChatError {
  if (error instanceof ChatError) return error;
  if (error instanceof AiError) {
    if (error.code === 'E_AUTH') {
      return new ChatError(
        'E_CHAT_KEY',
        'The model key was rejected. Check it in Settings and try again.',
        { cause: error },
      );
    }
    if (error.code === 'E_BUDGET') {
      return new ChatError(
        'E_CHAT_MODEL',
        'That request would exceed the model budget for this listing. Nothing was changed.',
        { cause: error },
      );
    }
    if (error.code === 'E_UNKNOWN_MODEL') {
      return new ChatError(
        'E_CHAT_MODEL',
        'The planning model is not available. Check the model setting and try again.',
        { cause: error },
      );
    }
  }
  return new ChatError(
    'E_CHAT_MODEL',
    'The assistant is unavailable right now. Nothing was changed; try again.',
    { cause: error },
  );
}

function parseEditReply(text: string): { reply: string; operations: PatchOp[] } {
  const parsed = parseJsonReply(text, REPLY_SCHEMA);
  if (!isRecord(parsed)) {
    throw new AiError('E_JSON', 'The reply is not a JSON object.');
  }

  const reply = parsed.reply;
  const operations = parsed.operations;
  if (typeof reply !== 'string' || reply.trim().length === 0) {
    throw new AiError('E_JSON', 'The reply text is empty.');
  }
  if (!Array.isArray(operations)) {
    throw new AiError('E_JSON', 'The operations list is missing.');
  }

  return { reply: reply.trim(), operations: operations as PatchOp[] };
}

// ---------------------------------------------------------------------------
// Version files
// ---------------------------------------------------------------------------

interface VersionRecord {
  id: string;
  createdAt: string;
  summary: string;
  path: string;
}

interface VersionsFile {
  version: 1;
  versions: VersionRecord[];
}

const STORED_VERSION_PATTERN = /^variants\/[a-z0-9][a-z0-9-]{0,63}\.json$/;

function manifestPath(listingDir: string, look: string): string {
  return join(listingDir, 'variants', `${look}.versions.json`);
}

function versionPath(listingDir: string, look: string, number: number): string {
  return join(listingDir, 'variants', `${look}-v${String(number)}.json`);
}

function storedVersionPath(look: string, number: number): string {
  return `variants/${look}-v${String(number)}.json`;
}

function isVersionRecord(value: unknown): value is VersionRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.path === 'string' &&
    STORED_VERSION_PATTERN.test(value.path)
  );
}

async function readVersionsFile(path: string): Promise<VersionsFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      return { version: 1, versions: [] };
    }
    throw new ChatError(
      'E_CHAT_IO',
      'The edit history could not be read. Nothing was changed.',
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ChatError(
      'E_CHAT_IO',
      'The edit history is damaged. Nothing was changed.',
      { cause: error },
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.versions)) {
    throw new ChatError('E_CHAT_IO', 'The edit history is damaged. Nothing was changed.');
  }

  return {
    version: 1,
    versions: parsed.versions.filter(isVersionRecord),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class DesktopChatService implements ChatService {
  private readonly options: ChatServiceOptions;
  private readonly model: string;
  /** Serialises read-modify-write cycles per listing/variant. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: ChatServiceOptions) {
    this.options = options;
    this.model = resolveModelId(options.model, 'nitro');
  }

  async send(request: ChatRequest): Promise<ChatResult> {
    const message = typeof request.message === 'string' ? request.message.trim() : '';
    if (message.length === 0) {
      throw new ChatError('E_CHAT_INPUT', 'Type the change you want.');
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new ChatError(
        'E_CHAT_INPUT',
        `Keep the request to ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      );
    }

    const key = await this.options.apiKey();
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new ChatError(
        'E_CHAT_KEY',
        'Add an OpenRouter key in Settings before asking the assistant to change the edit.',
      );
    }

    const listingDir = this.options.listingDir(request.listingId);
    const lockKey = `${request.listingId}/${request.variantId}`;
    return this.withLock(lockKey, () => this.run(request, listingDir, message));
  }

  private async run(
    request: ChatRequest,
    listingDir: string,
    message: string,
  ): Promise<ChatResult> {
    const variant = await this.requireVariant(listingDir, request.variantId);
    const before = await readVariantEdl(listingDir, variant.id);
    const index = await readCandidateIndex(listingDir);
    const candidates = index.candidates.slice(
      0,
      Math.max(1, this.options.maxCandidates ?? MAX_CANDIDATES),
    );

    const userContent = `Current edit:\n${buildEditContext(before, candidates)}\n\nRequest: ${message}`;
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    let lastReason = 'The assistant did not return a usable edit.';
    let retried = false;

    for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
      let text: string;
      try {
        const response = await this.options.complete({
          model: this.model,
          messages,
          jsonSchema: REPLY_SCHEMA,
          temperature: 0.2,
          maxTokens: MAX_TOKENS,
        });
        text = response.text;
      } catch (error) {
        // A JSON failure is repairable: show the schema issue once and ask the
        // model to answer again. Transport and auth failures are not.
        if (error instanceof AiError && error.code === 'E_JSON') {
          lastReason = error.message;
          messages.push({ role: 'user', content: repairMessage(lastReason) });
          retried = true;
          continue;
        }
        throw modelFailure(error);
      }

      let edit: { reply: string; operations: PatchOp[] };
      try {
        edit = parseEditReply(text);
      } catch (error) {
        if (error instanceof AiError && error.code === 'E_JSON') {
          lastReason = error.message;
          messages.push({ role: 'assistant', content: text.slice(0, MAX_REPLY_CHARS) });
          messages.push({ role: 'user', content: repairMessage(lastReason) });
          retried = true;
          continue;
        }
        throw modelFailure(error);
      }

      const outcome = evaluateEdit(before, edit.operations, candidates);
      if (!outcome.ok) {
        lastReason = outcome.reason;
        messages.push({ role: 'assistant', content: text.slice(0, MAX_REPLY_CHARS) });
        messages.push({ role: 'user', content: repairMessage(lastReason) });
        retried = true;
        continue;
      }

      const stored = await this.writeVersion({
        listingDir,
        variant,
        before,
        after: outcome.edl,
        summary: outcome.diff,
      });

      const warnings: string[] = [];
      if (index.warning !== undefined) warnings.push(index.warning);
      if (retried) warnings.push('The first reply was rejected and corrected once.');

      return {
        reply: edit.reply,
        diff: outcome.diff,
        versionId: stored.id,
        warnings,
      };
    }

    throw new ChatError(
      'E_CHAT_INVALID_EDIT',
      `That request could not be applied safely: ${lastReason} Nothing was changed.`,
    );
  }

  private async writeVersion(input: {
    listingDir: string;
    variant: VariantSummary;
    before: Edl;
    after: Edl;
    summary: string;
  }): Promise<VersionRecord> {
    const file = manifestPath(input.listingDir, input.variant.look);
    const history = await readVersionsFile(file);

    let number =
      history.versions.reduce((highest, record) => {
        const value = versionNumber(record.id);
        return value === null ? highest : Math.max(highest, value);
      }, 0) + 1;
    while (await exists(versionPath(input.listingDir, input.variant.look, number))) {
      number += 1;
    }

    const createdAt = this.options.now?.() ?? new Date().toISOString();
    const versionId = `${input.variant.look}-v${String(number)}`;
    const versionEdl: Edl = {
      ...input.after,
      id: `edl_${input.variant.look}-chat_v${String(number)}`,
      parentId: input.before.id,
      createdAt,
    };

    const check = validateEdl(versionEdl);
    if (!check.valid) {
      throw new ChatError(
        'E_CHAT_INVALID_EDIT',
        `That request could not be applied safely: ${describeIssues(check.issues)} Nothing was changed.`,
      );
    }

    await writeJsonAtomic(versionPath(input.listingDir, input.variant.look, number), versionEdl);

    const record: VersionRecord = {
      id: versionId,
      createdAt,
      summary: input.summary,
      path: storedVersionPath(input.variant.look, number),
    };
    await writeJsonAtomic(file, {
      version: 1,
      versions: [...history.versions, record],
    } satisfies VersionsFile);

    return record;
  }

  async apply(input: {
    listingId: string;
    variantId: string;
    versionId: string;
  }): Promise<{ ok: boolean }> {
    const listingDir = this.options.listingDir(input.listingId);
    const lockKey = `${input.listingId}/${input.variantId}`;

    return this.withLock(lockKey, async () => {
      if (!/^[a-z0-9][a-z0-9-]*-v[1-9][0-9]*$/.test(input.versionId)) {
        throw new ChatError('E_CHAT_NOT_FOUND', 'That version is not available.');
      }

      const variant = await this.requireVariant(listingDir, input.variantId);
      const history = await readVersionsFile(manifestPath(listingDir, variant.look));
      const record = history.versions.find((item) => item.id === input.versionId);
      const number = versionNumber(input.versionId);
      if (
        record === undefined ||
        number === null ||
        !input.versionId.startsWith(`${variant.look}-v`) ||
        record.path !== storedVersionPath(variant.look, number)
      ) {
        throw new ChatError(
          'E_CHAT_NOT_FOUND',
          'That version no longer exists. Ask for the change again.',
        );
      }

      // Read and validate before making it current: a corrupt version must not
      // become what the next export renders.
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(join(listingDir, record.path), 'utf8'));
      } catch (error) {
        throw new ChatError(
          'E_CHAT_IO',
          'That edit file is missing. Ask for the change again.',
          { cause: error },
        );
      }
      const check = validateEdl(parsed);
      if (!check.valid) {
        throw new ChatError(
          'E_CHAT_IO',
          `That edit is not valid (${describeIssues(check.issues)}). Nothing was changed.`,
        );
      }

      try {
        await setVariantEdlPath(listingDir, variant.id, record.path);
      } catch (error) {
        throw new ChatError('E_CHAT_IO', messageOf(error), { cause: error });
      }

      return { ok: true };
    });
  }

  async versions(
    listingId: string,
    variantId: string,
  ): Promise<Array<{ id: string; createdAt: string; summary: string }>> {
    const listingDir = this.options.listingDir(listingId);
    const variant = await this.requireVariant(listingDir, variantId);
    const history = await readVersionsFile(manifestPath(listingDir, variant.look));

    // Newest first. A stable numeric tie-break keeps the order meaningful when
    // an injected clock returns the same instant twice.
    return [...history.versions]
      .sort((left, right) => {
        const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        if (Number.isFinite(byTime) && byTime !== 0) return byTime;
        return (versionNumber(right.id) ?? 0) - (versionNumber(left.id) ?? 0);
      })
      .map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        summary: record.summary,
      }));
  }

  private async requireVariant(
    listingDir: string,
    variantId: string,
  ): Promise<VariantSummary> {
    const variants = await readVariants(listingDir);
    const found = variants.find(
      (variant) => variant.id === variantId || variant.look === variantId,
    );
    if (found === undefined) {
      throw new ChatError(
        'E_CHAT_NOT_FOUND',
        `The variant "${variantId}" was not found.`,
      );
    }
    return found;
  }

  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const guard = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, guard);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === guard) this.locks.delete(key);
    }
  }
}

export function createChatService(options: ChatServiceOptions): ChatService {
  if (typeof options.model !== 'string' || options.model.trim().length === 0) {
    throw new RangeError('The chat service needs a planning model.');
  }
  return new DesktopChatService(options);
}
