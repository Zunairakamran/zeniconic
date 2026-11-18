#!/usr/bin/env node
/**
 * Capture the real Electron UI (real IPC + the demo listing in data/) without
 * Playwright: start a static server for dist/ui, launch Electron pointed at it
 * with `ZENICONIC_DATA_DIR`, attach to the page over CDP and screenshot routes.
 *
 * Usage: node scripts/demo-capture.mjs
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const OUT = join(ROOT, 'demo', 'screenshots');
const UI = join(ROOT, 'dist', 'ui');
const PORT = 9333;
const BASE = 'http://127.0.0.1:9411';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', BASE);
    let file = join(UI, decodeURIComponent(url.pathname));
    if (!existsSync(file) || url.pathname === '/') file = join(UI, 'index.html');
    response.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(9411, '127.0.0.1', () => done(server)));
}

async function pageTarget() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === 'page' && typeof target.url === 'string' && target.url.startsWith(BASE),
      );
      if (page) return page;
    } catch {
      /* endpoint still starting */
    }
    await sleep(150);
  }
  throw new Error('Electron did not expose the app page.');
}

function attach(ws) {
  let nextId = 1;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`CDP timeout: ${method}`));
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
      const entry = pending.get(message.id);
      pending.delete(message.id);
      message.error ? entry.reject?.(new Error(message.error.message)) : entry.resolve(message.result);
    }
  };
  return { send };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const electron = (await import('electron')).default;
  const child = spawn(electron, [`--remote-debugging-port=${PORT}`, 'apps/desktop/electron/main.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZENICONIC_DATA_DIR: join(ROOT, 'data'),
      ZENICONIC_DEV_URL: BASE,
    },
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    const page = await pageTarget();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      ws.onopen = () => done();
      ws.onerror = () => fail(new Error('Could not open the CDP socket.'));
    });
    const { send } = attach(ws);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const routes = ['home', 'intake', 'analysis', 'shots', 'variants', 'chat', 'formats', 'export', 'remix', 'settings'];
    for (const route of routes) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: route === 'variants' ? 1280 : 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Runtime.evaluate', {
        expression: `location.hash = '#${route}'; location.reload();`,
      });
      await sleep(2600);
      if (route === 'chat') {
        await send('Runtime.evaluate', {
          expression: `(() => {
            const button = document.querySelector('.refine__draftrow button');
            if (button instanceof HTMLButtonElement) button.click();
          })()`,
        });
        await sleep(9000);
      }
      const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const file = join(OUT, `${route}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(`captured ${file}`);
    }
    ws.close();
  } finally {
    child.kill();
    server.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
