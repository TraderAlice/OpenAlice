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

The installer makes one small `openalice` command available. It does not:

- clone the OpenAlice repository;
- install or modify Electron;
- start Alice, UTA, Connector Service, or a browser before separate consent;
- configure credentials or native agent CLIs;
- expose a public listener;
- remove user data during an update.

The current browser-local distribution remains source-backed:

```text
curl installer
  └── installed openalice CLI
        └── user-owned OpenAlice checkout
              └── localhost Runtime
```

The install script targets macOS, Linux, WSL, and Git Bash. Native Windows
desktop distribution remains the complete Electron installer. A future native
PowerShell bootstrap may reuse the same installer contract, but it must not
weaken or silently replace the Electron lane.

## Current Entry Point

The preview installer is served directly from the `dev` branch:

```bash
curl -fsSL https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install | bash
```

It requires Node.js 20 or newer. The default source ref is `dev`, the default
install root is `~/.openalice`, and the downloaded payload is the file set
declared by `FILES` in the root `install` script.

The preview URL is not yet a stable release channel. Do not present a mutable
`dev` ref as a signed or immutable release. A stable installer needs release
assets and a release-owned authenticity chain; see
[Authenticity boundary](#authenticity-boundary).

## Load-Bearing Files

- `install` — user-facing Bash bootstrap and durable install transaction.
- `packages/cli/package.json` — CLI version, engine requirement, bin entry, and
  published file list.
- `packages/cli/bin/openalice.mjs` — installed command entry point.
- `packages/cli/src/server{,-control}.mjs` — detached lifecycle and the
  Guardian control client.
- `packages/cli/src/remote.mjs` — consent-first managed SSH orchestration.
- `packages/cli/src/install.spec.mjs` — plan, consent, PTY, layout, and live-lock
  contract tests.
- `scripts/install-docker-smoke.mjs` — local Docker acceptance runner.
- `scripts/remote-ssh-smoke.mjs` — local clean-host Server/SSH acceptance
  runner; its product contract belongs to [[docs/remote-access.md]].
- `scripts/install-smoke/` — clean user, local HTTP fixture, automated smoke,
  and manual playground.
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
  -> visible install plan
  -> explicit consent
  -> installer lock
  -> download or local copy into staging
  -> syntax, manifest, and executable validation
  -> content identity
  -> immutable release directory
  -> validate temporary launchers
  -> atomically replace visible launchers
  -> best-effort managed PATH update
  -> verify installed command
  -> release lock
  -> optional, separate localhost start prompt
```

Nothing under the install root is created before the install plan is approved.
The `--plan` path exits immediately after preflight and the plan.

### Preflight and plan

Preflight validates:

- the requested Git ref syntax and length;
- Node.js availability and major version;
- `curl` for remote installs, or CLI sources for `--source` installs;
- target paths and shell-profile choice;
- whether another `openalice` currently resolves earlier on `PATH`.

The visible plan includes action, source, ref, install root, command path, shell
change, and any PATH conflict. A check that only reads the system may happen
before consent; no installer-owned filesystem mutation may happen there.

### Consent contract

| Invocation | Required behavior |
|---|---|
| Interactive default | Ask `Continue with this install? [y/N]`; only an explicit `y` proceeds |
| Blank or `n` | Exit successfully without changing files |
| No TTY and no `--yes` | Exit with code 2 before creating the install root |
| `--yes` | Approve installation only; never start the Runtime |
| `--plan` | Print the same plan and exit without opening a prompt or changing files |
| Interactive install inside a checkout | After success, separately ask `Start OpenAlice now? [y/N]` |

The installer reads prompts from `/dev/tty`, not the curl pipe. Both prompts are
default-no. Installation consent and service-start consent are intentionally
different decisions.

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

### Validation and content identity

Before a release becomes visible, the installer:

1. runs `node --check` on every JavaScript entry;
2. verifies that `package.json` names `@traderalice/openalice-cli` and carries a
   string version;
3. executes the staged CLI with `--version` and compares its result with the
   package manifest;
4. hashes the ordered payload filenames and bytes with SHA-256 and uses the
   first 16 hex characters as its content identity.

The resulting directory is:

```text
<install-root>/cli-versions/<safe-ref>-<content-id>/
```

Installing identical content for the same ref reuses the existing directory.
If a directory claims that identity but its files no longer hash correctly, it
is preserved as `<release>.damaged.<pid>` and replaced with the validated
staging tree. The installer does not silently destroy the damaged evidence.

### Atomic visible-command switch

The installer writes temporary `openalice` and `openalice.cmd` launchers in the
target bin directory. Both point to the complete immutable release. It executes
the temporary shell launcher before replacing either visible command, then
moves the launchers into place within the same directory.

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
│   └── openalice.cmd
├── cli-versions/
│   ├── dev-<content-id>/
│   └── <older-ref-or-content>/
├── .cli-install.lock/       # present only while an installer owns it
├── data/                    # application state, not installer debris
├── workspaces/              # user work, not installer debris
├── provider-keys.json       # sensitive user state
└── sealing.key              # sensitive machine-bound key
```

The installer root and Runtime `OPENALICE_HOME` independently default to
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
| `--version <git-ref>` | Select a tag, branch, or commit for remote payloads and the installed source-ref label |
| `--install-dir <path>` | Override the OpenAlice install/user root |
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
| `OPENALICE_VERSION` | Default source ref when `--version` is absent |
| `OPENALICE_INSTALL_DIR` | Default install root when `--install-dir` is absent |
| `OPENALICE_INSTALL_BASE_URL` | Override payload base URL for local fixtures and installer tests |
| `NO_COLOR` | Disable installer color output |
| `HOME`, `SHELL`, `PATH`, `TERM` | Standard environment used for paths, profile detection, conflicts, and color |

`OPENALICE_INSTALL_BASE_URL` is a test/development seam, not a user-facing
mirror selector. A real mirror design must define equivalent authenticity and
version semantics before becoming public API.

## Authenticity Boundary

The current content identity protects update layout and detects accidental or
local modification. It does not prove who supplied the downloaded files. The
script is normally fetched from the mutable `dev` URL and then chooses payload
files from the requested raw GitHub ref. Even when that payload ref is an
immutable commit, a hash computed by the same downloaded installer is not an
independent trust anchor.

Do not describe the preview as cryptographically verified. A stable release
path should establish this chain:

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
bash -n install scripts/install-smoke/run.sh scripts/install-smoke/interactive.sh
pnpm -F @traderalice/openalice-cli test
```

The unit suite covers:

- installed layout and a runnable launcher;
- `--plan` no-write behavior;
- refusal without TTY or `--yes`;
- blank-input cancellation;
- explicit interactive approval and separate start refusal;
- live installer lock rejection.

### Clean Docker acceptance

```bash
pnpm test:install:docker
```

The smoke builds a non-root Debian fixture with an empty home, Node and curl,
no global pnpm, and no external network during the run. A local HTTP server
exercises the same remote-download branch as `curl | bash`. It verifies:

- unattended refusal before the install root exists;
- stale-lock recovery and lock cleanup;
- downloaded payload equality;
- installed `server status --json` execution and inclusion of every reachable
  Server/remote module;
- runnable shell and CMD launchers;
- idempotent managed PATH configuration;
- identical-release reuse;
- ref switching without deleting the prior release.

This is a local pre-release gate. It is intentionally not delegated to PR CI.

### Manual interaction review

```bash
pnpm test:install:docker --interactive
```

The playground stops at the real plan and prompt, then leaves the tester in the
clean container. Review the copy and spacing, approve with an explicit `y`, and
run at least:

```bash
command -v openalice
openalice --version
cat ~/.bashrc
curl -fsSL "$OPENALICE_INSTALL_URL" | bash -s -- --plan
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
2. Confirm the intended source ref and CLI package version. Do not accidentally
   advertise mutable `dev` as a stable release.
3. Run the fast installer tests and the full repository-required checks.
4. Run `pnpm test:install:docker` locally.
5. Walk `pnpm test:install:docker --interactive` as a human.
6. Exercise the installed CLI from `--source`; include the localhost handoff if
   the payload or start boundary changed.
7. State residual platform and authenticity gaps explicitly. Do not treat an
   unsigned raw-file preview as release-signing evidence.
8. Keep Electron signing and notarization in the Electron release lane; the CLI
   preview must not read those secrets.

For a `dev` to `master` promotion that publishes installer behavior, the local
Docker installer smoke remains a required manual gate under
[[docs/development-workflow.md]].

## Troubleshooting

| Symptom | Interpretation and next check |
|---|---|
| `No interactive terminal is available` | The installer correctly refused implicit consent; use `--plan`, or review the plan and pass `--yes` intentionally |
| `Another OpenAlice CLI installer is running` | Check the recorded PID and wait for the live installer; do not delete a lock owned by a live process |
| `Removing a stale CLI installer lock` | The prior owner no longer exists; the installer recovered before downloading |
| `PATH warning` or the wrong command runs | Use the printed absolute command, inspect `command -v openalice`, and reload the managed profile block |
| A `.damaged.<pid>` directory appears | A content-addressed release no longer matched its identity; preserve it for diagnosis while the validated replacement becomes active |
| CLI installs but localhost startup fails | Installation succeeded; continue with [[docs/local-runtime.md]] and Guardian/runtime diagnostics |
| Native PowerShell/CMD bootstrap is unavailable | Use the complete Electron installer, WSL, or Git Bash until a reviewed native bootstrap exists |

## Design Decisions and Next Steps

These decisions are intentional:

- localhost-first browser use is the initial CLI distribution contract;
- Electron remains a complete, independent desktop distribution;
- installation and service start always require separate consent;
- optional native agent CLIs and other dependencies are selected in a later,
  inspectable setup layer, not silently installed by the curl bootstrap;
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
