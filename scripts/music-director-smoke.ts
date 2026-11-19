/**
 * Live music-director smoke: brief → two Lyria takes → analyse → score → pick.
 *
 * This exercises the real path, not a fixture: `createMusicService` calls
 * OpenRouter's Lyria model, writes each MP3 under
 * `data/tmp/music-director-smoke/assets/music`, and reports the provider cost.
 * Every take is decoded and profiled before the next one is requested, so a
 * second generation is a measured retry, never a blind one. Generation stops
 * early when the first take clears `ACCEPT_SCORE`.
 *
 * Budget: two takes at the Lyria Pro price, hard-capped at $0.16. The key is
 * read from `.env` and is never printed, logged or included in the JSON.
 *
 * Re-running with `MUSIC_DIRECTOR_RESUME=1` loads the previously generated and
 * analysed takes from `selected-profile.json` (no regeneration, no cost) and
 * spends the remaining budget on one extra take, so a two-take comparison can
 * be produced without exceeding the cap.
 *
 * Usage:
 *   npx tsx scripts/music-director-smoke.ts
 *   $env:MUSIC_DIRECTOR_RESUME='1'; npx tsx scripts/music-director-smoke.ts
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createMusicService } from '../apps/desktop/music-service';
import {
  analyzeMusicFile,
  buildMusicBrief,
  musicPromptVariants,
  scoreMusicProfile,
  selectMusicCandidate,
} from '../services/pipeline/music-director';
import type {
  MusicCandidate,
  MusicProfile,
  MusicScore,
} from '../services/pipeline/music-director';
import models from '../services/pipeline/models.json';

const DATA_DIR = resolve('data/tmp/music-director-smoke');
const BUDGET_USD = 0.16;
const PRICE_PER_TAKE_USD = 0.08;
const ACCEPT_SCORE = 0.82;
const MAX_TAKES = 2;
const PROFILE_FILE = resolve(DATA_DIR, 'selected-profile.json');

interface ResumeState {
  spendUsd: number;
  costsUsd: number[];
  candidates: MusicCandidate[];
}

function openRouterKey(): string {
  const env = readFileSync(resolve('.env'), 'utf8');
  const line = env
    .split(/\r?\n/)
    .find((entry) => entry.trimStart().startsWith('OPENROUTER_API_KEY='));
  if (line === undefined) throw new Error('OPENROUTER_API_KEY is not in .env');
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  if (value.length === 0) throw new Error('OPENROUTER_API_KEY in .env is blank');
  return value;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Reuses takes that are already generated *and analysed* in a previous run.
 * This is what makes `MUSIC_DIRECTOR_RESUME=1` a comparison, not a retry: the
 * old profile is never regenerated, and the run can spend the remaining budget
 * on one additional take.
 */
function loadResumeState(): ResumeState | undefined {
  let raw: string;
  try {
    raw = readFileSync(PROFILE_FILE, 'utf8');
  } catch {
    return undefined;
  }

  const parsed = JSON.parse(raw) as {
    spendUsd?: unknown;
    costsUsd?: unknown;
    candidates?: unknown;
  };
  if (!Array.isArray(parsed.candidates)) return undefined;

  const candidates: MusicCandidate[] = [];
  for (const entry of parsed.candidates) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { id?: unknown; file?: unknown; profile?: unknown };
    if (typeof record.id !== 'string' || typeof record.file !== 'string') continue;
    if (typeof record.profile !== 'object' || record.profile === null) continue;
    candidates.push({
      id: record.id,
      file: record.file,
      profile: record.profile as MusicProfile,
    });
  }
  if (candidates.length === 0) return undefined;

  const spendUsd =
    typeof parsed.spendUsd === 'number' && Number.isFinite(parsed.spendUsd)
      ? parsed.spendUsd
      : 0;
  const costsUsd = Array.isArray(parsed.costsUsd)
    ? parsed.costsUsd.filter((cost): cost is number => typeof cost === 'number')
    : [];

  return { spendUsd, costsUsd, candidates };
}

function printScore(id: string, score: MusicScore): void {
  console.log(
    `[score] ${id} total=${score.total} bpm=${score.bpm} energy=${score.energy} ` +
      `duration=${score.duration} edges=${score.introOutro}`,
  );
  for (const note of score.notes) console.log(`[score]   ${note}`);
}

async function main(): Promise<void> {
  const brief = buildMusicBrief({
    luxuryLevel: 5,
    propertyType: 'penthouse',
    audience: 'investor',
    editPace: 'medium',
    emotionalTone: 'aspirational',
    durationSec: 30,
    hasVoiceover: false,
    setting: 'Dubai Marina waterfront, Dubai',
  });

  console.log('[brief]');
  for (const reason of brief.reasons) console.log(`[brief] ${reason}`);
  console.log(`[brief] prompt: ${brief.prompt}`);

  const resumeState =
    process.env.MUSIC_DIRECTOR_RESUME === '1' ? loadResumeState() : undefined;
  const candidates: MusicCandidate[] = resumeState?.candidates ?? [];
  let spentUsd = resumeState?.spendUsd ?? 0;
  const costs: number[] = resumeState?.costsUsd ?? [];
  const scores: Array<{ id: string; score: MusicScore }> = candidates.map((candidate) => ({
    id: candidate.id,
    score: scoreMusicProfile(candidate.profile, brief),
  }));

  if (resumeState !== undefined) {
    console.log(
      `[resume] reusing ${candidates.length} already-analysed take(s); ` +
        `carried spend $${spentUsd.toFixed(3)}`,
    );
    for (const entry of scores) printScore(entry.id, entry.score);
  }

  const service = createMusicService({
    dataDir: DATA_DIR,
    model: models.roles.music.model,
    apiKey: () => openRouterKey(),
    priceUsd: PRICE_PER_TAKE_USD,
    canSpend: (usd) => spentUsd + usd <= BUDGET_USD + 1e-9,
    onCost: (usd) => {
      spentUsd = round3(spentUsd + usd);
      costs.push(usd);
      console.log(`[cost] take ${costs.length}: $${usd.toFixed(3)} (run total $${spentUsd.toFixed(3)})`);
    },
  });

  const prompts = musicPromptVariants(brief, MAX_TAKES);
  let forceComparison = resumeState !== undefined && candidates.length < MAX_TAKES;

  try {
    for (let index = candidates.length; index < prompts.length; index += 1) {
      const previous = scores[scores.length - 1]?.score.total;
      const mustCompare = forceComparison;
      if (!mustCompare && previous !== undefined && previous >= ACCEPT_SCORE) break;
      if (spentUsd + PRICE_PER_TAKE_USD > BUDGET_USD + 1e-9) {
        console.log('[stop] budget guard: another take would exceed the $0.16 cap');
        break;
      }

      const id = `lyria-take-${index + 1}`;
      console.log(`[generate] ${id} via ${models.roles.music.model}`);
      const generated = await service.generate(prompts[index] ?? brief.prompt);
      const path = resolve(DATA_DIR, 'assets', 'music', generated.fileName);
      console.log(
        `[generate] ${id}: ${generated.fileName} ${generated.bytes} bytes, ` +
          `${generated.durationSec}s probed, cost $${generated.costUsd.toFixed(3)}`,
      );

      // Analyse before deciding whether another take is justified.
      const profile = analyzeMusicFile(path);
      console.log(
        `[analyse] ${id}: ${profile.durationSec}s, bpm=${profile.bpm ?? 'none'} ` +
          `confidence=${profile.beatConfidence}, beats=${profile.beats.length}, ` +
          `energy mean=${profile.energy.meanNorm} peak=${profile.energy.peakRms} ` +
          `dynamics=${profile.energy.dynamics}`,
      );
      console.log(
        `[analyse] ${id} sections: ` +
          profile.sections
            .map(
              (section) =>
                `${section.kind} ${section.startSec}-${section.endSec}s (${section.meanEnergy})`,
            )
            .join(' | '),
      );

      candidates.push({ id, file: path, profile });
      const scored = scoreMusicProfile(profile, brief);
      scores.push({ id, score: scored });
      printScore(id, scored);

      if (!mustCompare && scored.total >= ACCEPT_SCORE) {
        console.log(
          `[stop] ${id} clears ${ACCEPT_SCORE}; no further take is generated ` +
            '(a retry must follow an analysed take, and this one is good enough).',
        );
        break;
      }
      if (mustCompare) {
        forceComparison = false;
        console.log(
          `[compare] ${id} scored ${scored.total}; keeping both analysed takes for selection.`,
        );
      } else if (index + 1 < prompts.length) {
        console.log(
          `[retry] ${id} scored ${scored.total} < ${ACCEPT_SCORE}; one more take is justified.`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fail] music generation or analysis failed: ${message}`);
    console.error(`[fail] spend so far: $${spentUsd.toFixed(3)} (${costs.length} take(s))`);
    process.exitCode = 1;
    return;
  }

  if (candidates.length === 0) {
    console.error('[fail] no candidate was generated; nothing to select.');
    process.exitCode = 1;
    return;
  }

  const selection = selectMusicCandidate(candidates, brief);
  const chosen = selection.chosen;
  const selectedCopy = resolve(DATA_DIR, `selected${extname(chosen.candidate.file)}`);
  await mkdir(DATA_DIR, { recursive: true });
  await copyFile(chosen.candidate.file, selectedCopy);

  const payload = {
    generatedAt: new Date().toISOString(),
    model: models.roles.music.model,
    budgetUsd: BUDGET_USD,
    spendUsd: spentUsd,
    costsUsd: costs,
    callCount: costs.length,
    brief: {
      facts: brief.facts,
      style: brief.style,
      bpmTarget: brief.bpmTarget,
      bpmRange: brief.bpmRange,
      requiredDurationSec: brief.requiredDurationSec,
      energyTargets: brief.energyTargets,
      prompt: brief.prompt,
      reasons: brief.reasons,
    },
    candidates: selection.ranked.map((entry) => ({
      id: entry.candidate.id,
      file: entry.candidate.file,
      score: entry.score,
      profile: entry.candidate.profile,
    })),
    selected: {
      id: chosen.candidate.id,
      file: chosen.candidate.file,
      copy: selectedCopy,
      score: chosen.score,
      profile: chosen.candidate.profile,
    },
  };

  const profilePath = resolve(DATA_DIR, 'selected-profile.json');
  await writeFile(profilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log('\n[result]');
  console.log(`[result] selected: ${chosen.candidate.id} (${chosen.score.total})`);
  console.log(`[result] source:   ${chosen.candidate.file}`);
  console.log(`[result] copy:     ${selectedCopy}`);
  console.log(`[result] profile:  ${profilePath}`);
  console.log(
    `[result] profile:  ${chosen.candidate.profile.durationSec}s, ` +
      `bpm=${chosen.candidate.profile.bpm ?? 'none'}, ` +
      `confidence=${chosen.candidate.profile.beatConfidence}, ` +
      `beats=${chosen.candidate.profile.beats.length}, ` +
      `energy mean=${chosen.candidate.profile.energy.meanNorm}, ` +
      `peak=${chosen.candidate.profile.energy.peakRms}, ` +
      `dynamics=${chosen.candidate.profile.energy.dynamics}`,
  );
  console.log(
    `[result] sections: ` +
      chosen.candidate.profile.sections
        .map((section) => `${section.kind} ${section.startSec}-${section.endSec}s`)
        .join(' | '),
  );
  console.log(`[result] spend:    $${spentUsd.toFixed(3)} over ${costs.length} take(s)`);
  for (const entry of selection.ranked) {
    console.log(`[result] rank ${entry.candidate.id}: ${entry.score.total}`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
});
