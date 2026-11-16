/**
 * App settings, persisted as one JSON file next to the listings.
 *
 * ADR-006: no native modules. The file is written with the same
 * temp-write-and-rename discipline as the listing store, so a crash mid-save
 * leaves the previous settings intact.
 *
 * Reading is forgiving — a corrupt settings file must never stop the app from
 * opening — while writing validates the value first.
 */

import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_VOICE_ID, isVoiceId } from '../../../services/voice/src/voices';
import type { KeyStatus, SettingsSnapshot, Theme } from './contract';

/** Stable failure codes; `E_KEY_STORAGE` is shown to the user verbatim. */
export type SettingsErrorCode = 'E_KEY_STORAGE';

export class SettingsError extends Error {
  readonly code: SettingsErrorCode;

  constructor(code: SettingsErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SettingsError';
    this.code = code;
  }
}

/** The sentence Settings shows when Windows cannot protect the key. */
export const KEY_STORAGE_UNAVAILABLE =
  'Windows credential storage is unavailable, so the model key was not saved to disk. It is kept in memory for this session only.';

/** Minimal encryption seam so settings stay Electron-free. */
export interface SecretCipher {
  available(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface SettingsPort {
  get(): Promise<SettingsSnapshot>;
  setTheme(theme: Theme): Promise<void>;
  setKey(key: string): Promise<void>;
  keyStatus(): Promise<KeyStatus>;
  /** Persists the selected studio voice; unknown ids are rejected. */
  setVoice(voiceId: string): Promise<void>;
  /**
   * The decrypted key this machine can use, or `undefined`. This is the only
   * way the rest of the app reaches the secret; it is never logged or returned
   * over IPC.
   */
  getKey(): Promise<string | undefined>;
}

export interface CreateSettingsOptions {
  /** Absolute store root (`.../data`). */
  dataDir: string;
  /** A boolean, or a function read at call time so tests can flip it. */
  modelConfigured: boolean | (() => boolean);
  /**
   * Development fallback (`OPENROUTER_API_KEY`). Packaged builds pass nothing
   * and rely on the OS-encrypted file instead.
   */
  apiKey?: () => string | undefined;
  /**
   * Electron's `safeStorage` adapter. When absent or unavailable the key is
   * written to a 0600 file instead.
   */
  cipher?: SecretCipher;
  /** App version shown in Settings → Diagnostics. */
  version?: string;
  /** Spend recorded for this machine, in USD; a function is read at call time. */
  spendUsd?: number | (() => number);
}

const SETTINGS_FILE = 'settings.json';
const KEY_FILE = 'openrouter.key';
const DEFAULT_THEME: Theme = 'light';
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 512;

interface SettingsFile {
  version: 1;
  theme: Theme;
  voiceId: string;
}

interface KeyFile {
  version: 1;
  encrypted: true;
  value: string;
}

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_SETTINGS: SettingsFile = {
  version: 1,
  theme: DEFAULT_THEME,
  voiceId: DEFAULT_VOICE_ID,
};

/** Forgiving on read; every field falls back independently. */
async function readSettings(file: string): Promise<SettingsFile> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as { theme?: unknown; voiceId?: unknown };
      return {
        version: 1,
        theme: isTheme(record.theme) ? record.theme : DEFAULT_THEME,
        voiceId: isVoiceId(record.voiceId) ? record.voiceId : DEFAULT_VOICE_ID,
      };
    }
  } catch {
    // Corrupt settings are not fatal; fall through to the defaults.
  }

  return { ...DEFAULT_SETTINGS };
}

async function writeSettings(file: string, next: SettingsFile): Promise<void> {
  const tmp = `${file}.tmp`;
  const json = `${JSON.stringify(next, null, 2)}\n`;

  await mkdir(dirname(file), { recursive: true });

  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(json, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new Error(`Could not save settings to ${file}: ${messageOf(error)}`, { cause: error });
  }
}

/** True when the key file holds a non-empty value. Corrupt files count as unset. */
async function hasStoredKey(file: string): Promise<boolean> {
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.trim().length === 0) return false;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const value = (parsed as { value?: unknown }).value;
        return typeof value === 'string' && value.trim().length > 0;
      }
    } catch {
      // A plain-text fallback file is itself the key; any bytes mean configured.
    }
    return true;
  } catch {
    return false;
  }
}

function cipherAvailable(cipher: SecretCipher): boolean {
  try {
    return cipher.available() === true;
  } catch {
    return false;
  }
}

/**
 * Writes the key only as a ciphertext payload. There is deliberately no
 * plaintext fallback: a provider key must never sit on disk unprotected
 * (NFR-22), and `mode` 0600 is a no-op on Windows.
 */
async function writeKeyFile(file: string, key: string, cipher: SecretCipher): Promise<void> {  const tmp = `${file}.tmp`;

  if (!cipherAvailable(cipher)) {
    throw new SettingsError('E_KEY_STORAGE', KEY_STORAGE_UNAVAILABLE);
  }

  let data: string;
  try {
    const encrypted: KeyFile = { version: 1, encrypted: true, value: cipher.encrypt(key) };
    data = `${JSON.stringify(encrypted)}\n`;
  } catch (error) {
    throw new SettingsError('E_KEY_STORAGE', KEY_STORAGE_UNAVAILABLE, { cause: error });
  }

  await mkdir(dirname(file), { recursive: true });
  try {
    const handle = await open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    // Never include the key or a value-bearing message.
    throw new Error('Could not save the model key to this machine.', { cause: error });
  }
}

/** True when the file is the encrypted payload this module writes. */
function isEncryptedKeyPayload(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const value = (parsed as { value?: unknown }).value;
    return (parsed as { encrypted?: unknown }).encrypted === true && typeof value === 'string';
  } catch {
    return false;
  }
}

/**
 * Removes a legacy plaintext key file at startup. An encrypted payload is kept
 * only when the OS credential store that can decrypt it is available.
 */
function sweepKeyFile(file: string, cipherUsable: boolean): void {
  try {
    const raw = readFileSync(file, 'utf8');
    if (raw.trim().length === 0 || (cipherUsable && isEncryptedKeyPayload(raw))) {
      if (raw.trim().length === 0) rmSync(file, { force: true });
      return;
    }
    rmSync(file, { force: true });
  } catch {
    // Missing or unreadable key file: nothing to remove.
  }
}

/**
 * Creates the settings port. Theme writes are serialised so two quick clicks
 * cannot interleave their temp files.
 */
export function createSettings(options: CreateSettingsOptions): SettingsPort {
  if (typeof options.dataDir !== 'string' || options.dataDir.trim().length === 0) {
    throw new RangeError('Settings need a non-empty data directory.');
  }

  const dataDir = resolve(options.dataDir);
  const file = join(dataDir, SETTINGS_FILE);
  const keyFile = join(dataDir, KEY_FILE);
  const version =
    typeof options.version === 'string' && options.version.trim().length > 0
      ? options.version.trim()
      : '0.0.0';
  const cipherUsable =
    options.cipher !== undefined && cipherAvailable(options.cipher);

  // Never start with a provider key unprotected on disk. Legacy plaintext
  // files are deleted; an encrypted file survives only when the OS store is
  // available to decrypt it.
  sweepKeyFile(keyFile, cipherUsable);

  /** Session-only fallback when Windows credential storage is unavailable. */
  let sessionKey: string | undefined;

  const envConfigured = (): boolean => {
    const value =
      typeof options.modelConfigured === 'function'
        ? options.modelConfigured()
        : options.modelConfigured;
    return value === true;
  };

  /** Bad ledger values are a display bug, never a reason to fail Settings. */
  const spent = (): number => {
    const value =
      typeof options.spendUsd === 'function' ? options.spendUsd() : options.spendUsd;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  };

  const configured = async (): Promise<boolean> =>
    envConfigured() || sessionKey !== undefined || (await hasStoredKey(keyFile));

  let pending: Promise<void> = Promise.resolve();

  /** Serialise read-modify-write so two quick changes cannot interleave. */
  const updateSettings = async (patch: Partial<Omit<SettingsFile, 'version'>>): Promise<void> => {
    const write = pending.then(async () => {
      const current = await readSettings(file);
      await writeSettings(file, { ...current, ...patch, version: 1 });
    });
    pending = write.catch(() => undefined);
    await write;
  };

  return {
    async get(): Promise<SettingsSnapshot> {
      const stored = await readSettings(file);
      return {
        dataDir,
        modelConfigured: await configured(),
        theme: stored.theme,
        voiceId: stored.voiceId,
        version,
        spendUsd: spent(),
      };
    },

    async setTheme(theme: Theme): Promise<void> {
      if (!isTheme(theme)) {
        throw new RangeError(`Unknown theme "${String(theme)}"; expected light or dark.`);
      }
      await updateSettings({ theme });
    },

    async setVoice(voiceId: string): Promise<void> {
      if (typeof voiceId !== 'string' || !isVoiceId(voiceId)) {
        throw new RangeError(
          `Unknown voice "${String(voiceId)}"; choose one from the voice gallery.`,
        );
      }
      await updateSettings({ voiceId });
    },

    async setKey(key: string): Promise<void> {
      if (typeof key !== 'string') throw new RangeError('A model key must be a string.');
      const value = key.trim();
      if (value.length < MIN_KEY_LENGTH || value.length > MAX_KEY_LENGTH) {
        throw new RangeError('That model key is not the right length.');
      }
      if (/[\u0000-\u0020\u007f]/.test(value)) {
        throw new RangeError('A model key must not contain spaces or control characters.');
      }

      // The current run can always use the key, even when it cannot be stored.
      sessionKey = value;

      if (!cipherUsable) {
        // Belt and braces: a previous build may have left a plaintext file.
        await rm(keyFile, { force: true }).catch(() => undefined);
        throw new SettingsError('E_KEY_STORAGE', KEY_STORAGE_UNAVAILABLE);
      }

      const cipher = options.cipher;
      if (cipher === undefined) {
        await rm(keyFile, { force: true }).catch(() => undefined);
        throw new SettingsError('E_KEY_STORAGE', KEY_STORAGE_UNAVAILABLE);
      }

      const write = pending.then(() => writeKeyFile(keyFile, value, cipher));
      pending = write.catch(() => undefined);
      await write;
    },

    async keyStatus(): Promise<KeyStatus> {
      return { configured: await configured() };
    },

    async getKey(): Promise<string | undefined> {
      if (sessionKey !== undefined) return sessionKey;

      const injected = options.apiKey?.();
      if (typeof injected === 'string' && injected.trim().length > 0) {
        return injected.trim();
      }

      let raw: string;
      try {
        raw = await readFile(keyFile, 'utf8');
      } catch {
        return undefined;
      }
      if (raw.trim().length === 0 || !isEncryptedKeyPayload(raw)) {
        // Legacy plaintext files are swept at startup and are never used.
        return undefined;
      }
      if (!cipherUsable || options.cipher === undefined) return undefined;

      try {
        const parsed = JSON.parse(raw) as { value?: unknown };
        if (typeof parsed.value !== 'string') return undefined;
        const value = options.cipher.decrypt(parsed.value).trim();
        return value.length > 0 ? value : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
