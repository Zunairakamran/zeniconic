/**
 * The default capability catalogue. Registration order is irrelevant; the
 * registry sorts by id and rejects duplicates.
 */

import { createRegistry } from './registry';
import type { CapabilityRegistry, RegistryOptions } from './registry';
import type { Capability } from './types';
import {
  deleteClip, duplicateClip, reorderClips, setClipDuration, setClipSpeed,
  setSpeedRamp, setTargetDuration, splitClip, trimClip,
} from './capabilities/timeline';
import { setTransition, setTransitionAll } from './capabilities/transitions';
import { applyEffect, applyGrade, clearEffects, removeEffect } from './capabilities/effects';
import {
  setCaptionAnimation, setCaptionHighlight, setCaptionMode, setCaptionStyle,
  upsertCaptionWords,
} from './capabilities/captions';
import { addOverlay, removeOverlay, updateOverlay } from './capabilities/overlays';
import { setAudioFades, setMusic, setVoice } from './capabilities/audio';
import { kenBurns, setOutput, setTransform } from './capabilities/camera';

export const DEFAULT_CAPABILITIES: readonly Capability[] = [
  // timeline
  trimClip, splitClip, deleteClip, duplicateClip, reorderClips,
  setClipSpeed, setClipDuration, setTargetDuration, setSpeedRamp,
  // transitions
  setTransition, setTransitionAll,
  // effects
  applyEffect, removeEffect, applyGrade, clearEffects,
  // captions
  setCaptionStyle, setCaptionAnimation, setCaptionMode, upsertCaptionWords, setCaptionHighlight,
  // overlays
  addOverlay, updateOverlay, removeOverlay,
  // audio
  setMusic, setAudioFades, setVoice,
  // camera / output
  setTransform, kenBurns, setOutput,
];

export function createDefaultRegistry(options: RegistryOptions = {}): CapabilityRegistry {
  return createRegistry(DEFAULT_CAPABILITIES, options);
}

export { createRegistry } from './registry';
export type { CapabilityFilter, CapabilityRegistry, RegistryOptions } from './registry';
export * from './types';
