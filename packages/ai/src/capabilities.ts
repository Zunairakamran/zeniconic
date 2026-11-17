import { baseModelId } from './cost';
import { AiError } from './types';

/**
 * Capabilities a caller can require before spending money or trusting a reply.
 * The names mirror `services/pipeline/models.json` so a role's capability block
 * can be passed straight through.
 */
export type ModelCapability = 'tools' | 'vision' | 'json' | 'video' | 'audio' | 'file';

/** Only an explicit `true` counts as support; a missing key is unknown. */
export type ModelCapabilities = Partial<Record<ModelCapability, boolean>>;

/** Usually built from `models.json` by the caller; this package never reads files. */
export type CapabilityMap = Readonly<Record<string, ModelCapabilities | undefined>>;

function lookup(model: string, capabilitiesByModel: CapabilityMap): ModelCapabilities | undefined {
  const direct = capabilitiesByModel[model];
  if (direct !== undefined) return direct;
  // A routing variant (`:floor`, `:nitro`, `:free`) is the same model.
  return capabilitiesByModel[baseModelId(model)];
}

function quoteAll(capabilities: readonly ModelCapability[]): string {
  return capabilities.map((capability) => `"${capability}"`).join(', ');
}

/**
 * Pre-flight capability check. Throws `E_MODEL_CAPABILITY` naming the model and
 * the first missing capability; returns the resolved capability record on
 * success, so the caller can inspect related flags (e.g. pricing role).
 *
 * Fail-closed: a model that is not in the supplied map is treated as having no
 * declared capabilities, so requiring anything from it throws instead of
 * assuming support and discovering the failure on the network.
 */
export function assertModelCapabilities(
  model: string,
  required: readonly ModelCapability[],
  capabilitiesByModel: CapabilityMap,
): ModelCapabilities {
  const slug = model.trim();
  const declared = lookup(slug, capabilitiesByModel);
  const capabilities = declared ?? {};

  const missing = required.filter((capability) => capabilities[capability] !== true);
  if (missing.length > 0) {
    const names = quoteAll(missing);
    const reason =
      declared === undefined
        ? `Model "${slug}" is not in the capability table, so its ${names} capability cannot be confirmed; add it to the model config or choose a listed model.`
        : `Model "${slug}" lacks the required ${names} capability; use a model that declares it.`;
    throw new AiError('E_MODEL_CAPABILITY', reason);
  }

  // A copy: the caller must not be able to edit the config through the result.
  return { ...capabilities };
}
