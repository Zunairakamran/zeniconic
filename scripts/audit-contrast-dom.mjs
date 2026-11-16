#!/usr/bin/env node
// Audit rendered text contrast in the mockup deck, per theme, in the real DOM.
// Catches text over tokens (not over photos, which are reported as unknown).
// Usage: node scripts/audit-contrast-dom.mjs

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const deck = join(root, 'docs', 'mockups', 'index.html');
const PORT = 9334;

const chromeCandidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const chrome = chromeCandidates.find((p) => existsSync(p));
if (!chrome) { console.error('No Chrome or Edge found.'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = join(process.env.TEMP || '.', `reelestate-audit-${Date.now()}`);
const child = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} };
process.on('exit', cleanup);

let targets;
for (let i = 0; i < 60; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch {}
  await sleep(250);
}
const page = (targets || []).find((t) => t.type === 'page');
if (!page) { console.error('No page target.'); cleanup(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: r, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : r(m.result);
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
await sleep(2000);

const audit = `
(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };
  const hex = (c) => '#' + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const out = [];
  // Any element painted with an image or gradient counts as media. Text sitting
  // on media is judged against the picture, not against a token, so skip it.
  const mediaRects = [];
  for (const m of document.querySelectorAll('body *')) {
    const s = getComputedStyle(m);
    if (!s.backgroundImage || s.backgroundImage === 'none') continue;
    const mr = m.getBoundingClientRect();
    if (mr.width > 2 && mr.height > 2) mediaRects.push(mr);
  }
  const overMedia = (r) => {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return mediaRects.some((mr) => x >= mr.left && x <= mr.right && y >= mr.top && y <= mr.bottom);
  };
  for (const el of document.querySelectorAll('body *')) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (txt.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .is-disabled, [aria-hidden="true"]')) continue;
    // Text laid over photography or video is measured against media, not a token.
    if (el.closest('.poster, [class*="poster"], .preview916, .shot-photo, .thumb, .filmstrip, .covers, .cover-thumb, .sb, .playbtn, .pvframe')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (overMedia(r)) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    let bg = null, bgEl = null, unknown = false, node = el;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') { unknown = true; break; }
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0.9) { bg = c; bgEl = node; break; }
      node = node.parentElement;
    }
    if (unknown || !bg) continue;
    const cr = ratio(fg, bg);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const min = large ? 3 : 4.5;
    if (cr < min) {
      out.push({
        text: txt.slice(0, 54),
        cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 42),
        ratio: +cr.toFixed(2),
        min,
        fg: hex(fg),
        bg: hex(bg),
        size: +size.toFixed(1),
        bgCls: (bgEl.className && bgEl.className.toString ? bgEl.className.toString() : '').slice(0, 30),
      });
    }
  }
  out.sort((a, b) => a.ratio - b.ratio);
  return { total: out.length, items: out.slice(0, 40) };
})()
`;

for (const theme of ['light', 'dark']) {
  await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme === 'light' ? '' : theme)}; true`);
  await sleep(350);
  const res = await evaluate(audit);
  console.log(`\n${theme.toUpperCase()} — ${res.total} text elements below AA`);
  for (const it of res.items) {
    console.log(`  ${String(it.ratio).padStart(5)}:1  ${it.fg} on ${it.bg}  ${it.size}px  "${it.text}"  [${it.cls}]`);
  }
}

await send('Browser.close').catch(() => {});
ws.close();
cleanup();
