/**
 * Variant persistence for the desktop pipeline.
 *
 * One listing owns three creative variants. Each EDL is a normal `.json` file
 * under `<listing>/variants/`, and one `variants.json` holds the small amount
 * of metadata the UI needs. Writes are atomic, and a variant the user has
 * approved is never overwritten by a re-analysis.
 */

import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { validateEdl } from '../../packages/edl/src/index';
import type { Edl, LookId } from '../../packages/edl/src/index';
import type { VariantLook, VariantSummary } from '../../packages/ipc/src/index';

export const VARIANT_LOOKS: readonly VariantLook[] = ['calm', 'walkthrough', 'social'];

export interface VariantPlan {
  summary: VariantSummary;
  edl: Edl;
}

interface VariantsFile {
  version: 1;
  variants: VariantSummary[];
}

const VARIANTS_DIR = 'variants';
const METADATA_FILE = 'variants.json';
const VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A relative EDL path this module is willing to persist. */
const STORED_EDL_PATTERN = /^variants\/[a-z0-9][a-z0-9-]{0,63}\.json$/;

function variantsDir(listingDir: string): string {
  return join(listingDir, VARIANTS_DIR);
}

function metadataPath(listingDir: string): string {
  return join(variantsDir(listingDir), METADATA_FILE);
}

function edlPath(listingDir: string, variantId: string): string {
  if (!VARIANT_ID_PATTERN.test(variantId)) {
    throw new Error(`Invalid variant id "${variantId}".`);
  }
  return join(variantsDir(listingDir), `${variantId}.json`);
}

/**
 * The path persisted in `variants.json`: always relative to the listing
 * workspace, so moving `data/` to another PC keeps the variant readable.
 */
function storedEdlPath(variantId: string): string {
  if (!VARIANT_ID_PATTERN.test(variantId)) {
    throw new Error(`Invalid variant id "${variantId}".`);
  }
  return `${VARIANTS_DIR}/${variantId}.json`;
}

/**
 * Converts an on-disk EDL path back to the relative form stored in
 * `variants.json`. A file outside `<listing>/variants` falls back to the
 * canonical planned file; anything else is a programming error, not user data.
 */
function relativeStoredEdlPath(
  listingDir: string,
  absolutePath: string,
  look: VariantLook,
): string {
  const inside = relative(variantsDir(listingDir), absolutePath).replace(/\\/g, '/');
  const candidate = `${VARIANTS_DIR}/${inside}`;
  return STORED_EDL_PATTERN.test(candidate) ? candidate : storedEdlPath(look);
}

function asAbsolute(listingDir: string, stored: string): string {
  return isAbsolute(stored) ? stored : join(listingDir, stored);
}

/**
 * Resolves a persisted EDL path.
 *
 * The relative form wins. An absolute path from an older build is accepted
 * while the file still exists (the metadata is rewritten in relative form on
 * the next save); if that file is gone — because the data directory moved —
 * the canonical `<listing>/variants/<look>.json` is used instead.
 */
export async function resolveVariantEdlPath(
  listingDir: string,
  variant: Pick<VariantSummary, 'look' | 'edlPath'>,
): Promise<string | undefined> {
  const canonical = edlPath(listingDir, variant.look);
  const stored = variant.edlPath.trim();
  const candidates = stored.length === 0 ? [canonical] : [asAbsolute(listingDir, stored), canonical];

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLook(value: unknown): value is VariantLook {
  return typeof value === 'string' && (VARIANT_LOOKS as readonly string[]).includes(value);
}

function isSummary(value: unknown): value is VariantSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isLook(value.look) &&
    typeof value.format === 'string' &&
    typeof value.targetDurationSec === 'number' &&
    Number.isFinite(value.targetDurationSec) &&
    typeof value.clipCount === 'number' &&
    Number.isInteger(value.clipCount) &&
    value.clipCount >= 0 &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    typeof value.edlPath === 'string' &&
    typeof value.approved === 'boolean'
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new Error(`Could not save ${path}: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
}

/** Reads the persisted list. A missing file is an empty list. */
export async function readVariants(listingDir: string): Promise<VariantSummary[]> {
  let raw: string;
  try {
    raw = await readFile(metadataPath(listingDir), 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return [];
    throw new Error('Could not read the variants file.', { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const values = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.variants)
      ? parsed.variants
      : [];

  return values.filter(isSummary);
}

/**
 * Persists a fresh plan. An approved variant keeps both its EDL and metadata;
 * unapproved variants are replaced. The first variant is approved by default
 * only when nothing on disk has been approved yet.
 */
export async function saveVariants(
  listingDir: string,
  plans: VariantPlan[],
): Promise<VariantSummary[]> {
  const current = await readVariants(listingDir);
  const byLook = new Map(current.map((variant) => [variant.look, variant]));
  const next: VariantSummary[] = [];

  await mkdir(variantsDir(listingDir), { recursive: true });

  for (const plan of plans) {
    const existing = byLook.get(plan.summary.look);
    const existingPath =
      existing === undefined ? undefined : await resolveVariantEdlPath(listingDir, existing);
    if (existing?.approved === true && existingPath !== undefined) {
      // The metadata is rewritten below. An approved edit is never replaced by
      // a fresh analysis, and a chat version that is currently applied stays
      // current instead of being reset to the canonical planned file.
      next.push({
        ...existing,
        edlPath: relativeStoredEdlPath(listingDir, existingPath, existing.look),
      });
      continue;
    }

    const path = edlPath(listingDir, plan.summary.look);
    await writeJson(path, plan.edl);
    next.push({
      ...plan.summary,
      edlPath: storedEdlPath(plan.summary.look),
      approved: false,
    });
  }

  // Keep any previously approved variant that this plan did not mention.
  for (const variant of current) {
    if (variant.approved && !next.some((item) => item.look === variant.look)) {
      next.push({ ...variant, edlPath: storedEdlPath(variant.look) });
    }
  }

  await writeJson(metadataPath(listingDir), {
    version: 1,
    variants: next,
  } satisfies VariantsFile);

  return next;
}

export async function setVariantApproval(
  listingDir: string,
  variantId: string,
  approved: boolean,
): Promise<VariantSummary> {
  const variants = await readVariants(listingDir);
  const index = variants.findIndex(
    (variant) => variant.id === variantId || variant.look === variantId,
  );
  if (index < 0) throw new Error(`Variant "${variantId}" was not found.`);

  const found = variants[index]!;
  const resolved = await resolveVariantEdlPath(listingDir, found);
  const updated: VariantSummary = {
    ...found,
    // Keep the relative form when the canonical file is what we resolved.
    edlPath:
      resolved === edlPath(listingDir, found.look)
        ? storedEdlPath(found.look)
        : found.edlPath,
    approved,
  };
  variants[index] = updated;

  await writeJson(metadataPath(listingDir), {
    version: 1,
    variants,
  } satisfies VariantsFile);

  return updated;
}

/**
 * Points a variant at a saved EDL version. The export path resolves this
 * pointer through `readVariantEdl`, so applying a chat edit makes it current
 * without touching the previous version's file.
 */
export async function setVariantEdlPath(
  listingDir: string,
  variantId: string,
  storedPath: string,
): Promise<VariantSummary> {
  const relativePath = storedPath.trim().replace(/\\/g, '/');
  if (!STORED_EDL_PATTERN.test(relativePath)) {
    throw new Error(`"${storedPath}" is not a stored variant path.`);
  }

  const variants = await readVariants(listingDir);
  const index = variants.findIndex(
    (variant) => variant.id === variantId || variant.look === variantId,
  );
  if (index < 0) throw new Error(`Variant "${variantId}" was not found.`);

  const found = variants[index]!;
  if (!(await exists(join(listingDir, relativePath)))) {
    throw new Error(`The edit for "${found.look}" is missing; ask for the change again.`);
  }

  const updated: VariantSummary = { ...found, edlPath: relativePath };
  variants[index] = updated;

  await writeJson(metadataPath(listingDir), {
    version: 1,
    variants,
  } satisfies VariantsFile);

  return updated;
}

/** Loads one variant EDL, refusing a file the renderer could not trust. */
export async function readVariantEdl(
  listingDir: string,
  variantId: string,
): Promise<Edl> {
  const variants = await readVariants(listingDir);
  const variant = variants.find(
    (item) => item.id === variantId || item.look === variantId,
  );
  if (variant === undefined) throw new Error(`Variant "${variantId}" was not found.`);

  const path = await resolveVariantEdlPath(listingDir, variant);
  if (path === undefined) {
    throw new Error(`The EDL for "${variant.look}" is missing; analyse the listing again.`);
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`The EDL for "${variant.look}" is missing; analyse the listing again.`, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`The EDL for "${variant.look}" is not valid JSON.`, { cause: error });
  }

  const edl = parsed as Edl;
  const check = validateEdl(edl);
  if (!check.valid) {
    throw new Error(
      `The EDL for "${variant.look}" is invalid: ${check.issues[0]?.message ?? 'unknown issue'}`,
    );
  }

  return edl;
}

/** Mean of the shots the planner selected, on a 0..100 scale. */
export function scoreForEdl(edl: Edl): number {
  if (edl.clips.length === 0) return 0;
  const total = edl.clips.reduce((sum, clip) => sum + (clip.scoreAtSelection ?? 0), 0);
  return Math.round((total / edl.clips.length) * 100);
}

/** The look id used by the planner. Kept local so this module stays honest. */
export function asLook(look: VariantLook): LookId {
  return look;
}
