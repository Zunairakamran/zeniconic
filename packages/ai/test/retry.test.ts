import { describe, expect, it } from 'vitest';
import {
  RETRY_DELAYS_MS,
  codeForStatus,
  excerpt,
  isRetryableStatus,
  redactSecrets,
  retryDelayMs,
} from '../src/index';

describe('retry policy', () => {
  it('backs off 300, 900, 2700 ms and then keeps tripling', () => {
    expect(RETRY_DELAYS_MS).toEqual([300, 900, 2700]);
    expect([0, 1, 2, 3, 4].map(retryDelayMs)).toEqual([300, 900, 2700, 8100, 24300]);
  });

  it('retries only 429 and 5xx', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });

  it('maps statuses onto stable error codes', () => {
    expect(codeForStatus(401)).toBe('E_AUTH');
    expect(codeForStatus(403)).toBe('E_AUTH');
    expect(codeForStatus(429)).toBe('E_RATE');
    expect(codeForStatus(500)).toBe('E_SERVER');
    expect(codeForStatus(503)).toBe('E_SERVER');
    expect(codeForStatus(400)).toBe('E_BAD_REQUEST');
    expect(codeForStatus(404)).toBe('E_BAD_REQUEST');
    expect(codeForStatus(422)).toBe('E_BAD_REQUEST');
  });
});

describe('redaction', () => {
  it('replaces OpenRouter keys and bearer tokens', () => {
    const text = 'key sk-or-v1-abcdef123456 rejected; header Bearer abc.def-123';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('sk-or-v1-abcdef123456');
    expect(redacted).not.toContain('abc.def-123');
    expect(redacted).toContain('sk-or-v1-…');
    expect(redacted).toContain('Bearer …');
  });

  it('replaces an explicitly supplied secret of any shape', () => {
    expect(redactSecrets('token=plain-secret-value', ['plain-secret-value'])).toBe(
      'token=sk-or-v1-…',
    );
  });

  it('ignores very short secrets so ordinary words are not mangled', () => {
    expect(redactSecrets('a cat sat', ['cat'])).toBe('a cat sat');
  });

  it('truncates excerpts to 300 characters after redaction', () => {
    const body = `${'y'.repeat(500)} sk-or-v1-secretsecret`;
    const short = excerpt(body);
    expect(short.length).toBe(301);
    expect(short.endsWith('…')).toBe(true);
    expect(short).not.toContain('secretsecret');
  });
});
