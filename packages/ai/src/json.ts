import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { excerpt } from './retry';
import { AiError } from './types';

const FENCE_PATTERN = /^\s*```(?:json|JSON)?\s*([\s\S]*?)\s*```\s*$/;

let ajvInstance: Ajv2020 | undefined;
const compiled = new WeakMap<object, ValidateFunction>();

function ajv(): Ajv2020 {
  if (ajvInstance === undefined) {
    const instance = new Ajv2020({ allErrors: true, strict: false });
    addFormats(instance);
    ajvInstance = instance;
  }
  return ajvInstance;
}

function compile(schema: object): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached !== undefined) return cached;

  let validate: ValidateFunction;
  try {
    validate = ajv().compile(schema);
  } catch (cause) {
    throw new AiError('E_JSON', 'The requested JSON schema could not be compiled.', { cause });
  }
  compiled.set(schema, validate);
  return validate;
}

function issuePath(error: ErrorObject): string {
  const path = error.instancePath === '' ? '/' : error.instancePath;
  const params: unknown = error.params;
  if (
    error.keyword === 'required' &&
    typeof params === 'object' &&
    params !== null &&
    'missingProperty' in params
  ) {
    const missing = (params as { missingProperty?: unknown }).missingProperty;
    if (typeof missing === 'string') {
      return path === '/' ? `${missing} is required` : `${path}/${missing} is required`;
    }
  }
  return `${path} ${error.message ?? 'is invalid'}`;
}

/** Strips a ```json fence that models add despite being told not to. */
function stripCodeFence(text: string): string {
  const match = FENCE_PATTERN.exec(text);
  return match?.[1]?.trim() ?? text.trim();
}

/**
 * Parses a model reply, optionally validating it against JSON Schema 2020-12.
 * Failures are `E_JSON` and carry up to three issue paths so the caller can
 * repair the reply instead of retrying blindly.
 */
export function parseJsonReply(text: string, schema?: object): unknown {
  const cleaned = stripCodeFence(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (cause) {
    throw new AiError('E_JSON', `Reply is not valid JSON: ${excerpt(cleaned, 120)}`, { cause });
  }

  if (schema === undefined) return parsed;

  const validate = compile(schema);
  if (validate(parsed)) return parsed;

  const issues = (validate.errors ?? []).slice(0, 3).map(issuePath);
  throw new AiError('E_JSON', `Reply does not match the JSON schema: ${issues.join('; ')}`, { issues });
}
