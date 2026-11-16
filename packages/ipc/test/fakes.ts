/**
 * In-memory fakes for the IPC handler suite. They implement the same ports the
 * Electron main process passes in, so the tests never import Electron.
 */

import type { CreateListingInput, Facts, ListingRecord } from '@zeniconic/store';
import type { JobRecord, JobStatus, Stage } from '@zeniconic/jobs';
import type {
  CaptionMode,
  ChatApplyRequest,
  ChatApplyResult,
  ChatPort,
  ChatResult,
  ChatSendRequest,
  ChatVersion,
  ExportQuality,
  ExportResult,
  KeyStatus,
  PipelinePort,
  RunnerPort,
  SettingsPortLike,
  SettingsSnapshot,
  StorePort,
  Theme,
  VariantPreview,
  VariantSummary,
  VoiceMode,
} from '../src/index';

const NOW = '2026-11-15T09:00:00.000Z';

export class FakeStore implements StorePort {
  readonly records = new Map<string, ListingRecord>();
  readonly updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  private sequence = 0;

  seed(record: Partial<ListingRecord> & { id: string }): ListingRecord {
    const facts: Facts = { address: record.address ?? '12 Oak Avenue', currency: 'GBP' };
    const full: ListingRecord = {
      version: 1,
      id: record.id,
      address: record.address ?? '12 Oak Avenue',
      createdAt: record.createdAt ?? NOW,
      updatedAt: record.updatedAt ?? NOW,
      status: record.status ?? 'draft',
      facts: record.facts ?? facts,
      clipCount: record.clipCount ?? 0,
      ...(record.notes === undefined ? {} : { notes: record.notes }),
    };
    this.records.set(full.id, full);
    return full;
  }

  async list(): Promise<ListingRecord[]> {
    return [...this.records.values()];
  }

  async get(id: string): Promise<ListingRecord | undefined> {
    return this.records.get(id);
  }

  async create(input: CreateListingInput): Promise<ListingRecord> {
    this.sequence += 1;
    const slug = input.address
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const id = `2026-11-15-${slug}`;
    const facts: Facts = {
      address: input.address,
      currency: input.facts?.currency ?? 'GBP',
      ...(input.facts?.price === undefined ? {} : { price: input.facts.price }),
      ...(input.facts?.beds === undefined ? {} : { beds: input.facts.beds }),
      ...(input.facts?.baths === undefined ? {} : { baths: input.facts.baths }),
      ...(input.facts?.sqft === undefined ? {} : { sqft: input.facts.sqft }),
    };
    const record: ListingRecord = {
      version: 1,
      id,
      address: input.address,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'draft',
      facts,
      clipCount: 0,
    };
    this.records.set(id, record);
    return record;
  }

  async update(
    id: string,
    patch: Partial<Omit<ListingRecord, 'id' | 'version' | 'createdAt'>>,
  ): Promise<ListingRecord> {
    const current = this.records.get(id);
    if (current === undefined) throw new Error(`No listing ${id}`);
    this.updates.push({ id, patch: { ...patch } });
    const next: ListingRecord = { ...current, ...patch, updatedAt: NOW };
    this.records.set(id, next);
    return next;
  }
}

export class FakeRunner implements RunnerPort {
  readonly enqueued: string[] = [];
  readonly runCalls: string[] = [];
  readonly jobs = new Map<string, JobRecord>();
  finalStatus: JobStatus = 'complete';
  finalStage: Stage = 'done';
  failure: string | undefined;

  enqueue(listingId: string): JobRecord {
    this.enqueued.push(listingId);
    const job: JobRecord = {
      id: `job_${String(this.jobs.size + 1).padStart(4, '0')}_${listingId}`,
      listingId,
      stage: 'index',
      status: 'queued',
      attempts: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async run(jobId: string): Promise<JobRecord> {
    this.runCalls.push(jobId);
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`No job ${jobId}`);
    const finished: JobRecord = {
      ...job,
      stage: this.finalStage,
      status: this.finalStatus,
      updatedAt: NOW,
      ...(this.failure === undefined ? {} : { error: this.failure }),
    };
    this.jobs.set(jobId, finished);
    return { ...finished };
  }

  list(): JobRecord[] {
    return [...this.jobs.values()];
  }
}

export interface PreparedAnalysis {
  jobId: string;
  listingId: string;
  folder: string;
}

export interface ExportCall {
  listing: ListingRecord;
  profiles: string[];
  quality: ExportQuality;
  captions: CaptionMode;
  voice: VoiceMode;
}

export class FakePipeline implements PipelinePort {
  readonly prepared: PreparedAnalysis[] = [];
  readonly exports: ExportCall[] = [];
  readonly approvals: Array<{ listingId: string; variantId: string; approved: boolean }> = [];
  readonly previews: Array<{ listingId: string; variantId: string }> = [];
  output = 'D:/video/data/listings/2026-11-15-12-oak-avenue/exports/out.mp4';
  outputDir = 'D:/video/data/listings/2026-11-15-12-oak-avenue/exports';
  variants: VariantSummary[] = [];

  prepareAnalysis(input: PreparedAnalysis): void {
    this.prepared.push(input);
  }

  async listVariants(_listingId: string): Promise<VariantSummary[]> {
    return this.variants;
  }

  async approveVariant(input: {
    listingId: string;
    variantId: string;
    approved: boolean;
  }): Promise<VariantSummary> {
    this.approvals.push(input);
    const index = this.variants.findIndex((variant) => variant.id === input.variantId);
    const current = this.variants[index];
    const updated: VariantSummary = {
      id: input.variantId,
      look: current?.look ?? 'calm',
      format: current?.format ?? 'cinematic_hero',
      targetDurationSec: current?.targetDurationSec ?? 30,
      clipCount: current?.clipCount ?? 0,
      score: current?.score ?? 0,
      edlPath: current?.edlPath ?? '',
      approved: input.approved,
    };
    if (index >= 0) this.variants[index] = updated;
    return updated;
  }

  async previewVariant(input: {
    listingId: string;
    variantId: string;
  }): Promise<VariantPreview> {
    this.previews.push(input);
    return { stillPath: `D:/video/data/${input.variantId}.jpg` };
  }

  async exportListing(input: ExportCall): Promise<ExportResult> {
    this.exports.push(input);
    return { files: [this.output], exportDir: this.outputDir };
  }
}

export class FakeSettings implements SettingsPortLike {
  theme: Theme = 'light';
  readonly themes: Theme[] = [];
  readonly keys: string[] = [];
  readonly voiceIds: string[] = [];
  dataDir = 'D:/video/data';
  configured = true;
  voiceId = 'matilda';
  version = '0.1.0';
  spendUsd = 1.84;

  async get(): Promise<SettingsSnapshot> {
    return {
      dataDir: this.dataDir,
      modelConfigured: this.configured,
      theme: this.theme,
      voiceId: this.voiceId,
      version: this.version,
      spendUsd: this.spendUsd,
    };
  }

  async setTheme(theme: Theme): Promise<void> {
    this.themes.push(theme);
    this.theme = theme;
  }

  async setKey(key: string): Promise<void> {
    this.keys.push(key);
    this.configured = true;
  }

  async keyStatus(): Promise<KeyStatus> {
    return { configured: this.configured };
  }

  async setVoice(voiceId: string): Promise<void> {
    this.voiceIds.push(voiceId);
    this.voiceId = voiceId;
  }
}

export class FakeChat implements ChatPort {
  readonly sends: ChatSendRequest[] = [];
  readonly applies: ChatApplyRequest[] = [];
  readonly versionCalls: Array<{ listingId: string; variantId: string }> = [];
  result: ChatResult = {
    reply: 'Done.',
    diff: '1 change: living room → kitchen',
    versionId: 'calm-v1',
    warnings: [],
  };
  versionList: ChatVersion[] = [
    { id: 'calm-v1', createdAt: '2026-11-15T09:00:00.000Z', summary: '1 change: living room → kitchen' },
  ];
  failure: Error | undefined;
  applyResult: ChatApplyResult = { ok: true };

  async send(input: ChatSendRequest): Promise<ChatResult> {
    this.sends.push(input);
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }

  async apply(input: ChatApplyRequest): Promise<ChatApplyResult> {
    this.applies.push(input);
    if (this.failure !== undefined) throw this.failure;
    return this.applyResult;
  }

  async versions(_listingId: string, _variantId: string): Promise<ChatVersion[]> {
    this.versionCalls.push({ listingId: _listingId, variantId: _variantId });
    if (this.failure !== undefined) throw this.failure;
    return this.versionList;
  }
}
