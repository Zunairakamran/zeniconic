/**
 * Media paths for `staticFile`, and the fallback gradient for missing footage.
 *
 * Remotion's `staticFile` resolves inside the bundle's public directory. The
 * renderer points that at the listing workspace, so an EDL src is valid only
 * when it is relative to it; an absolute path outside the workspace is not
 * smuggled into the bundle. `staticMediaPath` returns null in that case and the
 * composition draws a deterministic gradient instead.
 */

function normalise(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

/**
 * Resolves an EDL `src` to a forward-slash path relative to `listingDir`.
 *
 * Windows paths are accepted in the EDL but normalised here: a backslash is a
 * 404 in the browser. Absolute paths are accepted only when they sit inside the
 * listing workspace. Parent traversal is rejected outright.
 */
export function staticMediaPath(src: string, listingDir: string): string | null {
  const raw = src.trim();
  if (raw.length === 0) return null;

  // A Windows drive letter is not a URL scheme; everything else with a colon is.
  const driveAbsolute = /^[a-zA-Z]:[\\/]/.test(raw);
  if (!driveAbsolute && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;

  const source = normalise(raw);
  const root = trimTrailingSlash(normalise(listingDir.trim()));
  if (root.length === 0) return null;

  const lowerSource = source.toLowerCase();
  const lowerRoot = root.toLowerCase();

  let relative: string;
  if (lowerSource === lowerRoot) return null;
  if (lowerSource.startsWith(`${lowerRoot}/`)) {
    relative = source.slice(root.length + 1);
  } else if (source.startsWith('/') || /^[a-zA-Z]:\//.test(source)) {
    return null;
  } else {
    relative = source.replace(/^\.\//, '');
  }

  const segments = relative.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  if (segments.length === 0) return null;

  return segments.join('/');
}

/** Stable 32-bit hash; used for gradient seeds, never for security. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface FallbackGradient {
  from: string;
  to: string;
  angle: number;
}

/**
 * A muted warm gradient for a missing clip. Deterministic from the clip id so
 * two renders of the same EDL are byte-identical.
 */
export function fallbackGradient(seed: string): FallbackGradient {
  const hash = hashString(seed);
  const hue = 18 + (hash % 36); // brass through clay, never blue
  const second = 30 + ((hash >>> 8) % 24);
  return {
    from: `hsl(${hue} 26% 17%)`,
    to: `hsl(${second} 18% 9%)`,
    angle: 120 + ((hash >>> 16) % 60),
  };
}
