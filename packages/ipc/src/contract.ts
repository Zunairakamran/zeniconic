/**
 * The renderer ↔ main contract.
 *
 * This file is the single source of truth for channel names and payloads. It
 * deliberately imports only types: the preload bundle stays free of Node and
 * filesystem code.
 *
 * Security rule: every value that crosses the bridge is untrusted. The
 * preload only forwards channels listed here, and the handlers in
 * `handlers.ts` validate every argument before touching the store or disk.
 */

import type { JobRecord } from '@zeniconic/jobs';
import type { Facts, ListingRecord } from '@zeniconic/store';

export type Theme = 'light' | 'dark';

export type ExportQuality = 'draft' | 'standard' | 'high';

/** What happens to spoken captions during export. */
export type CaptionMode = 'off' | 'burned' | 'srt' | 'both';

/** Where the export's audio comes from. */
export type VoiceMode = 'restore' | 'ai' | 'music';

/** The three creative directions planned after analysis. */
export type VariantLook = 'calm' | 'walkthrough' | 'social';

/**
 * One planned variant, as persisted under
 * `<listing>/variants/variants.json`.
 */
export interface VariantSummary {
  /** Stable id; currently the look id. */
  id: string;
  look: VariantLook;
  /** EDL format id (`cinematic_hero`). */
  format: string;
  targetDurationSec: number;
  clipCount: number;
  /** 0..100, mean of the selected shots' planner scores. */
  score: number;
  /** Stored EDL path, relative to the listing workspace (`variants/calm.json`). */
  edlPath: string;
  approved: boolean;
}

export interface VariantPreview {
  /** Absolute path to a single 1080-wide preview frame. */
  stillPath: string;
}

export interface ExportRequest {
  listingId: string;
  /** Render profiles (`vertical-social`, `feed-portrait`, `landscape`, `pin`). */
  profiles: string[];
  quality: ExportQuality;
  captions: CaptionMode;
  /** Restore presenter audio, synthesise a bridge voice, or music only. */
  voice: VoiceMode;
}

export interface ExportResult {
  /** Absolute paths of the files that were written, in render order. */
  files: string[];
  /** Absolute path of `<listing>/exports`, the folder the files were written to. */
  exportDir: string;
  /** Non-fatal stage failures the UI should show (e.g. voice fell back to music). */
  warnings?: string[];
}

/** Result of asking the desktop shell to reveal a folder. */
export interface OpenPathResult {
  ok: boolean;
  /** Plain-language failure from the shell, when `ok` is false. */
  error?: string;
}

export interface KeyStatus {
  configured: boolean;
}

export interface SettingsSnapshot {
  /** Absolute store root, shown in Settings → Storage. */
  dataDir: string;
  /** True when an OpenRouter key is available to the main process. */
  modelConfigured: boolean;
  theme: Theme;
  /** The packaged app version, shown in Settings → Diagnostics. */
  version: string;
  /** Model spend recorded for this machine, in USD. */
  spendUsd: number;
}

/** What the user asked the refine assistant to change. */
export interface ChatSendRequest {
  listingId: string;
  variantId: string;
  /** One sentence or a short paragraph; validated before it reaches the model. */
  message: string;
}

/**
 * A proposed edit. Nothing is current until `chat:apply` is called with
 * `versionId`; the diff is what the user reads first.
 */
export interface ChatResult {
  /** The assistant's plain-language answer, shown above the diff. */
  reply: string;
  /** One-line human diff, e.g. `2 changes: balcony at 8.0s, 30.0s → 28.0s`. */
  diff: string;
  /** Id of the written EDL version (`calm-v3`). Not current until applied. */
  versionId: string;
  /** Non-fatal notes, e.g. a corrected reply or a missing footage index. */
  warnings: string[];
}

export interface ChatApplyRequest {
  listingId: string;
  variantId: string;
  versionId: string;
}

export interface ChatApplyResult {
  ok: boolean;
}

/** One saved chat edit, as listed in the version rail. */
export interface ChatVersion {
  id: string;
  createdAt: string;
  summary: string;
}

/** Lifecycle of the optional Kokoro voice model download. */
export type VoiceModelPhase = 'missing' | 'downloading' | 'verifying' | 'ready' | 'error';

export interface VoiceModelStatus {
  phase: VoiceModelPhase;
  /** True only when every file has passed its checksum. */
  installed: boolean;
  /** Bytes present on disk now, including a resumable partial file. */
  bytes: number;
  totalBytes: number;
  /** Repo-relative file being fetched, while downloading. */
  file?: string;
  /** Plain-language failure; a partial download is kept for the next attempt. */
  error?: string;
  updatedAt: string;
}

export interface IpcContract {
  'listings:list': () => Promise<ListingRecord[]>;
  'listings:create': (input: {
    address: string;
    facts?: Partial<Facts>;
  }) => Promise<ListingRecord>;
  'listings:get': (id: string) => Promise<ListingRecord | undefined>;
  'listings:updateFacts': (input: {
    listingId: string;
    facts: Partial<Facts>;
  }) => Promise<ListingRecord>;
  'analysis:chooseFolder': () => Promise<string | null>;
  'analysis:start': (input: { listingId: string; folder: string }) => Promise<{ jobId: string }>;
  'variants:list': (listingId: string) => Promise<VariantSummary[]>;
  'variants:approve': (input: {
    listingId: string;
    variantId: string;
    approved: boolean;
  }) => Promise<VariantSummary>;
  'variants:preview': (input: {
    listingId: string;
    variantId: string;
  }) => Promise<VariantPreview>;
  'jobs:list': () => Promise<JobRecord[]>;
  'chat:send': (input: ChatSendRequest) => Promise<ChatResult>;
  'chat:apply': (input: ChatApplyRequest) => Promise<ChatApplyResult>;
  'chat:versions': (listingId: string, variantId: string) => Promise<ChatVersion[]>;
  'export:start': (input: ExportRequest) => Promise<ExportResult>;
  'settings:get': () => Promise<SettingsSnapshot>;
  'settings:setTheme': (theme: Theme) => Promise<void>;
  'settings:setKey': (key: string) => Promise<void>;
  'settings:keyStatus': () => Promise<KeyStatus>;
  'shell:openPath': (path: string) => Promise<OpenPathResult>;
  'voice:modelStatus': () => Promise<VoiceModelStatus>;
  /** Starts or resumes the download, then returns at once; poll status. */
  'voice:modelDownload': () => Promise<VoiceModelStatus>;
  /** Pauses the download; the partial file is kept. */
  'voice:modelCancel': () => Promise<VoiceModelStatus>;
}

export type Channel = keyof IpcContract;

export type Handler<C extends Channel> = (
  ...args: Parameters<IpcContract[C]>
) => ReturnType<IpcContract[C]>;

/** A plain object with one function per channel; suitable for direct testing. */
export type Handlers = { [C in Channel]: Handler<C> };

/** Lifecycle of the job that produced a progress event. */
export type JobProgressStatus = 'running' | 'complete' | 'failed' | 'cancelled';

/** Progress emitted while a job walks the stage machine. */
export interface JobProgressEvent {
  jobId: string;
  stage: string;
  /** 0..100 */
  percent: number;
  detail?: string;
  /** Optional lifecycle marker; absent on fine-grained pipeline events. */
  status?: JobProgressStatus;
  /** Plain-language failure message when `status` is `failed`. */
  error?: string;
}

/** The event channel preload subscribes to. Not a request channel. */
export const JOB_PROGRESS_CHANNEL = 'job:progress';

/**
 * Every request channel, in one place. `isChannel` is the allow-list the
 * preload uses before calling `ipcRenderer.invoke`.
 */
export const CHANNELS: readonly Channel[] = [
  'listings:list',
  'listings:create',
  'listings:get',
  'listings:updateFacts',
  'analysis:chooseFolder',
  'analysis:start',
  'variants:list',
  'variants:approve',
  'variants:preview',
  'jobs:list',
  'chat:send',
  'chat:apply',
  'chat:versions',
  'export:start',
  'settings:get',
  'settings:setTheme',
  'settings:setKey',
  'settings:keyStatus',
  'shell:openPath',
  'voice:modelStatus',
  'voice:modelDownload',
  'voice:modelCancel',
];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}
