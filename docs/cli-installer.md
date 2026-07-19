# CLI Installer

This guide owns the OpenAlice CLI installer contract: bootstrap behavior,
interactive consent, installed layout, update safety, PATH integration,
platform boundaries, verification, and release checks. Update it whenever the
root `install` script, the distributed CLI file set, or installer smoke changes.

Related guides: [[docs/local-runtime.md]],
[[docs/managed-workspace-runtime.md]], and
[[docs/development-workflow.md]]. Optional broker integration delivery belongs
to [[docs/broker-packs.md]]. External installer research is deliberately
non-authoritative and lives in
[[docs/reference/install-script/README.md]].

## Product Boundary

The installer always makes the `openalice` command and OpenAlice's pinned Pi
runtime available. Pi is installed inside the immutable OpenAlice release, not
into npm's system or user-global prefix. On Linux, the installer can also
install the source Runtime's native build tools, but only after the user
selects that option and approves the exact system command. By default it does
not:

- clone the OpenAlice repository;
- install or modify Electron;
- start Alice, UTA, Connector Service, or a browser before separate consent;
- configure credentials or install Claude Code, Codex, opencode, or other
  user-owned agent CLIs;
- expose a public listener;
- remove user data during an update.

`--with-runtime-deps` is deliberately narrower than a general machine setup
mode. It covers Git, Python 3, make, and a C++ compiler because pnpm may need to
compile native Node modules such as `node-pty`. It does not install Node,
additional Agent CLIs, broker SDKs, credentials, Docker, or Electron. Managed
Pi is part of the baseline OpenAlice transaction, not a Runtime-tool option.

The current browser-local distribution remains source-backed:

```text
curl installer
  └── immutable OpenAlice CLI + managed Pi
        ├── openalice command injects managed Pi into Guardian
        ├── pi command exposes the same pinned runtime directly
        └── user-owned OpenAlice checkout
              └── localhost Runtime
```

The install script targets macOS, Linux, WSL, and Git Bash. Native Windows
desktop distribution remains the complete Electron installer. A future native
PowerShell bootstrap may reuse the same installer contract, but it must not
weaken or silently replace the Electron lane.

## Current Entry Point

The stable installer is served from the OpenAlice site:

```bash
curl -fsSL https://openalice.ai/install | bash
```

The release workflow publishes the same bytes as a versioned GitHub Release
asset, mirrors them to `download.openalice.ai`, records their SHA-256 in the
download manifest, and updates the rolling `install` alias without caching it.
The main-site route proxies that release-owned alias and refuses non-script
upstream content.

The script requires Node.js 22.19.0 or newer, matching the pinned Pi runtime's
engine floor. With no selector, it targets the stable `master` branch.

The independently active development channel deliberately uses GitHub's raw
branch endpoint rather than the release CDN. Both layers must select `dev`:

```bash
curl -fsSL https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install \
  | bash -s -- --branch dev
```

That command tests the current dev installer script and the current dev CLI
payload together. Running the stable `https://openalice.ai/install` script with
`--branch dev` can be useful as a compatibility probe, but it does not prove
that changes to `dev/install` work. The raw endpoint is mutable preview
infrastructure for maintainers, not a user-facing release mirror.

`--version` selects a tag or commit, and the two selectors are mutually
exclusive. The default install root is `~/.openalice`, and the downloaded
OpenAlice payload is the file set declared by `FILES` in the root `install`
script. The installer also downloads Pi's release-owned install manifest and
lockfile for version `0.80.6`, verifies both against pinned SHA-256 values, and
runs `npm ci --omit=dev --ignore-scripts` in the staged release.

## Load-Bearing Files

- `install` — user-facing Bash bootstrap and durable install transaction.
- `packages/cli/package.json` — CLI version, engine requirement, bin entry, and
  published file list.
- `packages/cli/bin/openalice.mjs` — installed command entry point.
- `packages/cli/src/install-source.mjs` — validated installation-source
  metadata used when managed remote reproduces the invoking CLI.
- `packages/cli/src/server{,-control}.mjs` — detached lifecycle and the
  Guardian control client.
- `packages/cli/src/remote.mjs` — consent-first managed SSH orchestration.
- `packages/cli/src/runtime-deps.mjs` — source-build tool probe and actionable
  local-start failure.
- `packages/cli/src/install.spec.mjs` — plan, consent, PTY, layout, and live-lock
  contract tests.
- `scripts/install-docker-smoke.mjs` — local Docker acceptance runner.
- `scripts/install-channel-smoke.mjs` — clean-host acceptance for the live raw
  dev installer and matching dev payload.
- `scripts/remote-ssh-smoke.mjs` — local clean-host Server/SSH acceptance
  runner; its product contract belongs to [[docs/remote-access.md]].
- `scripts/install-smoke/` — clean user, local HTTP fixture, automated smoke,
  manual playground, exact Pi release assets, and an offline npm fixture.
- `.github/workflows/cli-installer-smoke.yml` — checkout acceptance on relevant
  PRs and live raw-channel acceptance after installer changes merge to `dev`.
- `docs/local-runtime.md` — behavior after the installed command starts a
  source-backed localhost Runtime.
- `docs/reference/install-script/README.md` — Claude Code and Codex research;
  useful context, not OpenAlice truth.

When a new runtime file is imported by the installed CLI, update all of the
following together:

1. `packages/cli/package.json` `files`;
2. `FILES` in `install`;
3. syntax or runtime validation in `install`;
4. installer tests and Docker fixture assertions as needed.

Leaving those lists out of sync produces an installer that validates locally
but fails only after the downloaded command imports a missing file.

## Installation Transaction

The durable sequence is:

```text
preflight
  -> optional source-build-tool selection
  -> visible install plan
  -> explicit consent
  -> optional system package command
  -> installer lock
  -> download or local copy into staging
  -> SHA-256 verification of pinned Pi manifest and lockfile
  -> npm ci for managed Pi inside staging
  -> syntax, manifest, Pi version, and executable validation
  -> record branch/tag/commit installer provenance
  -> content identity
  -> immutable release directory
  -> validate temporary launchers
  -> atomically replace visible launchers
  -> best-effort managed PATH update
  -> verify installed command
  -> release lock
  -> optional, separate localhost start prompt
```

Nothing under the install root is created and no package manager is invoked
before the install plan is approved. The `--plan` path exits immediately after
preflight and the plan. System package managers are not transactional with the
CLI install: a package-manager failure can leave packages partially updated,
but it cannot publish a partial OpenAlice CLI release.

### Preflight and plan

Preflight validates:

- the requested branch/tag/commit selector syntax and length;
- Node.js availability and the exact `>=22.19.0` floor;
- npm availability for the staged managed-Pi install;
- `curl` for remote installs, or CLI sources for `--source` installs;
- target paths and shell-profile choice;
- whether Git, Python 3, make, and a C++ compiler are already available;
- on Linux, the supported package manager and whether root or `sudo` is
  available when Runtime-tool installation is selected;
- whether another `openalice` currently resolves earlier on `PATH`.

The visible plan includes action, source, branch or version, install root, both
command paths, the pinned Pi version and source, the exact Pi npm command,
shell change, Runtime-tool action, exact system package-manager command when
selected, and any PATH conflict. A check that only reads the system may happen
before consent; no installer-owned filesystem mutation may happen there.

### Consent contract

| Invocation | Required behavior |
|---|---|
| Interactive default with missing build tools | First ask whether to include the tools, then print one complete plan and ask `Continue with this install? [y/N]` |
| Interactive default with tools ready | Print the plan and ask `Continue with this install? [y/N]`; only an explicit `y` proceeds |
| Blank or `n` | Exit successfully without changing files |
| No TTY and no `--yes` | Exit with code 2 before creating the install root |
| `--yes` | Approve the baseline CLI + managed Pi transaction and only the extra actions selected by flags; never implies Runtime tools and never starts the Runtime |
| `--with-runtime-deps` | Select missing Linux build tools; does not bypass the final confirmation |
| `--plan` | Print the same plan and exit without opening a prompt or changing files |
| Interactive install inside a checkout | After success, separately ask `Start OpenAlice now? [y/N]` |

The installer reads prompts from `/dev/tty`, not the curl pipe. The
Runtime-tool selection, final plan approval, and optional service start are all
default-no. They are intentionally different decisions. For automation,
`--yes --with-runtime-deps` is the explicit pair that approves the displayed
Linux package command as well as the CLI transaction.

### Source Runtime build tools

The Linux package mapping is:

| Manager | Packages |
|---|---|
| `apt-get` | `git python3 make g++` |
| `dnf`, `yum` | `git python3 make gcc-c++` |
| `apk` | `git python3 make g++` |
| `pacman` | `git python make gcc` |

The installer uses the package manager directly as root and prefixes it with
`sudo` otherwise. It refuses the selected action if neither authority is
available or if the host has no supported manager. It re-probes every tool
after the package command and fails before downloading the CLI if the machine
is still incomplete.

On macOS, the installer detects the same tool groups but does not try to launch
the GUI-backed Command Line Tools flow over a curl pipe or SSH session. A
selected but incomplete setup stops with the local-session instruction
`xcode-select --install`. Native Windows remains the Electron lane; WSL follows
the Linux contract.

### Lock and staging

After consent, the installer acquires:

```text
<install-root>/.cli-install.lock/pid
```

A live PID blocks a concurrent installer. A lock without a live owner is
treated as stale and recovered. Cleanup releases a lock owned by the current
installer and removes temporary staging or launcher files.

Downloads first land in a temporary `openalice-cli.*` directory outside the
visible command path. A failed or interrupted download therefore leaves the
previous installed command untouched.

Managed Pi is installed under `managed/pi/` in that same staging tree. npm
never receives `--global` and never writes OpenAlice's Pi into a host prefix.
The pinned lockfile supplies registry integrity values for the dependency tree;
install scripts are disabled. A failure leaves the previous content-addressed
OpenAlice and Pi release visible.

### Validation and content identity

Before a release becomes visible, the installer:

1. runs `node --check` on every JavaScript entry;
2. verifies that `package.json` names `@traderalice/openalice-cli` and carries a
   string version;
3. executes the staged CLI with `--version` and compares its result with the
   package manifest;
4. verifies the Pi install manifest and lockfile against the SHA-256 values
   pinned in the installer, then requires the staged Pi CLI to report `0.80.6`;
5. writes `install-source.json` with the CLI version, selected branch/tag/commit,
   and installer URL that produced this CLI;
6. hashes the ordered OpenAlice payload, install-source metadata, and both Pi
   install files with SHA-256 and uses the first 16 hex characters as its
   content identity.

That metadata is returned by `openalice version --json` together with the
16-character identity derived from the immutable installed release directory.
Managed `openalice remote` compares both provenance and content identity before
deciding that a remote CLI matches, then invokes the same ordinary installer
source and selector when it does not. This catches changed payload bytes even
when the CLI semantic version and branch name are unchanged. `remote` has no
independent branch/version option.

The resulting directory is:

```text
<install-root>/cli-versions/<safe-ref>-<content-id>/
```

Installing identical content for the same ref reuses the existing directory
only when both the content hash and executable Pi version still match. If a
directory claims that identity but its files no longer hash correctly or its
managed Pi runtime is missing/damaged, it is preserved as
`<release>.damaged.<pid>` and replaced with the validated staging tree. The
installer does not silently destroy the damaged evidence.

### Atomic visible-command switch

The installer writes temporary `openalice`, `openalice.cmd`, `pi`, and `pi.cmd`
launchers in the target bin directory. All point to the complete immutable
release. It executes both temporary shell launchers before replacing any
visible command, then moves the launchers into place within the same directory.
The OpenAlice launchers export `OPENALICE_MANAGED_PI_PATH` and
`OPENALICE_MANAGED_PI_NODE_PATH`; foreground and detached Guardian trees
therefore inherit the pinned runtime without relying on shell-profile reloads.

This gives updates a simple safety property: a visible launcher points to the
complete old release or the complete new release, never to a half-written
replacement tree. The final installed launcher is executed again with
`--version` before success is reported.

Old content-addressed releases are retained. There is currently no automatic
garbage collection, rollback command, or CLI-only uninstall command.

## Installed Layout

With the default installer and Runtime roots:

```text
~/.openalice/
├── bin/
│   ├── openalice
│   ├── openalice.cmd
│   ├── pi
│   └── pi.cmd
├── cli-versions/
│   ├── master-<content-id>/
│   │   ├── install-source.json
│   │   └── managed/pi/     # pinned npm runtime inside the immutable release
│   ├── dev-<content-id>/   # only after an explicit --branch dev install
│   └── <older-ref-or-content>/
├── .cli-install.lock/       # present only while an installer owns it
├── sources/                 # selector-specific managed remote checkouts
├── data/                    # application state, not installer debris
├── workspaces/              # user work, not installer debris
├── provider-keys.json       # sensitive user state
└── sealing.key              # sensitive machine-bound key
```

`sources/` is created by approved managed-remote orchestration, not by the
installer itself. The installer root and Runtime `OPENALICE_HOME` independently default to
`~/.openalice`. The installer does not read an `OPENALICE_HOME` override, and
`openalice start` does not infer Runtime home from the CLI's install location.
Either override may therefore diverge intentionally. Their default co-location
is convenient, but it makes the uninstall boundary critical: never implement
uninstall as `rm -rf ~/.openalice`.

A future uninstall operation must remove only installer-owned launchers,
installer-owned CLI releases, its lock, and its marked PATH block. It must
preserve application data, Workspaces, credentials, keys, backups, and any
other user-owned state.

## PATH Integration

The installer prepends `<install-root>/bin` through a marked block:

```text
# >>> OpenAlice CLI >>>
export PATH=.../bin:$PATH
# <<< OpenAlice CLI <<<
```

Profile selection is:

| Shell | Platform | Profile |
|---|---|---|
| zsh | macOS | `~/.zprofile` |
| zsh | other | `~/.zshrc` |
| bash | macOS | `~/.bash_profile` |
| bash | other | `~/.bashrc` |
| fish | all | `~/.config/fish/config.fish` |
| unknown | all | no automatic change; print manual command |

Repeated installs replace the managed block instead of appending duplicates.
The migration also removes the exact unmarked PATH line written by the earlier
preview installer. A symlinked profile is updated through the symlink instead
of replacing the symlink itself.

PATH integration is non-critical. If profile editing fails, the validated CLI
remains installed and the user receives the command needed for the current
shell. The installer never uninstalls a conflicting npm, Homebrew, or other
`openalice` command automatically; it reports which command currently resolves
first.

## Options and Environment

Public options:

| Option | Meaning |
|---|---|
| `--branch <name>` | Select a named Git branch (default: `master`) |
| `--version <git-ref>` | Select a Git tag or commit; mutually exclusive with `--branch` |
| `--install-dir <path>` | Override the OpenAlice install/user root |
| `--with-runtime-deps` | Include missing Linux Git/Python/make/C++ source-build tools in the approved plan |
| `--no-modify-path` | Install launchers without editing a shell profile |
| `--plan` | Show the exact plan and make no changes |
| `-y`, `--yes` | Explicit non-interactive installation consent |
| `-h`, `--help` | Print installer usage without making changes |

Development-only option:

| Option | Meaning |
|---|---|
| `--source <checkout>` | Copy CLI payload files from a local OpenAlice checkout |

Environment inputs:

| Variable | Meaning |
|---|---|
| `OPENALICE_INSTALL_DIR` | Default install root when `--install-dir` is absent |
| `OPENALICE_INSTALL_URL` | Override the public installer URL recorded in installed provenance; used by fixtures and private mirrors |
| `OPENALICE_INSTALL_BASE_URL` | Override payload base URL for local fixtures and installer tests |
| `OPENALICE_PI_RELEASE_BASE_URL` | Override the pinned Pi release-asset base for installer tests |
| `OPENALICE_PI_SOURCE_DIR` | Read the exact Pi manifest/lock assets from a local fixture |
| `OPENALICE_NPM_BIN` | Use a single alternate npm executable in installer tests |
| `OPENALICE_INSTALL_CONTEXT` | Internal managed-remote context; returns control without local checkout/start guidance |
| `NO_COLOR` | Disable installer color output |
| `HOME`, `SHELL`, `PATH`, `TERM` | Standard environment used for paths, profile detection, conflicts, and color |

The Pi overrides, `OPENALICE_INSTALL_URL`, and `OPENALICE_INSTALL_BASE_URL`
are distributor/test seams, not user-facing branch selectors. Managed remote
sets `OPENALICE_INSTALL_CONTEXT=remote` only after the user approves its outer
plan; the installer still owns its normal transaction and prints a
remote-appropriate heading, then returns instead of suggesting a second manual
clone or local start. The same pinned SHA-256 checks still apply to local Pi
assets. A real mirror design must define equivalent authenticity and version
semantics before becoming public API.

## Authenticity Boundary

The public bootstrap is release-owned: each accepted release carries a
versioned installer asset, the R2 manifest records its SHA-256, and the rolling
main-site entry resolves to the mirrored bytes. The installed content identity
then protects update layout and detects accidental or local modification.

This is still not a cryptographic signature. The installer downloads the CLI
payload as individual files from the selected raw GitHub ref, and the R2
manifest belongs to the same release control plane as the mirrored script.
Even when that payload ref is an immutable commit, a hash published beside the
download is not an independent trust anchor.

Do not describe the CLI path as signed. A future archive/signature path should
establish this chain:

```text
trusted release metadata
  -> expected checksum or signature
  -> downloaded archive
  -> validated package layout
  -> installed executable version
```

The expected checksum must come from release-owned metadata or a signature,
not from an unsigned manifest downloaded beside the archive. Preserve the
existing staging, executable validation, immutable placement, and atomic switch
after that trust chain is added.

## Verification

### Fast local feedback

```bash
bash -n install scripts/install-smoke/run.sh scripts/install-smoke/interactive.sh \
  scripts/install-channel-smoke/run.sh
pnpm -F @traderalice/openalice-cli test
```

The unit suite covers:

- default-`master`, explicit-branch, tag/commit, and selector-conflict behavior;
- persisted install provenance and `openalice version --json`;
- installed layout and a runnable launcher;
- pinned managed Pi layout, version, direct launcher, and OpenAlice env
  injection;
- `--plan` no-write behavior;
- refusal without TTY or `--yes`;
- blank-input cancellation;
- explicit interactive approval and separate start refusal;
- source-build-tool preflight before pnpm;
- live installer lock rejection.

### Clean Docker acceptance

```bash
pnpm test:install:docker
```

The smoke builds a non-root Debian fixture with an empty home, Node and curl,
no global pnpm, and no external network during the run. A local HTTP server
exercises the same OpenAlice remote-download branch as `curl | bash`; exact
release Pi assets plus a strict fake npm exercise the offline install contract.
It verifies:

- default `master`, explicit `dev`, and mutually exclusive selectors;
- unattended refusal before the install root exists;
- stale-lock recovery and lock cleanup;
- downloaded payload equality;
- default install invokes only the declared non-global managed-Pi npm command
  and does not invoke a system package manager;
- `--with-runtime-deps --plan` shows the exact elevated command without
  running it;
- approved Runtime-tool setup invokes the expected package list and re-probes
  the resulting commands;
- installed `server status --json` execution and inclusion of every reachable
  Server/remote module;
- installed content identity in `openalice version --json`, so same-version
  remote payload drift is detectable;
- runnable OpenAlice/Pi shell and CMD launchers plus managed-Pi env injection;
- idempotent managed PATH configuration;
- identical-release reuse;
- ref switching without deleting the prior release.

Relevant PRs run this deterministic acceptance in CI against the exact checkout.
The same workflow runs `pnpm test:remote:docker` in a separate clean SSH fixture
so installer changes cannot pass while managed remote is broken.

### Live dev-channel acceptance

```bash
pnpm test:install:dev-channel
```

This smoke builds an empty non-root container but copies no OpenAlice installer
or CLI payload into it. It downloads
`https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install`, installs
the matching `--branch dev` payload through the real network path, and verifies:

- the response is the Bash installer and passes syntax validation;
- `--plan` selects dev without writing the install root;
- the complete OpenAlice CLI and managed Pi transaction succeeds;
- installed provenance records the raw dev URL and branch selector;
- the CLI version, Pi version, and `server status --json` execute;
- an identical second install reuses the same content identity and immutable
  release directory.

The workflow runs this job after relevant changes merge to `dev`. PR checks use
the checkout fixtures instead, because the raw dev URL correctly continues to
represent the previously merged branch until the PR lands. A network failure is
reported separately from deterministic checkout acceptance rather than being
hidden by a local fixture.

### Manual interaction review

```bash
pnpm test:install:docker --interactive
```

The playground first offers the Runtime-tool choice, stops again at the real
combined plan, and then leaves the tester in the clean container. Its fake
offline package manager records the exact command while still exercising the
non-root plus `sudo` branch. Review both choices, copy, and spacing, approve
with an explicit `y`, and run at least:

```bash
command -v openalice
openalice --version
openalice version --json
command -v pi
pi --version
cat ~/.bashrc
curl -fsSL "$OPENALICE_INSTALL_URL" | bash -s -- --plan
curl -fsSL "$OPENALICE_INSTALL_URL" | bash -s -- --plan --branch dev
curl -fsSL "$OPENALICE_INSTALL_URL" | bash -s -- --plan --with-runtime-deps
cat "$OPENALICE_RUNTIME_DEPS_LOG"
```

Manual review is required when prompt text, color, progress, profile behavior,
or next-step guidance changes. A passing non-interactive smoke cannot judge
whether the installer feels alarming or confusing.

### End-to-end localhost handoff

When installer behavior, the distributed payload, or the optional start handoff
changes:

1. run `pnpm build:server`;
2. install from `--source` into a temporary install root;
3. start the installed CLI with an isolated `--home`, unused port, and
   `--no-open`;
4. verify `/api/auth/status` and the real root page;
5. stop with `Ctrl+C` and confirm the Runtime exits cleanly.

Never use the normal user home or a live broker account for this acceptance.
Electron smoke is required only when shared dependency topology, managed
Runtime behavior, PTY behavior, or Electron files also change.

## Release Checklist

Before publishing or promoting a change that affects the installer:

1. Confirm the CLI payload list in `install` and `packages/cli/package.json`
   still match the imports reachable from `bin/openalice.mjs`.
2. Confirm the intended source ref, CLI package version, Pi version, release
   asset hashes, lockfile engine floor, and root/CLI Node engines. Do not
   accidentally advertise mutable `dev` as a stable release.
3. Run the fast installer tests and the full repository-required checks.
4. Require checkout install and managed-remote CI acceptance to pass, then
   require the post-merge `pnpm test:install:dev-channel` result for current
   `dev` to be green.
5. Walk `pnpm test:install:docker --interactive` as a human when prompts,
   progress, PATH guidance, or next steps changed.
6. Exercise the installed CLI from `--source`; include the localhost handoff if
   the payload or start boundary changed.
7. Treat the `dev` to `master` merge as the release event. The release workflow
   repeats checkout acceptance before publication, creates the installer from
   the accepted tag, then verifies the versioned asset, R2 `install` alias,
   manifest checksum, and main-site proxy. State the remaining
   archive/signature gap explicitly.
8. Keep Electron signing and notarization in the Electron release lane; the CLI
   preview must not read those secrets.

Do not refresh the stable installer from an unreleased `master` commit. A
manual release mirror may only reproduce the exact bytes owned by its requested
tag; new installer behavior stays on the live dev channel until the next
versioned promotion under [[docs/development-workflow.md]].

## Troubleshooting

| Symptom | Interpretation and next check |
|---|---|
| `No interactive terminal is available` | The installer correctly refused implicit consent; use `--plan`, or review the plan and pass `--yes` intentionally |
| `Another OpenAlice CLI installer is running` | Check the recorded PID and wait for the live installer; do not delete a lock owned by a live process |
| `Removing a stale CLI installer lock` | The prior owner no longer exists; the installer recovered before downloading |
| `PATH warning` or the wrong command runs | Use the printed absolute command, inspect `command -v openalice`, and reload the managed profile block |
| npm is missing or Node is below 22.19.0 | Install the complete Node.js 22 LTS distribution; OpenAlice rejects the host before consent instead of publishing a broken Pi runtime |
| Pi asset SHA-256 check fails | Stop. The pinned release metadata and downloaded asset disagree; do not bypass the check |
| A `.damaged.<pid>` directory appears | A content-addressed release no longer matched its identity; preserve it for diagnosis while the validated replacement becomes active |
| CLI installs but localhost startup fails | Installation succeeded; continue with [[docs/local-runtime.md]] and Guardian/runtime diagnostics |
| Remote install succeeds and then prints no clone command | Managed remote set the installer context and is continuing with its already-approved source plan |
| Native PowerShell/CMD bootstrap is unavailable | Use the complete Electron installer, WSL, or Git Bash until a reviewed native bootstrap exists |

## Design Decisions and Next Steps

These decisions are intentional:

- localhost-first browser use is the initial CLI distribution contract;
- Electron remains a complete, independent desktop distribution;
- installation and service start always require separate consent;
- managed Pi is the explicit baseline agent shown in every install plan;
  Claude Code, Codex, opencode, and other user-owned CLIs remain optional and
  belong to a later inspectable setup layer;
- Claude Code installer source may be read as public behavior but is not
  vendored; Codex's Apache-2.0 installer is the inspectable engineering
  reference, while OpenAlice keeps an independent implementation;
- release authenticity must be designed explicitly rather than implied by a
  locally computed content hash.

Likely follow-up stages, in dependency order:

1. publish an immutable CLI archive with release-owned checksums or signatures;
2. move durable install logic behind a shared cross-platform core before adding
   a native PowerShell bootstrap;
3. add explicit CLI rollback, garbage collection, and surgical uninstall;
4. replace the source/build requirement with a standalone headless Runtime
   asset while retaining the same localhost and consent contracts;
5. layer remote transports around a loopback Runtime rather than opening the
   Runtime itself to the network.

Do not implement a later stage by weakening the current consent, data ownership,
loopback, Electron, or authenticity boundaries.
