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
export type VariantLook = 'calm' | 'walkthrough' | 'social' | 'marketing';

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
  /** The same frame as a data URL, for renderers that cannot load file://. */
  stillUrl?: string;
}

/** One indexed shot, as the review screen needs it. */
export interface ShotRow {
  shotId: string;
  sourceId: string;
  room: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** 0..1 measured/tagged quality. */
  score?: number;
  src?: string;
  sellingPoints?: string[];
  defects?: string[];
  reason?: string;
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
  /** The studio voice selected in Settings; `matilda` by default. */
  voiceId: string;
  /** The packaged app version, shown in Settings → Diagnostics. */
  version: string;
  /** Model spend recorded for this machine, in USD. */
  spendUsd: number;
  /** Run vision tagging at the end of analysis. */
  tagOnAnalyse: boolean;
  /** Selected bed under the app music folder; absent = bundled bed. */
  musicTrack?: string;
}

/** Pre-flight price of tagging the persisted shots for one listing. */
export interface TaggingEstimateDto {
  shots: number;
  /** Estimated USD for this batch. */
  usd: number;
  model: string;
  /** The per-batch cap the pipeline enforces. */
  capUsd: number;
  /** Shots that already carry tags. */
  tagged: number;
}

export type TaggingRunDto = {
  shots: number;
  tagged: number;
  failed: number;
  /** Provider-reported cost, or the estimate when none was reported. */
  costUsd: number;
  estimatedUsd: number;
  model: string;
};

export type RemixPreset = 'marketing' | 'original' | 'price_led';

export interface RemixSlotDto {
  order: number;
  beat: string;
  shotId: string;
  room: string;
  inSec: number;
  outSec: number;
  targetSec: number;
  reason: string;
}

/** What transcription cost and where the number came from. */
export interface RemixTranscriptionDto {
  words: number;
  durationSec: number;
  costUsd?: number;
  /** `provider` = reported by OpenRouter; `estimated` = configured rate applied. */
  costSource: 'provider' | 'estimated' | 'unreported';
  model: string;
  recordedAt: string;
}

export interface RemixStoryboardDto {
  fileName: string;
  analyzedAt: string;
  durationSec: number;
  fps: number;
  orientation: 'portrait' | 'landscape' | 'square';
  shots: Array<{ shotId: string; startSec: number; endSec: number; durationSec: number }>;
  presets: Record<RemixPreset, RemixSlotDto[]>;
  warnings: string[];
  /** Number of transcript words available for captions. */
  words?: number;
  /** Room per imported shot, after `remix:retag`. */
  rooms?: Record<string, string>;
  /** Saved manual order per preset, as shot ids. */
  orders?: Partial<Record<RemixPreset, string[]>>;
  /** Preset the current `remix` variant was built from. */
  activePreset?: RemixPreset;
  /** Transcription cost/status for the last analysis. */
  transcription?: RemixTranscriptionDto;
}

export interface RenderInspectionDto {  verdict: 'pass' | 'retry' | 'fail';
  score: number;
  summary: string;
  issues: Array<{
    issue: string;
    severity: 'low' | 'medium' | 'high';
    atSec: number;
    detail: string;
  }>;
  model: string;
  costUsd: number;
  frames: number[];
}

export interface MusicGenerationDto {
  /** Bare file name under `<data>/assets/music`. */
  fileName: string;
  durationSec: number;
  costUsd: number;
  model: string;
  bytes: number;
}

/** A reference-video style profile, as shown in the UI and used by the agent. */
export interface ReferenceProfileDto {
  analyzedAt: string;
  /** Basename only; the renderer never receives an absolute path. */
  fileName: string;
  profile: {
    pacing?: string;
    aspect?: string;
    motion?: string;
    averageShotSec?: number;
    cutDensityPerMin?: number;
    palette?: string[];
    confidence?: number;
    style?: Record<string, string>;
  };
}

/** One voice card in Settings. Paths never cross the bridge. */
export interface VoiceOption {
  /** Stable id; validated before it is stored or sent to the provider. */
  id: string;
  name: string;
  accent: string;
  /** Short tags, e.g. `warm`, `calm`. */
  tone: string[];
  gender: 'female' | 'male' | 'non-binary';
  /** Identifier of the bundled preview; never a filesystem path. */
  sampleId: string;
  /** `data:audio/mpeg;base64,…`, or absent when no sample shipped. */
  sampleUrl?: string;
  /** Size of the bundled sample, when present. */
  bytes?: number;
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

/** How much the agent may do without asking. */
export type Autonomy = 'suggest' | 'ask' | 'auto';

export interface AgentRunRequest {
  listingId: string;
  variantId: string;
  message: string;
  autonomy?: Autonomy;
}

export interface AgentEditDto {
  capability: string;
  summary: string;
  risk: string;
}

/** A playable draft of the current variant. The URL is scheme-based, not a path. */
export interface RefinePreviewDto {
  previewUrl: string;
  /** Render warnings, e.g. a missing font or music bed. */
  warning?: string;
}

export interface AgentRunResponse {
  ok: boolean;
  /** Correlates the response with `agent:event` progress and `agent:approve`. */
  runId?: string;
  reply: string;
  diff?: string;
  versionId?: string;
  /** True when the version was made current for export. */
  applied?: boolean;
  warnings: string[];
  edits: AgentEditDto[];
  costUsd: number;
  steps: number;
  /**
   * Scheme URL for the latest draft preview (`zeniconic-media://preview/…`).
   * Never an absolute filesystem path.
   */
  previewUrl?: string;
  error?: string;
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
  /** Native picker for a reference video. */
  'dialog:chooseReference': () => Promise<string | null>;
  /** Analyse a local reference and persist its style profile. */
  'reference:analyze': (input: { listingId: string; path: string }) => Promise<ReferenceProfileDto>;
  'reference:get': (listingId: string) => Promise<ReferenceProfileDto | null>;
  'reference:clear': (listingId: string) => Promise<void>;
  /** Native picker for a finished video to remix. */
  'dialog:chooseRemix': () => Promise<string | null>;
  /** Split a finished video into scenes and propose preset orders. */
  'remix:analyze': (input: { listingId: string; file: string; transcribe?: boolean }) => Promise<RemixStoryboardDto>;
  'remix:get': (listingId: string) => Promise<RemixStoryboardDto | null>;
  /** Turn one preset into the `remix` variant. */
  'remix:create': (input: { listingId: string; preset: RemixPreset }) => Promise<VariantSummary>;
  /** Persist a manual slot order for one preset; `order` names every slot once. */
  'remix:reorder': (input: {
    listingId: string;
    preset: RemixPreset;
    order: string[];
  }) => Promise<RemixStoryboardDto>;
  /** Set the room for one imported shot from the EDL vocabulary. */
  'remix:retag': (input: {
    listingId: string;
    shotId: string;
    room: string;
  }) => Promise<RemixStoryboardDto>;
  /** Ask a multimodal model to inspect a finished export. */
  'review:inspect': (input: {
    file: string;
    facts?: Record<string, string | number | undefined>;
  }) => Promise<RenderInspectionDto>;
  /** Generate a music bed with an audio-output model (Lyria). */
  'music:generate': (prompt: string) => Promise<MusicGenerationDto>;
  'analysis:start': (input: { listingId: string; folder: string }) => Promise<{ jobId: string }>;
  'variants:list': (listingId: string) => Promise<VariantSummary[]>;
  /** The persisted shot index; empty before analysis. */
  'shots:list': (listingId: string) => Promise<ShotRow[]>;
  /** One cached JPEG preview of a shot, as a data URL (never a path). */
  'shots:thumbnail': (input: {
    listingId: string;
    shotId: string;
  }) => Promise<{ dataUrl: string }>;
  /** Price the vision pass for the persisted shots. */
  'tagging:estimate': (listingId: string) => Promise<TaggingEstimateDto>;
  /** Run the vision pass now and write the tagged index. */
  'tagging:start': (listingId: string) => Promise<TaggingRunDto>;
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
  /** The agent edits a draft, validates it, and commits a version. */
  'agent:run': (input: AgentRunRequest) => Promise<AgentRunResponse>;
  /** Resolve a pending approval for a running agent. */
  'agent:approve': (input: { runId: string; approved: boolean }) => Promise<{ ok: boolean }>;
  /** Render the current variant as a low-resolution draft for playback. */
  'refine:preview': (input: {
    listingId: string;
    variantId: string;
  }) => Promise<RefinePreviewDto>;
  'export:start': (input: ExportRequest) => Promise<ExportResult>;
  'settings:get': () => Promise<SettingsSnapshot>;
  'settings:setTheme': (theme: Theme) => Promise<void>;
  'settings:setTagging': (enabled: boolean) => Promise<void>;
  'settings:setKey': (key: string) => Promise<void>;
  'settings:keyStatus': () => Promise<KeyStatus>;
  /** The catalogue plus bundled `data:` previews; no paths or keys. */
  'voice:list': () => Promise<VoiceOption[]>;
  /** Persists the selected studio voice; validated against the catalogue. */
  'voice:setVoice': (voiceId: string) => Promise<void>;
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

/** Live agent activity, including approval requests. */
export const AGENT_EVENT_CHANNEL = 'agent:event';

export interface AgentEventDto {
  runId: string;
  type:
    | 'understood'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'approval_required'
    | 'warning'
    | 'done'
    | 'error';
  /** Plain text for the UI; never chain-of-thought. */
  message: string;
  tool?: string;
  ok?: boolean;
  data?: unknown;
}

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
  'dialog:chooseReference',
  'reference:analyze',
  'reference:get',
  'reference:clear',
  'dialog:chooseRemix',
  'remix:analyze',
  'remix:get',
  'remix:create',
  'remix:reorder',
  'remix:retag',
  'review:inspect',
  'music:generate',
  'analysis:start',
  'variants:list',
  'shots:list',
  'shots:thumbnail',
  'tagging:estimate',
  'tagging:start',
  'variants:approve',
  'variants:preview',
  'jobs:list',
  'chat:send',
  'chat:apply',
  'chat:versions',
  'agent:run',
  'agent:approve',
  'refine:preview',
  'export:start',
  'settings:get',
  'settings:setTheme',
  'settings:setTagging',
  'settings:setKey',
  'settings:keyStatus',
  'voice:list',
  'voice:setVoice',
  'shell:openPath',
  'voice:modelStatus',
  'voice:modelDownload',
  'voice:modelCancel',
];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}
