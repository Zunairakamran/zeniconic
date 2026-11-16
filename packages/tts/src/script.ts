import { buildArabicScript } from './script-ar';
import { buildEnglishScript } from './script-en';
import type { ScriptInput } from './types';

/**
 * Build a voiceover script for one variant. English (`en-GB` and `en-US`) uses
 * the Kokoro-friendly English template; `ar-AE` uses the Arabic template.
 */
export function buildScript(input: ScriptInput): string {
  return input.language === 'ar-AE'
    ? buildArabicScript(input)
    : buildEnglishScript(input);
}
