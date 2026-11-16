# Packaging

One installer, one icon, no prerequisites. The user double-clicks, the app opens,
and every binary it needs is already inside. If the installer asks for an
administrator password or mentions a missing runtime, the build is wrong.

## Target machine

| Item | Minimum | Recommended |
|---|---|---|
| OS | Windows 11 24H2, x64 | Windows 11 25H2 or later |
| Architecture | x64 | x64 |
| RAM | 8 GB | 16 GB |
| Free disk before install | 4 GB | 10 GB |
| GPU | Integrated | Integrated; no CUDA, no ONNX |
| Runtime | None; Node 22 and ffmpeg are bundled | — |

Windows 10 is not supported: it left mainstream support in October 2025 and is no longer in the test matrix. Windows on ARM is not supported either. Do not ship an arm64 build that "mostly works"; x64 under emulation renders slowly and the support cost is worse than saying no.

## electron-builder

```yaml
appId: app.zeniconic.desktop
productName: Zeniconic
directories: { output: release, buildResources: build }
files: ["dist/**", "node_modules/**/*", "package.json"]
asarUnpack: ["node_modules/better-sqlite3/**"]
compression: maximum
extraResources:
  - from: node_modules/ffmpeg-static/ffmpeg.exe
    to: bin/ffmpeg.exe
  - from: node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe
    to: bin/ffprobe.exe
win:
  target: [{ target: nsis, arch: [x64] }]
  icon: build/icon.ico
  rfc3161TimeStampServer: http://timestamp.digicert.com
nsis:
  oneClick: false
  perMachine: false
  allowElevation: false
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
  include: build/installer.nsh
publish: { provider: generic, url: https://updates.zeniconic.app/win/x64, channel: latest }
```

`perMachine: false` and `allowElevation: false` mean a per-user install under `%LOCALAPPDATA%\Programs\Zeniconic` with no UAC prompt: no admin rights, no machine-wide registry litter, uninstall without elevation.

`better-sqlite3` is a native module. Rebuild it for Electron's ABI before the
build, and unpack it from the asar:

```powershell
pnpm -C apps/desktop exec electron-rebuild -f -w better-sqlite3
pnpm -C apps/desktop exec electron-builder --win nsis --x64 --publish never
```

Installed size is about 310 MB: Electron ~110 MB, ffmpeg ~80 MB, ffprobe ~80 MB, app ~40 MB. The NSIS installer compresses to ~130 MB with `compression: maximum`, which adds roughly two minutes to the build. Use it for release builds only.

## Bundled media binaries

Never call a system `ffmpeg`. Resolve both binaries from `process.resourcesPath`:

```ts
const bin = path.join(process.resourcesPath, 'bin');
const ffmpeg = path.join(bin, 'ffmpeg.exe');
const ffprobe = path.join(bin, 'ffprobe.exe');
```

At first run, verify once and cache the result in SQLite:

```powershell
& "$env:LOCALAPPDATA\Programs\Zeniconic\resources\bin\ffmpeg.exe" -version
& "$env:LOCALAPPDATA\Programs\Zeniconic\resources\bin\ffmpeg.exe" -filters | Select-String loudnorm
& "$env:LOCALAPPDATA\Programs\Zeniconic\resources\bin\ffprobe.exe" -version
```

The build must fail if `libx264`, `aac`, `loudnorm`, `ebur128` or `subtitles` is
missing. A build that renders on your machine because `C:\ffmpeg\bin` is on PATH
is not a build.

## First-run model key

The app is usable without a key for importing, editing and local export. AI
stages need one. Validate before storing, and store only through `safeStorage`.

```ts
const res = await fetch('https://openrouter.ai/api/v1/key', {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(8000)
});
if (res.status === 401) return { ok: false, copy: 'That key was not accepted. Paste it again from openrouter.ai/keys.' };
const { data } = await res.json();
return { ok: true, label: data.label, limitUsd: data.limit, usageUsd: data.usage };
```

| Result | What the user sees | What happens |
|---|---|---|
| 200 | "Key works. Credit: $18.40." (when the key has a limit) | Key encrypted and saved |
| 401 | "That key was not accepted." | Nothing saved |
| 429 | "The key is valid but busy. Try again in a minute." | Nothing saved |
| Timeout / offline | "You're offline. Editing and export still work." | Key saved as unverified, re-tested next launch |
| No key | "Add a key to use AI features." | Local flow continues |

Copy rules: name the action, not the HTTP status. Never echo the key, not even
masked, in a message that can be screenshotted.

## Auto-update

`electron-updater` with the generic provider. Check on launch and every six
hours; download in the background; install on quit, never during a job.

```ts
autoUpdater.channel = settings.channel; // 'latest' or 'beta'
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
app.on('before-quit', () => {
  if (!updateReady || installing) return;
  if (isJobRunning()) { pendingInstall = true; return; } // install next launch
  installing = true;
  autoUpdater.quitAndInstall();
});
```

Feed layout:

```
https://updates.zeniconic.app/win/x64/latest.yml
https://updates.zeniconic.app/win/x64/Zeniconic-Setup-1.4.0.exe
https://updates.zeniconic.app/win/x64/Zeniconic-Setup-1.4.0.exe.blockmap
https://updates.zeniconic.app/win/x64/beta.yml
https://updates.zeniconic.app/win/x64/archive/1.3.0/
```

Rules: never install mid-render or mid-analysis; never auto-update a user who is offline (the check fails quietly); keep N-1 downloadable for rollback; release notes in plain language, no changelog jargon. There is no in-app downgrade — rolling back means re-publishing N-1 as `latest` and letting the next check pick it up. An unsigned build can still auto-update, but the update is only as trustworthy as the HTTPS feed; signing the installer and the update payload is part of the same decision.

## Uninstall

`deleteAppDataOnUninstall: false` protects the cache by doing nothing. The custom
macro removes the cache and the stored key, and tells the user where the projects
are. It never deletes a project.

```nsh
!macro customUnInstall
  RMDir /r "$LOCALAPPDATA\Zeniconic\cache"
  RMDir /r "$LOCALAPPDATA\Zeniconic\logs"
  Delete "$APPDATA\Zeniconic\secrets.bin"
  ReadRegStr $0 HKCU "Software\Zeniconic" "ProjectsRoot"
  StrCmp $0 "" 0 +2
  StrCpy $0 "$DOCUMENTS\Zeniconic"
  MessageBox MB_OK "Zeniconic has been removed. Your videos and projects are still in $0. This uninstaller does not delete them."
!macroend
```

The projects root is written to `HKCU\Software\Zeniconic\ProjectsRoot` by the app
at first run, so the message is correct when the user chose another drive. The
uninstaller removes program files, shortcuts, cache, logs and the encrypted key.
It leaves `zeniconic.db`, `listings/` and every rendered file.

## Code signing

| Option | Cost | SmartScreen | CI friction |
|---|---|---|---|
| Unsigned | $0 | "Windows protected your PC", "Unknown publisher" | None |
| OV certificate | $80–200/yr | Reputation builds over days to weeks; warning at first | Token or cloud HSM |
| EV certificate | $200–400/yr + $50–100 token | Trusted immediately | Hardware token or cloud signing |
| Azure Trusted Signing | ~$10/month | Good, but requires 3 years of verifiable business history | Clean, cloud-held key |

Without a signature, the first launch shows a blue dialog: **"Windows protected
your PC — Microsoft Defender SmartScreen prevented an unrecognised app from
starting."** The user must click **More info → Run anyway**. On Windows 11 with
Smart App Control enabled, an unsigned app may be blocked outright, with no
"Run anyway". Some corporate laptops do the same by policy.

That is the honest position: signing is the difference between an install that finishes and one that generates a support call. Budget for an EV certificate in year one; if the budget is refused, publish SHA-256 checksums on the download page, link the checksum in the install guide, and put the SmartScreen instruction in the one-pager. A self-signed certificate does not help: it still shows "Unknown publisher" and cannot build reputation.

Signing command for a cloud or token-backed certificate:

```powershell
$thumbprint = (Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object -First 1).Thumbprint
signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 `
  /sha1 $thumbprint .\release\Zeniconic-Setup-1.4.0.exe
Get-AuthenticodeSignature .\release\Zeniconic-Setup-1.4.0.exe | Format-List Status,SignerCertificate
```

Timestamping is mandatory: without it the signature expires with the certificate and old installers stop validating.

## Verification

| Check | Pass condition |
|---|---|
| Clean VM | Installs and launches with no admin prompt, no missing DLL |
| Binaries | Both report a version from `resources\bin`, filters include `loudnorm` |
| Size | Installed 280–340 MB; installer 110–150 MB |
| Key | 401 rejected in <3 s; 200 shows status and any credit; offline path works |
| Update | N-1 installs N on quit, refuses mid-job, `latest.yml` matches the file hash |
| Uninstall | Projects survive; cache and `secrets.bin` gone; message names the folder |
| Signature | `Get-AuthenticodeSignature` returns `Valid`, or the download page states unsigned with a checksum |
