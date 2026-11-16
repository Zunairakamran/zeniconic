export type Variant = 'auto' | 'floor' | 'nitro';

/**
 * Applies an OpenRouter routing suffix to a model slug.
 *
 * `auto` (or no variant) leaves the slug untouched. A slug that already carries
 * a suffix is returned unchanged, so a caller cannot end up with `:floor:floor`.
 * `:free` is deliberately not in `Variant`: it is a development-only string that
 * must be written out explicitly by whoever wants it.
 */
export function resolveModelId(model: string, variant: Variant = 'auto'): string {
  const slug = model.trim();
  if (variant === 'auto') return slug;
  if (slug.includes(':')) return slug;
  return `${slug}:${variant}`;
}
