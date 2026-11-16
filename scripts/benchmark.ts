// Reference benchmark: profile two videos and score the candidate against the
// reference. Read-only; prints a report and never writes files.
//
// Usage: npx tsx scripts/benchmark.ts <candidate> <reference>
//
// Exit codes: 0 report printed, 1 a file could not be read or decoded,
// 2 the arguments were missing.

import { compareProfiles, profileVideo } from '../packages/benchmark/src/index';
import type { StyleProfile } from '../packages/benchmark/src/index';

const [candidateFile, referenceFile] = process.argv.slice(2);

if (candidateFile === undefined || referenceFile === undefined) {
  console.error('usage: npx tsx scripts/benchmark.ts <candidate> <reference>');
  process.exit(2);
}

try {
  const [candidate, reference] = await Promise.all([
    profileVideo(candidateFile),
    profileVideo(referenceFile),
  ]);

  printProfile('candidate', candidateFile, candidate);
  printProfile('reference', referenceFile, reference);

  const comparison = compareProfiles(candidate, reference);

  console.log(`score ${comparison.score.toFixed(1)} / 100`);
  console.log('');

  console.log('deltas (candidate - reference, normalised)');
  for (const [key, value] of Object.entries(comparison.deltas)) {
    const sign = value > 0 ? '+' : '';
    console.log(`  ${key.padEnd(14)} ${sign}${value.toFixed(3)}`);
  }
  console.log('');

  printList('strengths', comparison.strengths);
  printList('weaknesses', comparison.weaknesses);
  printList('advice', comparison.advice);

  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`benchmark failed: ${message}`);
  process.exit(1);
}

function printProfile(label: string, file: string, profile: StyleProfile): void {
  console.log(`${label}  ${file}`);
  console.log(JSON.stringify(profile, null, 2));
  console.log('');
}

function printList(label: string, lines: readonly string[]): void {
  console.log(`${label} (${lines.length})`);
  if (lines.length === 0) {
    console.log('  none');
  } else {
    for (const line of lines) console.log(`  - ${line}`);
  }
  console.log('');
}
