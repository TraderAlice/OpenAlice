# CLI Installer

This guide owns the macOS/Linux OpenAlice CLI bootstrap, installed layout,
activation, provenance, update, rollback, uninstall, and release acceptance.
Runtime behavior after activation belongs to [[docs/local-runtime.md]]. Electron
packaging remains independent under [[docs/managed-workspace-runtime.md]].

The current CLI payload is one target-native Bun executable plus immutable
OpenAlice resources. The installer does not install Node.js, Bun, npm, source
dependencies, build tools, or an Agent Runtime.

npm, Bun, Homebrew, and Arch/AUR installation consume the same accepted native
archives but remain owned by their package manager. Their topology, commands,
and update behavior live in [[docs/cli-package-managers.md]].

## Supported entry paths

Stable direct install:

```bash
curl -fsSL https://openalice.ai/install | bash
```

Development preview:

```bash
curl -fsSL https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install \
  | bash -s -- --branch dev
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
archives, validates `release.json` target/version/content identity, and runs
the staged executable's `--version` before activation.

The stable selector resolves the latest GitHub release and downloads the exact
versioned asset. `--branch dev` downloads the fixed preview aliases:

```text
https://download.openalice.ai/cli/dev/openalice-cli-dev-<platform>-<arch>.tar.gz
https://download.openalice.ai/cli/dev/openalice-cli-dev-<platform>-<arch>.tar.gz.sha256
```

Every `dev` push builds all four native targets. Publication verifies each
sidecar and the archive's target/version metadata, uploads an immutable copy
under `cli/dev/releases/<commit>/`, then replaces the fixed archive aliases.
Each checksum alias is written after its archive, so a reader racing a publish
can fail verification but cannot activate mismatched bytes. The dev manifest is
published last as the completed-set receipt. Stable releases publish the same
four versioned archives and sidecars as GitHub Release assets and mirror them
unchanged to the download CDN.

## Ownership boundary

The direct installer owns only:

- immutable OpenAlice CLI releases;
- release-owned Git and OpenAlice resources;
- `openalice` and Workspace helper launchers;
- the `cli/current` activation pointer;
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
│   ├── releases/<version>-<platform>-<arch>-<content-id>/
│   ├── provenance/<release-name>.json
│   └── staging/
├── .cli-install.lock/       # only while an installer owns the transaction
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

1. rejects a live installer lock or removes a stale one;
2. stages on the same filesystem as the release store;
3. downloads or copies the archive and verifies SHA-256;
4. validates and smoke-runs the staged release;
5. moves the release into its immutable content-addressed directory;
6. writes provenance outside the release;
7. atomically replaces `cli/current` using platform-correct symlink semantics;
8. atomically replaces installer-owned launchers;
9. verifies the stable `openalice` launcher;
10. retains the newest three releases by default and collects older inactive
    installer-owned releases;
11. writes one marked PATH block when requested;
12. releases the lock and removes staging on every exit path.

An existing release is reused only when its executable checksum matches the
staged release. A damaged collision stops with evidence preserved.

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

## Update and rollback

`openalice update --check` reads the stable release manifest. Development,
pinned, and custom installs do not cross to stable automatically.

For a stable direct install, `openalice update` downloads the versioned Bash
installer, verifies the installer's manifest checksum, and invokes it with the
exact advertised `--version`, current install root, and ordinary consent. A
running process keeps its already-mapped executable; the new pointer affects
the next invocation.

Rollback is local and download-free:

```bash
openalice rollback --plan
openalice rollback --yes
openalice rollback --to <full-retained-release-name> --yes
```

It validates both releases and their provenance, refuses to race a live
installer, and atomically switches only `cli/current`. It does not alter user
data or remove releases. The current process is not hot-reloaded; run
`openalice` again after update or rollback.

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
| `--branch master` | Stable channel; equivalent to the default selector |
| `--branch dev` | Development preview channel |
| `--version <x.y.z>` | Exact pinned GitHub release |
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
| `OPENALICE_DOWNLOAD_BASE_URL` | Dev preview artifact base |
| `OPENALICE_RELEASES_API_URL` | Stable release discovery endpoint |
| `OPENALICE_RELEASE_ASSET_BASE_URL` | Versioned release asset base for release tests/mirrors |
| `OPENALICE_INSTALL_KEEP_RELEASES` | Positive release retention count |
| `OPENALICE_EXPECTED_CLI_VERSION` | Update handoff binding to one artifact version |

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
   `--branch dev` network path;
6. verify release assets and sidecar checksums before making any stable alias
   visible.

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
| update reports a non-stable channel | Refresh with the same selector instead of crossing trust boundaries |
