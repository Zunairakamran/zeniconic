import type { Room } from '@zeniconic/edl';

/**
 * The dominant camera motion across the six frames of one shot.
 *
 * This is a deliberately smaller set than the prose vocabulary in
 * `footage-analysis/references/tagging-prompt.md`: the planner only needs to
 * know whether a move runs left, right, in, out, orbits or is not a move at
 * all. `tilt_*`, `gimbal_walk` and `zoom_*` collapse into the nearest of these
 * so one enum is shared by the model, the index and the UI.
 */
export type CameraMove =
  | 'static'
  | 'pan_left'
  | 'pan_right'
  | 'push_in'
  | 'pull_out'
  | 'orbit'
  | 'handheld'
  | 'drone';

/**
 * Visible evidence that lowers a shot's usefulness. Fixed and closed: a novel
 * string here is a vocabulary bug, not creativity.
 */
export type Defect =
  | 'shaky'
  | 'blurry'
  | 'too_dark'
  | 'blown_windows'
  | 'lens_flare'
  | 'lens_dust'
  | 'clutter'
  | 'camera_in_mirror'
  | 'people'
  | 'reflection';

/**
 * What the tagger returns for one contact sheet: one shot, one typed record.
 *
 * `score` is the answer to "would a good editor use this shot in a 30-second
 * marketing video", not a measure of how pretty the room is. `bestInSec` and
 * `bestOutSec` are seconds from the start of the shot and stay inside its
 * duration.
 */
export interface ShotTags {
  room: Room;
  cameraMove: CameraMove;
  /** At most four snake_case tags, each at most 40 characters. */
  sellingPoints: string[];
  defects: Defect[];
  bestInSec?: number;
  bestOutSec?: number;
  /** 0..100. */
  score: number;
  /** 0..1, for the room and cameraMove calls together. */
  confidence: number;
  /** Normalised 0..1 in the padded tile, origin top-left. */
  subjectBox?: { x: number; y: number; w: number; h: number };
}
