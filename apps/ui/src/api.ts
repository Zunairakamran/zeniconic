/**
 * The renderer's only door to the machine.
 *
 * In Electron the preload exposes `globalThis.zeniconic`; in a plain browser
 * (Vite dev without the shell) there is no bridge, so every call falls back to
 * the demo dataset. Screens import this module, never `electron` or `fs`.
 */

import type {
  AgentEventDto,
  AgentRunRequest,
  AgentRunResponse,
  CaptionMode,
  Channel,
  ChatApplyRequest,
  ChatApplyResult,
  ChatResult,
  ChatSendRequest,
  ChatVersion,
  ExportQuality,
  IpcContract,
  JobProgressEvent,
  KeyStatus,
  OpenPathResult,
  MusicGenerationDto,
  ReferenceProfileDto,
  RefinePreviewDto,
  RemixPreset,
  RemixStoryboardDto,
  RenderInspectionDto,
  SettingsSnapshot,
  ShotRow,
  TaggingEstimateDto,
  TaggingRunDto,
  Theme,
  VariantSummary,
  VoiceMode,
  VoiceModelStatus,
  VoiceOption,
} from '../../../packages/ipc/src/index';
import type { JobRecord } from '../../../packages/jobs/src/index';
import type { Facts, ListingRecord } from '../../../packages/store/src/index';
import {
  DEFAULT_VOICE_ID,
  VOICE_CATALOG,
  isVoiceId,
} from '../../../services/voice/src/voices';
import { candidates as demoCandidates, listings as demoListings, variants as demoVariants } from './demo';
import type { Listing, Variant } from './types';

/** The shape `preload.ts` exposes. No `ipcRenderer` is reachable from here. */
interface ZeniconicBridge {
  invoke<C extends Channel>(
    channel: C,
    ...args: Parameters<IpcContract[C]>
  ): Promise<Awaited<ReturnType<IpcContract[C]>>>;
  onJobProgress(listener: (event: JobProgressEvent) => void): () => void;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
}

interface GlobalScope {
  zeniconic?: ZeniconicBridge;
}

function bridge(): ZeniconicBridge | undefined {
  return (globalThis as unknown as GlobalScope).zeniconic;
}

const DEMO_DATA_DIR = 'D:\\Zeniconic\\data';
const DEMO_NOW = Date.now();
const DEMO_VERSION = '0.1.0';
const DEMO_SPEND_USD = 1.84;

let demoTheme: Theme = 'light';

/** Mirrors `packages/store`'s Dubai heuristic so the browser demo matches. */
function demoCurrencyFor(address: string): Facts['currency'] {
  return /\b(dubai|uae|united arab emirates|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/i.test(
    address,
  )
    ? 'AED'
    : 'GBP';
}

function demoRecord(listing: Listing, index: number): ListingRecord {
  const updatedAt = new Date(DEMO_NOW - index * 3_600_000).toISOString();
  return {
    version: 1,
    id: listing.id,
    address: listing.address,
    createdAt: new Date(DEMO_NOW - 86_400_000).toISOString(),
    updatedAt,
    status: listing.status,
    facts: {
      address: listing.address,
      price: listing.price,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
      currency: 'AED',
    },
    clipCount: 0,
    notes: listing.community,
  };
}

let demoList: ListingRecord[] = demoListings.map(demoRecord);

function demoCreate(input: { address: string; facts?: Partial<Facts> }): ListingRecord {
  const address = input.address.trim();
  const slug =
    address
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'listing';
  const day = new Date().toISOString().slice(0, 10);

  let id = `${day}-${slug}`;
  let suffix = 2;
  while (demoList.some((record) => record.id === id)) {
    id = `${day}-${slug}-${suffix}`;
    suffix += 1;
  }

  const now = new Date().toISOString();
  const record: ListingRecord = {
    version: 1,
    id,
    address,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    facts: {
      address,
      currency: input.facts?.currency ?? demoCurrencyFor(address),
      ...(input.facts?.price === undefined ? {} : { price: input.facts.price }),
      ...(input.facts?.beds === undefined ? {} : { beds: input.facts.beds }),
      ...(input.facts?.baths === undefined ? {} : { baths: input.facts.baths }),
      ...(input.facts?.sqft === undefined ? {} : { sqft: input.facts.sqft }),
    },
    clipCount: 0,
  };

  demoList = [record, ...demoList];
  return record;
}

function demoUpdateFacts(listingId: string, patch: Partial<Facts>): ListingRecord {
  const current = demoList.find((record) => record.id === listingId);
  if (current === undefined) throw new Error(`Listing "${listingId}" was not found.`);

  const facts: Facts = { ...current.facts };
  if (patch.address !== undefined) facts.address = patch.address;
  if (patch.price !== undefined) facts.price = patch.price;
  if (patch.beds !== undefined) facts.beds = patch.beds;
  if (patch.baths !== undefined) facts.baths = patch.baths;
  if (patch.sqft !== undefined) facts.sqft = patch.sqft;
  if (patch.currency !== undefined) facts.currency = patch.currency;
  if (patch.confirmedAt !== undefined) facts.confirmedAt = patch.confirmedAt;

  const updated: ListingRecord = {
    ...current,
    facts,
    updatedAt: new Date().toISOString(),
  };
  demoList = demoList.map((record) => (record.id === listingId ? updated : record));
  return updated;
}

const demoVariantState = new Map<string, VariantSummary[]>();
let demoKeyConfigured = false;
let demoVoiceId = DEFAULT_VOICE_ID;
/** Browser-preview stand-in for the Kokoro download; the desktop owns the real one. */
let demoVoiceInstalled = false;
const DEMO_VOICE_TOTAL = 92_364_770;

/** Metadata-only: the browser bundle ships no audio samples. */
function demoVoiceGallery(): VoiceOption[] {
  return VOICE_CATALOG.map((voice) => ({
    id: voice.id,
    name: voice.name,
    accent: voice.accent,
    tone: [...voice.tone],
    gender: voice.gender,
    sampleId: voice.id,
  }));
}

const demoTracks = {
  voiceModel(): VoiceModelStatus {
    return {
      phase: demoVoiceInstalled ? 'ready' : 'missing',
      installed: demoVoiceInstalled,
      bytes: demoVoiceInstalled ? DEMO_VOICE_TOTAL : 0,
      totalBytes: DEMO_VOICE_TOTAL,
      updatedAt: new Date().toISOString(),
    };
  },
};

interface DemoChatState {
  sequence: number;
  versions: ChatVersion[];
}

const demoChatState = new Map<string, DemoChatState>();

function demoChatFor(listingId: string, variantId: string): DemoChatState {
  const key = `${listingId}/${variantId}`;
  const existing = demoChatState.get(key);
  if (existing !== undefined) return existing;

  const created: DemoChatState = { sequence: 0, versions: [] };
  demoChatState.set(key, created);
  return created;
}

/**
 * The browser preview cannot call a model. It still returns the same shape as
 * the desktop service so RefineChat's diff and Apply flow can be exercised.
 */
function demoChatSend(input: ChatSendRequest): ChatResult {
  const state = demoChatFor(input.listingId, input.variantId);
  state.sequence += 1;
  const versionId = `${input.variantId}-v${String(state.sequence)}`;
  const diff = '2 changes: balcony at 8.0s, 30.0s → 28.0s';
  state.versions.unshift({
    id: versionId,
    createdAt: new Date().toISOString(),
    summary: diff,
  });

  return {
    reply:
      'In the desktop app this is written to a new version after the model checks the edit. Here is the shape of the diff.',
    diff,
    versionId,
    warnings: ['Browser preview: no model call was made.'],
  };
}

function demoChatApply(input: ChatApplyRequest): ChatApplyResult {
  const state = demoChatFor(input.listingId, input.variantId);
  if (!state.versions.some((version) => version.id === input.versionId)) {
    throw new Error(`Version "${input.versionId}" was not found.`);
  }
  return { ok: true };
}

function demoVariantsFor(listingId: string): VariantSummary[] {
  const existing = demoVariantState.get(listingId);
  if (existing !== undefined) return existing;

  const records: VariantSummary[] = demoVariants.map((variant) => ({
    id: variant.id,
    look: variant.look === 'editorial' ? 'calm' : variant.look,
    format: 'cinematic_hero',
    targetDurationSec: variant.durationSec,
    clipCount: variant.clipCount,
    score: variant.score,
    edlPath: `${DEMO_DATA_DIR}\\listings\\${listingId}\\variants\\${variant.id}.json`,
    approved: variant.approved,
  }));
  demoVariantState.set(listingId, records);
  return records;
}

function demoPreviewPath(listingId: string, variantId: string): string {
  return `${DEMO_DATA_DIR}\\listings\\${listingId}\\variants\\previews\\${variantId}.jpg`;
}

const VARIANT_META: Record<
  VariantSummary['look'],
  { name: string; tone: string; hook: string }
> = {
  calm: { name: 'Calm', tone: 'calm', hook: 'A quiet look at the light.' },
  walkthrough: {
    name: 'Walkthrough',
    tone: 'walk',
    hook: 'From the door to the view.',
  },
  social: { name: 'Social', tone: 'social', hook: 'Just listed.' },
  marketing: {
    name: 'Marketing 38',
    tone: 'social',
    hook: 'Hook, light, ritual, craft, space, lift, price, close.',
  },
};

/** Maps a persisted variant onto the view model the review screen uses. */
export function toUiVariant(record: VariantSummary): Variant {
  const meta = VARIANT_META[record.look];
  return {
    id: record.id,
    name: meta.name,
    look: record.look,
    durationSec: record.targetDurationSec,
    clipCount: record.clipCount,
    score: record.score,
    approved: record.approved,
    tone: meta.tone,
    hook: meta.hook,
  };
}

function formatPrice(facts: Facts): string {
  if (facts.price === undefined || facts.price.trim().length === 0) return '';
  const digits = facts.price.replace(/[^0-9.]/g, '');
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0 || digits.length === 0) return facts.price;

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: facts.currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return facts.price;
  }
}

function whenLabel(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(then),
  );
}

const TONES = ['warm', 'cool', 'sand', 'green'] as const;

function toneFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return TONES[hash % TONES.length] ?? 'warm';
}

/** Maps a persisted record onto the view model the screens already use. */
export function toUiListing(record: ListingRecord): Listing {
  return {
    id: record.id,
    address: record.address,
    community: record.notes?.trim() ?? '',
    price: formatPrice(record.facts),
    beds: record.facts.beds ?? 0,
    baths: record.facts.baths ?? 0,
    sqft: record.facts.sqft ?? 0,
    currency: record.facts.currency,
    status: record.status,
    updatedAt: whenLabel(record.updatedAt),
    variantCount: 0,
    clipCount: record.clipCount,
    tone: toneFor(record.id),
  };
}

export interface ZeniconicApi {
  /** True inside the Electron shell; false in a plain browser. */
  readonly isDesktop: boolean;
  listings: {
    list(): Promise<ListingRecord[]>;
    create(input: { address: string; facts?: Partial<Facts> }): Promise<ListingRecord>;
    get(id: string): Promise<ListingRecord | undefined>;
    updateFacts(input: { listingId: string; facts: Partial<Facts> }): Promise<ListingRecord>;
  };
  analysis: {
    chooseFolder(): Promise<string | null>;
    start(input: { listingId: string; folder: string }): Promise<{ jobId: string }>;
  };
  dialog: {
    chooseReference(): Promise<string | null>;
    chooseRemix(): Promise<string | null>;
  };
  reference: {
    analyze(input: { listingId: string; path: string }): Promise<ReferenceProfileDto>;
    get(listingId: string): Promise<ReferenceProfileDto | null>;
    clear(listingId: string): Promise<void>;
  };
  remix: {
    analyze(input: { listingId: string; file: string; transcribe?: boolean }): Promise<RemixStoryboardDto>;
    get(listingId: string): Promise<RemixStoryboardDto | null>;
    create(input: { listingId: string; preset: RemixPreset }): Promise<VariantSummary>;
    reorder(input: {
      listingId: string;
      preset: RemixPreset;
      order: string[];
    }): Promise<RemixStoryboardDto>;
    retag(input: {
      listingId: string;
      shotId: string;
      room: string;
    }): Promise<RemixStoryboardDto>;
  };
  review: {
    inspect(input: {
      file: string;
      facts?: Record<string, string | number | undefined>;
    }): Promise<RenderInspectionDto>;
  };
  music: {
    generate(prompt: string): Promise<MusicGenerationDto>;
  };
  variants: {
    list(listingId: string): Promise<VariantSummary[]>;
    approve(input: {
      listingId: string;
      variantId: string;
      approved: boolean;
    }): Promise<VariantSummary>;
    preview(input: {
      listingId: string;
      variantId: string;
    }): Promise<{ stillPath: string }>;
  };
  shots: {
    list(listingId: string): Promise<ShotRow[]>;
  };
  jobs: {
    list(): Promise<JobRecord[]>;
  };
  chat: {
    send(input: ChatSendRequest): Promise<ChatResult>;
    apply(input: ChatApplyRequest): Promise<ChatApplyResult>;
    versions(listingId: string, variantId: string): Promise<ChatVersion[]>;
  };
  agent: {
    run(input: AgentRunRequest): Promise<AgentRunResponse>;
    approve(input: { runId: string; approved: boolean }): Promise<{ ok: boolean }>;
  };
  refine: {
    preview(input: { listingId: string; variantId: string }): Promise<RefinePreviewDto>;
  };
  export: {
    start(input: {
      listingId: string;
      profiles: string[];
      quality: ExportQuality;
      captions: CaptionMode;
      voice: VoiceMode;
    }): Promise<{ files: string[]; exportDir: string; warnings?: string[] }>;
  };
  settings: {
    get(): Promise<SettingsSnapshot>;
    setTheme(theme: Theme): Promise<void>;
    setKey(key: string): Promise<void>;
    keyStatus(): Promise<KeyStatus>;
    setTagging(enabled: boolean): Promise<void>;
  };
  tagging: {
    estimate(listingId: string): Promise<TaggingEstimateDto>;
    start(listingId: string): Promise<TaggingRunDto>;
  };
  shell: {
    openPath(path: string): Promise<OpenPathResult>;
  };
  voice: {
    modelStatus(): Promise<VoiceModelStatus>;
    downloadModel(): Promise<VoiceModelStatus>;
    cancelModel(): Promise<VoiceModelStatus>;
    /** Catalogue and bundled previews. */
    list(): Promise<VoiceOption[]>;
    /** Persists the selected studio voice. */
    setVoice(voiceId: string): Promise<void>;
  };
  onJobProgress(listener: (event: JobProgressEvent) => void): () => void;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
}

export const api: ZeniconicApi = {
  get isDesktop() {
    return bridge() !== undefined;
  },

  listings: {
    async list() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('listings:list');
      return demoList.map((record) => ({ ...record }));
    },

    async create(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('listings:create', input);
      return demoCreate(input);
    },

    async get(id) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('listings:get', id);
      return demoList.find((record) => record.id === id);
    },

    async updateFacts(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('listings:updateFacts', input);
      return demoUpdateFacts(input.listingId, input.facts);
    },
  },

  analysis: {
    async chooseFolder() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('analysis:chooseFolder');
      return null;
    },

    async start(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('analysis:start', input);
      demoVariantsFor(input.listingId);
      return { jobId: `job_demo_${Date.now()}` };
    },
  },

  dialog: {
    async chooseReference() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('dialog:chooseReference');
      return null;
    },

    async chooseRemix() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('dialog:chooseRemix');
      return null;
    },
  },

  reference: {
    async analyze(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('reference:analyze', input);
      throw new Error('Reference analysis needs the desktop app.');
    },

    async get(listingId) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('reference:get', listingId);
      return null;
    },

    async clear(listingId) {
      const desktop = bridge();
      if (desktop) await desktop.invoke('reference:clear', listingId);
    },
  },

  remix: {
    async analyze(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('remix:analyze', input);
      throw new Error('Remix analysis needs the desktop app.');
    },

    async get(listingId) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('remix:get', listingId);
      return null;
    },

    async create(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('remix:create', input);
      throw new Error('Remix creation needs the desktop app.');
    },

    async reorder(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('remix:reorder', input);
      throw new Error('Reordering a remix needs the desktop app.');
    },

    async retag(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('remix:retag', input);
      throw new Error('Tagging remix scenes needs the desktop app.');
    },
  },

  review: {
    async inspect(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('review:inspect', input);
      throw new Error('Render inspection needs the desktop app.');
    },
  },

  music: {
    async generate(prompt) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('music:generate', prompt);
      throw new Error('Music generation needs the desktop app.');
    },
  },

  variants: {
    async list(listingId) {      const desktop = bridge();
      if (desktop) return desktop.invoke('variants:list', listingId);
      return demoVariantsFor(listingId).map((variant) => ({ ...variant }));
    },

    async approve(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('variants:approve', input);

      const records = demoVariantsFor(input.listingId);
      const index = records.findIndex(
        (variant) => variant.id === input.variantId || variant.look === input.variantId,
      );
      if (index < 0) throw new Error(`Variant "${input.variantId}" was not found.`);
      const updated: VariantSummary = { ...records[index]!, approved: input.approved };
      records[index] = updated;
      return { ...updated };
    },

    async preview(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('variants:preview', input);
      return { stillPath: demoPreviewPath(input.listingId, input.variantId) };
    },
  },

  jobs: {
    async list() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('jobs:list');
      return [];
    },
  },

  shots: {
    async list(listingId) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('shots:list', listingId);
      // Browser preview only: the same demo pool the other screens show.
      return demoCandidates.map((candidate, index) => {
        const startSec = Math.round(index * 3.2 * 10) / 10;
        return {
          shotId: candidate.id,
          sourceId: `s_${candidate.id}`,
          room: candidate.room,
          startSec,
          endSec: Math.round((startSec + candidate.durationSec) * 10) / 10,
          durationSec: candidate.durationSec,
          score: Math.round(candidate.score) / 100,
          reason: candidate.reason,
          ...(candidate.rejected === undefined ? {} : { defects: [candidate.rejected] }),
        };
      });
    },
  },

  chat: {
    async send(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('chat:send', input);
      return demoChatSend(input);
    },

    async apply(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('chat:apply', input);
      return demoChatApply(input);
    },

    async versions(listingId, variantId) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('chat:versions', listingId, variantId);
      return demoChatFor(listingId, variantId).versions.map((version) => ({ ...version }));
    },
  },

  agent: {
    async run(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('agent:run', input);
      // Browser preview: no model, no commit. Same shape as the desktop reply.
      return {
        ok: false,
        reply:
          'The agent needs the desktop app and an OpenRouter key. In the browser preview this button only explains the flow.',
        warnings: ['Browser preview: no model call was made.'],
        edits: [],
        costUsd: 0,
        steps: 0,
        error: 'desktop-only',
      };
    },

    async approve(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('agent:approve', input);
      return { ok: false };
    },
  },

  refine: {
    async preview(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('refine:preview', input);
      throw new Error('Draft previews need the desktop app.');
    },
  },

  export: {
    async start(input) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('export:start', input);

      if (input.profiles.length === 0) throw new Error('Choose at least one output shape.');
      const approved = demoVariantsFor(input.listingId).filter((variant) => variant.approved);
      const list = approved.length > 0 ? approved : demoVariantsFor(input.listingId).slice(0, 1);

      const files = list.flatMap((variant) =>
        input.profiles.map(
          (profile) =>
            `${DEMO_DATA_DIR}\\listings\\${input.listingId}\\exports\\${input.listingId}_${variant.look}_${profile}_v1.mp4`,
        ),
      );
      return {
        files,
        exportDir: `${DEMO_DATA_DIR}\\listings\\${input.listingId}\\exports`,
      };
    },
  },

  settings: {
    async get() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('settings:get');
      return {
        dataDir: DEMO_DATA_DIR,
        modelConfigured: demoKeyConfigured,
        theme: demoTheme,
        voiceId: demoVoiceId,
        version: DEMO_VERSION,
        spendUsd: DEMO_SPEND_USD,
        tagOnAnalyse: false,
      };
    },

    async setTheme(theme) {
      demoTheme = theme;
      const desktop = bridge();
      if (desktop) await desktop.invoke('settings:setTheme', theme);
    },

    async setKey(key) {
      const desktop = bridge();
      if (desktop) {
        await desktop.invoke('settings:setKey', key);
        return;
      }
      const trimmed = key.trim();
      if (trimmed.length < 8) throw new Error('That model key looks too short.');
      demoKeyConfigured = true;
    },

    async keyStatus() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('settings:keyStatus');
      return { configured: demoKeyConfigured };
    },

    async setTagging(enabled) {
      const desktop = bridge();
      if (desktop) {
        await desktop.invoke('settings:setTagging', enabled);
        return;
      }
      throw new Error('Tagging settings need the desktop app.');
    },
  },

  tagging: {
    async estimate(listingId) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('tagging:estimate', listingId);
      return { shots: 0, usd: 0, model: 'desktop only', capUsd: 0.25, tagged: 0 };
    },

    async start(listingId) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('tagging:start', listingId);
      throw new Error('Vision tagging needs the desktop app.');
    },
  },

  shell: {
    async openPath(path) {
      const desktop = bridge();
      if (desktop) return desktop.invoke('shell:openPath', path);
      return {
        ok: false,
        error: 'Opening folders needs the desktop app; this browser preview cannot open Explorer.',
      };
    },
  },

  voice: {
    async modelStatus() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('voice:modelStatus');
      return demoTracks.voiceModel();
    },

    async downloadModel() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('voice:modelDownload');
      demoVoiceInstalled = true;
      return demoTracks.voiceModel();
    },

    async cancelModel() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('voice:modelCancel');
      return demoTracks.voiceModel();
    },

    async list() {
      const desktop = bridge();
      if (desktop) return desktop.invoke('voice:list');
      return demoVoiceGallery();
    },

    async setVoice(voiceId) {
      const desktop = bridge();
      if (desktop) {
        await desktop.invoke('voice:setVoice', voiceId);
        return;
      }
      if (!isVoiceId(voiceId)) throw new Error('Choose a voice from the gallery.');
      demoVoiceId = voiceId;
    },
  },

  onJobProgress(listener) {
    const desktop = bridge();
    if (!desktop) return () => undefined;
    return desktop.onJobProgress(listener);
  },

  onAgentEvent(listener) {
    const desktop = bridge();
    if (!desktop) return () => undefined;
    return desktop.onAgentEvent(listener);
  },
};

export type {
  CaptionMode,
  ChatApplyRequest,
  ChatApplyResult,
  ChatResult,
  ChatSendRequest,
  ChatVersion,
  ExportQuality,
  Facts,
  JobProgressEvent,
  ListingRecord,
  Theme,
  VariantSummary,
  VoiceMode,
  VoiceModelStatus,
  VoiceOption,
};
