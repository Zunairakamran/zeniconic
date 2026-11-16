# Testing

The pipeline is a pure function of files, versions and inputs. Test it that way:
no network in unit tests, no pixels in snapshots, no retries to hide flakiness.
The ladder runs cheapest-first, and every rung has a number that can fail.

## The ladder

| Rung | Tool | Scope | Runtime | Gate |
|---|---|---|---|---|
| Unit | Vitest | Metrics, validator, cost maths, redaction, migrations | <40 s | 100 % pass, ≥85 % statements |
| Golden | Vitest snapshots | 3 real listings, EDL and manifest | <60 s | Byte-identical except `createdAt` and provenance counters |
| E2E | Playwright + Electron | The six-step flow | <8 min | Pass on Windows CI, zero retries |
| Smoke | Real pipeline render | 5.000 s vertical file | <90 s | ffprobe asserts exact |
| Evals | Chat harness | 30 scripted requests | <20 s recorded | ≥27/30 tool match, 30/30 invariants |
| Release | Manual checklist | Install, update, uninstall, migrate | 30 min | Every row ticked |

## Unit tests

| File | What it proves |
|---|---|
| `metrics.test.ts` | Sharpness, exposure, motion and score formulas match stored vectors to 3dp |
| `validator.test.ts` | Every rule R01–R39 has at least one failing fixture and one passing fixture |
| `cost.test.ts` | Nano-USD arithmetic, cap enforcement, reservation races, rounding at 4dp |
| `time-ref.test.ts` | 1,000 fuzzed offsets; no escape from a shot; every error carries `allowed` |
| `redact.test.ts` | Keys, tokens, usernames, addresses, prices and paths never reach a log line |
| `migrate.test.ts` | Each EDL version step is forward-only and idempotent |

Rules for these tests: no `Date.now()` in an assertion, no `Math.random()` without
a fixed seed, no sleeping, no model call, no ffmpeg process. A unit test that
needs any of those is an integration test wearing a costume.

Coverage is a floor, not a target: 85 % statements and 80 % branches across
`services/pipeline`, with 100 % on `services/pipeline/cost` and on the validator
rule registry. A rule without a failing fixture fails the suite, even if coverage
is high.

## Golden fixtures

Three listings, anonymised, small enough to clone in CI:

| Fixture | Format | Clips | Why |
|---|---|---|---|
| `oak-avenue` | `just_listed` | 9 | The happy path; every tool has a target |
| `riverside-loft` | `cinematic_hero` | 12 | Long-form timing, dissolves, music-led |
| `pine-cottage` | `social_hook` | 7 | Short hook, tight duration, burned captions |

```
tests/fixtures/listings/oak-avenue/
  footage_index.json          measured once from the real media
  facts.json                  confirmed price, address, beds, baths, phone
  edl/just-listed_v3.json     the snapshot under test
  expected/manifest.json      segment hashes, duration, LUFS, frame count
  proxy/*.mp4                 320×568, original duration and timebase, encode-path only
```

The proxy clips exercise crop, concat and mux; they are not used to recompute
metrics, because a proxy has different sharpness and motion. Metric tests read
stored measurement vectors instead. That keeps the fixture honest and the suite
fast.

Snapshot comparison strips `createdAt`, `provenance.costUsd` and
`provenance.renderCacheHits`, then compares canonical JSON byte-for-byte. Update
with `pnpm vitest run tests/golden -u`, and only with a reviewer who can explain
the EDL diff. A snapshot change in a pull request is a design change.

Renders are compared by EDL hash and manifest, never by pixel diff. Pixel diffs
fail on font hinting and codec drift; the EDL hash catches the thing that matters.

## Playwright: the six-step flow

1. Create a listing from `oak-avenue` and confirm the facts.
2. Wait for analysis to finish; assert the shot count and the first contact sheet.
3. Choose `just_listed` + `social`; assert one variant and one EDL v1.
4. Type "make it 20 seconds", wait for the preview card, click Apply.
5. Assert the 8 s draft, the 20.0 s label and the diff lines.
6. Export `vertical-social`; assert the MP4, cover `.jpg`, `.txt`, and `.srt` when captions are `sidecar` or `both`.

```ts
const app = await _electron.launch({
  args: ['apps/desktop/dist/main.js'],
  env: { ...process.env, REEL_E2E: '1', MODEL_MODE: 'fixture' }
});
const win = await app.firstWindow();
```

The model provider is stubbed with recorded responses, so the test is free and
deterministic. Fail on any console error, any unhandled dialog and any outbound
request other than the update check. Trace and screenshot on failure; zero
retries in CI, because a flaky test is a bug in the app or the test, not weather.

Per-step timeout 90 s, whole flow 8 minutes. If the suite regularly needs 9, the
app is too slow for the target machine, not the test too strict.

## The 5-second render smoke

This runs the real pipeline, not a mock: a 5.000 s vertical EDL through segments,
Remotion, encode, mux and loudness.

```powershell
$ffprobe = "$env:LOCALAPPDATA\Programs\Zeniconic\resources\bin\ffprobe.exe"
node services/pipeline/cli.mjs render `
  --edl tests/smoke/edl-5s.json `
  --profile vertical-social `
  --ladder final `
  --out tests/smoke/out.mp4
& $ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate `
  -of json tests/smoke/out.mp4
```

| Assertion | Value |
|---|---|
| Duration | 5.000 s ±0.034 (one frame at 30 fps) |
| Picture | 1080×1920, h264, yuv420p, 30/1 |
| Audio | aac, 48 kHz, stereo |
| Loudness | −14.0 ±1.0 LUFS, true peak ≤ −1.5 dBTP |
| Fast start | `moov` before `mdat` |
| Runtime | <90 s on a 4-core CI runner |

A second, cheaper smoke runs only ffmpeg and finishes in 25 s; it proves the
bundled encoder works when Chromium or Remotion is unavailable. The pipeline
smoke is the gate; the ffmpeg smoke is the diagnostic.

## Prompt changes

Any change under `prompts/**`, `services/pipeline/models.json` or a tool schema
requires, in the same pull request:

1. The recorded eval suite passes (30/30 schema, ≥27/30 tool match, 30/30
   invariants).
2. The live eval suite passes with the `prompt-change` label, applied by a
   reviewer, never the author.
3. Golden EDLs are re-reviewed if planning output changed; `-u` alone is not a
   review.
4. The model ID and prompt version in the fixture are updated deliberately.

The workflow fails if `prompts/**` changed and the label is absent. That is
cheaper than discovering a regression in a client's video.

## CI

```yaml
name: ci
on: [pull_request]
jobs:
  windows:
    runs-on: windows-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -C apps/desktop build
      - run: pnpm vitest run --coverage
      - run: pnpm playwright test --project=windows
      - run: powershell -File tests/smoke/render-5s.ps1
      - run: pnpm tsx services/pipeline/evals/run.ts --suite tools-v3 --mode recorded --fail-under 0.9
```

Target total is under 15 minutes with a warm pnpm store and cached Playwright
browsers. Windows only: the app ships on Windows, and a Linux-only green build
has never caught a path-length bug, a `\` separator or a locked-file rename.

## Test data rules

- No client media in the repository. Fixtures are anonymised at the address level;
  prices and phone numbers are synthetic but internally consistent.
- No network in unit, golden or E2E. Live evals are the only billed test.
- No screenshots as golden images. Text and layout are asserted structurally.
- Timeouts fail; they do not retry.
- A test that depends on the machine's locale, clock or GPU is disabled until it
  does not.

## Verification

| Command | Expected |
|---|---|
| `pnpm vitest run --coverage` | 0 failures; coverage floors printed and met |
| `pnpm vitest run tests/golden` | 3 fixtures, zero snapshot diffs |
| `pnpm playwright test --project=windows` | 1 flow, 0 retries, trace only on failure |
| `powershell -File tests/smoke/render-5s.ps1` | Exit 0 within 90 s; all six assertions |
| `pnpm tsx services/pipeline/evals/run.ts --suite tools-v3 --mode recorded` | Gate table green |
| `git diff --stat tests/fixtures` | Empty unless the PR is about the fixtures |
