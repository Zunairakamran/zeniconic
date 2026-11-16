export { MemoryTaggingCache, cacheKey } from './cache';
export type { TaggingCache } from './cache';

export { buildTaggingMessages, SYSTEM_PROMPT } from './prompt';

export {
  CAMERA_MOVE_VALUES,
  DEFECT_VALUES,
  MAX_DEFECTS,
  MAX_SELLING_POINTS,
  MAX_SELLING_POINT_CHARS,
  ROOM_VALUES,
  TAGGING_SCHEMA,
  validateTags,
} from './schema';

export { TaggingError, tagShot } from './tag';
export type { TagShotInput, TagShotOptions } from './tag';

export type { CameraMove, Defect, ShotTags } from './types';
