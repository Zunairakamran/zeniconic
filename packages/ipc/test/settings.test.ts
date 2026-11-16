import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSettings,
  KEY_STORAGE_UNAVAILABLE,
  SettingsError,
  type SecretCipher,
} from '../src/index';

const KEY = 'sk-or-v1-test-key-123456';
const keyFile = (root: string): string => join(root, 'openrouter.key');

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zeniconic-settings-'));
  roots.push(root);
  return root;
}

/** A stand-in for Electron's DPAPI-backed cipher. */
function cipher(available = true): SecretCipher {
  return {
    available: () => available,
    encrypt: (value) => `enc:${Buffer.from(value, 'utf8').toString('base64')}`,
    decrypt: (value) => Buffer.from(value.replace(/^enc:/, ''), 'base64').toString('utf8'),
  };
}

afterEach(async () => {
  const pending = roots.splice(0);
  await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true })));
});

describe('settings voice selection', () => {
  it('defaults to matilda before anything is saved', async () => {
    const root = await makeRoot();
    const settings = createSettings({ dataDir: root, modelConfigured: false });
    await expect(settings.get()).resolves.toMatchObject({ voiceId: 'matilda' });
  });

  it('persists the selected voice beside the theme', async () => {
    const root = await makeRoot();
    const settings = createSettings({ dataDir: root, modelConfigured: false });
    await settings.setTheme('dark');
    await settings.setVoice('george');

    const file = join(root, 'settings.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(stored).toMatchObject({ version: 1, theme: 'dark', voiceId: 'george' });

    const reopened = createSettings({ dataDir: root, modelConfigured: false });
    await expect(reopened.get()).resolves.toMatchObject({
      theme: 'dark',
      voiceId: 'george',
    });
  });

  it('rejects an unknown voice without changing the file', async () => {
    const root = await makeRoot();
    const settings = createSettings({ dataDir: root, modelConfigured: false });
    await settings.setVoice('lily');

    await expect(settings.setVoice('../secrets')).rejects.toBeInstanceOf(RangeError);
    await expect(settings.setVoice('nobody')).rejects.toBeInstanceOf(RangeError);
    await expect(settings.get()).resolves.toMatchObject({ voiceId: 'lily' });
  });

  it('falls back to matilda on a corrupt or unknown stored voice', async () => {
    const root = await makeRoot();
    await writeFile(
      join(root, 'settings.json'),
      JSON.stringify({ version: 1, theme: 'dark', voiceId: 'from-the-future' }),
      'utf8',
    );
    const settings = createSettings({ dataDir: root, modelConfigured: false });
    await expect(settings.get()).resolves.toMatchObject({
      theme: 'dark',
      voiceId: 'matilda',
    });
  });
});

describe('settings key storage', () => {
  it('refuses to persist without credential storage and keeps a session key', async () => {
    const root = await makeRoot();
    const settings = createSettings({
      dataDir: root,
      modelConfigured: false,
      cipher: cipher(false),
    });

    const failure = settings.setKey(KEY);
    await expect(failure).rejects.toBeInstanceOf(SettingsError);
    await expect(failure).rejects.toMatchObject({
      code: 'E_KEY_STORAGE',
      message: KEY_STORAGE_UNAVAILABLE,
    });

    expect(existsSync(keyFile(root))).toBe(false);
    await expect(settings.keyStatus()).resolves.toEqual({ configured: true });

    // Session only: a fresh process has no key and no file to read.
    const reopened = createSettings({
      dataDir: root,
      modelConfigured: false,
      cipher: cipher(false),
    });
    await expect(reopened.keyStatus()).resolves.toEqual({ configured: false });
  });

  it('deletes a legacy plaintext key on startup and never writes another', async () => {
    const root = await makeRoot();
    await writeFile(keyFile(root), `${KEY}\n`, 'utf8');
    expect(existsSync(keyFile(root))).toBe(true);

    // Even with working credential storage, the old plaintext file must go.
    createSettings({ dataDir: root, modelConfigured: false, cipher: cipher(true) });
    expect(existsSync(keyFile(root))).toBe(false);

    await writeFile(keyFile(root), `${KEY}\n`, 'utf8');
    const noCipher = createSettings({ dataDir: root, modelConfigured: false });
    expect(existsSync(keyFile(root))).toBe(false);
    await expect(noCipher.setKey(KEY)).rejects.toMatchObject({ code: 'E_KEY_STORAGE' });
    expect(existsSync(keyFile(root))).toBe(false);
  });

  it('writes only a ciphertext payload when credential storage works', async () => {
    const root = await makeRoot();
    const settings = createSettings({
      dataDir: root,
      modelConfigured: false,
      cipher: cipher(true),
    });

    await settings.setKey(`  ${KEY}  `);

    const raw = await readFile(keyFile(root), 'utf8');
    expect(raw).not.toContain(KEY);
    expect(JSON.parse(raw)).toMatchObject({ version: 1, encrypted: true });
    await expect(settings.keyStatus()).resolves.toEqual({ configured: true });

    const reopened = createSettings({
      dataDir: root,
      modelConfigured: false,
      cipher: cipher(true),
    });
    await expect(reopened.keyStatus()).resolves.toEqual({ configured: true });
  });

  it('drops an encrypted file when the store that wrote it is unavailable', async () => {
    const root = await makeRoot();
    const working = createSettings({
      dataDir: root,
      modelConfigured: false,
      cipher: cipher(true),
    });
    await working.setKey(KEY);
    expect(existsSync(keyFile(root))).toBe(true);

    createSettings({ dataDir: root, modelConfigured: false, cipher: cipher(false) });
    expect(existsSync(keyFile(root))).toBe(false);
  });

  it('returns the key to the main process without exposing it over IPC', async () => {
    const root = await makeRoot();
    const settings = createSettings({
      dataDir: root,
      modelConfigured: false,
      cipher: cipher(true),
    });

    await expect(settings.getKey()).resolves.toBeUndefined();
    await settings.setKey(KEY);
    await expect(settings.getKey()).resolves.toBe(KEY);

    // A new process decrypts the same file; the session cache is per instance.
    const reopened = createSettings({
      dataDir: root,
      modelConfigured: false,
      cipher: cipher(true),
    });
    await expect(reopened.getKey()).resolves.toBe(KEY);
  });

  it('uses the injected environment key and keeps a session key when storage is unavailable', async () => {
    const fromEnv = createSettings({
      dataDir: await makeRoot(),
      modelConfigured: false,
      apiKey: () => '  sk-or-v1-from-env-123456  ',
      cipher: cipher(true),
    });
    await expect(fromEnv.getKey()).resolves.toBe('sk-or-v1-from-env-123456');

    const sessionOnly = createSettings({
      dataDir: await makeRoot(),
      modelConfigured: false,
      cipher: cipher(false),
    });
    await expect(sessionOnly.setKey(KEY)).rejects.toMatchObject({
      code: 'E_KEY_STORAGE',
    });
    await expect(sessionOnly.getKey()).resolves.toBe(KEY);
  });
});
