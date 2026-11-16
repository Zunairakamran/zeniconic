import type { AiErrorCode } from './types';

/** Exponential backoff for retries: 300 ms, 900 ms, 2700 ms, … */
export const RETRY_DELAYS_MS = [300, 900, 2700] as const;

export function retryDelayMs(retryIndex: number): number {
  const known = RETRY_DELAYS_MS[retryIndex];
  if (known !== undefined) return known;
  const last = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 300;
  const overflow = retryIndex - RETRY_DELAYS_MS.length + 1;
  return last * 3 ** Math.max(1, overflow);
}

/** 429 and 5xx are transient; 4xx means the request or key is wrong. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function codeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'E_AUTH';
  if (status === 429) return 'E_RATE';
  if (status >= 500) return 'E_SERVER';
  return 'E_BAD_REQUEST';
}

const API_KEY_PATTERN = /sk-or-v1-[A-Za-z0-9_-]+/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Removes credentials from any text that might reach a log, a message or a
 * crash report. The literal key is redacted too, in case the provider echoes a
 * differently shaped credential.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(API_KEY_PATTERN, 'sk-or-v1-…').replace(BEARER_PATTERN, 'Bearer …');
  for (const secret of secrets) {
    if (secret.trim().length >= 4) out = out.split(secret).join('sk-or-v1-…');
  }
  return out;
}

/** A short, redacted slice of a provider body for error messages. */
export function excerpt(text: string, limit = 300, secrets: readonly string[] = []): string {
  const redacted = redactSecrets(text, secrets).trim();
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, limit)}…`;
}
