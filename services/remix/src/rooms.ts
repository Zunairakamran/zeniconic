/**
 * The room vocabulary shared by remix tagging and the EDL.
 *
 * It mirrors `Room` in `packages/edl` exactly. The EDL only exports the type,
 * so the runtime list lives here: the IPC handlers and the Remix screen both
 * validate against this one array instead of re-typing the strings.
 */

export const REMIX_ROOMS = [
  'exterior',
  'building',
  'entry',
  'living',
  'kitchen',
  'dining',
  'bedroom',
  'bathroom',
  'balcony',
  'view',
  'amenity',
  'unknown',
] as const;

export type RemixRoom = (typeof REMIX_ROOMS)[number];

export function isRemixRoom(value: unknown): value is RemixRoom {
  return typeof value === 'string' && (REMIX_ROOMS as readonly string[]).includes(value);
}
