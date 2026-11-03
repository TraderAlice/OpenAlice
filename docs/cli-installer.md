# CLI Installer

This guide owns the macOS/Linux/Windows OpenAlice CLI bootstrap, installed
layout, activation, provenance, update, rollback, uninstall, and release
acceptance. Runtime behavior after activation belongs to
[[docs/local-runtime.md]]; Electron packaging to
[[docs/managed-workspace-runtime.md]]; npm/Bun/Homebrew/AUR topology to
[[docs/cli-package-managers.md]].

Bootstrap Bash/PowerShell stay dependency-free with one channel grammar;
they reject zero-padded versions, `beta.0`/`beta.01`, and uppercase BETA
(shared policy is imported by JS build/release tools). The payload is one
target-native Bun executable plus immutable resources; the installer never
installs Node, Bun, npm, source dependencies, build tools, or an Agent
Runtime. POSIX hosts need Bash, `tar` (gzip), `diff`, a SHA-256 utility, and
for safe transactions `lockf`/`shlock` (macOS) or `flock` (Linux).

## Supported entry paths

```bash
curl -fsSL https://openalice.ai/install | bash                     # stable
curl -fsSL https://openalice.ai/install | bash -s -- --channel beta
curl -fsSL https://openalice.ai/install | bash -s -- --channel dev
bash install --version 0.91.0                                      # pinned
bash install --archive ./<archive>.tar.gz --sha256 <64-hex>        # local
```

Windows uses `install.ps1` (PowerShell 5.1, system `tar.exe`, no elevation,
no persistent execution-policy change; child processes may use
`-ExecutionPolicy RemoteSigned` only). `https://download.openalice.ai/install.ps1`
defaults to stable with `-Channel beta|dev`, `-Plan` review, `-Yes` consent.
Windows uses `cli/current.txt` (retained release name) instead of a symlink;
`bin/*.cmd` launchers resolve it per invocation. The installer may add only
its own bin directory to user PATH (`-NoModifyPath` opts out). Uninstall
schedules deferred cleanup (an EXE cannot remove itself) and records the
outcome in `.cli-uninstall-result.json`; a running installed Runtime blocks
cleanup. Windows retains installed release directories until uninstall (no
POSIX-style three-release pruning yet). Windows stable candidates build
natively; dev/beta cross-build on Linux.

## Artifact contract

Archive name: `openalice-cli-<version>-<darwin|linux|win32>-<arm64|x64>.tar.gz`,
containing one top-level directory: `bin/openalice`, `release.json`,
`share/openalice/` (ui/dist, default/, templates, adapter resources),
LICENSE, THIRD_PARTY_NOTICES.md. The `<archive>.sha256` sidecar is part of
the release contract. The installer verifies bytes before extraction,
rejects unsafe/multi-root archives, validates `release.json` target/version/
content-identity shape, and runs the staged `--version` before activation.
Publication additionally verifies extracted files against `release.json`,
recomputes the identity, and statically verifies macOS embedded signatures.

`contentIdentity` is a canonical digest of the complete native payload
manifest (metadata plus every file hash, size, mode, symlink target;
`release.json` excluded). It is not an executable-only checksum — UI,
templates, and release-owned Git changes all produce a new identity.

Channels: stable uses the OpenAlice-owned `manifest.json`; beta uses
`beta/manifest.json`; dev uses `cli/dev/manifest.json` with commit-addressed
immutable archives under `cli/dev/releases/<commit>/`. A separate activation
stage rechecks that remote `refs/heads/dev` equals the workflow commit before
replacing the live manifest (a stale rerun is a successful no-op); the
manifest is the completed-set authority. The neutral payload includes
`packages/update-lifecycle/dist` (both CLI client and backend import it);
platform-neutral server inputs come from one clean Ubuntu job
(`CLI_NEUTRAL_INPUT_ROOTS` in `scripts/prepare-cli-neutral-inputs.mjs`), with
per-target verification of every file and the exact commit — the receipt
rejects missing/extra/changed outputs and never carries `node_modules`,
dugite Git, or a Bun executable. Beta/stable publish the accepted archive
matrix as GitHub Release assets mirrored unchanged to the CDN; install-script
snapshots are verified copies of the root source, not separate channels. Each
build emits `report.json` (build durations, `smoke.coldStartReadyMs`,
`smoke.idleMemoryBytes` median) — same-runner acceptance measurements, not
cross-host promises.

## Ownership boundary

The direct installer owns only: immutable CLI releases and resources,
`openalice`/Workspace helper launchers, the `cli/current` activation pointer,
the direct-install `cli/activation.json` receipt, per-release provenance, the
installer lock and update-check cache, and its marked PATH block. It does not
own Agent Runtimes (versions, credentials, configuration, plugins),
application data, AliceProjects, credentials, broker state, Electron
packages, or any background service. A missing Agent Runtime is an
onboarding concern, not an installer transaction.

## Installed layout

Default root `~/.openalice`, independent of any AliceProject
`OPENALICE_HOME`:

```text
~/.openalice/
├── bin/{openalice,alice,alice-workspace,alice-uta,traderhub}
├── cli/{current -> releases/<active>, activation.json, releases/<version>-<platform>-<arch>-<content-id>/, provenance/, staging/}
├── .cli-install.lock/ + .cli-install.lock.guard
├── .cli-update-check.json
└── data/ workspaces/ sources/ provider-keys.json sealing.key   # preserved
```

Launchers resolve `cli/current` on every invocation and export the canonical
install/release root, provenance path, content identity, and install method;
they never hard-code a release path, so an atomic pointer change is enough
for update or rollback.

## Consent and transaction

Releases declaring `dependencyPolicy: "system"` continue through
`openalice setup` (checks Git/Bash, shows package-manager commands, asks
separate consent, rechecks availability; `--check`/`--json` read-only).
`--yes` never approves installing system software; declining does not roll
back a successful install. Supported managers: Homebrew, WinGet, apt-get,
dnf, pacman, apk (when already installed).

Before creating the install root the installer prints the action, channel,
target, platform/arch, artifact URL/path, expected SHA-256, install root,
pointer, retention, and the ownership boundary. `--plan` exits without
mutation; interactive consent reads from a real terminal, never the curl
pipe; non-interactive requires `--yes` (else exit 2). Consent never starts
OpenAlice.

Transaction: acquire the kernel-lock inode (reject a live owner, remove only
a stale record) → stage on the same filesystem → verify SHA-256 → validate
and smoke-run → move into the immutable content-addressed directory → write
provenance → record pending activation and atomically replace `cli/current`
→ replace launchers → verify the active launcher (restoring the previous
pointer on failure) → retain the newest three releases (never the pending
rollback release) → optional marked PATH block → release lock and remove
staging on every exit path. An existing release is reused only on a complete
content match; a damaged collision stops with evidence preserved.

## Provenance and update authority

Direct installs write schema 3 provenance (repository, cliVersion, selector,
installerUrl, channel, method, artifact platform/arch/sha256, installedAt);
`openalice version --json` reports it plus the active content identity.
Invalid metadata is an error — no silent channel or trust-boundary change.

Update authority follows provenance + runtime profile, not package semver:
source checkouts use Git; packaged Electron uses the native updater;
installed stable/beta use `openalice update` (deferring to
npm/Bun/Homebrew/AUR when a manager owns the files); a direct dev CLI
resolves by complete artifact checksum and content identity, never Web
semver; Docker is updated by its deployment owner; pinned/custom/invalid
provenance is non-updating. `GET /api/version` / `POST /api/version/check`
expose only normalized channel and update authority (never the provenance
path), and service-managed/dev/pinned/custom contexts make no manifest
request — the Web UI cannot invent a second update path. After a public
beta/stable release, copy the synchronized version values back to `dev` in a
focused PR.

## Update and rollback

`openalice update --check` reads the installed channel's manifest (stable
never accepts prerelease; beta only beta; dev compares the complete platform
archive SHA-256 because version alone does not name a build).
`openalice update` downloads the manifest's immutable installer snapshot,
verifies its SHA-256, and invokes it with the current root and ordinary
consent — preserving the channel, not pinning a version. In the manifest,
`installer.versionedUrl` + `installer.sha256` are the executable update
input; `installer.url` is the mutable human bootstrap only. A running process
keeps its mapped executable; the new pointer affects the next invocation.

Managed SSH bootstrap compares stable/beta/pinned installations by logical
release identity (repository, channel/selector, product version), never
requiring macOS and Linux archives of one release to share SHA-256 or content
identity; the remote host's own schema 3 provenance and matching Runtime
identity are required. Dev is stricter: the invoking CLI must match the CDN
manifest target by version, archive SHA-256, and content identity, and a
stale CLI, missing target, or malformed manifest blocks remote mutation.

The first successful Guardian + Alice HTTP readiness confirms
`cli/activation.json`; a failed first start validates retained provenance and
atomically restores the exact previous pointer without touching user data. A
fresh install has no rollback target. Rollback is local and download-free:

```bash
openalice rollback --plan
openalice rollback --yes
openalice rollback --to <full-retained-release-name> --yes
```

It validates both releases, refuses to race a live installer, records the
inverse switch as a pending activation, and switches only `cli/current`.
Recovery protection matches update. Run `openalice` again after update or
rollback; nothing is hot-reloaded.

## Uninstall

`openalice uninstall --plan` then `--yes`. Native uninstall removes `cli/`,
the five installer-owned launchers, the update cache, installer lock, and
matching PATH blocks. It preserves application data, AliceProjects, sources,
credentials, sealing keys, external Agent Runtimes, and the shared root, and
refuses to race a live installer.

## Options and test seams

| Option | Meaning |
|---|---|
| `--channel stable\|beta\|dev` | Channel selection (stable default) |
| `--version <version>` | Exact pinned release; with a channel, an exact candidate on that channel |
| `--branch master\|dev` | Compatibility alias for stable/dev |
| `--archive <path>` | Local archive; requires `--sha256` |
| `--install-dir <path>` / `--no-modify-path` / `--plan` / `--yes` | Root, PATH, review, non-interactive consent |

Bounded environment seams: `OPENALICE_INSTALL_DIR`, `OPENALICE_INSTALL_URL`,
`OPENALICE_DOWNLOAD_BASE_URL`, `OPENALICE_{STABLE,BETA,DEV}_MANIFEST_URL`,
`OPENALICE_RELEASE_ASSET_BASE_URL`,
`OPENALICE_LEGACY_STABLE_INSTALLER_{URL,SHA256}`,
`OPENALICE_INSTALL_KEEP_RELEASES`, `OPENALICE_EXPECTED_CLI_VERSION`,
`OPENALICE_EXPECTED_CLI_ARTIFACT_SHA256`,
`OPENALICE_EXPECTED_CLI_CONTENT_IDENTITY`, `OPENALICE_EXPECTED_DEV_COMMIT`.
Never add source package lists, Agent Runtime pins, or dependency mutation to
these seams.

## Verification

```bash
bash -n install
pnpm exec vitest run tests/e2e/cli-installer/install.spec.mjs
pnpm test:system:installer
npx tsc --noEmit && pnpm test
```

For managed SSH or cross-target changes also run `pnpm test:system:remote`
plus the remote/project-transfer specs
(`packages/cli/src/remote.spec.mjs`, `project-transfer*.spec.*`). The Docker
smoke uses a clean non-root Debian host with Node/npm/pnpm/Bun/Agent
Runtimes absent (plan, consent, install, launchers, update activation,
retention, PATH, lock cleanup); `-- --interactive` opens the manual prompt
playground; `pnpm test:system:installer:dev` exercises only the published
dev channel (network, non-hermetic). Before promotion: build the real
archive, install into an isolated root, update from a distinct release and
roll back, build/install natively per supported arch, publish the dev
candidate and exercise the raw network path, and verify assets/sidecars
before exposing any channel alias (a beta mirror must prove the stable
manifest byte-for-byte unchanged). Missing/non-positive build, readiness, or
memory metrics make an acceptance report invalid; routine acceptance is
non-trading with isolated homes.

## Troubleshooting

| Message | Meaning |
|---|---|
| `No interactive terminal is available` | Review `--plan`, then pass `--yes` intentionally |
| `Another OpenAlice CLI installer is running` | Wait for the live PID; do not delete its lock |
| `failed SHA-256 verification` | Bytes and trusted checksum disagree; stop |
| `Existing release ... is damaged` | Preserve the collision; do not overwrite |
| `No previous OpenAlice release is retained` | Install/update once before rollback |
| startup says the activation was rolled back | New Runtime failed first readiness; run `openalice` again |
| update reports a non-updating channel | Refresh with the same selector; do not cross trust boundaries |

## CLI compiler and final artifact integrity

`.bun-version` is the exact compiler source of truth (CI setup-bun and the
remote Docker builder consume it directly; newer global Bun is rejected).
`scripts/sign-cli-macos.mjs` stages and signs the build-owned executable with
system ad-hoc codesign (no Developer ID, timestamp, or notarization; no
stable TCC identity) after the last executable mutation and before file
hashes, `contentIdentity`, and `release.json` are generated — native smoke
must leave those bytes unchanged. `scripts/verify-cli-release.mjs` (shared
by dev preparation, package-manager generation, and beta/stable publication)
checks final extraction, hashes/sizes/modes/links, manifest identity, and
macOS page hashes; installers never repair or re-sign payloads. The read-only
**CLI artifact acceptance** workflow builds Linux x64 and both Mac
architectures from the PR head and preserves head-named artifacts for seven
days; it never publishes or activates a channel.
