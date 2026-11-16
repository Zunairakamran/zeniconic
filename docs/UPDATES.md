# Updates

Zeniconic updates itself from GitHub Releases. One decision matters more than the
mechanism: **the update repository is public, the source stays private.**

## Why the releases repo is public

Electron's updater must read release metadata and download the installer. For a
private repository, electron-updater needs a `GH_TOKEN` **on the user's machine**.
That token ships inside an app you hand to someone else — a credential leak, and a
GitHub advisory (GHSA-p2f4-r6v6-j797) exists for exactly this class of mistake.

So:

| Repository | Visibility | Contains |
|---|---|---|
| `Zunairakamran/zeniconic` | **private** | source, docs, skills |
| `Zunairakamran/zeniconic-releases` | **public** | installers, blockmaps, `latest.yml` |

The binaries are already being handed to the client; making them downloadable does
not expose the source. If the client insists on private binaries, the alternative is
a private repo **plus** a GitHub token configured on each machine (documented, not
recommended), or a signed-URL generic provider.

## Release flow

CI does this for you: push a tag (`git tag v0.1.1 && git push origin v0.1.1`) and
`.github/workflows/release.yml` typechecks, tests, builds and publishes to
`zeniconic-releases`. It needs one repository secret:

| Secret | Value |
|---|---|
| `RELEASE_TOKEN` | Fine-grained PAT with **contents: write** on `zeniconic-releases` only |

The default `GITHUB_TOKEN` cannot write to a second repository, which is why a
dedicated token is required.

To build locally instead:

```powershell
# 1. bump the version (semver)
npm version patch          # or minor / major

# 2. build the installer and the update manifest
$env:GH_TOKEN = "<token with repo scope>"   # CI or your machine only
npm run dist -- --publish always
```

Artifacts in `release/`:

```
Zeniconic-Setup-0.1.1-x64.exe
Zeniconic-Setup-0.1.1-x64.exe.blockmap
latest.yml
```

Upload all three to a **draft** GitHub release in `zeniconic-releases`, tag it
`v0.1.1`, then publish it. The app checks `latest.yml` on launch.

## What the user sees

- Silent check on launch, in the background.
- When an update is downloaded: *"Version 0.1.2 is ready. Restart and update / Later."*
- Choosing Later applies it on quit (`autoInstallOnAppQuit`).
- Listings, media and settings are untouched; the app data directory is outside the
  install location.

## Rules

- Never check for updates in development (`app.isPackaged` gate).
- Never publish a release without a version bump — `latest.yml` is keyed by version.
- Do not ship a `GH_TOKEN` or a signing certificate in the installer.
- Keep the updater on the `latest` channel; no pre-releases for the client.
- Without a code-signing certificate, Windows SmartScreen warns on **first** install
  and on each update. The updater still works; the warning is a trust cost. OV
  certificates are cheaper; EV requires hardware and clears reputation faster.

## Verification

1. Install version *n* on a clean VM.
2. Publish *n+1* to the releases repo.
3. Relaunch *n* with the network on; the dialog appears within ~10 s.
4. Restart; the About/Settings screen shows *n+1*.
5. Confirm the data directory and a listing still open.
