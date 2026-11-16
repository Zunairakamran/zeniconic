#!/usr/bin/env node
// Skill integrity gate for the Zeniconic playbooks.
// Checks frontmatter, dead relative links, and size budgets.
// Usage: node scripts/check-skills.mjs [--strict]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillsDir = join(root, '.opencode', 'skills');
const strict = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const rows = [];

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const skillMd = join(skillsDir, dir.name, 'SKILL.md');
  let text;
  try {
    text = readFileSync(skillMd, 'utf8');
  } catch {
    errors.push(`${dir.name}: missing SKILL.md`);
    continue;
  }

  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) errors.push(`${dir.name}: no frontmatter block`);
  else {
    const block = fm[1];
    const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = block.match(/^description:\s*([\s\S]*?)(?=\n[a-z-]+:|$)/m)?.[1]?.trim();
    if (!name) errors.push(`${dir.name}: frontmatter is missing name`);
    if (!description) errors.push(`${dir.name}: frontmatter is missing description`);
    if (description && description.length < 80 && !description.startsWith('|')) {
      warnings.push(`${dir.name}: description is only ${description.length} chars; trigger phrases help discovery`);
    }
  }

  const lines = text.split(/\r?\n/).length;
  if (lines > 420) warnings.push(`${dir.name}: SKILL.md is ${lines} lines; move detail into references/`);

  // Relative links in markdown: [text](path) — skip URLs and anchors.
  const links = [...text.matchAll(/\]\(([^)#]+?)\)/g)]
    .map((m) => m[1].trim())
    .filter((p) => !/^(https?:|mailto:)/.test(p));
  for (const link of links) {
    const target = resolve(dirname(skillMd), link);
    try {
      statSync(target);
    } catch {
      errors.push(`${dir.name}: dead link -> ${link}`);
    }
  }

  const files = walk(join(skillsDir, dir.name));
  const refFiles = files.filter((f) => /[\\/]references[\\/]/.test(f));
  const scriptFiles = files.filter((f) => /[\\/]scripts[\\/]/.test(f));
  rows.push({
    skill: dir.name,
    lines,
    references: refFiles.length,
    scripts: scriptFiles.length,
    files: files.length,
  });
}

const pad = (v, n) => String(v).padEnd(n);
console.log(pad('Skill', 26) + pad('SKILL.md', 10) + pad('refs', 6) + pad('scripts', 9) + 'files');
for (const r of rows) {
  console.log(pad(r.skill, 26) + pad(r.lines, 10) + pad(r.references, 6) + pad(r.scripts, 9) + r.files);
}

if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log('  ~ ' + w);
}
if (errors.length) {
  console.log('\nErrors:');
  for (const e of errors) console.log('  x ' + e);
  process.exit(1);
}
console.log('\nAll skills valid: frontmatter present, no dead links.');
if (strict && warnings.length) process.exit(1);
