#!/usr/bin/env node
// Render the mockup deck to PNGs, per screen and per theme, using Chrome
// DevTools Protocol directly. No dependencies, no Playwright install.
// Usage: node scripts/render-mockups.mjs [--deck path] [--out dir]

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const root = resolve(import.meta.dirname, '..');
const deck = resolve(arg('--deck', join(root, 'docs', 'mockups', 'index.html')));
const outDir = resolve(arg('--out', join(root, 'docs', 'mockups', 'renders')));
const PORT = 9333;

const chromeCandidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const chrome = chromeCandidates.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome or Edge found.');
  process.exit(1);
}
if (!existsSync(deck)) {
  console.error(`Deck not found: ${deck}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = join(process.env.TEMP || process.env.TMP || '.', `reelestate-render-${Date.now()}`);
const child = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1500,1000',
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => { try { child.kill(); } catch {} };
process.on('exit', cleanup);

let targets;
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    targets = await res.json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch {}
  await sleep(250);
}
const page = (targets || []).find((t) => t.type === 'page');
if (!page) {
  console.error('Chrome did not expose a page target.');
  cleanup();
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: r, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : r(msg.result);
  }
};
const send = (method, params = {}) => new Promise((r, j) => {
  const id = nextId++;
  pending.set(id, { resolve: r, reject: j });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(deck).href });
await sleep(1800); // fonts + layout

const readScreens = () => evaluate(`
  [...document.querySelectorAll('section.board-block')].map((s, i) => {
    const r = s.getBoundingClientRect();
    const t = s.querySelector('.bh-title h2') || s.querySelector('h2');
    const n = s.querySelector('.bh-num');
    return {
      id: s.id || 's' + (i + 1),
      name: (t ? t.textContent : 'screen').trim(),
      num: (n ? n.textContent : '').replace(/[^0-9]/g, '') || String(i + 1),
      top: Math.round(r.top + window.scrollY),
      height: Math.round(r.height)
    };
  })
`);

let screens = [];
// Wait for the deck to settle: nine boards and a stable geometry across two reads.
let previous = '';
for (let i = 0; i < 60; i++) {
  screens = await readScreens();
  const signature = JSON.stringify(screens.map((s) => [s.id, s.top, s.height]));
  if (screens.length >= 9 && signature === previous) break;
  previous = signature;
  await sleep(250);
}
if (!screens.length) {
  const diag = await evaluate(`({
    href: location.href,
    ready: document.readyState,
    title: document.title,
    sections: document.querySelectorAll('section').length,
    boards: document.querySelectorAll('.board-block').length,
    bodyStart: (document.body && document.body.innerText || '').slice(0, 120)
  })`);
  console.error('No section.board-block elements found.', diag);
  cleanup();
  process.exit(1);
}
console.log(`Found ${screens.length} screens in ${deck}`);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Windows can hold a handle on an existing PNG (preview pane, image viewer, AV).
// Write to a temp name and swap, so a stale lock never fails the whole render.
const savePng = (file, b64) => {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, Buffer.from(b64, 'base64'));
  try { if (existsSync(file)) unlinkSync(file); } catch {}
  renameSync(tmp, file);
};

const shoot = async (theme) => {
  const dir = join(outDir, theme);
  mkdirSync(dir, { recursive: true });
  await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme === 'light' ? '' : theme)}; true`);
  await sleep(500);

  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      // Skip the fixed deck nav: it repeats on every screen and clips badly
      // when captured mid-page. The full-deck image keeps it.
      clip: { x: 200, y: s.top, width: 1300, height: s.height, scale: 1 },
    });
    const stem = `${String(s.num).padStart(2, '0')}-${slug(s.name)}`;
    const file = join(dir, `${stem}.png`);
    savePng(file, data);
    console.log(`  ${theme}/${stem}.png  ${s.height}px`);
  }

  // Full deck as one tall image.
  const fullHeight = await evaluate('document.documentElement.scrollHeight');
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1500, height: fullHeight, scale: 1 },
  });
  savePng(join(dir, "_deck.png"), data);
  console.log(`  ${theme}/_deck.png  ${fullHeight}px`);
};

await shoot('light');
await shoot('dark');

await send('Browser.close').catch(() => {});
ws.close();
cleanup();
console.log(`\nRendered to ${outDir}`);
