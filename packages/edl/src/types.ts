/**
 * TypeScript mirror of `schema.json` (EDL 1.0.0 + additive 2.0.0).
 *
 * Every interface here corresponds to a `$defs` entry or the root object, with
 * the same required/optional split and the same enum unions. The schema remains
 * the runtime authority for shape and enums; `validate.ts` owns the numeric
 * ranges and cross-field rules. These types are what the rest of the app
 * compiles against.
 *
 * Versioning: writers still emit `EDL_VERSION` (1.0.0) until the planner is
 * switched over; `EDL_VERSION_2` is the forward version that `migrateEdl`
 * upgrades to, and the schema accepts both.
 */

export const EDL_VERSION = '1.0.0';
export const EDL_VERSION_2 = '2.0.0';

/** Every version this module understands: 1.0.0 on read, 2.0.0 on write. */
export type EdlVersion = typeof EDL_VERSION | typeof EDL_VERSION_2;

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export type Profile = 'vertical-social' | 'feed-portrait' | 'landscape' | 'pin';

export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Canvas {
  profile: Profile;
  width: number;
  height: number;
  fps: number;
  safeArea: SafeArea;
}

// ---------------------------------------------------------------------------
// Output overrides (v2)
// ---------------------------------------------------------------------------

/**
 * Optional encode overrides. Anything omitted falls back to the render
 * profile, so a document without `output` encodes exactly as it did in v1.
 */
export interface Output {
  /** 320..7680 */
  width?: number;
  /** 320..7680 */
  height?: number;
  /** 12..60 */
  fps?: number;
  /** /\d+[kM]$/ */
  videoBitrate?: string;
  /** /\d+k$/ */
  audioBitrate?: string;
}

// ---------------------------------------------------------------------------
// Effects (v2)
// ---------------------------------------------------------------------------

export type EffectType =
  | 'blur'
  | 'motion_blur'
  | 'glow'
  | 'grain'
  | 'vignette'
  | 'sharpen'
  | 'chromatic_aberration'
  | 'saturation'
  | 'exposure'
  | 'contrast'
  | 'lut'
  | 'stabilize';

/** Type-specific, free-form payload; validated per type in `validate.ts`. */
export type EffectParams = Record<string, number | string | boolean>;

/**
 * A single effect. Root-level effects are timeline-global; clip-level effects
 * are scoped to that clip's timeline window. `inSec`/`outSec` narrow the window
 * and default to the whole scope.
 */
export interface Effect {
  /** `e1`, `e2`… unique within the owning scope (document or clip). */
  id: string;
  type: EffectType;
  /** 0..100 strength for the types that have one. */
  amount?: number;
  inSec?: number;
  outSec?: number;
  params?: EffectParams;
  /** Default true. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Grade (v2)
// ---------------------------------------------------------------------------

export type ColorGradePreset =
  | 'none'
  | 'warm_cinematic'
  | 'cool_cinematic'
  | 'luxury'
  | 'natural'
  | 'vivid'
  | 'noir';

/**
 * A preset expands to parameters in the renderer; explicit fields override the
 * preset. A clip grade replaces the root grade for that clip.
 */
export interface ColorGrade {
  preset?: ColorGradePreset;
  /** -2..2 */
  exposure?: number;
  /** 0.5..2 */
  contrast?: number;
  /** 0..2 */
  saturation?: number;
  /** -1..1, blue → warm */
  temperature?: number;
  /** -1..1, green → magenta */
  tint?: number;
  /** -1..1 */
  highlights?: number;
  /** -1..1 */
  shadows?: number;
  /** -1..1 */
  vibrance?: number;
  /** Repo-relative `.cube` under `data/luts/`; no `..`. */
  lut?: string;
  /** 0..1, blends the grade. */
  intensity?: number;
}

// ---------------------------------------------------------------------------
// Speed ramp (v2)
// ---------------------------------------------------------------------------

export interface SpeedPoint {
  /** Normalised position inside the clip's source window, 0..1. */
  t: number;
  /** 0.25..4. */
  speed: number;
}

// ---------------------------------------------------------------------------
// Creative references
// ---------------------------------------------------------------------------

export type FormatId =
  | 'cinematic_hero'
  | 'social_hook'
  | 'room_walkthrough'
  | 'just_listed'
  | 'amenity_lifestyle'
  | 'price_drop'
  | 'agent_intro'
  | 'before_after'
  | 'drone_hero'
  | 'vertical_tour'
  | 'marketing_38';

export interface FormatRef {
  id: FormatId;
  label: string;
  targetDurationSec: number;
}

export type LookId = 'calm' | 'social' | 'walkthrough' | 'editorial';

export interface LookRef {
  id: LookId;
  label: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/**
 * `zoom_blur`, `luma_wipe` and `light_leak` are the marketing-campaign
 * transitions. The v2 additions (`dip_black`…`glitch`) are the first nine
 * entries of the bundled FFmpeg `xfade` list. They map onto `xfade` exactly
 * like the original four, so an EDL stays renderer-neutral.
 */
export type TransitionType =
  | 'cut'
  | 'dissolve'
  | 'slide'
  | 'whip'
  | 'zoom_blur'
  | 'luma_wipe'
  | 'light_leak'
  | 'dip_black'
  | 'dip_white'
  | 'blur'
  | 'directional_blur'
  | 'push_left'
  | 'push_right'
  | 'circle'
  | 'wipe'
  | 'glitch';

export interface Transition {
  type: TransitionType;
  durationSec: number;
}

export interface CropPoint {
  t: number;
  x: number;
  y: number;
  scale: number;
}

export type TransformMode = 'cover' | 'pad_blur' | 'contain';

export type Focus = 'saliency' | 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface Transform {
  mode: TransformMode;
  focus: Focus;
  path: CropPoint[];
}

export type Room =
  | 'exterior'
  | 'building'
  | 'entry'
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'bathroom'
  | 'balcony'
  | 'view'
  | 'amenity'
  | 'unknown';

export interface Clip {
  id: string;
  sourceId: string;
  src: string;
  inSec: number;
  outSec: number;
  speed: number;
  volumeDb: number;
  room?: Room;
  transform: Transform;
  transitionIn: Transition;
  transitionOut?: Transition;
  /**
   * Source seconds the renderer may borrow *past* `outSec` to feed the
   * outgoing transition. Transition handles are not part of the timeline: the
   * assembled film still runs `outSec - inSec` per clip, and `xfade` consumes
   * the handle instead of shortening the cut.
   */
  handleOutSec?: number;
  /**
   * Motion energy measured on the source shot, 0..1. Optional because only the
   * formats that gate on motion (marketing) need it; a missing value is not
   * the same as zero motion.
   */
  motionAtSelection?: number;
  reason: string;
  scoreAtSelection?: number;
  /** v2: clip-scoped effects. */
  effects?: Effect[];
  /** v2: replaces the root grade for this clip. */
  grade?: ColorGrade;
  /**
   * v2: 2..8 points replacing the scalar `speed`. When present `speed` must be
   * 1; the ramp is authoritative and the sum of `segmentSource / speed` is the
   * clip's timeline duration.
   */
  speedRamp?: SpeedPoint[];
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export type OverlayKind =
  | 'price'
  | 'spec_row'
  | 'address'
  | 'logo'
  | 'lower_third'
  | 'cta'
  | 'disclaimer'
  | 'room_label';

export type Anchor =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'center'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

export type OverlayStyle =
  | 'price_lower'
  | 'spec_pill'
  | 'address_tag'
  | 'logo_corner'
  | 'cta_card'
  | 'caption'
  | 'small_print';

/** v2: the caption animation set plus `count_up` for numeric overlays. */
export type OverlayAnimation =
  | 'none'
  | 'fade'
  | 'rise'
  | 'slide_in'
  | 'count_up'
  | 'pop'
  | 'typewriter'
  | 'tracking_in'
  | 'blur_in'
  | 'scale_in';

export type OverlayExitAnimation = 'none' | 'fade' | 'slide_out';

export interface OverlayFont {
  family?: string;
  /** 100..900 */
  weight?: number;
  sizePx?: number;
}

export interface OverlayBackground {
  /** `#RRGGBB` */
  color?: string;
  /** 0..1 */
  opacity?: number;
  radiusPx?: number;
}

/** A motion keyframe; `t` is relative to the overlay window. */
export interface OverlayKeyframe {
  /** 0..1, strictly increasing across the array. */
  t: number;
  /** 0..1 of the canvas. */
  x?: number;
  /** 0..1 of the canvas. */
  y?: number;
  /** 0.1..4 */
  scale?: number;
  /** 0..1 */
  opacity?: number;
  /** -180..180 */
  rotation?: number;
}

export interface Overlay {
  id: string;
  kind: OverlayKind;
  text?: string;
  subtext?: string;
  inSec: number;
  outSec: number;
  anchor: Anchor;
  style: OverlayStyle;
  maxWidthPct?: number;
  opacity?: number;
  animation?: OverlayAnimation;
  /** v2 */
  exitAnimation?: OverlayExitAnimation;
  /** v2 */
  font?: OverlayFont;
  /** v2: `#RRGGBB` */
  color?: string;
  /** v2 */
  background?: OverlayBackground;
  /** v2: -180..180 */
  rotation?: number;
  /** v2: 1..24 keyframes inside the overlay window. */
  keyframes?: OverlayKeyframe[];
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export type CaptionMode = 'burn' | 'sidecar' | 'both' | 'none';

export type CaptionStyle =
  | 'clean_lower'
  | 'bold_center'
  | 'editorial_serif'
  | 'social_bold'
  | 'clean_reel'
  | 'editorial'
  | 'luxury_gold'
  | 'kinetic_bold'
  | 'minimal_white'
  | 'glass_pill'
  | 'bold_bw';

export type TextAnimation =
  | 'none'
  | 'fade'
  | 'rise'
  | 'slide_in'
  | 'pop'
  | 'typewriter'
  | 'word_by_word'
  | 'tracking_in'
  | 'blur_in'
  | 'scale_in';

export type CaptionAnchor = 'bottom_center' | 'center' | 'top_center';

export interface CaptionWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface CaptionHighlight {
  /** `#RRGGBB` */
  color?: string;
  /** Must be a subset of the words present in `words`. */
  words?: string[];
}

export interface CaptionFont {
  family?: string;
  /** 100..900 */
  weight?: number;
  sizePx?: number;
  uppercase?: boolean;
}

export interface CaptionBox {
  /** `#RRGGBB` */
  color?: string;
  /** 0..1 */
  opacity?: number;
  radiusPx?: number;
}

export interface CaptionPosition {
  anchor?: CaptionAnchor;
  offsetPx?: number;
}

export interface Captions {
  mode: CaptionMode;
  style?: CaptionStyle;
  language?: string;
  words?: CaptionWord[];
  /** v2 */
  animation?: TextAnimation;
  /** v2 */
  highlight?: CaptionHighlight;
  /** v2 */
  font?: CaptionFont;
  /** v2 */
  box?: CaptionBox;
  /** v2 */
  position?: CaptionPosition;
  /** v2: 1..8, cue-builder default 6. */
  maxWordsPerLine?: number;
  /** v2: 1..3, cue-builder default 2. */
  maxLines?: number;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type MusicLicenseSource = 'ai_generated' | 'royalty_free' | 'user_supplied';

export interface MusicLicense {
  source: MusicLicenseSource;
  licenseId: string;
  attribution?: string;
}

export interface Music {
  trackId: string;
  src: string;
  gainDb: number;
  duckUnderVoiceDb: number;
  beatGrid: number[];
  license?: MusicLicense;
}

export type VoiceMode = 'keep' | 'clean' | 'replace_tts' | 'mute';

export interface VoiceEnhance {
  denoise?: boolean;
  dereverb?: boolean;
  isolate?: boolean;
  deess?: boolean;
}

export interface Voice {
  mode: VoiceMode;
  src?: string;
  text?: string;
  voiceId?: string;
  enhance?: VoiceEnhance;
}

export interface AudioMix {
  lufs: number;
  truePeakDbtp?: number;
}

export interface Audio {
  music: Music;
  voice: Voice;
  mix: AudioMix;
  /** v2: 0..5 */
  fadeInSec?: number;
  /** v2: 0..5 */
  fadeOutSec?: number;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export type ReviewCheckId =
  | 'duration'
  | 'no_black_frames'
  | 'no_freeze'
  | 'text_safe_area'
  | 'cta_legible'
  | 'room_order'
  | 'loudness'
  | 'no_repeated_shot'
  | 'hook_visible'
  | 'facts_present'
  | 'marketing_beats';

export interface ReviewCheck {
  id: ReviewCheckId;
  passed: boolean;
  detail: string;
}

export interface Review {
  score: number;
  checks: ReviewCheck[];
  reviewedBy?: string;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface ProvenanceModels {
  tagging: string;
  planning: string;
  review?: string;
  tts?: string;
}

export interface ProvenancePromptVersions {
  tagging: string;
  planning: string;
}

export interface Provenance {
  pipelineVersion: string;
  sourceIndexHash?: string;
  models: ProvenanceModels;
  promptVersions: ProvenancePromptVersions;
  costUsd: number;
  renderCacheHits?: number;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface Edl {
  /** `1.0.0` (legacy, read through `migrateEdl`) or `2.0.0`. */
  edlVersion: EdlVersion;
  id: string;
  listingId: string;
  createdAt: string;
  parentId?: string | null;
  format: FormatRef;
  look: LookRef;
  canvas: Canvas;
  clips: Clip[];
  overlays: Overlay[];
  audio: Audio;
  captions: Captions;
  review?: Review;
  provenance: Provenance;
  /** v2: encode overrides. */
  output?: Output;
  /** v2: timeline-global effects. */
  effects?: Effect[];
  /** v2: global grade, applied after each clip's grade. */
  grade?: ColorGrade;
}

/**
 * A schema-valid EDL that has been parsed from JSON. Reserved for call sites
 * that want to distinguish "came off disk" from "constructed in memory"; the
 * shape is identical today.
 */
export interface EdlDocument extends Edl {}
