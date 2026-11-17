/**
 * Reference-video smoke test: analyse a local clip, persist its style profile,
 * then run the agent with that guidance and a request that follows it.
 *
 * Usage: npx tsx scripts/reference-smoke.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OpenRouterClient } from '../packages/ai/src/index';
import type { ChatMessage, ToolDefinition } from '../packages/ai/src/index';
import { createDefaultRegistry } from '../packages/capabilities/src/index';
import { runAgent } from '../packages/agent/src/index';
import type { AgentModel } from '../packages/agent/src/index';
import { durationSec, validateEdl } from '../packages/edl/src/index';
import type { Clip, Edl } from '../packages/edl/src/index';
import {
  analyseReference,
  readReferenceProfile,
  referenceGuidance,
  saveReferenceProfile,
} from '../services/reference/src/index';
import models from '../services/pipeline/models.json';

function key(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  return line.slice('OPENROUTER_API_KEY='.length).trim();
}

function clip(id: string, src: string, duration: number, room: Clip['room']): Clip {
  return {
    id,
    sourceId: `s_${id.repeat(8).slice(0, 8)}`,
    src: resolve(src),
    inSec: 0,
    outSec: duration,
    speed: 1,
    volumeDb: -18,
    room,
    transform: { mode: 'cover', focus: 'saliency', path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }] },
    transitionIn: { type: 'cut', durationSec: 0 },
    transitionOut: { type: 'cut', durationSec: 0 },
    reason: 'reference smoke',
  };
}

async function main(): Promise<void> {
  const referencePath = resolve('tests/fixtures/media/fast-cut-9x16.mp4');
  const profile = await analyseReference({ file: referencePath });
  console.log('REFERENCE', JSON.stringify({
    pacing: profile.pacing,
    averageShotSec: profile.averageShotSec,
    cutDensityPerMin: profile.cutDensityPerMin,
    aspect: profile.aspect,
    palette: profile.palette,
    style: profile.style,
    confidence: profile.confidence,
  }, null, 2));

  const listingDir = resolve('data/tmp/reference-smoke-listing');
  await saveReferenceProfile(listingDir, { file: referencePath, profile });
  const stored = await readReferenceProfile(listingDir);
  if (stored === undefined) throw new Error('profile was not persisted');
  const guidance = referenceGuidance(stored);

  const edl: Edl = {
    edlVersion: '2.0.0',
    id: 'edl_reference-smoke_v1',
    listingId: '2026-11-17-reference-smoke',
    createdAt: new Date().toISOString(),
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 13 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social', width: 1080, height: 1920, fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips: [
      clip('c01', 'tests/fixtures/media/fast-cut-9x16.mp4', 4, 'living'),
      clip('c02', 'tests/fixtures/media/slow-16x9.mp4', 6, 'kitchen'),
      clip('c03', 'tests/fixtures/media/square-1x1.mp4', 3, 'bedroom'),
    ],
    overlays: [],
    audio: {
      music: { trackId: 'none', src: '', gainDb: -18, duckUnderVoiceDb: -12, beatGrid: [] },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: { mode: 'none' },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: models.roles.agent.model },
      promptVersions: { tagging: 'n/a', planning: 'reference-smoke' },
      costUsd: 0,
    },
  };
  if (!validateEdl(edl).valid) throw new Error('fixture EDL is invalid');

  const candidates = [models.roles.agent.model, ...models.roles.agent.candidates];
  const model: AgentModel = {
    async complete(input) {
      let last: unknown;
      for (const id of candidates) {
        try {
          const client = new OpenRouterClient({ apiKey: key(), fetchImpl: (url, init) => fetch(url, init) });
          const response = await client.complete({
            model: id,
            messages: input.messages as ChatMessage[],
            tools: input.tools as ToolDefinition[],
            temperature: 0.2,
            maxTokens: 1600,
          });
          return {
            text: response.text,
            ...(response.toolCalls === undefined ? {} : { toolCalls: response.toolCalls }),
            costUsd: response.costUsd,
          };
        } catch (error) {
          last = error;
          throw error;
        }
      }
      throw last instanceof Error ? last : new Error('no model');
    },
  };

  const result = await runAgent(
    { model, registry: createDefaultRegistry() },
    {
      message:
        'Use the reference style: make this cut match its pacing, retime the film to 9 seconds, and apply a warm cinematic grade.',
      autonomy: 'auto',
      context: {
        listingId: edl.listingId,
        edl,
        facts: { address: 'Reference Smoke Tower, Dubai Marina', price: 'AED 1,850,000', beds: 2, baths: 2, currency: 'AED' },
        shots: [],
        reference: guidance,
      },
      onEvent: (event) => {
        if (event.type === 'tool_result' || event.type === 'warning' || event.type === 'error') {
          console.log(`[${event.type}] ${event.message}`);
        }
      },
    },
  );

  console.log('\nAGENT', JSON.stringify({
    ok: result.ok,
    reply: result.reply,
    edits: result.edits,
    duration: durationSec(result.edl),
    grade: result.edl.grade,
    costUsd: result.costUsd,
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
