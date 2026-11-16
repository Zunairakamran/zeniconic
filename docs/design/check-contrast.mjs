#!/usr/bin/env node
// Contrast gate for Zeniconic palettes — light and dark.
// Usage: node docs/design/check-contrast.mjs
// Exits 1 if any required pair misses WCAG 2.2 AA: 4.5:1 for text,
// 3:1 for non-text UI boundaries. Disabled text is exempt and reported only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tokens.css'), 'utf8');

const parseVars = (block) => {
  const vars = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) vars[m[1]] = m[2];
  return vars;
};

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
const darkBlock = css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
if (!rootBlock) throw new Error('could not find the :root block in tokens.css');

const light = parseVars(rootBlock[1]);
const dark = { ...light, ...(darkBlock ? parseVars(darkBlock[1]) : {}) };
if (!darkBlock) throw new Error('could not find :root[data-theme="dark"] in tokens.css');

const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((x) => lin(parseInt(x, 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [label, foreground token, background token, minimum]
const pairs = [
  ['body text', 'ink', 'paper', 4.5],
  ['body on raised card', 'ink', 'paper-raised', 4.5],
  ['secondary text', 'ink-70', 'paper', 4.5],
  ['secondary on raised', 'ink-70', 'paper-raised', 4.5],
  ['tertiary / 10px caps', 'ink-45', 'paper', 4.5],
  ['tertiary on inset panel', 'ink-45', 'paper-deep', 4.5],
  ['brass text on paper', 'brass-text', 'paper', 4.5],
  ['brass text on wash', 'brass-text', 'brass-wash', 4.5],
  ['primary button label', 'on-brass', 'brass', 4.5],
  ['primary hover label', 'on-brass', 'brass-hover', 4.5],
  ['success badge', 'success-text', 'sage-wash', 4.5],
  ['warning badge', 'warn-text', 'amber-wash', 4.5],
  ['danger badge', 'danger-text', 'clay-wash', 4.5],
  ['input border on paper', 'border-interactive', 'paper', 3.0],
  ['focus ring on paper', 'brass-text', 'paper', 3.0],
  ['focus ring on stage', 'brass-text', 'stage', 3.0],
];

let failed = 0;
for (const [themeName, palette] of [['light', light], ['dark', dark]]) {
  console.log(`\n${themeName.toUpperCase()}`);
  for (const [label, fgName, bgName, min] of pairs) {
    const fg = palette[fgName];
    const bg = palette[bgName];
    if (!fg || !bg) {
      console.log(`FAIL  missing token  ${fgName} on ${bgName}  (${label})`);
      failed++;
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  min ${min.toFixed(1)}  ${label}`);
  }
  // Informational: disabled text is exempt from 4.5:1 but must still be legible.
  const dis = ratio(palette['ink-20'], palette['paper-deep']);
  console.log(`INFO  ${dis.toFixed(2)}:1  disabled text (exempt, must stay legible)`);
  // The stage separates from cards by a hairline, not by luminance, in dark mode.
  const stageGap = ratio(palette['paper-raised'], palette['stage']);
  console.log(`INFO  ${stageGap.toFixed(2)}:1  raised card vs stage (border carries the edge)`);
}

if (failed) {
  console.error(`\n${failed} pair(s) below AA across themes. Adjust tokens before shipping.`);
  process.exit(1);
}
console.log('\nBoth themes pass WCAG 2.2 AA.');
