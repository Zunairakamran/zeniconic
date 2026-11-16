#!/usr/bin/env node
// End-to-end browser harness for the Zeniconic renderer.
//
// No test framework and no dependencies: the built `dist/ui` bundle is served
// by a small Node static server, Chrome/Edge runs headless, and the pages are
// driven over the DevTools Protocol. `npm run build:ui` must have run first.
//
// Usage: node scripts/e2e.mjs
//
// Exits non-zero on the first sign of a broken route, missing screen content,
// horizontal overflow, console errors or a short screenshot.

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distDir = join(root, 'dist', 'ui');
const screensDir = join(root, 'tests', 'e2e', 'screens');

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
];

// Every row is a browser-visible assertion. Expressions are evaluated inside
// one page script that defines `text`, `count` and `attr` helpers.
const routes = [
  {
    id: 'home',
    heading: '.home-head h1',
    title: 'Listings',
    note: '4 listing cards, new-video tile, spend footer',
    checks: [
      { label: 'listing cards', expr: `count('.home-card')`, op: 'equals', value: 4 },
      { label: 'new video tile', expr: `count('.home-new')`, op: 'equals', value: 1 },
      { label: 'thumbnails', expr: `count('.home-thumb')`, op: 'equals', value: 4 },
      { label: 'spend footer', expr: `text('.home-foot__spend')`, op: 'includes', value: '1.84' },
    ],
  },
  {
    id: 'intake',
    heading: '.intake-head h1',
    title: 'Intake',
    note: '3 looks, facts from the listing, 2 of 3 aspects',
    checks: [
      { label: 'look cards', expr: `count('.intake-look')`, op: 'equals', value: 3 },
      { label: 'one picked look', expr: `count('.intake-look--on')`, op: 'equals', value: 1 },
      { label: 'price fact', expr: `document.querySelector('#intake-price')?.value ?? ''`, op: 'includes', value: '1,850,000' },
      { label: 'beds fact', expr: `document.querySelector('#intake-beds')?.value ?? ''`, op: 'equals', value: '3' },
      { label: 'facts confirmed', expr: `text('.intake-facts .badge')`, op: 'includes', value: '5 of 5' },
      { label: 'aspects selected', expr: `count('.intake-chips .chip--on')`, op: 'equals', value: 2 },
      { label: 'clip strip', expr: `count('.intake-shot')`, op: 'equals', value: 6 },
    ],
  },
  {
    id: 'analysis',
    heading: '.analysis-head h1',
    title: 'Analysis',
    note: 'idle state, 5 queued stages, folder and listings actions',
    // A direct #analysis load has no job, so the screen must settle into its
    // idle state instead of waiting for progress that will never arrive.
    settle: '.analysis--idle .analysis-idle__card',
    settleTimeout: 10000,
    checks: [
      { label: 'idle state', expr: `count('.analysis--idle')`, op: 'equals', value: 1 },
      { label: 'queued stages', expr: `count('.analysis-stage--queued')`, op: 'equals', value: 5 },
      { label: 'idle actions', expr: `count('.analysis-head__actions .btn')`, op: 'equals', value: 2 },
      { label: 'choose folder action', expr: `text('.analysis-head .btn--primary')`, op: 'includes', value: 'Choose a folder' },
      { label: 'back action', expr: `text('.analysis-head .btn--ghost')`, op: 'includes', value: 'Back to listings' },
      { label: 'idle note', expr: `text('.analysis-sub')`, op: 'includes', value: 'Nothing is running' },
    ],
  },
  {
    id: 'shots',
    heading: '.shotreview__title',
    title: 'Shot review',
    note: '18 shots, 3 rejected, 6 room filters',
    checks: [
      { label: 'shot tiles', expr: `count('.shotreview__tile')`, op: 'equals', value: 18 },
      { label: 'rejected tiles', expr: `count('.shotreview__tile.is-rejected')`, op: 'equals', value: 3 },
      { label: 'room filters', expr: `count('.shotreview__filters .chip')`, op: 'equals', value: 6 },
      { label: 'head note', expr: `text('.shotreview__headnote')`, op: 'includes', value: 'of 18 rejected' },
      { label: 'foot count', expr: `text('.shotreview__footinfo')`, op: 'includes', value: '18' },
    ],
  },
  {
    id: 'variants',
    heading: '.variantscreen__title',
    title: 'Variants',
    note: '3 variants, 2 approved, 11-shot storyboard',
    checks: [
      { label: 'variant cards', expr: `count('.variantscreen__card')`, op: 'equals', value: 3 },
      { label: 'approved cards', expr: `count('.variantscreen__card.is-approved')`, op: 'equals', value: 2 },
      { label: 'storyboard shots', expr: `count('.variantscreen__strip button')`, op: 'equals', value: 11 },
      { label: 'scores', expr: `count('.variantscreen__scorevalue')`, op: 'equals', value: 3 },
      { label: 'storyboard title', expr: `text('.variantscreen__boardtitle')`, op: 'includes', value: 'Storyboard' },
    ],
  },
  {
    id: 'chat',
    heading: '.refine__heading h1',
    title: 'Refine',
    note: '4 versions, 3-change diff, apply gated behind preview',
    checks: [
      { label: 'version thumbs', expr: `count('.refine__vthumb')`, op: 'equals', value: 4 },
      { label: 'diff rows', expr: `count('.refine__row')`, op: 'equals', value: 3 },
      { label: 'diff is preview-only', expr: `text('.refine__diffmode')`, op: 'equals', value: 'Preview only' },
      { label: 'apply disabled', expr: `document.querySelector('.refine__diffactions .btn--primary')?.disabled === true`, op: 'truthy' },
      { label: 'composer', expr: `attr('#refine-input', 'placeholder')`, op: 'includes', value: 'Ask for one change' },
      { label: 'transcript heading', expr: `text('.refine__chat h2')`, op: 'equals', value: 'Refine' },
    ],
  },
  {
    id: 'formats',
    heading: '.formats__title h1',
    title: 'Formats',
    note: '3 shapes, 2 on by default, 6 output files',
    checks: [
      { label: 'aspect cards', expr: `count('.aspect-card')`, op: 'equals', value: 3 },
      { label: 'aspects on', expr: `count('.aspect-card.is-on')`, op: 'equals', value: 2 },
      { label: 'file total', expr: `text('.formats__output h2')`, op: 'equals', value: '4 files' },
      { label: 'render rows', expr: `count('.render-row')`, op: 'equals', value: 3 },
      { label: 'selected count', expr: `text('.formats__count b')`, op: 'equals', value: '2' },
      { label: 'safe area', expr: `attr('.safe-frame', 'aria-label')`, op: 'includes', value: '340' },
    ],
  },
  {
    id: 'export',
    heading: '.export__title h1',
    title: 'Export',
    note: '3 chips, 2 approved, 4 files across 2 shapes',
    checks: [
      { label: 'output table rows', expr: `count('table[aria-label="Output files"] tbody tr')`, op: 'equals', value: 3 },
      { label: 'variant chips', expr: `count('.export__chip')`, op: 'equals', value: 3 },
      { label: 'approved chips', expr: `count('.export__chip.is-approved')`, op: 'equals', value: 2 },
      { label: 'file total', expr: `text('.export__table-card h2')`, op: 'equals', value: '4 files' },
      { label: 'foot total', expr: `text('.export__price b')`, op: 'includes', value: '4 files' },
      { label: 'approval note', expr: `text('.export__approved-note')`, op: 'includes', value: '2 of 3 approved' },
    ],
  },
  {
    id: 'settings',
    heading: '.settings__head h1',
    title: 'Settings',
    note: '8 cards, 3 models, voice model, theme switch, log tail',
    checks: [
      { label: 'cards', expr: `count('.settings__card')`, op: 'equals', value: 8 },
      { label: 'model rows', expr: `count('.settings__card--models .settings__model')`, op: 'equals', value: 3 },
      { label: 'theme buttons', expr: `count('.settings__theme button')`, op: 'equals', value: 2 },
      { label: 'log rows', expr: `count('.settings__log-row')`, op: 'equals', value: 6 },
      { label: 'spend total', expr: `text('.settings__big')`, op: 'equals', value: '$1.84' },
    ],
  },
];

const darkScreens = ['variants', 'export', 'settings'];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Microsoft/Edge/Application/msedge.exe`,
].filter(Boolean);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.map', 'application/json; charset=utf-8'],
]);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** @type {Array<{ ok: boolean, label: string, detail: string }>} */
const results = [];
let anyFailed = false;

function record(label, ok, detail) {
  results.push({ ok: Boolean(ok), label, detail });
  if (!ok) anyFailed = true;
}

function printTable() {
  const width = Math.max(5, ...results.map((row) => row.label.length));
  const line = '-'.repeat(width + 12 + 52);
  console.log('');
  console.log('Zeniconic UI e2e');
  console.log(line);
  console.log(`${'STATUS'.padEnd(7)}${'CHECK'.padEnd(width + 2)}DETAIL`);
  console.log(line);
  for (const row of results) {
    console.log(`${(row.ok ? 'PASS' : 'FAIL').padEnd(7)}${row.label.padEnd(width + 2)}${row.detail}`);
  }
  console.log(line);
  const passed = results.filter((row) => row.ok).length;
  const failed = results.length - passed;
  console.log(`${passed} passed · ${failed} failed · ${screens.length} screenshots (${screens.filter((s) => !s.endsWith('-dark')).length} light, ${screens.filter((s) => s.endsWith('-dark')).length} dark)`);
  if (failed > 0) console.log('FAILED');
}

// ---------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/favicon.ico') {
          response.writeHead(204);
          response.end();
          return;
        }
        if (pathname.endsWith('/')) pathname += 'index.html';

        const filePath = resolve(distDir, `.${pathname}`);
        const inside = filePath === distDir || filePath.startsWith(distDir + sep);
        if (!inside) {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }

        const usable = existsSync(filePath) && statSync(filePath).isFile();
        const target = usable ? filePath : !extname(pathname) ? join(distDir, 'index.html') : null;
        if (!target) {
          response.writeHead(404);
          response.end('Not found');
          return;
        }

        const type = MIME.get(extname(target).toLowerCase()) ?? 'application/octet-stream';
        response.writeHead(200, {
          'content-type': type,
          'cache-control': 'no-store',
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(target).pipe(response);
      } catch {
        response.writeHead(500);
        response.end('Server error');
      }
    });

    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectServer(new Error('Static server did not get a port.'));
        return;
      }
      resolveServer({ server, port: address.port });
    });
  });
}

// ---------------------------------------------------------------------------
// Chrome / CDP
// ---------------------------------------------------------------------------

async function waitForDevToolsPort(profile, child) {
  const file = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Browser exited before DevTools was ready (code ${child.exitCode}).`);
    }
    if (existsSync(file)) {
      const [first] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
      const port = Number(first);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for DevToolsActivePort in ${profile}.`);
}

function attachCdp(ws) {
  let nextId = 1;
  const pending = new Map();
  /** @type {Array<{ kind: string, text: string, url: string | null }>} */
  const consoleErrors = [];

  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`CDP timeout after 30s: ${method}`));
      }, 30000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          done(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          fail(error);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: done, reject: fail } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? fail(new Error(message.error.message)) : done(message.result);
      return;
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.type ?? '')
        .join(' ');
      consoleErrors.push({
        kind: 'console',
        text,
        url: message.params.stackTrace?.callFrames?.[0]?.url ?? null,
      });
    }

    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      consoleErrors.push({
        kind: 'exception',
        text: details.exception?.description ?? details.text ?? 'Uncaught exception',
        url: details.url ?? null,
      });
    }
  };

  ws.onclose = () => {
    for (const { reject: fail } of pending.values()) {
      fail(new Error('CDP connection closed.'));
    }
    pending.clear();
  };

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          'Evaluation failed.',
      );
    }
    return response.result.value;
  };

  return { send, evaluate, consoleErrors };
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

const HELPERS = `
  const text = (selector) =>
    (document.querySelector(selector)?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const count = (selector) => document.querySelectorAll(selector).length;
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) ?? null;
`;

const settle = async (evaluate) => {
  await evaluate(`(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return true;
  })()`);
  await sleep(120);
};

async function waitFor(evaluate, expression, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${label}.`);
}

let navigationSeq = 0;

// A unique query parameter makes every navigation a real document load. Without
// it, re-checking the same route at another viewport can observe the old page
// while the new one is still committing.
function stampUrl(url) {
  const [path, hash = ''] = url.split('#');
  const separator = path.includes('?') ? '&' : '?';
  navigationSeq += 1;
  return `${path}${separator}e2e=${navigationSeq}#${hash}`;
}

async function loadRoute(evaluate, url, route, viewport) {
  const target = stampUrl(url);
  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sendCommand('Page.navigate', { url: target });
  await waitFor(
    evaluate,
    `location.href === ${JSON.stringify(target)} && document.readyState === 'complete'`,
    15000,
    `${route.id} document ready`,
  );
  await waitFor(
    evaluate,
    `!!document.querySelector(${JSON.stringify(route.heading)})`,
    10000,
    `${route.id} heading ${route.heading}`,
  );
  if (route.settle) {
    await waitFor(
      evaluate,
      `!!document.querySelector(${JSON.stringify(route.settle)})`,
      route.settleTimeout ?? 15000,
      `${route.id} settled (${route.settle})`,
    );
  }
  await settle(evaluate);
}

// `loadRoute` needs the command sender; bind it once the CDP session exists.
let sendCommand = async () => {
  throw new Error('CDP session is not ready.');
};

function compare(check, value) {
  switch (check.op) {
    case 'equals':
      return value === check.value;
    case 'includes':
      return typeof value === 'string' && value.includes(check.value);
    case 'gte':
      return typeof value === 'number' && value >= check.value;
    case 'truthy':
      return Boolean(value);
    case 'falsy':
      return !value;
    default:
      throw new Error(`Unknown assertion op: ${check.op}`);
  }
}

function show(value) {
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function describeExpectation(check) {
  switch (check.op) {
    case 'equals':
      return `= ${show(check.value)}`;
    case 'includes':
      return `includes ${show(check.value)}`;
    case 'gte':
      return `>= ${show(check.value)}`;
    case 'truthy':
      return 'truthy';
    case 'falsy':
      return 'falsy';
    default:
      return check.op;
  }
}

async function runRouteChecks(evaluate, route) {
  const expressions = [
    `text(${JSON.stringify(route.heading)})`,
    ...route.checks.map((check) => `(${check.expr})`),
  ];
  const values = await evaluate(
    `(() => { ${HELPERS} return [${expressions.join(',')}]; })()`,
  );

  const failed = [];
  const heading = values[0];
  if (!String(heading).includes(route.title)) {
    failed.push(`heading ${show(heading)} should include ${show(route.title)}`);
  }

  route.checks.forEach((check, index) => {
    const value = values[index + 1];
    if (!compare(check, value)) {
      failed.push(`${check.label} ${show(value)} should be ${describeExpectation(check)}`);
    }
  });

  const total = route.checks.length + 1;
  record(
    `${route.id} · content`,
    failed.length === 0,
    failed.length === 0 ? `${total} assertions · ${route.note}` : failed.join('; '),
  );
}

async function checkOverflow(evaluate, route, viewport) {
  const report = await evaluate(`(() => {
    const main = document.querySelector('.main');
    return {
      body: document.body.scrollWidth,
      html: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      mainScroll: main ? main.scrollWidth : 0,
      mainClient: main ? main.clientWidth : 0,
    };
  })()`);

  const bodyOk = report.body <= report.inner + 1;
  const rootOk = report.html <= report.inner + 1;
  const workspace = report.mainScroll > report.mainClient + 1
    ? ` · workspace scrolls ${report.mainScroll} > ${report.mainClient}`
    : ` · workspace ${report.mainClient}`;
  record(
    `${route.id} · overflow @${viewport.width}×${viewport.height}`,
    bodyOk && rootOk,
    `body ${report.body} / root ${report.html} ≤ inner ${report.inner}${workspace}`,
  );
}

const screens = [];

async function capture(evaluate, send, name) {
  await settle(evaluate);
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const buffer = Buffer.from(data, 'base64');
  const size = pngSize(buffer);
  const file = join(screensDir, `${name}.png`);
  const temp = `${file}.tmp`;
  writeFileSync(temp, buffer);
  try {
    if (existsSync(file)) unlinkSync(file);
    renameSync(temp, file);
  } catch {
    // Windows can hold a handle on an existing PNG (preview pane, scanner).
    writeFileSync(file, buffer);
    try {
      unlinkSync(temp);
    } catch {
      /* best effort */
    }
  }
  screens.push(name);
  record(
    `${name} · screenshot`,
    size.width === 1440 && size.height === 900,
    `${size.width}×${size.height} · ${(buffer.length / 1024).toFixed(0)} KB`,
  );
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Screenshot was not a PNG.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function consoleRow(label, errors) {
  if (errors.length === 0) {
    record(label, true, '0 console errors');
    return;
  }
  const first = errors[0];
  record(
    label,
    false,
    `${errors.length} error(s) · ${first.kind}: ${String(first.text).replace(/\s+/g, ' ').slice(0, 160)}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let server;
let browser;
let cdp;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}

function waitForExit(child, timeout) {
  return new Promise((done) => {
    if (child.exitCode !== null) {
      done(true);
      return;
    }
    let timer;
    const finish = () => {
      clearTimeout(timer);
      child.off('exit', finish);
      done(child.exitCode !== null);
    };
    timer = setTimeout(finish, timeout);
    child.once('exit', finish);
  });
}

async function removeDir(path, attempts = 40, delay = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return true;
    } catch {
      // Windows keeps handles on shader caches and crash reports for a moment
      // after the process exits. Give it time instead of leaking the profile.
      await sleep(delay);
    }
  }
  return false;
}

async function launchBrowser() {
  const executable = CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new Error('No Chrome or Edge found. Set CHROME_PATH to a Chromium executable.');
  }

  const profile = mkdtempSync(join(tmpdir(), 'zeniconic-e2e-'));
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  try {
    const port = await waitForDevToolsPort(profile, child);

    let page;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        page = targets.find((target) => target.type === 'page');
        if (page) break;
      } catch {
        /* the HTTP endpoint is still starting */
      }
      await sleep(100);
    }
    if (!page) {
      throw new Error('Chrome did not expose a page target.');
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      ws.onopen = () => done();
      ws.onerror = () => fail(new Error('Could not open the CDP websocket.'));
    });

    return { child, profile, port, ws };
  } catch (error) {
    killTree(child);
    await waitForExit(child, 2000);
    await removeDir(profile);
    throw error;
  }
}

let cleaning = false;

async function cleanup() {
  if (cleaning) return;
  cleaning = true;

  if (cdp && browser) {
    try {
      await cdp.send('Browser.close');
    } catch {
      /* the socket may already be closing */
    }
  }
  try {
    browser?.ws?.close();
  } catch {
    /* already closed */
  }

  if (browser?.child) {
    await waitForExit(browser.child, 3000);
    killTree(browser.child);
    await waitForExit(browser.child, 1000);
  }

  if (server) {
    await new Promise((done) => server.close(() => done()));
    server = undefined;
  }

  if (browser?.profile) {
    const removed = await removeDir(browser.profile);
    record(
      'cleanup · browser and profile',
      removed,
      removed ? 'browser closed · temp profile removed' : `profile not removable: ${browser.profile}`,
    );
  }
}

// Last-resort cleanup if the process exits through an unexpected path.
process.on('exit', () => {
  try {
    browser?.ws?.close();
  } catch {
    /* already closed */
  }
  killTree(browser?.child);
  try {
    server?.close();
  } catch {
    /* already closed */
  }
  if (browser?.profile) {
    try {
      rmSync(browser.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* Windows may still hold a handle; the temp profile is safe to leave. */
    }
  }
});

async function main() {
  if (!existsSync(join(distDir, 'index.html'))) {
    record('build · dist/ui/index.html', false, 'missing — run `npm run build:ui` first');
    console.error('');
    console.error('FAIL: dist/ui/index.html is missing.');
    console.error('Build the renderer first: npm run build:ui');
    return;
  }
  record('build · dist/ui/index.html', true, 'found');

  rmSync(screensDir, { recursive: true, force: true });
  mkdirSync(screensDir, { recursive: true });

  const started = await startServer();
  server = started.server;
  const base = `http://127.0.0.1:${started.port}`;
  console.log(`Serving dist/ui on ${base}`);

  browser = await launchBrowser();
  cdp = attachCdp(browser.ws);
  sendCommand = cdp.send;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const { evaluate, consoleErrors } = cdp;

  // Light theme, one route at a time, at both desktop widths.
  for (const route of routes) {
    const errorStart = consoleErrors.length;
    try {
      for (const viewport of VIEWPORTS) {
        await loadRoute(evaluate, `${base}/?theme=light#${route.id}`, route, viewport);
        if (route.id === 'analysis') {
          console.log(`Checked #${route.id} @${viewport.width}×${viewport.height} (idle state)`);
        }
        await runRouteChecks(evaluate, route);
        await checkOverflow(evaluate, route, viewport);
        if (viewport === VIEWPORTS[0]) {
          await capture(evaluate, cdp.send, route.id);
        }
      }
    } catch (error) {
      record(`${route.id} · page`, false, error instanceof Error ? error.message : String(error));
    }
    await sleep(150);
    consoleRow(`${route.id} · console`, consoleErrors.slice(errorStart));
  }

  // Theme: the query parameter must win, and the topbar button must flip it.
  const themeErrors = consoleErrors.length;
  try {
    const variantRoute = routes.find((route) => route.id === 'variants');
    await loadRoute(evaluate, `${base}/?theme=dark#variants`, variantRoute, VIEWPORTS[0]);
    const before = await evaluate(`({
      theme: document.documentElement.dataset.theme ?? null,
      label: (document.querySelector('.themebtn')?.textContent ?? '').replace(/\\s+/g, ' ').trim() || null
    })`);
    record(
      'theme · ?theme=dark applies',
      before.theme === 'dark',
      `data-theme=${show(before.theme)} · topbar ${show(before.label)}`,
    );

    await evaluate(`document.querySelector('.themebtn')?.click(); true`);
    await settle(evaluate);
    const after = await evaluate(`({
      theme: document.documentElement.dataset.theme ?? null,
      label: (document.querySelector('.themebtn')?.textContent ?? '').replace(/\\s+/g, ' ').trim() || null
    })`);
    record(
      'theme · topbar flips dark → light',
      after.theme === null && after.label === 'Dark',
      `data-theme=${show(after.theme)} · topbar ${show(after.label)}`,
    );

    await evaluate(`document.querySelector('.themebtn')?.click(); true`);
    await settle(evaluate);
    const back = await evaluate(`({
      theme: document.documentElement.dataset.theme ?? null,
      label: (document.querySelector('.themebtn')?.textContent ?? '').replace(/\\s+/g, ' ').trim() || null
    })`);
    record(
      'theme · topbar flips light → dark',
      back.theme === 'dark' && back.label === 'Light',
      `data-theme=${show(back.theme)} · topbar ${show(back.label)}`,
    );
  } catch (error) {
    record('theme · toggle', false, error instanceof Error ? error.message : String(error));
  }
  await sleep(150);
  consoleRow('theme · console', consoleErrors.slice(themeErrors));

  // Three representative screens in dark, at the same 1440×900 frame.
  for (const id of darkScreens) {
    const route = routes.find((item) => item.id === id);
    const errorStart = consoleErrors.length;
    try {
      await loadRoute(evaluate, `${base}/?theme=dark#${id}`, route, VIEWPORTS[0]);
      await capture(evaluate, cdp.send, `${id}-dark`);
    } catch (error) {
      record(`${id}-dark · page`, false, error instanceof Error ? error.message : String(error));
    }
    await sleep(150);
    consoleRow(`${id}-dark · console`, consoleErrors.slice(errorStart));
  }
}

try {
  await main();
} catch (error) {
  record('harness', false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
}

printTable();
process.exit(anyFailed ? 1 : 0);
