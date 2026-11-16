/**
 * TypeScript mirror of `schema.json` (EDL 1.0.0).
 *
 * Every interface here corresponds to a `$defs` entry or the root object, with
 * the same required/optional split and the same enum unions. The schema remains
 * the runtime authority; these types are what the rest of the app compiles
 * against.
 */

export const EDL_VERSION = '1.0.0';

/** The only version this module understands. */
export type EdlVersion = typeof EDL_VERSION;

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
 * transitions. They map onto `xfade` (`zoomin`, `hblur`, `radial`) exactly like
 * the original four, so an EDL stays renderer-neutral.
 */
export type TransitionType =
  | 'cut'
  | 'dissolve'
  | 'slide'
  | 'whip'
  | 'zoom_blur'
  | 'luma_wipe'
  | 'light_leak';

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

export type OverlayAnimation = 'none' | 'fade' | 'rise' | 'slide_in' | 'count_up';

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
  | 'editorial';

export interface CaptionWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface Captions {
  mode: CaptionMode;
  style?: CaptionStyle;
  language?: string;
  words?: CaptionWord[];
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
}

/**
 * A schema-valid EDL that has been parsed from JSON. Reserved for call sites
 * that want to distinguish "came off disk" from "constructed in memory"; the
 * shape is identical today.
 */
export interface EdlDocument extends Edl {}
