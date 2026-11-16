/**
 * The tagging prompt version written into the index provenance and mixed into
 * every cache key. Bump it whenever `SYSTEM_PROMPT` in `packages/tagging`
 * changes by even a word, otherwise a cached sheet keeps its stale labels.
 */
export const TAGGING_PROMPT_VERSION = 'tag-1.3.0';
