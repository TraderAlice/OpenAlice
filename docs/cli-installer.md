# CLI Installer

This guide owns the macOS/Linux OpenAlice CLI bootstrap, installed layout,
activation, provenance, update, rollback, uninstall, and release acceptance.
Runtime behavior after activation belongs to [[docs/local-runtime.md]]. Electron
packaging remains independent under [[docs/managed-workspace-runtime.md]].

The current CLI payload is one target-native Bun executable plus immutable
OpenAlice resources. The installer does not install Node.js, Bun, npm, source
dependencies, build tools, or an Agent Runtime.

The direct installer expects Bash, `tar` with gzip support, `diff`, and either `sha256sum` or
`shasum`; a network install also needs `curl`. Safe transaction ownership uses
the platform kernel: macOS must provide `lockf`, while Linux must provide
`flock` (normally from `util-linux`). These are host prerequisites, not packages
that the installer silently adds. Minimal images and remote hosts should install
them before running the shared installer.

npm, Bun, Homebrew, and Arch/AUR installation consume the same accepted native
archives but remain owned by their package manager. Their topology, commands,
and update behavior live in [[docs/cli-package-managers.md]].

## Supported entry paths

Stable direct install:

```bash
curl -fsSL https://openalice.ai/install | bash
```

Beta and development channels use the same installer:

```bash
curl -fsSL https://openalice.ai/install | bash -s -- --channel beta
curl -fsSL https://openalice.ai/install | bash -s -- --channel dev
```

The raw dev path remains a publication acceptance seam for installer changes:

```bash
curl -fsSL https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install \
  | bash -s -- --channel dev
```

Exact release and local acceptance:

```bash
bash install --version 0.91.0
bash install --archive ./openalice-cli-0.91.0-linux-x64.tar.gz \
  --sha256 <64-lowercase-hex>
```

Native Windows PowerShell installation is deferred. Windows users use the
Electron distribution or an explicitly chosen POSIX environment until that
lane is implemented and accepted.

## Artifact contract

Every accepted archive is named:

```text
openalice-cli-<version>-<darwin|linux>-<arm64|x64>.tar.gz
```

It contains exactly one top-level directory with:

```text
openalice-cli-<version>-<platform>-<arch>/
├── bin/openalice
├── release.json
├── share/openalice/
│   ├── ui/dist/
│   ├── default/
│   ├── templates and external adapter resources
│   └── runtime/git/
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

The sidecar `<archive>.sha256` is part of the release contract. The installer
verifies the downloaded bytes before extraction, rejects unsafe or multi-root
archives, validates the `release.json` target, version, and content-identity
shape, checks an expected content identity when the update handoff supplied
one, and runs the staged executable's `--version` before activation. The build
owns the canonical content-identity calculation; the installer does not
recompute that payload manifest. Dev and release publication do recompute the
identity from `release.json` before accepting an archive, so stale or tampered
manifest identities cannot become channel metadata.

`contentIdentity` is a canonical digest of the complete native payload
manifest: product metadata plus every shipped file hash, size, mode, and
symlink target, with `release.json` excluded to avoid self-reference. It is not
an executable-only checksum; UI, default assets, templates, and release-owned
Git changes all produce a new identity.

The channel-neutral installer defaults to the OpenAlice-owned stable
`manifest.json`. `--channel beta` resolves `beta/manifest.json`, while
`--channel dev` downloads the fixed per-commit preview aliases:

```text
https://download.openalice.ai/cli/dev/openalice-cli-dev-<platform>-<arch>.tar.gz
https://download.openalice.ai/cli/dev/openalice-cli-dev-<platform>-<arch>.tar.gz.sha256
```

Every `dev` push builds all four native targets. Publication verifies each
sidecar and the archive's target/version metadata, uploads an immutable copy
under `cli/dev/releases/<commit>/`, then replaces the fixed archive aliases.
Each checksum alias is written after its archive, so a reader racing a publish
can fail verification but cannot activate mismatched bytes. The dev manifest is
published last as the completed-set receipt. Versioned beta and stable releases
publish the same four target archives and sidecars as GitHub Release assets and
mirror them unchanged to the download CDN. Stable and beta manifests remain separate;
immutable `OpenAlice-<version>-install` and
`cli/dev/releases/<commit>/install` files are verified snapshots of the same
root `install` source, not separate channel scripts.

Each native build also emits `report.json`. `buildDurationMs` is the clean Bun
standalone compile, `artifactBuildDurationMs` is assembly plus archive creation
with already-built server inputs, and `totalDurationMs` includes the real
acceptance smoke. `smoke.coldStartReadyMs` runs from process spawn until
Guardian reports Alice ready. `smoke.idleMemoryBytes` samples Guardian and
Alice RSS three times after a one-second settling period and records the
median. The separate multiprocess feasibility report applies the same method
to Guardian, Alice, UTA, and Connector. These are target-run acceptance
measurements, not cross-host performance promises; compare builds on the same
runner and preserve the report beside its archive.

## Ownership boundary

The direct installer owns only:

- immutable OpenAlice CLI releases;
- release-owned Git and OpenAlice resources;
- `openalice` and Workspace helper launchers;
- the `cli/current` activation pointer;
- the direct-install `cli/activation.json` readiness receipt;
- per-release provenance;
- the installer lock and update-check cache;
- its marked shell `PATH` block.

It does not own:

- Pi, OpenCode, Codex, Claude Code, or another Agent Runtime;
- Agent Runtime versions, credentials, configuration, or plugins;
- OpenAlice application data, AliceProjects, credentials, or broker state;
- Electron packages or desktop update state;
- a background service merely because installation succeeded.

Agent Runtimes remain ordinary external adapter targets discovered from the
user's environment. A missing Runtime is a startup/onboarding concern, not an
installer transaction.

## Installed layout

The default install root is `~/.openalice`, independent from any
`OPENALICE_HOME` used by a particular AliceProject:

```text
~/.openalice/
├── bin/
│   ├── openalice
│   ├── alice
│   ├── alice-workspace
│   ├── alice-uta
│   └── traderhub
├── cli/
│   ├── current -> releases/<active-release>
│   ├── activation.json
│   ├── releases/<version>-<platform>-<arch>-<content-id>/
│   ├── provenance/<release-name>.json
│   └── staging/
├── .cli-install.lock/       # owner record while an installer owns the transaction
├── .cli-install.lock.guard  # persistent kernel-lock inode; contains no user data
├── .cli-update-check.json   # optional bounded update cache
├── data/                    # preserved product state
├── workspaces/              # preserved user work
├── sources/                 # preserved explicit source overrides
├── provider-keys.json       # preserved credentials
└── sealing.key              # preserved key material
```

Launchers resolve `cli/current` on every invocation and export the canonical
install root, release root, provenance path, content identity, and install
method to the native executable. They never hard-code one release path, so an
atomic pointer change is enough for update or rollback.

### Volume-backed service hosts

A persistent service host must keep the native install root separate from the
AliceProject Home even when both live on one mounted volume. The Railway SSH
profile uses:

```text
/data/home                  fixed persistent Railway SSH HOME
/data/home/.openalice       OPENALICE_INSTALL_DIR
/data/projects/default      OPENALICE_HOME
```

The image fixes and exports `/data/home`, `/data/home/.openalice`,
`/data/home/.local`, `/data/home/.bun`, and their persistent executable `PATH`.
That image environment is intentional: a Railway SSH process must see the same
user and installed commands as Guardian. The entrypoint starts installer
bootstrap with system-only `PATH`, validates those fixed roots, and restores
the persistent `PATH` only after the native CLI passes provenance and Runtime
checks. These user/install paths are not deployment options.

Only `OPENALICE_HOME` may select another AliceProject beneath `/data`.
`AQ_LAUNCHER_ROOT` is always derived as `<OPENALICE_HOME>/workspaces`; an
independent Workspace-root override is not honored, while an alternate
Volume/user/install/npm/Bun root or normalized path escape is rejected.

The install root owns immutable native releases, activation, provenance, and
the five OpenAlice launchers. The AliceProject root owns user configuration,
credentials, Workspaces, and Runtime state. Machine-level convenience links
under `/usr/local/bin` may be rebuilt on every container boot; they are not the
durable install or data authority. AliceProject transfer likewise excludes
top-level `bin/`, `cli/`, and machine-local or escaping symlinks rather than
copying installation bytes to another machine.

Service bootstrap may call the shared installer with `--yes`,
`--no-modify-path`, the fixed install root, and a stable, beta, or dev selector.
This is service configuration authority, not a relaxation of the interactive
user consent contract. Installation still does not start a background service
by itself; the Railway entrypoint separately validates the active launcher and
`exec`s foreground `openalice server run`. Agent Runtime executables and their
user-level install roots remain outside both the OpenAlice install root and
AliceProject transfer.

## Consent and transaction

Before creating the install root, the installer prints:

- install or update action;
- channel and target;
- platform and architecture;
- artifact URL or local path;
- expected SHA-256;
- install root, command path, activation pointer, retention count;
- the OpenAlice and Agent Runtime ownership boundary.

`--plan` exits without mutation. Interactive consent defaults to no and reads
from a real controlling terminal, never from the curl pipe. A non-interactive
install must pass `--yes`; otherwise it exits with status 2. Installation
consent never starts OpenAlice.

After consent, the transaction:

1. acquires the persistent kernel-lock inode, then rejects a verified live
   transaction owner or removes only its stale owner record;
2. stages on the same filesystem as the release store;
3. downloads or copies the archive and verifies SHA-256;
4. validates and smoke-runs the staged release;
5. moves the release into its immutable content-addressed directory;
6. writes provenance outside the release;
7. records the exact previous release as a pending activation, then atomically
   replaces `cli/current` using platform-correct symlink semantics;
8. atomically replaces installer-owned launchers;
9. verifies the newly active `openalice` launcher, restoring the exact previous
   pointer if this post-activation install step fails;
10. retains the newest three releases by default and never collects the exact
    pending rollback release;
11. writes one marked PATH block when requested;
12. releases the lock and removes staging on every exit path.

An existing release is reused only when file contents, path types, modes, and
symlink targets match the complete staged tree. A damaged collision stops with
evidence preserved.

## Provenance

Direct installs write schema 3 metadata:

```json
{
  "schemaVersion": 3,
  "repository": "TraderAlice/OpenAlice",
  "cliVersion": "0.91.0",
  "selector": { "kind": "version", "value": "v0.91.0" },
  "installerUrl": "https://openalice.ai/install",
  "updateChannel": "stable",
  "method": "direct",
  "artifact": {
    "platform": "darwin",
    "arch": "arm64",
    "sha256": "..."
  },
  "installedAt": "2026-08-29T00:00:00Z"
}
```

`openalice version --json` reports this provenance and the active content
identity. Invalid installed metadata is an error; the CLI does not silently
change channels or trust boundaries.

### Update authority in the Web surface

Installed provenance and the runtime profile determine which surface may
offer an update; package semver alone is not authority:

- source checkouts use Git and may show source-update guidance;
- packaged Electron uses the native desktop updater;
- installed stable and beta releases use `openalice update` as the update entry
  point; that command defers to npm, Bun, Homebrew, or AUR when provenance says
  a package manager owns the files;
- a direct dev CLI resolves updates in the native CLI by complete artifact
  checksum and content identity, never by a Web semver comparison;
- Railway and Docker are updated by their service/deployment owner, not by the
  browser UI or a command run inside the service; and
- pinned, custom, or invalid provenance is non-updating until the user repairs
  it or explicitly selects another channel.

`GET /api/version` and `POST /api/version/check` expose only the normalized
channel and update authority. They never expose the provenance file path.
Service-managed, dev, pinned, and custom contexts do not fetch a release
manifest through these routes, so the Web UI cannot invent a second update
path beside the native CLI or deployment workflow.

The standalone launcher propagates the already-discovered `install-source.json`
path into Guardian and Alice. This covers metadata beside the install prefix
(npm/Bun and Homebrew) and under `share/openalice` (Homebrew and AUR) without
teaching the Web layer a second package-layout discovery algorithm.

## Update and rollback

`openalice update --check` reads the manifest owned by the installed stable,
beta, or dev channel. Every manifest must identify its channel explicitly;
stable never accepts a prerelease manifest and beta accepts only beta versions.
Dev compares the complete platform archive SHA-256, because multiple dev
commits may carry the same package version. Pinned and custom installs remain
non-updating unless the user explicitly selects a channel.

For a direct install, `openalice update` downloads the channel manifest's
immutable snapshot of the shared Bash installer, verifies its SHA-256, and
invokes it with the current install root and ordinary consent. Native stable
and beta releases pass both the channel and exact accepted version. Dev passes
the channel and binds the expected archive identity. An update therefore
preserves or changes the selected channel without turning it into an
exact-version pin. The historical v0.90.1 bridge is a bootstrap and forward
cutover seam only; it is never used to replace an existing native layout. A
running process keeps its already-mapped executable; the new pointer affects
the next invocation.

In the manifest, `installer.versionedUrl` is the executable update input and
`installer.sha256` binds those immutable bytes. `installer.url` is the mutable
human bootstrap entry only; an updater never combines that URL with the
versioned checksum.
`openalice status` and an idempotent `openalice up` report the pending product
version while an older Guardian is still active.

Managed SSH bootstrap compares stable, beta, and pinned installations by their
logical release identity: repository, channel/selector, and product version.
It must not require a macOS archive and Linux archive for that release to have
the same SHA-256 or content identity. The remote host must instead report valid
schema 3 provenance for its own platform and architecture, and its active
native Runtime must match that remote artifact's product and content identity.
When local and remote targets are the same, their checksum and content identity
must still match exactly.

Dev is stricter because the package version alone does not name one build. The
latest CDN dev manifest is the completed-set authority. Before a managed remote
install, the invoking CLI must match its own manifest target by version,
archive SHA-256, and content identity; the remote platform target is then
selected from that same manifest and passed to the installer as expected
checksum and content identity. A stale local dev CLI, missing target, malformed
manifest, or unavailable manifest blocks remote mutation rather than falling
back to a branch label or version-only comparison.

The first successful Guardian plus Alice HTTP readiness from the newly active
content confirms `cli/activation.json`. If that first start exits early, times
out, or cannot execute, the CLI validates the retained provenance and restores
the exact previous `cli/current` target atomically. It does not start that
release automatically and it never changes user data; the error tells the user
to run `openalice` again. An initial install has no previous release and
therefore reports the failure without inventing a rollback target.

Rollback is local and download-free:

```bash
openalice rollback --plan
openalice rollback --yes
openalice rollback --to <full-retained-release-name> --yes
```

It validates both releases and their provenance, refuses to race a live
installer, records the inverse switch as a pending activation, and atomically
switches only `cli/current`. Its first readiness receives the same recovery
protection as an update. It does not alter user data or remove releases. The
current process is not hot-reloaded; run `openalice` again after update or
rollback.

## v0.90.1 cutover

The native installer recognizes the last expanded CLI layout under
`cli-versions/`. It stages and validates the Bun release first, then removes
only that installer-owned tree and its managed-Pi launchers. Product data,
credentials, AliceProjects, and Agent Runtimes elsewhere on `PATH` remain
untouched. Normal startup after activation knows only the native layout; there
is no permanent dual-runtime resolver. Before changing the active pointer, the
cutover also backs up every legacy launcher; a validation failure restores the
old launchers and removes the unconfirmed native pointer.

Both `dev` alias publication and every versioned beta/stable release replay this
cutover from the published v0.90.1 installer on Linux x64. The acceptance
fixture pins the historical Pi manifests by SHA-256 because the upstream Pi
release assets are not part of OpenAlice's durable release surface. It then
proves native `version`, detached `up`, `status`, `down`, and uninstall with Node
and Agent Runtimes absent from the new Runtime path, while preserving a data
marker and a user-owned external Pi executable.

The shipped v0.90.1 updater invoked the accepted versioned installer without a
selector and bound the candidate with `OPENALICE_EXPECTED_CLI_VERSION`. The
shared installer keeps that forward invocation on `stable`; a normal
user-supplied `--version` remains `pinned`.

A native beta/dev installation cannot safely downgrade in place to the old
Node-managed v0.90.1 layout: the historical installer does not own
`cli/current` or all native helper launchers. During the first beta rollout,
while v0.90.1 was the latest stable, both `openalice update --channel stable`
and the Supervisor channel picker therefore reported the transition as
unsupported and left the native installation unchanged. Native stable releases
resume ordinary channel switching through the shared installer.

The v0.90.1 GitHub Release predates native CLI archives. If the stable manifest
or an exact selector names v0.90.1, a fresh install therefore verifies the
immutable published v0.90.1 installer by its pinned SHA-256 and delegates to
it. Exact v0.90.1 selection retains `pinned` ownership when `--version` was used
alone. The bridge refuses a root containing a native release or pointer.
Current native stable releases, beta, and dev use the ordinary native artifact
transaction.

## Uninstall

Review first:

```bash
openalice uninstall --plan
openalice uninstall --yes
```

Native uninstall removes `cli/`, the five installer-owned launchers, the update
cache, installer lock, and matching PATH blocks. It preserves application data,
AliceProjects, sources, provider credentials, sealing keys, external Agent
Runtimes, and the shared install root. It refuses to race a live installer.

## Options and test seams

Public options:

| Option | Meaning |
|---|---|
| `--channel stable` | Latest stable release; the default |
| `--channel beta` | Latest accepted beta release |
| `--channel dev` | Latest dev-branch native preview |
| `--version <version>` | Exact pinned GitHub release when used alone |
| `--channel stable --version <x.y.z>` | Exact stable candidate that remains on stable |
| `--channel beta --version <x.y.z-beta[.N]>` | Exact beta candidate that remains on beta |
| `--branch master\|dev` | Compatibility alias for stable or dev |
| `--archive <path>` | Local archive; requires `--sha256` |
| `--install-dir <path>` | Alternate installation root |
| `--no-modify-path` | Do not edit a shell profile |
| `--plan` | Print the complete transaction without mutation |
| `--yes`, `-y` | Approve non-interactively |

Bounded environment seams:

| Variable | Purpose |
|---|---|
| `OPENALICE_INSTALL_DIR` | Alternate install root |
| `OPENALICE_INSTALL_URL` | Recorded HTTP(S) installer source for a trusted mirror/test |
| `OPENALICE_DOWNLOAD_BASE_URL` | Default stable/beta-manifest and dev-preview artifact base |
| `OPENALICE_STABLE_MANIFEST_URL` | Stable release discovery manifest |
| `OPENALICE_BETA_MANIFEST_URL` | Beta release discovery manifest |
| `OPENALICE_RELEASE_ASSET_BASE_URL` | Versioned release asset base for release tests/mirrors |
| `OPENALICE_LEGACY_STABLE_INSTALLER_URL` | Test override for the pinned v0.90.1 transition installer |
| `OPENALICE_LEGACY_STABLE_INSTALLER_SHA256` | Test override for that transition installer's pinned digest |
| `OPENALICE_INSTALL_KEEP_RELEASES` | Positive release retention count |
| `OPENALICE_EXPECTED_CLI_VERSION` | Update handoff binding to one artifact version |
| `OPENALICE_EXPECTED_CLI_ARTIFACT_SHA256` | Dev update handoff binding to one complete archive |
| `OPENALICE_EXPECTED_CLI_CONTENT_IDENTITY` | Dev update binding to the complete payload identity |

Do not add source package lists, managed Agent Runtime pins, package-manager
installation, or system dependency mutation back to these seams.

## Verification

For installer changes run:

```bash
bash -n install
pnpm exec vitest run packages/cli/src/install.spec.mjs
pnpm test:install:docker
npx tsc --noEmit
pnpm test
```

For a volume-backed Railway bootstrap or managed cross-target change, also run:

```bash
bash -n scripts/railway/*.sh
pnpm exec vitest run \
  scripts/railway-entrypoint.spec.ts \
  packages/cli/src/remote.spec.mjs \
  packages/cli/src/project-transfer.spec.ts \
  packages/cli/src/project-transfer-ssh.spec.ts \
  packages/cli/src/project-transfer-stream.spec.ts
```

These local checks replace neither hosted acceptance journey: a disposable
empty-Volume bootstrap/fail-closed drill, nor a non-destructive deployment,
AliceProject transfer, restart/redeploy, and SSH tunnel journey against the
retained real Volume. The authoritative checklist is owned by
[[docs/docker-deployment.md]]; run-specific progress and measurements live only
in [[plans/bun-cli-distribution.md]].

The Docker smoke uses a clean non-root Debian host with Node, npm, pnpm, Bun,
and Agent Runtimes absent. It verifies plan, consent, native installation,
dynamic launchers, update activation, retention, PATH, and lock cleanup. Use
`pnpm test:install:docker -- --interactive` for the manual prompt playground.

Before promotion also:

1. build the real target-native Bun archive;
2. install it into an isolated root and run `version --json`;
3. update from a distinct retained release and exercise rollback;
4. build/install on native macOS and clean Linux for each supported arch;
5. publish the fixed dev aliases and exercise the raw `dev/install` plus
   `--channel dev` network path;
6. verify release assets and sidecar checksums before making any channel alias
   visible; a beta mirror must also prove the stable manifest and stable update
   feeds remained byte-for-byte unchanged. The shared installer may change only
   when its default still resolves stable.

Treat missing or non-positive build, readiness, or per-role memory metrics as
an invalid native acceptance report. A compile-only result is not sufficient.

Routine acceptance is non-trading and uses isolated homes without real
credentials or broker accounts.

## Troubleshooting

| Message | Meaning |
|---|---|
| `No interactive terminal is available` | Review `--plan`, then pass `--yes` intentionally |
| `Another OpenAlice CLI installer is running` | Wait for the recorded live PID; do not delete its lock |
| `Removing a stale CLI installer lock` | The recorded owner no longer exists and recovery is safe |
| `failed SHA-256 verification` | Stop; artifact bytes and trusted checksum disagree |
| `Existing release ... is damaged` | Preserve the collision for inspection; do not overwrite it |
| `No previous OpenAlice release is retained` | Install/update once more before rollback is available |
| startup says the activation was rolled back | The new direct-install Runtime failed first readiness; run `openalice` again to start the restored release |
| update reports a non-updating channel | Refresh with the same selector instead of crossing trust boundaries |
