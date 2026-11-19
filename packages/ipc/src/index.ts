/**
 * Typed IPC contract and the Electron-free handler table.
 *
 * `apps/desktop/main.ts` wires `createHandlers` to `ipcMain`; the sandboxed
 * preload exposes only these channels to the renderer. Nothing in this package
 * imports Electron or touches the window, which is what keeps the handlers
 * testable in a plain Node process.
 */

export type {
  AgentEditDto,
  AgentEventDto,
  AgentRunRequest,
  AgentRunResponse,
  Autonomy,
  CaptionMode,
  CaptionStyleId,
  Channel,
  ChatApplyRequest,
  ChatApplyResult,
  ChatResult,
  ChatSendRequest,
  ChatVersion,
  ExportQuality,
  ExportRequest,
  ExportResult,
  Handler,
  Handlers,
  IpcContract,
  JobProgressEvent,
  JobProgressStatus,
  KeyStatus,
  OpenPathResult,
  ReferenceProfileDto,
  RemixPreset,
  RemixSlotDto,
  RemixStoryboardDto,
  RemixTranscriptionDto,
  RenderInspectionDto,
  MusicGenerationDto,
  RefinePreviewDto,
  SettingsSnapshot,
  ShotRow,
  TaggingEstimateDto,
  TaggingRunDto,
  Theme,
  VariantLook,
  VariantPreview,
  VariantSummary,
  VoiceMode,
  VoiceModelPhase,
  VoiceModelStatus,
  VoiceOption,
} from './contract';

export { CHANNELS, JOB_PROGRESS_CHANNEL, AGENT_EVENT_CHANNEL, isChannel } from './contract';

export { createHandlers, IpcError } from './handlers';
export type {
  AgentPort,
  ChatPort,
  HandlerDeps,
  IpcErrorCode,
  PipelinePort,
  ReferencePort,
  RemixPort,
  ReviewPort,
  MusicPort,
  RunnerPort,
  SettingsPortLike,
  SpendPort,
  StorePort,
  TaggingPort,
  VoiceGalleryPort,
  VoiceModelPort,
} from './handlers';

export { createSettings, KEY_STORAGE_UNAVAILABLE, SettingsError } from './settings';
export type { CreateSettingsOptions, SecretCipher, SettingsPort, SettingsErrorCode } from './settings';
