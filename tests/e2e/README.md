# Renderer end-to-end harness

`scripts/e2e.mjs` is the end-to-end test for the built renderer. It is plain
Node: no Playwright, no test framework and no added dependencies.

It serves `dist/ui` from a small built-in HTTP server, launches Chrome or Edge
headless, drives the real pages over the Chrome DevTools Protocol, and prints a
PASS/FAIL table.

## Run it

```powershell
npm run build:ui
node scripts/e2e.mjs
```

`dist/ui/index.html` must exist. If it does not, the harness fails immediately
with:

```
FAIL: dist/ui/index.html is missing.
Build the renderer first: npm run build:ui
```

The harness exits `0` when every check passes and `1` on any failure, including
a missing build, a missing heading, an assertion mismatch, horizontal overflow,
a console error, a missing screenshot or a browser that will not start.

Chrome or Edge must be installed. Discovery checks the standard Windows
install locations; set `CHROME_PATH` to use a specific Chromium executable:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/e2e.mjs
```

## What it covers

Every hash route is loaded as a fresh document:

`#home`, `#intake`, `#analysis`, `#shots`, `#variants`, `#chat`, `#formats`,
`#export`, `#settings`

For each route, at both **1440×900** and **1280×800**:

- waits for `document.readyState === 'complete'` and the screen's root heading;
- asserts route-specific content taken from the React source, for example:
  - `home`: 4 listing cards, new-video tile, spend footer;
  - `intake`: 3 look cards, price/beds facts, 5 of 5 facts confirmed, 2 of 3
    aspects selected;
  - `analysis`: 5 stages, 24-shot contact sheet, 24 scored tiles and the review
    action (the live scoring animation is allowed to finish first so the
    screenshot is stable);
  - `shots`: 18 tiles, 3 rejected, 6 room filters;
  - `variants`: 3 cards, 2 approved, 11-shot storyboard;
  - `chat`: 4 versions, 3-change diff, apply disabled until preview;
  - `formats`: 3 shapes, 2 on by default, 6 output files;
  - `export`: 3 variant chips, 2 approved, 4 output files;
  - `settings`: 6 cards, 3 model rows, 2 theme buttons, 6 log rows;
- asserts `document.body.scrollWidth <= window.innerWidth + 1` (and the root
  `scrollWidth`), so a route that introduces horizontal overflow fails;
- collects `Runtime.consoleAPICalled` errors and `Runtime.exceptionThrown`
  events and fails if the route emitted any.

### Theme

- Loads `?theme=dark#variants` and asserts `document.documentElement.dataset.theme`
  is `dark`.
- Clicks the topbar `.themebtn` through `Runtime.evaluate` and asserts the
  document flips to light and the button label becomes `Dark`.
- Clicks again and asserts it flips back to dark.

### Screenshots

One viewport screenshot per route at 1440×900, light theme:

```
tests/e2e/screens/home.png
tests/e2e/screens/intake.png
tests/e2e/screens/analysis.png
tests/e2e/screens/shots.png
tests/e2e/screens/variants.png
tests/e2e/screens/chat.png
tests/e2e/screens/formats.png
tests/e2e/screens/export.png
tests/e2e/screens/settings.png
```

Three dark screenshots at the same size:

```
tests/e2e/screens/variants-dark.png
tests/e2e/screens/export-dark.png
tests/e2e/screens/settings-dark.png
```

Every PNG is checked to be exactly 1440×900. The screens directory is cleared
at the start of each run.

## How it works

- **Static server**: Node `http` on an ephemeral `127.0.0.1` port, serving
  `dist/ui` with MIME types for HTML, JS, CSS, images and fonts. Extension-less
  paths fall back to `index.html`; `/favicon.ico` returns `204`.
- **Browser**: Chrome/Edge with `--headless=new` and
  `--remote-debugging-port=0`. The actual port is read from
  `DevToolsActivePort` in the temporary profile, then the page websocket is
  discovered via `/json/list`.
- **Determinism**: a unique `e2e=N` query parameter is appended to every
  navigation so the harness never observes the previous document during a
  same-route reload. Fonts and two animation frames are awaited before checks
  and screenshots.
- **Cleanup**: a `try/finally` closes the browser (`Browser.close`, then a
  process-tree kill on Windows), closes the static server and removes the
  temporary profile. A synchronous `exit` handler repeats the kill and profile
  removal if the process ends unexpectedly. No browser process or temp profile
  is left behind, even on failure.

## Extending

Add or adjust a route in the `routes` array in `scripts/e2e.mjs`. Each check is
an expression evaluated in the page plus an operator (`equals`, `includes`,
`gte`, `truthy`, `falsy`). Helper functions available inside expressions:

- `text(selector)` — trimmed, whitespace-collapsed `textContent`;
- `count(selector)` — number of matching elements;
- `attr(selector, name)` — attribute value or `null`.

The goal is to assert stable, meaningful things (counts, labels, gates) rather
than volatile values such as live percentages or timestamps.

## Current UI bugs the harness does not mask

These are observations from the first run; the harness asserts current
behaviour and does not encode the bugs as expected values:

- The rail's **Music** and **Brand** items both navigate to `#settings`, and
  the active-state expression can never mark either item as selected.
- The topbar says **$12.40 left**, while Settings reports **$1.84 of $20**
  (which leaves $18.16) and Analysis reports **$19.93** left of the same cap.
- **Formats** counts all three variants (6 files including the unapproved
  Walkthrough), while **Export** renders only the two approved variants
  (4 files). The step between the two screens changes the file count.
- **Shot review** reports **3 rejected**, while the Variants storyboard warns
  **2 shots rejected**.
- The home cards are built from the bridge fallback, which drops
  `variantCount` and `progress`: Marina Gate 1 shows **0 variants ready** and
  Bloom Towers shows **Analysing 0%** even though the demo data says 3 variants
  and 62%.
