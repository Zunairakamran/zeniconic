export type StyleErrorCode = 'E_STYLE_NOT_FOUND' | 'E_STYLE_INVALID';

/**
 * Every failure in this package carries a stable code. The message repeats it
 * so a log line is enough to tell a missing look from a broken pack.
 */
export class StyleError extends Error {
  readonly code: StyleErrorCode;
  readonly issues: readonly string[];

  constructor(code: StyleErrorCode, message: string, issues: readonly string[] = []) {
    super(`${code}: ${message}`);
    this.name = 'StyleError';
    this.code = code;
    this.issues = issues;
  }
}
