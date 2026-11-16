import type { Facts } from '@zeniconic/planner';

/**
 * Languages the voice bank can speak. English defaults to `en-GB`; Arabic is
 * Gulf-neutral (`ar-AE`) and is a first-class second language for Dubai work.
 */
export type Language = 'en-GB' | 'en-US' | 'ar-AE';

/**
 * Engines are adapters. This package never runs a model; it owns the catalogue,
 * the script, the duration estimate and the preview-cache policy.
 */
export type Engine = 'kokoro' | 'silma' | 'qwen3' | 'elevenlabs';

export interface Voice {
  id: string;
  name: string;
  language: Language;
  gender: 'female' | 'male';
  engine: Engine;
  tone: string;
  commercialUse: boolean;
}

export interface ScriptInput {
  facts: Facts;
  rooms: string[];
  durationSec: number;
  language: Language;
  agentName?: string;
}

export interface PreviewKeyInput {
  voiceId: string;
  text: string;
  engineVersion: string;
}

export interface PreviewCache {
  get(key: string): string | undefined;
  put(key: string, path: string): void;
}

export interface SynthesisRequest {
  voiceId: string;
  text: string;
  language: Language;
  outPath: string;
}

export interface SynthesisResult {
  audioPath: string;
  durationSec: number;
}

export interface TtsEngine {
  synthesise(req: SynthesisRequest): Promise<SynthesisResult>;
}
