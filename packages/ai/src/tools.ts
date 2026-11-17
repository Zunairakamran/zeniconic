import { assertMatchesSchema } from './json';
import { excerpt } from './retry';
import { AiError } from './types';
import type { ToolCall } from './types';

/**
 * Parses one `ToolCall.arguments` JSON string and validates it against the
 * tool's `parameters` schema.
 *
 * The argument string is used verbatim: models sometimes wrap it in a code
 * fence, but a fence is a malformed tool call, not a reply body, so it is
 * reported as `E_JSON` instead of being silently repaired. The returned value
 * is the parsed JSON; pass the expected shape as the type argument once the
 * schema has confirmed it.
 */
export function parseToolArguments<T = unknown>(call: ToolCall, schema: object): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.arguments);
  } catch (cause) {
    throw new AiError(
      'E_JSON',
      `Tool call "${call.name}" (${call.id}) arguments are not valid JSON: ${excerpt(call.arguments, 120)}`,
      { cause },
    );
  }

  assertMatchesSchema(parsed, schema, `Tool call "${call.name}" (${call.id}) arguments`);
  return parsed as T;
}
