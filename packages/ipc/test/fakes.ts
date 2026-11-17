/**
 * In-memory fakes for the IPC handler suite. They implement the same ports the
 * Electron main process passes in, so the tests never import Electron.
 */

import type { CreateListingInput, Facts, ListingRecord } from '@zeniconic/store';
import type { JobRecord, JobStatus, Stage } from '@zeniconic/jobs';
import type {
  AgentPort,
  AgentRunResponse,
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
  ReferencePort,
  ReferenceProfileDto,
  RemixPort,
  RemixPreset,
  RemixStoryboardDto,
  RenderInspectionDto,
  ReviewPort,
  RunnerPort,
  SettingsPortLike,
  SettingsSnapshot,
  ShotRow,
  StorePort,
  TaggingEstimateDto,
  TaggingPort,
  TaggingRunDto,
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

  enqueue(
    listingId: string,
    options: { kind?: 'analysis' | 'export' | 'agent'; checkpoint?: string } = {},
  ): JobRecord {
    this.enqueued.push(listingId);
    const job: JobRecord = {
      id: `job_${String(this.jobs.size + 1).padStart(4, '0')}_${listingId}`,
      listingId,
      stage: 'index',
      status: 'queued',
      attempts: 0,
      createdAt: NOW,
      updatedAt: NOW,
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async setCheckpoint(jobId: string, checkpoint: string): Promise<JobRecord> {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`No job ${jobId}`);
    job.checkpoint = checkpoint;
    return { ...job };
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job !== undefined && job.status === 'queued') job.status = 'cancelled';
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

  shots: ShotRow[] = [];

  async listShots(_listingId: string): Promise<ShotRow[]> {
    return this.shots;
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
  tagOnAnalyse = false;

  async get(): Promise<SettingsSnapshot> {
    return {
      dataDir: this.dataDir,
      modelConfigured: this.configured,
      theme: this.theme,
      voiceId: this.voiceId,
      version: this.version,
      spendUsd: this.spendUsd,
      tagOnAnalyse: this.tagOnAnalyse,
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

export class FakeAgent implements AgentPort {
  readonly runs: Array<{
    listingId: string;
    variantId: string;
    message: string;
    autonomy?: 'suggest' | 'ask' | 'auto';
  }> = [];
  readonly approvals: Array<{ runId: string; approved: boolean }> = [];
  result: AgentRunResponse & { previewPath?: string } = {
    ok: true,
    runId: 'agent_test_1',
    reply: 'Made the opening warmer.',
    diff: '1 change: grade',
    versionId: 'calm-v2',
    applied: true,
    warnings: [],
    edits: [{ capability: 'apply_grade', summary: 'Applied warm grade.', risk: 'low' }],
    costUsd: 0.001,
    steps: 2,
  };
  failure: Error | undefined;
  approveResult = true;

  async run(input: {
    listingId: string;
    variantId: string;
    message: string;
    autonomy?: 'suggest' | 'ask' | 'auto';
  }): Promise<AgentRunResponse> {
    this.runs.push(input);
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }

  approve(runId: string, approved: boolean): boolean {
    this.approvals.push({ runId, approved });
    return this.approveResult;
  }
}

export class FakeTagging implements TaggingPort {
  estimateResult: TaggingEstimateDto = {
    shots: 9,
    usd: 0.0144,
    model: 'perceptron/perceptron-mk1.5',
    capUsd: 0.25,
    tagged: 0,
  };
  runResult: TaggingRunDto = {
    shots: 9,
    tagged: 9,
    failed: 0,
    costUsd: 0.014,
    estimatedUsd: 0.0144,
    model: 'perceptron/perceptron-mk1.5',
  };
  readonly estimates: string[] = [];
  readonly runs: string[] = [];
  failure: Error | undefined;

  async estimate(listingId: string): Promise<TaggingEstimateDto> {
    this.estimates.push(listingId);
    if (this.failure !== undefined) throw this.failure;
    return this.estimateResult;
  }

  async start(listingId: string): Promise<TaggingRunDto> {
    this.runs.push(listingId);
    if (this.failure !== undefined) throw this.failure;
    return this.runResult;
  }
}

export class FakeReference implements ReferencePort {
  picked: string | null = 'C:/refs/luxury.mp4';
  profile: ReferenceProfileDto = {
    analyzedAt: '2026-11-17T10:00:00.000Z',
    fileName: 'luxury.mp4',
    profile: {
      pacing: 'fast',
      aspect: '9:16',
      motion: 'medium',
      averageShotSec: 2.1,
      cutDensityPerMin: 28,
      palette: ['#112233', '#445566', '#778899'],
      confidence: 0.82,
      style: { style: 'fast warm edit', transition_style: 'hard cuts' },
    },
  };
  readonly analyzed: Array<{ listingId: string; file: string }> = [];
  readonly cleared: string[] = [];
  failure: Error | undefined;

  async chooseFile(): Promise<string | null> {
    return this.picked;
  }

  async analyze(listingId: string, file: string): Promise<ReferenceProfileDto> {
    this.analyzed.push({ listingId, file });
    if (this.failure !== undefined) throw this.failure;
    return this.profile;
  }

  async get(): Promise<ReferenceProfileDto | null> {
    if (this.failure !== undefined) throw this.failure;
    return this.profile;
  }

  async clear(listingId: string): Promise<void> {
    this.cleared.push(listingId);
    if (this.failure !== undefined) throw this.failure;
  }
}

export class FakeRemix implements RemixPort {
  picked: string | null = 'C:/remix/cut.mp4';
  storyboard: RemixStoryboardDto = {
    fileName: 'cut.mp4',
    analyzedAt: '2026-11-17T10:00:00.000Z',
    durationSec: 30,
    fps: 30,
    orientation: 'portrait',
    shots: [{ shotId: 'sh1', startSec: 0, endSec: 3, durationSec: 3 }],
    presets: {
      marketing: [
        { order: 0, beat: 'hook', shotId: 'sh1', room: 'living', inSec: 0, outSec: 3, targetSec: 2.4, reason: 'Open on the light.' },
      ],
      original: [],
      price_led: [],
    },
    warnings: [],
  };
  readonly analyzed: Array<{ listingId: string; file: string }> = [];
  readonly created: Array<{ listingId: string; preset: string }> = [];
  readonly reordered: Array<{ listingId: string; preset: string; order: string[] }> = [];
  readonly retagged: Array<{ listingId: string; shotId: string; room: string }> = [];
  failure: Error | undefined;

  async chooseFile(): Promise<string | null> {
    return this.picked;
  }

  async analyze(listingId: string, file: string, transcribe?: boolean): Promise<RemixStoryboardDto> {
    this.analyzed.push({ listingId, file, ...(transcribe === undefined ? {} : { transcribe }) });
    if (this.failure !== undefined) throw this.failure;
    return this.storyboard;
  }

  async get(): Promise<RemixStoryboardDto | null> {
    if (this.failure !== undefined) throw this.failure;
    return this.storyboard;
  }

  async create(listingId: string, preset: RemixPreset): Promise<VariantSummary> {
    this.created.push({ listingId, preset });
    if (this.failure !== undefined) throw this.failure;
    return {
      id: 'remix',
      look: 'social',
      format: 'social_hook',
      targetDurationSec: 30,
      clipCount: 12,
      score: 50,
      edlPath: 'variants/remix.json',
      approved: false,
    };
  }

  async reorder(
    listingId: string,
    preset: RemixPreset,
    order: string[],
  ): Promise<RemixStoryboardDto> {
    this.reordered.push({ listingId, preset, order });
    if (this.failure !== undefined) throw this.failure;

    const slots = order.map((shotId, index) => {
      const found = this.storyboard.presets[preset].find((slot) => slot.shotId === shotId);
      if (found === undefined) throw new Error(`Shot "${shotId}" is not part of this preset.`);
      return { ...found, order: index };
    });
    this.storyboard = {
      ...this.storyboard,
      presets: { ...this.storyboard.presets, [preset]: slots },
      orders: { ...this.storyboard.orders, [preset]: order },
    };
    return this.storyboard;
  }

  async retag(listingId: string, shotId: string, room: string): Promise<RemixStoryboardDto> {
    this.retagged.push({ listingId, shotId, room });
    if (this.failure !== undefined) throw this.failure;

    const presets = { ...this.storyboard.presets };
    for (const preset of Object.keys(presets) as RemixPreset[]) {
      presets[preset] = presets[preset].map((slot) =>
        slot.shotId === shotId ? { ...slot, room } : slot,
      );
    }
    this.storyboard = {
      ...this.storyboard,
      presets,
      rooms: { ...this.storyboard.rooms, [shotId]: room },
    };
    return this.storyboard;
  }
}

export class FakeReview implements ReviewPort {
  result: RenderInspectionDto = {
    verdict: 'retry',
    score: 0.62,
    summary: 'Price card sits under the caption block.',
    issues: [
      { issue: 'price card low', severity: 'medium', atSec: 31.2, detail: 'Card under captions.' },
    ],
    model: 'google/gemini-4-hydrogen',
    costUsd: 0.0021,
    frames: [3, 9, 15, 22, 28, 34],
  };
  readonly calls: Array<{ file: string; facts?: Record<string, string | number | undefined> }> = [];
  failure: Error | undefined;

  async inspect(input: {
    file: string;
    facts?: Record<string, string | number | undefined>;
  }): Promise<RenderInspectionDto> {
    this.calls.push(input);
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }
}
