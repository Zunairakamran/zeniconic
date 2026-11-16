# Packaging Zeniconic for Windows

The Windows installer is built with **electron-builder 26** from the `build`
key in the repository `package.json` (there is no separate
`electron-builder.yml`, so the config lives next to the scripts that use it).
This folder holds the pieces that are not obvious from that config: the icon
generator and this guide.

## Build it

From the repository root, in a normal (non-elevated) shell:

```powershell
npm ci                 # or npm install
npm run icon           # once, or after the brand SVG changes
npm run dist           # build:main + build:ui + NSIS installer
npm run dist:dir       # build:main + build:ui + unpacked app, no installer
```

`npm run dist` runs `npm run build` first, so `dist/main/*.cjs` and
`dist/ui/**` are always current. `npm run build` on its own is unchanged and
does not invoke electron-builder.

Prerequisites: Node 22 x64 and a 64-bit Windows host (or Wine/CI equivalent).
Nothing else — no Visual Studio, no Python, no FFmpeg install.

### Output

| Command | Output | Size on this machine |
| --- | --- | --- |
| `npm run dist` | `release\Zeniconic-Setup-0.1.0-x64.exe` (+ `.blockmap`) | ~153 MB |
| `npm run dist:dir` | `release\win-unpacked\Zeniconic.exe` | ~497 MB on disk |

The installer is about 150 MB, matching ADR-012 ("installer ~150 MB"). The
unpacked tree is larger because Electron, `ffmpeg.exe` and `ffprobe.exe` are
stored uncompressed there; NSIS compresses them.

`release/` is a build artefact and is ignored by git. It is not the same as
`dist/` — electron-builder would normally use `dist` as its output folder and
delete the UI build, so `directories.output` is pinned to `release`.

## What is bundled

Inside `resources\app.asar` (0.8 MB):

- `dist\main\main.cjs` and `dist\main\preload.cjs` — the esbuild bundles. The
  entry point is set with `extraMetadata.main`; the repository `main` field is
  untouched.
- `dist\ui\**` — the Vite renderer.
- `apps\desktop\electron\**` — the development shim, kept so the packaged tree
  matches the repository layout.
- `package.json`.

Unpacked next to it in `resources\app.asar.unpacked\node_modules` (they must
be real files to be executed):

- `ffmpeg-static\ffmpeg.exe` (~83 MB)
- `ffprobe-static\bin\win32\x64\ffprobe.exe` (~63 MB)

Everything else is compiled into the main bundle by esbuild, so no other
production `node_modules` is shipped: the `files` entry excludes every package
except those two, and the non-Windows/non-x64 FFprobe binaries are dropped.
Several hundred MB of Remotion/webpack tooling would otherwise be copied even
though the main process never loads it.

Not bundled:

- `.env` / `.env.*` — the OpenRouter key is never shipped (ADR-004, ADR-012).
- `data/` — listings, cache and takes stay on the user's machine.
- `docs/brand` — the icon is embedded in the executable and the UI; no runtime
  code reads the brand folder, so no `extraResources` entry is needed. Add one
  only if a future end-card renderer needs the originals at runtime.

`asar` is on. `asarUnpack` covers exactly the two binary packages. No native
modules are rebuilt (`npmRebuild: false`); `postinstall` runs
`electron-builder install-app-deps`, which is a no-op here and never prompts
for elevation.

## Runtime locations

| | Path |
| --- | --- |
| App home / Chromium profile | `%APPDATA%\Zeniconic` |
| Store (listings, cache, takes) | `%APPDATA%\Zeniconic\data` |
| Dev store | `D:\video\data` |
| Override for any build | `ZENICONIC_DATA_DIR=<absolute path>` |

`apps/desktop/main.ts` calls `app.setPath('userData', ...)` before `ready`, so
the folder is stable if the npm package name changes. Note that
`docs/SPEC.md` still says `%LOCALAPPDATA%\Zeniconic`; the implementation and
this guide use `%APPDATA%\Zeniconic`, which is what the current code path
does. `deleteAppDataOnUninstall` is `false`, so uninstalling keeps the user's
listings.

The installer itself is per-user: `perMachine: false`, `allowElevation: false`,
so it installs to `%LOCALAPPDATA%\Programs\Zeniconic` without a UAC prompt.
`allowToChangeInstallationDirectory` is on, so the user can still pick another
folder.

## First run without a key

On launch, the main process reads `settings:get` (`modelConfigured`), derives
`needsKey`, and if it is true:

1. opens the window on `#settings`, and
2. shows a native warning: *"Zeniconic needs an OpenRouter API key before it
   can analyse footage."*

The check repeats on every launch until a key exists; rendering and export
still work. The key itself is stored by `packages/ipc`'s `settings:setKey`
channel (`safeStorage`/DPAPI), and `settings:keyStatus` reports it. The
Settings *screen* does not render the key field yet, so the prompt currently
points at a screen whose entry field is still landing; the TODO is marked in
`apps/desktop/main.ts` (`promptForModelKey`) and in the renderer work.

Known limitation for the same reason: the overlay/Remotion CLI is located
under the repository (`node_modules/tsx` + `apps/render/src/cli.ts`). In a
packaged app that path does not exist, so exports fall back to the FFmpeg
picture pass without burned text. Fixing it means shipping the CLI as an
`extraResources` bundle and pointing `repoRoot` at `process.resourcesPath`, a
pipeline change outside this packaging task.

## Code signing: the trade-off

No certificate is configured, so electron-builder skips signing (`no code
signing certificate configured, signing is skipped`). Consequences:

- **SmartScreen / "Windows protected your PC"** on first run of the installer.
  The user must click *More info → Run anyway*. Windows remembers the file and
  publisher only after enough reputation, which an unsigned binary never
  accrues reliably.
- The extracted `Zeniconic.exe`, `ffmpeg.exe` and `ffprobe.exe` are also
  unsigned; some endpoint agents will quarantine them.
- No timestamped signature means no way to prove the installer came from us
  after a download.

Options, cheapest first:

1. Ship unsigned and give the user the one-line SmartScreen instruction (fine
   for a pilot on one office machine).
2. Buy an OV code-signing certificate (~$200–400/yr, hardware token or cloud
   HSM). Removes most warnings after reputation builds; still warns initially.
3. Buy an EV certificate (higher cost, identity vetting). SmartScreen trusts it
   immediately.

When a certificate exists, add it through the environment rather than
committing it:

```powershell
$env:CSC_LINK = "C:\secure\zeniconic.pfx"   # or a base64 blob / cloud signing
$env:CSC_KEY_PASSWORD = "<password>"
npm run dist
```

Keep the `.pfx` and password out of the repository and out of CI logs. Verify a
signed build with `Get-AuthenticodeSignature release\Zeniconic-Setup-*.exe`.

## Verifying a clean install on a VM

Use a fresh Windows 10/11 x64 VM with no Node, no FFmpeg and no previous
Zeniconic install. Take a snapshot first.

1. Copy only `Zeniconic-Setup-0.1.0-x64.exe` to the VM (no `node_modules`, no
   `data/`, no `.env`).
2. Double-click it. Expect the SmartScreen warning (unsigned build); choose
   *More info → Run anyway*. There must be **no UAC prompt**.
3. Choose *Only for me* if asked, keep or change the folder, finish. The app
   launches (`runAfterFinish`).
4. Confirm the first-run state: the window opens on **Settings** with the
   *Add an OpenRouter key* dialog. Dismiss it.
5. Confirm the install: `%LOCALAPPDATA%\Programs\Zeniconic\Zeniconic.exe`,
   Start-menu shortcut *Zeniconic*, optional desktop shortcut.
6. Confirm data: `%APPDATA%\Zeniconic\data\listings` exists. Nothing was
   written to `C:\Program Files` and no `data` folder appeared next to the
   executable.
7. Create a listing, drop a small clip folder on Intake and run analysis. The
   picture render/export must work without the AI key; a missing-key failure
   must be the explicit message, not a crash.
8. Sanity-check FFmpeg resolution: export one variant. If `ffmpeg`/`ffprobe`
   were not found you would see *"ffmpeg-static did not resolve to a binary"*
   or a probe error instead of an output file.
9. Check `%APPDATA%\Zeniconic\data\settings.json` is absent until a theme is
   chosen, then that choosing a theme writes it.
10. Close the app, run the uninstaller from *Settings → Apps*. It must remove
    `%LOCALAPPDATA%\Programs\Zeniconic` and the shortcuts but keep
    `%APPDATA%\Zeniconic` (the user's listings).
11. Reinstall over the snapshot. No stale files, no duplicate shortcuts.

Record the installer SHA-256 for the handover:

```powershell
Get-FileHash release\Zeniconic-Setup-0.1.0-x64.exe -Algorithm SHA256
```

## Icon

`build\icon.ico` is generated, not hand-edited:

```powershell
npm run icon
```

`packaging/make-icon.mjs` renders `docs/brand/zeniconic-app-icon.svg` at
256/128/64/48/32/16 and packs uncompressed 32-bit BMP frames (what NSIS's
resource compiler requires). It uses the `sharp` devDependency; it also writes
`build\icon.png` (512 px) for previews.

`build/` is currently listed in `.gitignore` (it was ignored as generic build
output). The icon is an input to the build, so either commit
`build/icon.ico` or add `!build/icon.ico` to `.gitignore`; otherwise a clean
clone must run `npm run icon` before `npm run dist`. The generator is
deterministic, so regenerating on CI is also fine.
