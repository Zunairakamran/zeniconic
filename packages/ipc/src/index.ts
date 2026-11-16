/**
 * Typed IPC contract and the Electron-free handler table.
 *
 * `apps/desktop/main.ts` wires `createHandlers` to `ipcMain`; the sandboxed
 * preload exposes only these channels to the renderer. Nothing in this package
 * imports Electron or touches the window, which is what keeps the handlers
 * testable in a plain Node process.
 */

export type {
  CaptionMode,
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
  SettingsSnapshot,
  Theme,
  VariantLook,
  VariantPreview,
  VariantSummary,
  VoiceMode,
  VoiceModelPhase,
  VoiceModelStatus,
} from './contract';

export { CHANNELS, JOB_PROGRESS_CHANNEL, isChannel } from './contract';

export { createHandlers, IpcError } from './handlers';
export type {
  ChatPort,
  HandlerDeps,
  IpcErrorCode,
  PipelinePort,
  RunnerPort,
  SettingsPortLike,
  StorePort,
  VoiceModelPort,
} from './handlers';

export { createSettings, KEY_STORAGE_UNAVAILABLE, SettingsError } from './settings';
export type { CreateSettingsOptions, SecretCipher, SettingsPort, SettingsErrorCode } from './settings';
