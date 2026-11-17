/**
 * The IPC handlers, with Electron deliberately absent.
 *
 * Everything here can be unit-tested with a fake store, runner, pipeline and
 * settings port. `apps/desktop/main.ts` only adapts these to `ipcMain`.
 *
 * Validation policy: a renderer is treated as compromised. Ids must match the
 * store's anchored pattern, the folder must be an existing directory with at
 * least one video file, enums are checked against fixed lists, and `facts` is
 * rebuilt from known keys so unknown fields never reach the store.
 */

import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import type { JobRecord } from '@zeniconic/jobs';
import { isValidListingId } from '@zeniconic/store';
import type { Facts, ListingRecord, Store } from '@zeniconic/store';
import { PROFILES } from '@zeniconic/render';
import { VOICE_CATALOG, isVoiceId } from '../../../services/voice/src/voices';
import { REMIX_ROOMS, isRemixRoom } from '../../../services/remix/src/rooms';
import type {
  AgentRunResponse,
  CaptionMode,
  Channel,
  ChatApplyRequest,
  ChatApplyResult,
  ChatResult,
  ChatSendRequest,
  ChatVersion,
  ExportQuality,
  ExportResult,
  Handlers,
  IpcContract,
  KeyStatus,
  ReferenceProfileDto,
  RemixPreset,
  RemixStoryboardDto,
  RenderInspectionDto,
  MusicGenerationDto,
  RefinePreviewDto,
  SettingsSnapshot,
  ShotRow,
  TaggingEstimateDto,
  TaggingRunDto,
  Theme,
  VariantPreview,
  VariantSummary,
  VoiceMode,
  VoiceModelStatus,
  VoiceOption,
} from './contract';

/** Minimal surface of `JsonStore`; a fake satisfies it in tests. */
export type StorePort = Pick<Store, 'list' | 'get' | 'create' | 'update'>;

/** Minimal surface of `JobRunner`; both the real runner and fakes satisfy it. */
export interface RunnerPort {
  enqueue(
    listingId: string,
    options?: { kind?: 'analysis' | 'export' | 'agent'; checkpoint?: string },
  ): JobRecord;
  run(jobId: string): Promise<JobRecord>;
  list(): JobRecord[];
  /** Persist where a resumable job can find its source. */
  setCheckpoint?(jobId: string, checkpoint: string): Promise<JobRecord>;
  /** Abort a job that never started (e.g. failed validation after enqueue). */
  cancel?(jobId: string): void;
}

/**
 * The pipeline port. The desktop adapter owns analysis, planning and rendering;
 * the handlers only validate and delegate.
 */
export interface PipelinePort {
  /**
   * Binds the folder the user chose to the job the runner is about to start.
   * Called before `runner.run`, so the stage executor can find the footage.
   */
  prepareAnalysis(input: { jobId: string; listingId: string; folder: string }): void;
  /** Reads the persisted variants for a listing; `[]` before analysis. */
  listVariants(listingId: string): Promise<VariantSummary[]>;
  /** Reads the persisted shot index; `[]` before analysis. */
  listShots(listingId: string): Promise<ShotRow[]>;
  /** Sets one variant's approval bit without touching its EDL. */
  approveVariant(input: {
    listingId: string;
    variantId: string;
    approved: boolean;
  }): Promise<VariantSummary>;
  /** Renders one 1080-wide still for the variant's hook shot. */
  previewVariant(input: { listingId: string; variantId: string }): Promise<VariantPreview>;
  /** Renders every approved variant for every profile. */
  exportListing(input: {
    listing: ListingRecord;
    profiles: string[];
    quality: ExportQuality;
    captions: CaptionMode;
    voice: VoiceMode;
  }): Promise<ExportResult>;
}

export interface SettingsPortLike {
  get(): Promise<SettingsSnapshot>;
  setTheme(theme: Theme): Promise<void>;
  setKey(key: string): Promise<void>;
  keyStatus(): Promise<KeyStatus>;
  setVoice(voiceId: string): Promise<void>;
  setTagging?(enabled: boolean): Promise<void>;
}

/** Vision tagging on the persisted index. */
export interface TaggingPort {
  estimate(listingId: string): Promise<TaggingEstimateDto>;
  start(listingId: string): Promise<TaggingRunDto>;
}

/** Reference-video analysis and its persisted profile. */
export interface ReferencePort {
  chooseFile(): Promise<string | null>;
  analyze(listingId: string, file: string): Promise<ReferenceProfileDto>;
  get(listingId: string): Promise<ReferenceProfileDto | null>;
  clear(listingId: string): Promise<void>;
}

/** Remix analysis, manual editing and variant creation. */
export interface RemixPort {
  chooseFile(): Promise<string | null>;
  analyze(listingId: string, file: string, transcribe?: boolean): Promise<RemixStoryboardDto>;
  get(listingId: string): Promise<RemixStoryboardDto | null>;
  create(listingId: string, preset: RemixPreset): Promise<VariantSummary>;
  reorder(
    listingId: string,
    preset: RemixPreset,
    order: string[],
  ): Promise<RemixStoryboardDto>;
  retag(listingId: string, shotId: string, room: string): Promise<RemixStoryboardDto>;
}

/** Multimodal inspection of a finished export. */
export interface ReviewPort {
  inspect(input: {
    file: string;
    facts?: Record<string, string | number | undefined>;
  }): Promise<RenderInspectionDto>;
}

/** Music-bed generation (Lyria via OpenRouter). */
export interface MusicPort {
  generate(prompt: string): Promise<MusicGenerationDto>;
}

/**
 * The refine-assistant port. The desktop adapter owns the model call and the
 * EDL versions; the handlers only validate input and translate failures.
 */
export interface ChatPort {
  send(input: ChatSendRequest): Promise<ChatResult>;
  apply(input: ChatApplyRequest): Promise<ChatApplyResult>;
  versions(listingId: string, variantId: string): Promise<ChatVersion[]>;
}

/** The editing agent port; the desktop adapter owns the model and commit. */
export interface AgentPort {
  run(input: {
    listingId: string;
    variantId: string;
    message: string;
    autonomy?: 'suggest' | 'ask' | 'auto';
  }): Promise<AgentRunResponse & { previewPath?: string }>;
  /** Resolve a pending approval; false when the run is unknown. */
  approve(runId: string, approved: boolean): boolean;
}

/** Draft playback for the Refine stage; the desktop host owns the renderer. */
export interface RefinePreviewPort {
  preview(input: { listingId: string; variantId: string }): Promise<{
    path?: string;
    warning?: string;
  }>;
}

/** Read-only spend source for `settings:get`. */
export interface SpendPort {
  summary(): Promise<{ monthUsd: number }>;
}

export interface HandlerDeps {
  store: StorePort;
  runner: RunnerPort;
  pipeline: PipelinePort;
  settings: SettingsPortLike;
  /** Refine assistant; absent in builds that ship without a model key. */
  chat?: ChatPort;
  /** Agentic editor; absent in builds that ship without a model key. */
  agent?: AgentPort;
  /** Native folder picker, injected by Electron; absent in tests. */
  chooseFolder?: () => Promise<string | null>;
  /** Absolute store root; `shell:openPath` refuses anything outside it. */
  dataDir?: string;
  /** Electron's `shell.openPath`; resolves to an error string, or '' on success. */
  openPath?: (path: string) => Promise<string>;
  /** Voice-model installer; absent in tests. */
  voiceModel?: VoiceModelPort;
  /** Bundled studio voice samples; absent returns metadata with no previews. */
  voiceGallery?: VoiceGalleryPort;
  /** Persisted cost ledger; absent means the snapshot reports 0. */
  spend?: SpendPort;
  /** Vision tagging; absent disables estimate/start in this build. */
  tagging?: TaggingPort;
  /** Reference-video analysis; absent disables the reference card. */
  reference?: ReferencePort;
  /** Remix analysis; absent disables the Remix screen. */
  remix?: RemixPort;
  /** Render inspection; absent hides the Inspect control. */
  review?: ReviewPort;
  /** Music generation; absent hides the Generate control. */
  music?: MusicPort;
  /** Draft playback for Refine; absent leaves the stage mock only. */
  refinePreview?: RefinePreviewPort;
}

/**
 * The gallery adapter. The desktop main process resolves bundled sample ids to
 * `data:` URLs; the handler validates every field before it reaches the
 * renderer, so this port can never hand over a path.
 */
export interface VoiceGalleryPort {
  list(): Promise<VoiceOption[]>;
}

/**
 * The voice-model installer. The desktop adapter owns the network and disk; the
 * handlers only expose it and translate failures.
 */
export interface VoiceModelPort {
  status(): Promise<VoiceModelStatus>;
  /** Starts or resumes; resolves once the attempt is running, not when it ends. */
  start(): Promise<VoiceModelStatus>;
  /** Pauses; the engine keeps a `.part` file that the next start resumes. */
  cancel(): Promise<VoiceModelStatus>;
}

export type IpcErrorCode =
  | 'E_INVALID_INPUT'
  | 'E_NOT_FOUND'
  | 'E_PIPELINE'
  | 'E_CHAT'
  | 'E_VOICE'
  | 'E_VOICE_MODEL';

/** Stable codes for logs and QA; the renderer shows `message`. */
export class IpcError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IpcError';
    this.code = code;
  }
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mts',
  '.mkv',
  '.avi',
  '.webm',
]);

const THEMES: readonly Theme[] = ['light', 'dark'];
const QUALITIES: readonly ExportQuality[] = ['draft', 'standard', 'high'];
const CAPTION_MODES: readonly CaptionMode[] = ['off', 'burned', 'srt', 'both'];
const VOICE_MODES: readonly VoiceMode[] = ['restore', 'ai', 'music'];
const PROFILE_IDS = new Set<string>(Object.keys(PROFILES) satisfies string[]);
const MAX_ADDRESS_LENGTH = 200;
const MAX_PRICE_LENGTH = 40;
const MAX_ROOMS = 100;
const MAX_SQFT = 1_000_000;
const MAX_PROFILES = 4;
const MAX_VARIANT_ID_LENGTH = 64;
const MAX_VERSION_ID_LENGTH = 80;
const MAX_CHAT_MESSAGE_LENGTH = 2_000;

/**
 * A draft preview is served by the `zeniconic-media` scheme from the app's
 * previews folder. The renderer only ever sees the bare file name.
 */
export function previewUrlFor(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 260) return undefined;
  const name = basename(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/i.test(name)) return undefined;
  return `zeniconic-media://preview/${encodeURIComponent(name)}`;
}
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 512;

const FACT_KEYS = ['address', 'price', 'beds', 'baths', 'sqft', 'currency', 'confirmedAt'] as const;
const CURRENCIES: readonly Facts['currency'][] = ['AED', 'GBP', 'USD', 'EUR'];

/** A saved chat version id shares the variant slug grammar (`calm-v3`). */
const VERSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): IpcError {
  return new IpcError('E_INVALID_INPUT', message);
}

function notFound(id: string): IpcError {
  return new IpcError('E_NOT_FOUND', `Listing "${id}" was not found.`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${label} must be an object.`);
  return value;
}

/** Rejects traversal and malformed ids before any path is built. */
function requireListingId(value: unknown): string {
  if (typeof value !== 'string' || !isValidListingId(value)) {
    throw invalid('A listing id must look like YYYY-MM-DD-<lowercase-slug>.');
  }
  return value;
}

function requireAddress(value: unknown): string {
  if (typeof value !== 'string') throw invalid('An address is required.');
  const address = value.trim();
  if (address.length === 0) throw invalid('An address is required.');
  if (address.length > MAX_ADDRESS_LENGTH) {
    throw invalid(`An address must be ${MAX_ADDRESS_LENGTH} characters or fewer.`);
  }
  // Newlines and NULs have no place in a folder name or a listing card.
  if (/[\u0000-\u001f\u007f]/.test(address)) {
    throw invalid('An address must not contain control characters.');
  }
  return address;
}

function requireTheme(value: unknown): Theme {
  if (typeof value !== 'string' || !(THEMES as readonly string[]).includes(value)) {
    throw invalid('Theme must be "light" or "dark".');
  }
  return value as Theme;
}

function requireQuality(value: unknown): ExportQuality {
  if (typeof value !== 'string' || !(QUALITIES as readonly string[]).includes(value)) {
    throw invalid('Quality must be draft, standard or high.');
  }
  return value as ExportQuality;
}

function requireProfile(value: unknown): string {
  if (typeof value !== 'string' || !PROFILE_IDS.has(value)) {
    throw invalid(`Unknown render profile "${String(value)}".`);
  }
  return value;
}

function requireProfiles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid('Choose at least one output shape.');
  }
  if (value.length > MAX_PROFILES) {
    throw invalid(`At most ${MAX_PROFILES} output shapes can be exported at once.`);
  }

  const profiles: string[] = [];
  for (const item of value) {
    const profile = requireProfile(item);
    if (!profiles.includes(profile)) profiles.push(profile);
  }
  return profiles;
}

function requireCaptionMode(value: unknown): CaptionMode {
  if (typeof value !== 'string' || !(CAPTION_MODES as readonly string[]).includes(value)) {
    throw invalid('Captions must be off, burned, srt or both.');
  }
  return value as CaptionMode;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`${label} must be true or false.`);
  return value;
}

const REMIX_PRESETS: readonly RemixPreset[] = ['marketing', 'original', 'price_led'];
const MAX_REMIX_SLOTS = 200;
const SHOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

function requireRemixPreset(value: unknown): RemixPreset {
  if (typeof value !== 'string' || !(REMIX_PRESETS as readonly string[]).includes(value)) {
    throw invalid('Choose a remix preset.');
  }
  return value as RemixPreset;
}

function requireShotId(value: unknown): string {
  if (typeof value !== 'string' || !SHOT_ID_PATTERN.test(value)) {
    throw invalid('That scene id is not valid.');
  }
  return value;
}

/** A slot order must name every slot exactly once; the remix service enforces the set. */
function requireRemixOrder(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid('A slot order needs at least one scene.');
  }
  if (value.length > MAX_REMIX_SLOTS) {
    throw invalid(`At most ${MAX_REMIX_SLOTS} scenes can be ordered.`);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const shotId = requireShotId(item);
    if (seen.has(shotId)) throw invalid(`Scene "${shotId}" appears twice in the order.`);
    seen.add(shotId);
    order.push(shotId);
  }
  return order;
}

function requireRemixRoom(value: unknown): string {
  if (!isRemixRoom(value)) {
    throw invalid(`Choose a room: ${REMIX_ROOMS.join(', ')}.`);
  }
  return value;
}

function requireVoiceMode(value: unknown): VoiceMode {
  if (typeof value !== 'string' || !(VOICE_MODES as readonly string[]).includes(value)) {
    throw invalid('Voice must be restore, ai or music.');
  }
  return value as VoiceMode;
}

function requireAutonomy(value: unknown): 'suggest' | 'ask' | 'auto' {
  if (value !== 'suggest' && value !== 'ask' && value !== 'auto') {
    throw invalid('Autonomy must be suggest, ask or auto.');
  }
  return value;
}

function requireVoiceId(value: unknown): string {
  if (!isVoiceId(value)) {
    throw invalid('Choose a voice from the gallery.');
  }
  return value;
}

/** Never let a port hand a path (or a non-audio URL) to the renderer. */
function sanitiseVoiceOption(value: unknown): VoiceOption | null {
  if (!isRecord(value) || !isVoiceId(value.id)) return null;
  const known = VOICE_CATALOG.find((voice) => voice.id === value.id);
  if (known === undefined) return null;

  const sampleUrl =
    typeof value.sampleUrl === 'string' &&
    /^data:audio\/mpeg;base64,[A-Za-z0-9+/]+=*$/.test(value.sampleUrl)
      ? value.sampleUrl
      : undefined;

  return {
    id: known.id,
    name: known.name,
    accent: known.accent,
    tone: [...known.tone],
    gender: known.gender,
    sampleId: known.id,
    ...(sampleUrl === undefined ? {} : { sampleUrl }),
    ...(typeof value.bytes === 'number' && Number.isFinite(value.bytes) && value.bytes > 0
      ? { bytes: value.bytes }
      : {}),
  };
}

/** The metadata-only fallback when the build ships no samples. */
function voiceCatalogue(): VoiceOption[] {
  return VOICE_CATALOG.map((voice) => ({
    id: voice.id,
    name: voice.name,
    accent: voice.accent,
    tone: [...voice.tone],
    gender: voice.gender,
    sampleId: voice.id,
  }));
}

function requireVariantId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_VARIANT_ID_LENGTH ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value)
  ) {
    throw invalid('A variant id must be a short lowercase slug.');
  }
  return value;
}

/** A saved chat version id shares the variant slug grammar (`calm-v3`). */
function requireVersionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_VERSION_ID_LENGTH ||
    !VERSION_ID_PATTERN.test(value)
  ) {
    throw invalid('A version id must be a short lowercase slug.');
  }
  return value;
}

/**
 * A chat message is one short paragraph. Newlines and tabs are allowed; NULs
 * and the rest of the C0 set are not, because they have no place in a prompt or
 * a log line.
 */
function requireChatMessage(value: unknown): string {
  if (typeof value !== 'string') throw invalid('Type the change you want.');
  const message = value.trim();
  if (message.length === 0) throw invalid('Type the change you want.');
  if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw invalid(`Keep the request to ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) {
    throw invalid('The request must not contain control characters.');
  }
  return message;
}

/**
 * The key is opaque to us, but it must never carry newlines or control
 * characters into a file or a log line. It is deliberately not trimmed to a
 * loggable value: nothing here includes the key in an error.
 */
function requireApiKey(value: unknown): string {
  if (typeof value !== 'string') throw invalid('A model key is required.');
  const key = value.trim();
  if (key.length < MIN_KEY_LENGTH) throw invalid('That model key looks too short.');
  if (key.length > MAX_KEY_LENGTH) throw invalid('That model key looks too long.');
  if (/[\u0000-\u0020\u007f]/.test(key)) {
    throw invalid('A model key must not contain spaces or control characters.');
  }
  return key;
}

function optionalString(patch: Record<string, unknown>, key: string): string | undefined {
  const value = patch[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalid(`facts.${key} must be a string.`);
  return value;
}

function optionalNumber(patch: Record<string, unknown>, key: string): number | undefined {
  const value = patch[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid(`facts.${key} must be a non-negative number.`);
  }
  return value;
}

/** A price is a display string ("AED 1,850,000", "£850,000"), never free text. */
function optionalPrice(patch: Record<string, unknown>): string | undefined {
  const value = patch.price;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalid('facts.price must be a string.');

  const price = value.trim();
  if (price.length === 0) throw invalid('facts.price cannot be empty.');
  if (price.length > MAX_PRICE_LENGTH) {
    throw invalid(`facts.price must be ${MAX_PRICE_LENGTH} characters or fewer.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(price)) {
    throw invalid('facts.price must not contain control characters.');
  }
  if (!/\d/.test(price)) throw invalid('facts.price must contain a number.');
  return price;
}

/** Beds and baths are whole rooms; a fractional value is a typo, not data. */
function optionalRooms(patch: Record<string, unknown>, key: 'beds' | 'baths'): number | undefined {
  const value = optionalNumber(patch, key);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw invalid(`facts.${key} must be a whole number.`);
  if (value > MAX_ROOMS) throw invalid(`facts.${key} must be ${MAX_ROOMS} or fewer.`);
  return value;
}

function optionalSqft(patch: Record<string, unknown>): number | undefined {
  const value = optionalNumber(patch, 'sqft');
  if (value === undefined) return undefined;
  if (value > MAX_SQFT) throw invalid(`facts.sqft must be ${MAX_SQFT} or fewer.`);
  return value;
}

function optionalCurrency(patch: Record<string, unknown>): Facts['currency'] | undefined {
  const value = patch.currency;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(CURRENCIES as readonly string[]).includes(value)) {
    throw invalid('facts.currency must be AED, GBP, USD or EUR.');
  }
  return value as Facts['currency'];
}

/**
 * Rebuilds a facts patch from known keys only. Unknown keys are rejected
 * outright, so a renderer cannot smuggle arbitrary JSON into a listing.
 */
function sanitiseFacts(value: unknown): Partial<Facts> | undefined {
  if (value === undefined) return undefined;
  const patch = requireObject(value, 'facts');

  for (const key of Object.keys(patch)) {
    if (!(FACT_KEYS as readonly string[]).includes(key)) {
      throw invalid(`Unknown fact "${key}".`);
    }
  }

  const facts: Partial<Facts> = {};

  const address = optionalString(patch, 'address');
  if (address !== undefined) facts.address = requireAddress(address);

  const price = optionalPrice(patch);
  if (price !== undefined) facts.price = price;

  const beds = optionalRooms(patch, 'beds');
  if (beds !== undefined) facts.beds = beds;

  const baths = optionalRooms(patch, 'baths');
  if (baths !== undefined) facts.baths = baths;

  const sqft = optionalSqft(patch);
  if (sqft !== undefined) facts.sqft = sqft;

  const currency = optionalCurrency(patch);
  if (currency !== undefined) facts.currency = currency;

  if (patch.confirmedAt !== undefined) {
    if (
      typeof patch.confirmedAt !== 'string' ||
      Number.isNaN(Date.parse(patch.confirmedAt))
    ) {
      throw invalid('facts.confirmedAt must be an ISO timestamp.');
    }
    facts.confirmedAt = patch.confirmedAt;
  }

  return facts;
}

/**
 * The folder picker hands us a path; the renderer can hand us anything. A
 * directory with one video is the only shape the analysis stage understands,
 * so reject early with a sentence a person can act on.
 */
async function requireVideoFolder(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid('Choose a folder with your footage.');
  }

  const folder = resolve(value);

  let info;
  try {
    info = await stat(folder);
  } catch {
    throw invalid(`The folder "${folder}" does not exist.`);
  }
  if (!info.isDirectory()) {
    throw invalid(`"${folder}" is a file, not a folder.`);
  }

  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    throw invalid(`The folder "${folder}" could not be read: ${messageOf(error)}`);
  }

  const hasVideo = entries.some(
    (entry) => entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()),
  );
  if (!hasVideo) {
    throw invalid(`There are no video files in "${folder}".`);
  }

  return folder;
}

async function requireListing(store: StorePort, id: string): Promise<ListingRecord> {
  const listing = await store.get(id);
  if (listing === undefined) throw notFound(id);
  return listing;
}

/**
 * A failing model call must reach the renderer as one sentence, not a stack.
 * Input validation has already happened, so anything thrown here is the chat
 * service's own typed failure.
 */
async function viaChat<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof IpcError) throw error;
    throw new IpcError('E_CHAT', messageOf(error), { cause: error });
  }
}

/** Never let a port hand an absolute path to the renderer. */
function sanitiseReferenceProfile(value: unknown): ReferenceProfileDto {
  if (!isRecord(value) || typeof value.analyzedAt !== 'string' || typeof value.fileName !== 'string') {
    throw new IpcError('E_PIPELINE', 'The reference analysis returned no profile.');
  }
  const profile = isRecord(value.profile) ? value.profile : {};
  const text = (key: string): string | undefined =>
    typeof profile[key] === 'string' ? (profile[key] as string).slice(0, 80) : undefined;
  const palette = Array.isArray(profile.palette)
    ? profile.palette
        .filter((colour): colour is string => typeof colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(colour))
        .slice(0, 6)
    : undefined;
  const style = isRecord(profile.style)
    ? Object.fromEntries(
        Object.entries(profile.style)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .slice(0, 12)
          .map(([key, value]) => [key, value.slice(0, 120)]),
      )
    : undefined;

  return {
    analyzedAt: value.analyzedAt.slice(0, 40),
    fileName: value.fileName.slice(0, 120),
    profile: {
      ...(text('pacing') === undefined ? {} : { pacing: text('pacing') }),
      ...(text('aspect') === undefined ? {} : { aspect: text('aspect') }),
      ...(text('motion') === undefined ? {} : { motion: text('motion') }),
      ...(typeof profile.averageShotSec === 'number' && Number.isFinite(profile.averageShotSec)
        ? { averageShotSec: profile.averageShotSec }
        : {}),
      ...(typeof profile.cutDensityPerMin === 'number' && Number.isFinite(profile.cutDensityPerMin)
        ? { cutDensityPerMin: profile.cutDensityPerMin }
        : {}),
      ...(typeof profile.confidence === 'number' && Number.isFinite(profile.confidence)
        ? { confidence: profile.confidence }
        : {}),
      ...(palette === undefined ? {} : { palette }),
      ...(style === undefined ? {} : { style }),
    },
  };
}

function requireChat(chat: ChatPort | undefined): ChatPort {
  if (chat === undefined) {
    throw new IpcError('E_PIPELINE', 'The editing assistant is not available in this build.');
  }
  return chat;
}

/**
 * `shell:openPath` must never be a general-purpose "run this path" primitive.
 * The renderer may only reveal folders inside the store root it already owns.
 */
function requireDataPath(value: unknown, root: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid('A folder path is required.');
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid('A folder path must not contain control characters.');
  }

  const dataDir = resolve(root);
  const target = resolve(value);
  const comparableRoot = process.platform === 'win32' ? dataDir.toLowerCase() : dataDir;
  const comparableTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  if (
    comparableTarget !== comparableRoot &&
    !comparableTarget.startsWith(`${comparableRoot}${sep}`)
  ) {
    throw invalid('Only folders inside the app data folder can be opened.');
  }
  return target;
}

/**
 * Builds the handler table. No Electron import, no window, no globals: the
 * same object runs in `ipcMain` and in a Vitest process.
 */
export function createHandlers(deps: HandlerDeps): Handlers {
  const { store, runner, pipeline, settings, chat, agent, chooseFolder, dataDir, openPath, voiceModel, voiceGallery, spend, tagging, reference, remix, review, music, refinePreview } = deps;

  const handlers: Handlers = {
    'listings:list': async (): Promise<ListingRecord[]> => store.list(),

    'listings:create': async (input): Promise<ListingRecord> => {
      const raw = requireObject(input, 'input');
      const address = requireAddress(raw.address);
      const facts = sanitiseFacts(raw.facts);
      return store.create(facts === undefined ? { address } : { address, facts });
    },

    'listings:get': async (id): Promise<ListingRecord | undefined> => {
      return store.get(requireListingId(id));
    },

    'listings:updateFacts': async (input): Promise<ListingRecord> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      if (raw.facts === undefined) throw invalid('facts must be an object.');

      const facts = sanitiseFacts(raw.facts);
      if (facts === undefined || Object.keys(facts).length === 0) {
        throw invalid('Add at least one fact to save.');
      }

      // Check first so a typo returns the not-found message rather than a
      // store error from inside the write lock. The patch is completed against
      // the current facts because the store's record type holds a full Facts.
      const listing = await requireListing(store, listingId);
      return store.update(listingId, { facts: { ...listing.facts, ...facts } });
    },

    'analysis:chooseFolder': async (): Promise<string | null> => {
      if (chooseFolder === undefined) return null;
      const picked = await chooseFolder();
      if (picked === null) return null;
      if (typeof picked !== 'string' || picked.trim().length === 0) return null;
      return resolve(picked);
    },

    'dialog:chooseReference': async (): Promise<string | null> => {
      if (reference === undefined) return null;
      const picked = await reference.chooseFile();
      if (picked === null) return null;
      if (typeof picked !== 'string' || picked.trim().length === 0) return null;
      return resolve(picked);
    },

    'reference:analyze': async (input): Promise<ReferenceProfileDto> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      if (typeof raw.path !== 'string' || raw.path.trim().length === 0) {
        throw invalid('Choose a reference video first.');
      }
      const file = raw.path.trim();
      if (/[\u0000-\u001f\u007f]/.test(file) || /^https?:/i.test(file)) {
        throw invalid('A reference must be a local video file.');
      }
      if (!VIDEO_EXTENSIONS.has(extname(file).toLowerCase())) {
        throw invalid('That file is not a video.');
      }
      await requireListing(store, listingId);
      if (reference === undefined) {
        throw new IpcError('E_PIPELINE', 'Reference analysis is not available in this build.');
      }
      const profile = await reference.analyze(listingId, resolve(file));
      return sanitiseReferenceProfile(profile);
    },

    'reference:get': async (listingId): Promise<ReferenceProfileDto | null> => {
      const id = requireListingId(listingId);
      await requireListing(store, id);
      if (reference === undefined) return null;
      const profile = await reference.get(id);
      return profile === null ? null : sanitiseReferenceProfile(profile);
    },

    'reference:clear': async (listingId): Promise<void> => {
      const id = requireListingId(listingId);
      await requireListing(store, id);
      if (reference === undefined) return;
      await reference.clear(id);
    },

    'dialog:chooseRemix': async (): Promise<string | null> => {
      if (remix === undefined) return null;
      const picked = await remix.chooseFile();
      if (picked === null) return null;
      return typeof picked === 'string' && picked.trim().length > 0 ? resolve(picked) : null;
    },

    'remix:analyze': async (input): Promise<RemixStoryboardDto> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      if (typeof raw.file !== 'string' || raw.file.trim().length === 0) {
        throw invalid('Choose a finished video first.');
      }
      const file = raw.file.trim();
      if (/[\u0000-\u001f\u007f]/.test(file) || /^https?:/i.test(file)) {
        throw invalid('A remix source must be a local video file.');
      }
      if (!VIDEO_EXTENSIONS.has(extname(file).toLowerCase())) {
        throw invalid('That file is not a video.');
      }
      const transcribe = raw.transcribe === undefined ? undefined : requireBoolean(raw.transcribe, 'transcribe');
      await requireListing(store, listingId);
      if (remix === undefined) {
        throw new IpcError('E_PIPELINE', 'Remix is not available in this build.');
      }
      const storyboard = await remix.analyze(listingId, resolve(file), transcribe);
      if (!isRecord(storyboard) || !Array.isArray(storyboard.shots) || !isRecord(storyboard.presets)) {
        throw new IpcError('E_PIPELINE', 'The remix analysis returned no storyboard.');
      }
      return storyboard;
    },

    'remix:get': async (listingId): Promise<RemixStoryboardDto | null> => {
      const id = requireListingId(listingId);
      await requireListing(store, id);
      if (remix === undefined) return null;
      return remix.get(id);
    },

    'remix:create': async (input): Promise<VariantSummary> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const preset = raw.preset;
      if (preset !== 'marketing' && preset !== 'original' && preset !== 'price_led') {
        throw invalid('Choose a remix preset.');
      }
      await requireListing(store, listingId);
      if (remix === undefined) {
        throw new IpcError('E_PIPELINE', 'Remix is not available in this build.');
      }
      return remix.create(listingId, preset);
    },

    'remix:reorder': async (input): Promise<RemixStoryboardDto> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const preset = requireRemixPreset(raw.preset);
      const order = requireRemixOrder(raw.order);
      await requireListing(store, listingId);
      if (remix === undefined) {
        throw new IpcError('E_PIPELINE', 'Remix is not available in this build.');
      }
      const storyboard = await remix.reorder(listingId, preset, order);
      if (!isRecord(storyboard) || !Array.isArray(storyboard.shots)) {
        throw new IpcError('E_PIPELINE', 'The reordered storyboard could not be read.');
      }
      return storyboard;
    },

    'remix:retag': async (input): Promise<RemixStoryboardDto> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const shotId = requireShotId(raw.shotId);
      const room = requireRemixRoom(raw.room);
      await requireListing(store, listingId);
      if (remix === undefined) {
        throw new IpcError('E_PIPELINE', 'Remix is not available in this build.');
      }
      const storyboard = await remix.retag(listingId, shotId, room);
      if (!isRecord(storyboard) || !isRecord(storyboard.presets)) {
        throw new IpcError('E_PIPELINE', 'The tagged storyboard could not be read.');
      }
      return storyboard;
    },

    'review:inspect': async (input): Promise<RenderInspectionDto> => {
      const raw = requireObject(input, 'input');
      if (dataDir === undefined) {
        throw new IpcError('E_PIPELINE', 'Render inspection is not available in this build.');
      }
      const file = requireDataPath(raw.file, dataDir);
      if (extname(file).toLowerCase() !== '.mp4') {
        throw invalid('Only exported .mp4 files can be inspected.');
      }
      if (review === undefined) {
        throw new IpcError('E_PIPELINE', 'Render inspection is not available in this build.');
      }

      let facts: Record<string, string | number | undefined> | undefined;
      if (raw.facts !== undefined) {
        const patch = requireObject(raw.facts, 'facts');
        facts = {};
        for (const [key, value] of Object.entries(patch).slice(0, 20)) {
          if (typeof value === 'string' || typeof value === 'number') facts[key.slice(0, 40)] = value;
        }
      }

      const result = await review.inspect({ file, ...(facts === undefined ? {} : { facts }) });
      if (!isRecord(result) || !Array.isArray(result.issues)) {
        throw new IpcError('E_PIPELINE', 'The inspection returned no result.');
      }
      return {
        verdict: result.verdict === 'pass' || result.verdict === 'fail' ? result.verdict : 'retry',
        score: typeof result.score === 'number' && Number.isFinite(result.score) ? Math.min(1, Math.max(0, result.score)) : 0,
        summary: typeof result.summary === 'string' ? result.summary.slice(0, 400) : '',
        issues: result.issues
          .filter(
            (issue): issue is RenderInspectionDto['issues'][number] =>
              isRecord(issue) &&
              typeof issue.issue === 'string' &&
              (issue.severity === 'low' || issue.severity === 'medium' || issue.severity === 'high') &&
              typeof issue.atSec === 'number' &&
              typeof issue.detail === 'string',
          )
          .slice(0, 12)
          .map((issue) => ({
            issue: issue.issue.slice(0, 120),
            severity: issue.severity,
            atSec: Math.max(0, issue.atSec),
            detail: issue.detail.slice(0, 240),
          })),
        model: typeof result.model === 'string' ? result.model.slice(0, 120) : 'unknown',
        costUsd:
          typeof result.costUsd === 'number' && Number.isFinite(result.costUsd)
            ? Math.max(0, result.costUsd)
            : 0,
        frames: Array.isArray(result.frames)
          ? result.frames.filter((t): t is number => typeof t === 'number').slice(0, 12)
          : [],
      };
    },

    'analysis:start': async (input): Promise<{ jobId: string }> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const folder = await requireVideoFolder(raw.folder);

      // Check the listing before enqueueing, so a typo never leaves a job that
      // can only fail in the executor.
      await requireListing(store, listingId);

      const job = runner.enqueue(listingId, { kind: 'analysis', checkpoint: folder });
      try {
        pipeline.prepareAnalysis({ jobId: job.id, listingId, folder });
        await store.update(listingId, { status: 'analysing' });
      } catch (error) {
        // A job queued before a failed preparation could only fail later, after
        // the user has been told analysis started. Cancel it and fail here.
        runner.cancel?.(job.id);
        throw error instanceof IpcError
          ? error
          : new IpcError('E_PIPELINE', messageOf(error), { cause: error });
      }

      // Analysis takes minutes; the contract returns as soon as the job is
      // queued. Failures are persisted on the listing and reported by the job.
      void runner
        .run(job.id)
        .then(async (finished) => {
          if (finished.status === 'complete') {
            await store.update(listingId, { status: 'ready' });
            return;
          }
          if (finished.status === 'failed') {
            await store.update(listingId, {
              status: 'failed',
              lastError: finished.error ?? 'Analysis failed.',
            });
            return;
          }
          if (finished.status === 'cancelled') {
            await store.update(listingId, { status: 'draft' });
          }
        })
        .catch(async (error: unknown) => {
          await store
            .update(listingId, { status: 'failed', lastError: messageOf(error) })
            .catch(() => undefined);
        });

      return { jobId: job.id };
    },

    'variants:list': async (listingId): Promise<VariantSummary[]> => {
      const id = requireListingId(listingId);
      await requireListing(store, id);
      return pipeline.listVariants(id);
    },

    'shots:list': async (listingId): Promise<ShotRow[]> => {
      const id = requireListingId(listingId);
      await requireListing(store, id);
      const rows = await pipeline.listShots(id);
      if (!Array.isArray(rows)) {
        throw new IpcError('E_PIPELINE', 'The shot index could not be read.');
      }
      return rows
        .filter(
          (row): row is ShotRow =>
            isRecord(row) &&
            typeof row.shotId === 'string' &&
            typeof row.sourceId === 'string' &&
            typeof row.room === 'string' &&
            typeof row.startSec === 'number' &&
            typeof row.endSec === 'number' &&
            row.endSec > row.startSec,
        )
        .slice(0, 500)
        .map((row) => ({
          shotId: row.shotId.slice(0, 120),
          sourceId: row.sourceId.slice(0, 120),
          room: row.room.slice(0, 40),
          startSec: row.startSec,
          endSec: row.endSec,
          durationSec: Math.max(0, (row.durationSec ?? row.endSec - row.startSec) | 0) || row.endSec - row.startSec,
          ...(typeof row.score === 'number' && Number.isFinite(row.score) ? { score: row.score } : {}),
          ...(typeof row.src === 'string' ? { src: row.src.slice(0, 500) } : {}),
          ...(Array.isArray(row.sellingPoints) ? { sellingPoints: row.sellingPoints.filter((point): point is string => typeof point === 'string').slice(0, 8) } : {}),
          ...(Array.isArray(row.defects) ? { defects: row.defects.filter((defect): defect is string => typeof defect === 'string').slice(0, 8) } : {}),
          ...(typeof row.reason === 'string' ? { reason: row.reason.slice(0, 200) } : {}),
        }));
    },

    'tagging:estimate': async (listingId): Promise<TaggingEstimateDto> => {
      const id = requireListingId(listingId);
      await requireListing(store, id);
      if (tagging === undefined) {
        throw new IpcError('E_PIPELINE', 'Vision tagging is not available in this build.');
      }
      const estimate = await tagging.estimate(id);
      if (!isRecord(estimate) || typeof estimate.usd !== 'number' || !Number.isFinite(estimate.usd)) {
        throw new IpcError('E_PIPELINE', 'The tagging estimate could not be read.');
      }
      return {
        shots: Number.isInteger(estimate.shots) && estimate.shots >= 0 ? estimate.shots : 0,
        usd: Math.max(0, estimate.usd),
        model: typeof estimate.model === 'string' ? estimate.model.slice(0, 120) : 'unknown',
        capUsd: typeof estimate.capUsd === 'number' && estimate.capUsd > 0 ? estimate.capUsd : 0.25,
        tagged: Number.isInteger(estimate.tagged) && estimate.tagged >= 0 ? estimate.tagged : 0,
      };
    },

    'tagging:start': async (listingId): Promise<TaggingRunDto> => {
      const id = requireListingId(listingId);
      await requireListing(store, id);
      if (tagging === undefined) {
        throw new IpcError('E_PIPELINE', 'Vision tagging is not available in this build.');
      }
      const run = await tagging.start(id);
      if (!isRecord(run)) {
        throw new IpcError('E_PIPELINE', 'The tagging run returned no result.');
      }
      const count = (value: unknown): number =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
      return {
        shots: count(run.shots),
        tagged: count(run.tagged),
        failed: count(run.failed),
        costUsd: typeof run.costUsd === 'number' && Number.isFinite(run.costUsd) ? Math.max(0, run.costUsd) : 0,
        estimatedUsd:
          typeof run.estimatedUsd === 'number' && Number.isFinite(run.estimatedUsd)
            ? Math.max(0, run.estimatedUsd)
            : 0,
        model: typeof run.model === 'string' ? run.model.slice(0, 120) : 'unknown',
      };
    },

    'variants:approve': async (input): Promise<VariantSummary> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const variantId = requireVariantId(raw.variantId);
      const approved = requireBoolean(raw.approved, 'approved');
      await requireListing(store, listingId);
      return pipeline.approveVariant({ listingId, variantId, approved });
    },

    'variants:preview': async (input): Promise<VariantPreview> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const variantId = requireVariantId(raw.variantId);
      await requireListing(store, listingId);
      const preview = await pipeline.previewVariant({ listingId, variantId });
      if (
        !isRecord(preview) ||
        typeof preview.stillPath !== 'string' ||
        preview.stillPath.trim().length === 0
      ) {
        throw new IpcError('E_PIPELINE', 'The renderer did not produce a preview frame.');
      }
      return { stillPath: preview.stillPath };
    },

    'jobs:list': async (): Promise<JobRecord[]> => runner.list(),

    'chat:send': async (input): Promise<ChatResult> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const variantId = requireVariantId(raw.variantId);
      const message = requireChatMessage(raw.message);
      await requireListing(store, listingId);
      const service = requireChat(chat);
      const result = await viaChat(() => service.send({ listingId, variantId, message }));
      if (
        !isRecord(result) ||
        typeof result.reply !== 'string' ||
        typeof result.diff !== 'string' ||
        typeof result.versionId !== 'string' ||
        // The renderer hands this id straight back to `chat:apply`, which only
        // accepts a slug. A service that invents anything else cannot be
        // applied, so fail here rather than hand over a dead id.
        !VERSION_ID_PATTERN.test(result.versionId) ||
        result.versionId.length > MAX_VERSION_ID_LENGTH
      ) {
        throw new IpcError('E_CHAT', 'The assistant did not return a usable edit.');
      }
      return {
        reply: result.reply,
        diff: result.diff,
        versionId: result.versionId,
        warnings: Array.isArray(result.warnings)
          ? result.warnings.filter(
              (warning): warning is string =>
                typeof warning === 'string' && warning.trim().length > 0,
            )
          : [],
      };
    },

    'chat:apply': async (input): Promise<ChatApplyResult> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const variantId = requireVariantId(raw.variantId);
      const versionId = requireVersionId(raw.versionId);
      await requireListing(store, listingId);
      const service = requireChat(chat);
      const result = await viaChat(() =>
        service.apply({ listingId, variantId, versionId }),
      );
      if (!isRecord(result) || typeof result.ok !== 'boolean') {
        throw new IpcError('E_CHAT', 'That edit could not be made current.');
      }
      return { ok: result.ok };
    },

    'chat:versions': async (listingId, variantId): Promise<ChatVersion[]> => {
      const id = requireListingId(listingId);
      const variant = requireVariantId(variantId);
      await requireListing(store, id);
      const service = requireChat(chat);
      const versions = await viaChat(() => service.versions(id, variant));
      if (!Array.isArray(versions)) {
        throw new IpcError('E_CHAT', 'The version history could not be read.');
      }
      return versions.filter(
        (version): version is ChatVersion =>
          isRecord(version) &&
          typeof version.id === 'string' &&
          typeof version.createdAt === 'string' &&
          typeof version.summary === 'string',
      );
    },

    'agent:run': async (input): Promise<AgentRunResponse> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const variantId = requireVariantId(raw.variantId);
      const message = requireChatMessage(raw.message);
      const autonomy = raw.autonomy === undefined ? undefined : requireAutonomy(raw.autonomy);
      await requireListing(store, listingId);

      if (agent === undefined) {
        throw new IpcError('E_PIPELINE', 'The editing assistant is not available in this build.');
      }

      let result: AgentRunResponse;
      try {
        result = await agent.run({
          listingId,
          variantId,
          message,
          ...(autonomy === undefined ? {} : { autonomy }),
        });
      } catch (error) {
        throw new IpcError('E_CHAT', messageOf(error), { cause: error });
      }

      if (!isRecord(result) || typeof result.ok !== 'boolean' || typeof result.reply !== 'string') {
        throw new IpcError('E_CHAT', 'The assistant did not return a usable result.');
      }

      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter(
            (warning): warning is string => typeof warning === 'string' && warning.trim().length > 0,
          )
        : [];
      const edits = Array.isArray(result.edits)
        ? result.edits
            .filter(
              (edit): edit is { capability: string; summary: string; risk: string } =>
                isRecord(edit) &&
                typeof edit.capability === 'string' &&
                typeof edit.summary === 'string' &&
                typeof edit.risk === 'string',
            )
            .slice(0, 20)
            .map((edit) => ({
              capability: edit.capability.slice(0, 80),
              summary: edit.summary.slice(0, 300),
              risk: edit.risk.slice(0, 20),
            }))
        : [];
      const versionId =
        typeof result.versionId === 'string' &&
        result.versionId.length <= MAX_VERSION_ID_LENGTH &&
        VERSION_ID_PATTERN.test(result.versionId)
          ? result.versionId
          : undefined;
      const previewUrl = previewUrlFor(result.previewPath);

      return {
        ok: result.ok,
        runId: typeof result.runId === 'string' ? result.runId.slice(0, 80) : undefined,
        reply: result.reply,
        warnings,
        edits,
        costUsd:
          typeof result.costUsd === 'number' && Number.isFinite(result.costUsd) && result.costUsd >= 0
            ? result.costUsd
            : 0,
        steps:
          typeof result.steps === 'number' && Number.isInteger(result.steps) && result.steps >= 0
            ? result.steps
            : 0,
        ...(typeof result.diff === 'string' ? { diff: result.diff } : {}),
        ...(versionId === undefined ? {} : { versionId }),
        applied: result.applied === true,
        ...(previewUrl === undefined ? {} : { previewUrl }),
        ...(typeof result.error === 'string' ? { error: result.error } : {}),
      };
    },

    'agent:approve': async (input): Promise<{ ok: boolean }> => {
      const raw = requireObject(input, 'input');
      const runId = raw.runId;
      if (typeof runId !== 'string' || !/^agent_[a-z0-9_]{1,72}$/.test(runId)) {
        throw invalid('That approval does not belong to a running agent.');
      }
      const approved = requireBoolean(raw.approved, 'approved');
      if (agent === undefined) {
        throw new IpcError('E_PIPELINE', 'The editing assistant is not available in this build.');
      }
      return { ok: agent.approve(runId, approved) };
    },

    'refine:preview': async (input): Promise<RefinePreviewDto> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const variantId = requireVariantId(raw.variantId);
      await requireListing(store, listingId);
      if (refinePreview === undefined) {
        throw new IpcError('E_PIPELINE', 'Draft previews are not available in this build.');
      }
      const result = await refinePreview.preview({ listingId, variantId });
      if (!isRecord(result)) {
        throw new IpcError('E_PIPELINE', 'The preview renderer returned no result.');
      }
      const previewUrl = previewUrlFor(result.path);
      if (previewUrl === undefined) {
        throw new IpcError(
          'E_PIPELINE',
          typeof result.warning === 'string' && result.warning.length > 0
            ? result.warning
            : 'The draft preview could not be rendered.',
        );
      }
      return {
        previewUrl,
        ...(typeof result.warning === 'string' && result.warning.length > 0
          ? { warning: result.warning.slice(0, 400) }
          : {}),
      };
    },

    'export:start': async (input): Promise<ExportResult> => {
      const raw = requireObject(input, 'input');
      const listingId = requireListingId(raw.listingId);
      const profiles = requireProfiles(raw.profiles);
      const quality = requireQuality(raw.quality);
      const captions = requireCaptionMode(raw.captions);
      const voice = requireVoiceMode(raw.voice);
      const listing = await requireListing(store, listingId);

      const result = await pipeline.exportListing({
        listing,
        profiles,
        quality,
        captions,
        voice,
      });

      if (!isRecord(result) || !Array.isArray(result.files)) {
        throw new IpcError('E_PIPELINE', 'The renderer did not report any files.');
      }
      const files = result.files.filter(
        (file): file is string => typeof file === 'string' && file.trim().length > 0,
      );
      if (files.length === 0 || files.length !== result.files.length) {
        throw new IpcError('E_PIPELINE', 'The renderer did not produce an output file.');
      }

      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter(
            (warning): warning is string =>
              typeof warning === 'string' && warning.trim().length > 0,
          )
        : [];

      // Older pipeline implementations may omit `exportDir`; derive it from
      // the first file so the renderer can still reveal the folder.
      const exportedDir =
        typeof result.exportDir === 'string' && result.exportDir.trim().length > 0
          ? result.exportDir.trim()
          : dirname(files[0]!);

      await store.update(listingId, { status: 'exported' });
      return warnings.length > 0
        ? { files, exportDir: exportedDir, warnings }
        : { files, exportDir: exportedDir };
    },

    'music:generate': async (prompt): Promise<MusicGenerationDto> => {
      if (typeof prompt !== 'string') throw invalid('Describe the music you want.');
      const text = prompt.trim();
      if (text.length < 5 || text.length > 600) {
        throw invalid('Describe the music in 5–600 characters.');
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        throw invalid('The music prompt must not contain control characters.');
      }
      if (music === undefined) {
        throw new IpcError('E_PIPELINE', 'Music generation is not available in this build.');
      }
      const result = await music.generate(text);
      if (!isRecord(result) || typeof result.fileName !== 'string') {
        throw new IpcError('E_PIPELINE', 'The music model returned no file.');
      }
      return {
        fileName: result.fileName.slice(0, 120),
        durationSec:
          typeof result.durationSec === 'number' && Number.isFinite(result.durationSec)
            ? Math.max(0, result.durationSec)
            : 0,
        costUsd:
          typeof result.costUsd === 'number' && Number.isFinite(result.costUsd)
            ? Math.max(0, result.costUsd)
            : 0,
        model: typeof result.model === 'string' ? result.model.slice(0, 120) : 'unknown',
        bytes:
          typeof result.bytes === 'number' && Number.isInteger(result.bytes) && result.bytes >= 0
            ? result.bytes
            : 0,
      };
    },

    'settings:get': async (): Promise<SettingsSnapshot> => {
      const snapshot = await settings.get();
      if (spend === undefined) return snapshot;
      try {
        const summary = await spend.summary();
        return { ...snapshot, spendUsd: summary.monthUsd };
      } catch {
        return snapshot;
      }
    },

    'settings:setTheme': async (theme): Promise<void> => {
      await settings.setTheme(requireTheme(theme));
    },

    'settings:setTagging': async (enabled): Promise<void> => {
      const value = requireBoolean(enabled, 'enabled');
      if (settings.setTagging === undefined) {
        throw new IpcError('E_PIPELINE', 'Tagging settings are not available in this build.');
      }
      await settings.setTagging(value);
    },

    'settings:setKey': async (key): Promise<void> => {
      await settings.setKey(requireApiKey(key));
    },

    'settings:keyStatus': async (): Promise<KeyStatus> => settings.keyStatus(),

    'voice:list': async (): Promise<VoiceOption[]> => {
      if (voiceGallery === undefined) return voiceCatalogue();
      try {
        const entries = await voiceGallery.list();
        if (!Array.isArray(entries)) return voiceCatalogue();
        const clean = entries
          .map((entry) => sanitiseVoiceOption(entry))
          .filter((entry): entry is VoiceOption => entry !== null);
        // A port that lost every entry is a bug; the catalogue still works.
        return clean.length === 0 ? voiceCatalogue() : clean;
      } catch (error) {
        throw new IpcError('E_VOICE', messageOf(error));
      }
    },

    'voice:setVoice': async (voiceId): Promise<void> => {
      await settings.setVoice(requireVoiceId(voiceId));
    },

    'shell:openPath': async (path) => {
      const root = dataDir;
      if (root === undefined || root.trim().length === 0) {
        throw new IpcError('E_PIPELINE', 'Opening folders is not available in this build.');
      }
      const target = requireDataPath(path, root);
      if (openPath === undefined) {
        throw new IpcError('E_PIPELINE', 'Opening folders is not available in this build.');
      }

      try {
        const error = await openPath(target);
        if (typeof error === 'string' && error.trim().length > 0) {
          return { ok: false, error };
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },

    'voice:modelStatus': async (): Promise<VoiceModelStatus> => {
      if (voiceModel === undefined) {
        throw new IpcError(
          'E_VOICE_MODEL',
          'Voice model downloads need the desktop app; this browser preview cannot install it.',
        );
      }
      try {
        return await voiceModel.status();
      } catch (error) {
        throw new IpcError('E_VOICE_MODEL', messageOf(error));
      }
    },

    'voice:modelDownload': async (): Promise<VoiceModelStatus> => {
      if (voiceModel === undefined) {
        throw new IpcError(
          'E_VOICE_MODEL',
          'Voice model downloads need the desktop app; this browser preview cannot install it.',
        );
      }
      try {
        return await voiceModel.start();
      } catch (error) {
        throw new IpcError('E_VOICE_MODEL', messageOf(error));
      }
    },

    'voice:modelCancel': async (): Promise<VoiceModelStatus> => {
      if (voiceModel === undefined) {
        throw new IpcError('E_VOICE_MODEL', 'There is no voice download to cancel.');
      }
      try {
        return await voiceModel.cancel();
      } catch (error) {
        throw new IpcError('E_VOICE_MODEL', messageOf(error));
      }
    },
  };

  return handlers;
}

/** Re-exported for callers that only need the channel union. */
export type { Channel, IpcContract };
