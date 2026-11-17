/**
 * Real end-to-end agent smoke test.
 *
 * Runs the agent against OpenRouter on the generated fixture clips, then
 * renders the resulting EDL with FFmpeg and probes the output. This is proof
 * that the agent edits the document and that the edit reaches a file — not a
 * plan-only test.
 *
 * Usage: npx tsx scripts/agent-smoke.ts
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenRouterClient } from '../packages/ai/src/index';
import type { ChatMessage, ToolDefinition } from '../packages/ai/src/index';
import { createDefaultRegistry } from '../packages/capabilities/src/index';
import { runAgent } from '../packages/agent/src/index';
import type { AgentModel } from '../packages/agent/src/index';
import { validateEdl, durationSec } from '../packages/edl/src/index';
import type { Clip, Edl } from '../packages/edl/src/index';
import { probe, ffmpegPath } from '../packages/media/src/index';
import { renderEdl } from '../services/pipeline/service';
import { renderPreview } from '../services/preview/src/index';
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
    ...(room === undefined ? {} : { room }),
    transform: {
      mode: 'cover',
      focus: 'saliency',
      path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }, { t: 1, x: 0.5, y: 0.5, scale: 1.08 }],
    },
    transitionIn: { type: 'cut', durationSec: 0 },
    transitionOut: { type: 'cut', durationSec: 0 },
    reason: 'smoke fixture',
  };
}

function fixtureEdl(): Edl {
  const clips = [
    clip('c01', 'tests/fixtures/media/fast-cut-9x16.mp4', 4, 'living'),
    clip('c02', 'tests/fixtures/media/slow-16x9.mp4', 6, 'kitchen'),
    clip('c03', 'tests/fixtures/media/square-1x1.mp4', 3, 'bedroom'),
  ];
  const total = clips.reduce((sum, entry) => sum + (entry.outSec - entry.inSec) / entry.speed, 0);
  return {
    edlVersion: '2.0.0',
    id: 'edl_agent-smoke_v1',
    listingId: '2026-11-17-agent-smoke',
    createdAt: new Date().toISOString(),
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: total },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social', width: 1080, height: 1920, fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips,
    overlays: [{
      id: 'o01', kind: 'price', text: 'AED 1,850,000', inSec: Math.max(0, total - 4), outSec: total,
      anchor: 'bottom_center', style: 'price_lower',
    }],
    audio: {
      music: { trackId: 'none', src: '', gainDb: -18, duckUnderVoiceDb: -12, beatGrid: [] },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: { mode: 'none' },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: models.roles.agent.model },
      promptVersions: { tagging: 'n/a', planning: 'agent-smoke' },
      costUsd: 0,
    },
  };
}

async function main(): Promise<void> {
  const apiKey = key();
  const candidates = [models.roles.agent.model, ...models.roles.agent.candidates];
  const model: AgentModel = {
    async complete(input) {
      let last: unknown;
      for (const id of candidates) {
        try {
          const client = new OpenRouterClient({ apiKey, fetchImpl: (url, init) => fetch(url, init) });
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

  const edl = fixtureEdl();
  const check = validateEdl(edl);
  if (!check.valid) throw new Error(`fixture EDL is invalid: ${JSON.stringify(check.issues)}`);

  const result = await runAgent(
    { model, registry: createDefaultRegistry() },
    {
      message: 'Add a 0.4 second blur transition before the second clip, make the whole video 9 seconds, then render a preview and tell me what you changed.',
      autonomy: 'auto',
      context: { listingId: edl.listingId, edl, facts: { address: 'Smoke Test Tower, Dubai Marina', price: 'AED 1,850,000', beds: 2, baths: 2, currency: 'AED' }, shots: [] },
      onEvent: (event) => {
        if (event.type === 'tool_result' || event.type === 'warning' || event.type === 'error') {
          console.log(`[${event.type}] ${event.message}`);
        }
      },
    },
  );

  console.log('\nRESULT', JSON.stringify({
    ok: result.ok,
    reply: result.reply,
    edits: result.edits,
    costUsd: result.costUsd,
    steps: result.steps,
    warnings: result.warnings,
    duration: durationSec(result.edl),
    transition: result.edl.clips[1]?.transitionIn,
  }, null, 2));

  if (!result.ok) process.exitCode = 1;

  const outDir = resolve('data/tmp');
  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, 'agent-smoke.mp4');
  await renderEdl(result.edl, 'vertical-social', 'draft', output, { timeoutMs: 180_000 });
  const info = await probe(output);
  console.log(`\nRENDERED ${output}\n  ffmpeg=${ffmpegPath()}\n  duration=${info.durationSec}s  ${info.width}x${info.height}`);
  if (Math.abs(info.durationSec - durationSec(result.edl)) > 0.35) {
    console.error('Rendered duration does not match the edited EDL.');
    process.exitCode = 1;
  }

  // Second run: a medium-risk deletion must pause for approval. The preview
  // port is real, so a `preview_render` call produces an actual draft.
  let approvals = 0;
  let previewRendered = false;
  const approvalRun = await runAgent(
    {
      model,
      registry: createDefaultRegistry(),
      preview: {
        preview: async (draft) => {
          const previewPath = join(outDir, 'agent-preview.mp4');
          const rendered = await renderPreview({
            edl: draft,
            listingDir: resolve('tests/fixtures/media'),
            output: previewPath,
            width: 540,
            facts: { address: 'Smoke Test Tower, Dubai Marina', price: 'AED 1,850,000' },
          });
          previewRendered = true;
          console.log(`[preview] ${rendered.path} ${rendered.width}x${rendered.height} ${rendered.durationSec}s`);
          return { path: rendered.path, ...(rendered.warnings.length > 0 ? { warning: rendered.warnings[0] } : {}) };
        },
      },
    },
    {
      message: 'First call preview_render on the current edit. Then retime the film to 8 seconds and render a final preview.',
      autonomy: 'ask',
      context: { listingId: edl.listingId, edl: result.edl, facts: { address: 'Smoke Test Tower, Dubai Marina', price: 'AED 1,850,000', beds: 2, baths: 2, currency: 'AED' }, shots: [] },
      requestApproval: async (request) => {
        approvals += 1;
        console.log(`[approval] ${request.risk} ${request.summary}`);
        return true;
      },
      onEvent: (event) => {
        if (event.type === 'tool_result' || event.type === 'warning' || event.type === 'error') {
          console.log(`[${event.type}] ${event.message}`);
        }
      },
    },
  );

  console.log('\nAPPROVAL RUN', JSON.stringify({
    ok: approvalRun.ok,
    approvals,
    previewRendered,
    reply: approvalRun.reply,
    edits: approvalRun.edits,
    costUsd: approvalRun.costUsd,
    duration: durationSec(approvalRun.edl),
  }, null, 2));
  if (!approvalRun.ok || approvals === 0 || !previewRendered) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
