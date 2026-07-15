# Managed Workspace Runtime

This guide owns the packaged-desktop runtime contract for Workspace agents.
Read it before changing desktop packaging, agent discovery, Pi launch behavior,
the Windows shell/toolchain, or the `OPENALICE_MANAGED_*` environment keys.

Related guides: [[docs/project-structure.md]] and
[[docs/development-workflow.md]].

## Product Contract

A packaged OpenAlice install must be able to open a Workspace on a fresh
supported machine without asking the user to install Node, npm, Git, Bash, or
an agent CLI first.

The default packaged path is:

1. OpenAlice supplies a managed Pi runtime.
2. The user configures an API-key credential in **Settings → AI Provider**.
3. OpenAlice injects that credential into the Workspace's Pi config.
4. Pi starts with the OpenAlice CLIs and shared skills already available.

The runtime and the model credential are separate requirements. Bundling Pi
removes the CLI/toolchain prerequisite; it does not bundle a model account or
API key. User-installed Claude Code, Codex, opencode, or Pi remain supported as
additional runtimes and may use their own subscription login or local config.

Source/dev and Docker installs are different deployment shapes. They do not
inherit the packaged desktop's managed-agent promise and may require an agent
CLI to be installed in the host environment or image.

### Desktop data-location selection

The desktop resolves the complete `OPENALICE_HOME` before acquiring runtime
ownership or starting Alice/UTA. Fresh installs can choose a folder at startup;
**Settings → General → Data location** can switch with a full restart, reopen a
recent location, or ask on every launch. A duplicate-owner dialog can choose a
different home instead of stopping the live instance.

This launcher preference is stored under Electron `userData`, not inside the
selected OpenAlice home and not inside portable `data/`. `OPENALICE_HOME` and
`AQ_LAUNCHER_ROOT` environment overrides lock the desktop selector. Switching
never copies or moves data. Follow [[docs/data-locations.md]] for precedence,
concurrent-instance semantics, missing-drive behavior, and verification.

## Current Platform Payloads

### macOS packaged app

The app ships:

- Electron's bundled Node runtime;
- the pinned managed Pi npm runtime under `vendor/pi/`;
- pinned `fd` and `ripgrep` binaries under `vendor/tools/darwin-<arch>/`;
- the existing packaged Git path used by Workspace bootstrap.

Pi uses `/bin/bash` when available and falls back to `/bin/sh`. The packaged
app can still discover user-installed CLIs from common Homebrew, pnpm, and
user-bin locations when it was launched from Finder with a minimal `PATH`.

### Windows packaged app

The app ships:

- Electron's bundled Node runtime;
- the same pinned managed Pi npm runtime;
- pinned `fd` and `ripgrep` binaries under `vendor/tools/win32-<arch>/`;
- a pinned PortableGit payload under `vendor/git/<platform>-<arch>/`, including
  `git.exe`, `bash.exe`, `sh.exe`, and the command-line tools Pi needs.

OpenAlice launches managed Pi through Electron in Node mode and gives Pi the
managed Bash path. Workspace child processes receive the PortableGit command
directories on `PATH`, so the default packaged flow does not require Node,
npm, Git for Windows, WSL, or a system agent CLI.

Workspace-facing OpenAlice commands (`alice`, `alice-workspace`, `traderhub`,
and `alice-uta`) also do not depend on a host Node installation. Their POSIX
and Windows launchers execute the explicit `openalice-cli.cjs` payload through
the Electron executable recorded in `OPENALICE_MANAGED_PI_NODE_PATH`, with
`ELECTRON_RUN_AS_NODE=1`. When the POSIX launcher is reached from managed Git
Bash, it normalizes Windows-native launcher and Electron paths through
`cygpath` before execution and excludes `OPENALICE_TOOL_URL` plus
`OPENALICE_TOOL_SOCKET` from MSYS environment conversion. In particular,
`/cli` is an application route and must not become a Git installation path.
Source/dev falls back to `node` from the contributor environment. Keep the public commands as launchers: executing extensionless
JavaScript directly makes behavior depend on the host Node version and the
nearest `package.json` module type.

The Windows package currently retains dugite's embedded Git payload as well as
PortableGit. This duplication is intentional until all Workspace Git call
sites have moved behind an OpenAlice-owned wrapper.

### Windows workspace shell preference

Windows has one machine-local Workspace shell preference in **Settings →
General**. It is intentionally not a cross-platform setting: macOS and Linux
return before reading or writing the preference file and keep their existing
shell behavior.

The preference is stored at
`~/.openalice/state/workspace-shell.json`, outside a portable install's
`data/` directory. Its modes and precedence are:

1. **Custom** stores an absolute path to `bash.exe` and exposes it to Workspace
   processes as `OPENALICE_WORKSPACE_SHELL_PATH`. This explicit user choice
   wins over the packaged managed shell.
2. **Auto** clears that override. A packaged app then uses
   `OPENALICE_MANAGED_SHELL_PATH` (the bundled PortableGit Bash); a source/dev
   install discovers Git Bash from `SHELL`, `PATH`, standard Git for Windows
   installation directories, or a per-user Git installation.

`OPENALICE_WORKSPACE_SHELL_PATH` is OpenAlice's resolved internal override,
not a second independent user setting. If a custom executable is later moved
or deleted, the setting is reported as invalid and process launch fails
explicitly; OpenAlice does not silently fall back to Auto.

During Windows Pi bootstrap, OpenAlice mirrors the resolved global shell into
the Workspace's `.pi-agent/settings.json`. This also backfills existing
Workspaces created before the global preference existed, while preserving all
other Pi-owned settings. The Pi file is a derived compatibility cache; the
machine-local preference remains the source of truth.

## Packaging and Runtime Flow

### 1. Vendor pinned payloads

`scripts/vendor-managed-runtime.mjs` prepares the runtime before packaging. It:

- downloads Pi's pinned install package and lockfile;
- verifies their checksums;
- runs an isolated `npm ci --omit=dev` under `vendor/pi/`;
- downloads the platform's pinned `fd` and `ripgrep` archives, verifies their
  release checksums, and retains their license files;
- publishes both search binaries from one shared `vendor/tools/<platform>-<arch>/bin`
  directory so Pi never needs a per-Workspace tool download;
- downloads and verifies PortableGit on supported Windows targets;
- extracts it into the deterministic `vendor/git/<platform>-<arch>/` path;
- writes `vendor/manifest.json` with versions, paths, and toolchain entries.

`pnpm electron:pack` runs this through `pnpm vendor:runtime`. The desktop
builder keeps `asar` disabled and includes `vendor/**` in the packaged files.
Contributors who run `pnpm vendor:runtime` also get the generated search-tool
directory on `pnpm dev`'s managed PATH; dev startup never downloads or mutates
that payload implicitly.

### 2. Resolve packaged capabilities

`apps/desktop/src/main.ts` inspects the packaged resource tree before starting
Alice and injects the capabilities it actually finds:

```text
OPENALICE_RUNTIME_PROFILE=electron-packaged
OPENALICE_MANAGED_PI_PATH=/.../vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
OPENALICE_MANAGED_PI_NODE_PATH=/.../OpenAlice(.exe)
OPENALICE_MANAGED_GIT_DIR=/.../vendor/git/win32-x64
OPENALICE_MANAGED_GIT_BIN=/.../vendor/git/win32-x64/cmd/git.exe
OPENALICE_MANAGED_SHELL_PATH=/.../vendor/git/win32-x64/bin/bash.exe
OPENALICE_MANAGED_TOOLCHAIN_PATH=/.../vendor/tools/win32-x64/bin:/.../cmd:/.../bin:/.../usr/bin
LOCAL_GIT_DIRECTORY=/.../vendor/git/win32-x64
```

Paths are platform-specific and only appear when their payload exists. macOS
does not receive the Windows Git fields; packaged macOS does receive its
resolved system shell path.

### 3. Normalize the profile once

`src/core/runtime-profile.ts` parses those environment values into
`RuntimeProfile`. Workspace code consumes that profile rather than scattering
platform guesses across adapters.

The profile describes capabilities, not product permission. Managed Pi and a
managed shell do not grant trading access; trading mode and UTA enforcement
remain at the OpenAlice/UTA boundary.

### 4. Detect and launch agents

- `src/workspaces/agent-detect.ts` treats managed Pi as installed before
  falling back to a `pi` executable on `PATH`.
- `src/workspaces/spawn-env.ts` places OpenAlice's CLI shims first, followed by
  managed toolchain directories and host fallbacks. On Windows it also
  canonicalizes `Path`/`PATH` so Pi's nested shell keeps the injected entries.
- `src/workspaces/adapters/pi.ts` launches the npm runtime as
  `[managedPiNodePath, managedPiPath, ...args]` and writes the managed shell
  path into `.pi-agent/settings.json` during Windows Workspace bootstrap.

The managed npm runtime is not added to `PATH` as a fake `pi` binary; the Pi
adapter owns its explicit launch command. User-installed standalone Pi still
uses the normal `pi` command path.

Pi project trust follows the runtime boundary:

- interactive sessions never receive `--approve`; Pi shows its trust prompt
  and the user makes the project-resource decision;
- packaged headless sessions pass `--approve` because no user is present and
  OpenAlice controls the pinned managed Pi and Workspace contents;
- source/dev headless sessions do not receive version-specific approval flags.
  The Pi executable on `PATH`, its version, and its upgrade policy belong to
  the contributor running `pnpm dev`.

Do not add external-Pi version probing or upgrade UX to preserve flags used by
the packaged runtime. Compatibility for the packaged app is maintained by
pinning and upgrading the bundled Pi with the OpenAlice release.

### Pi and OpenCode context limits

Workspace provider overrides write the model context limit into both runtime
formats: `provider.models.<id>.limit.context` for OpenCode and
`providers.workspace.models[].contextWindow` for Pi. Unknown custom and local
models default to **256K**, not 1M. Larger values remain explicit user choices;
the provider connection probe cannot prove that a local backend has enough
memory for a future long prefill.

The Workspace config file is the source of truth for this model-specific
choice. Re-selecting the same vault credential and model must preserve the
existing Workspace context limit. Selecting a different credential or model
starts from the conservative default instead of carrying an unrelated 1M
setting across providers.

Pi and OpenCode load provider state at process startup. Saving a new context
limit does not resize a running process: the UI must name affected running
Sessions and tell the user to pause and resume them. WebPi follows new output
only while the reader is already near the transcript tail; polling, retries,
and streaming updates must never steal the scroll position from someone
reading older messages.

### Codex interactive permissions

OpenAlice launches interactive Codex TUI sessions with explicit
`--sandbox danger-full-access --ask-for-approval never` arguments. This applies
to fresh sessions, Quick Chat prompts, and resumed sessions. Launch-time flags
are intentional: otherwise Codex may inherit a restrictive global or project
default, silently sandbox the session, and prevent the injected `alice`,
`alice-workspace`, `alice-uta`, and `traderhub` CLIs from reaching their local
OpenAlice transport.

Headless Codex remains narrower: it uses `approval_policy=never`, a
workspace-write sandbox, and explicit loopback network access. That is enough
for unattended Workspace CLI work without granting an automation run unrelated
host access. Neither policy bypasses OpenAlice's trading boundary; broker writes
and their approval rules remain enforced by UTA.

## Workspace Bootstrap and Skills

Built-in templates run `bootstrap.mjs` on Electron's Node using
`ELECTRON_RUN_AS_NODE=1`. Their Git operations go through `_common.mjs` and
dugite; on packaged Windows, `LOCAL_GIT_DIRECTORY` points those calls at the
managed PortableGit directory.

Do not add new Bash bootstraps for built-in templates. `bootstrap.sh` remains
a compatibility fallback for third-party templates and only works where a
POSIX shell exists.

OpenAlice copies Workspace skills into two canonical project paths:

- `.claude/skills/` for Claude Code;
- `.agents/skills/` for Codex, current Pi, and compatible shared-skill readers.

Pi's provider state lives separately under `.pi-agent/`. Do not restore a
duplicate `.pi/skills/` copy: current Pi discovers the shared
`.agents/skills/` tree from the Workspace working directory.

## Packaging Invariants

Keep these true together:

- `vendor/**` remains in the Electron builder file list.
- `asar` remains disabled while packaged scripts and binaries are executed
  from the resource tree.
- `dugite` remains in `pnpm.onlyBuiltDependencies` until its embedded payload
  is deliberately removed; skipping its postinstall silently produces an
  incomplete package.
- Pi and PortableGit versions, download URLs, and checksums remain pinned in
  `scripts/vendor-managed-runtime.mjs`.
- Managed `fd` and `ripgrep` versions, release URLs, checksums, binaries, and
  license files remain pinned together in `scripts/vendor-managed-runtime.mjs`.
- Pi remains network-capable. The managed search tools prevent its normal
  startup probe from downloading a separate copy into each redirected
  `PI_CODING_AGENT_DIR`; they do not force `PI_OFFLINE` or patch Pi itself.
- Every packaged Workspace CLI includes the shared `openalice-cli.cjs` payload,
  its POSIX launcher, and its Windows `.cmd` twin; packaged smoke must execute
  the payload through Electron Node.
- A runtime version bump updates its assertions and packaged smoke coverage in
  the same change.
- Windows keeps a single case-insensitive `PATH` entry after Workspace env
  construction.

## Verification

### Workspace acceptance contract

`pnpm electron:smoke:workspace` is the release-facing definition of an
actually usable packaged Workspace. It runs against isolated temporary data
and a deterministic local OpenAI-compatible provider; it never reads a real
API key or depends on external model availability.

The smoke creates one real Chat Workspace and proves both layers of the product
contract:

1. A shell Session, reached through the Electron preload PTY bridge, receives
   the production-composed Workspace environment. It resolves `alice`,
   `alice-workspace`, `traderhub`, and `alice-uta`, loads every CLI manifest over
   the Electron tool socket, verifies Git, and creates then reads an issue with
   the real `alice-workspace` shim.
2. The packaged managed Pi runtime performs a deterministic `bash` tool call
   that invokes `alice-workspace issue create`. The smoke accepts the run only
   when structured assistant output is decoded and the created issue is visible
   from the external `/api/issues` surface.

The second assertion deliberately uses an observable Workspace side effect,
not a model claiming that a command succeeded. The run emits a versioned JSON
receipt whose individual checks make PATH, injection, CLI transport, runtime
output, tool use, and cleanup failures distinguishable. The Desktop Package
Smoke matrix preserves these receipts as CI artifacts. Release candidates run
the same acceptance on all three platform/architecture builds before any tag or
GitHub Release is created; only accepted installers are then published.

Do not replace the actual shims with direct tool-function calls in this smoke:
that would stop covering argv parsing, manifest discovery, managed Node,
Workspace identity headers, and the Electron-only socket transport.

For runtime or packaging changes, run the focused local tests first:

```bash
pnpm vitest run \
  src/core/runtime-profile.spec.ts \
  src/workspaces/agent-detect.spec.ts \
  src/workspaces/spawn-env.spec.ts \
  src/workspaces/adapters/ai-config.spec.ts \
  scripts/vendor-managed-runtime.spec.ts \
  scripts/assert-desktop-package.spec.ts \
  scripts/smoke-packaged-toolchain.spec.ts
```

Then exercise the packaged path:

```bash
pnpm electron:smoke:workspace
```

That command is the standard local acceptance path. It builds and vendors the
runtime, packages into a unique owner directory under the OS temp directory,
launches the packaged Workspace acceptance, waits for every child to exit, and
then removes both isolated data and the expanded app. Cleanup uses bounded
retries for Windows `EBUSY`, `EPERM`, and `ENOTEMPTY` release races. A cleanup
failure is reported as a smoke failure instead of silently leaking a large
directory.

Package artifact ownership is explicit:

- A package-producing smoke owns its unique temporary directory and cleans it.
- `--keep-package` preserves that temporary package and prints its path.
- `--skip-pack` reuses an external package and never deletes it. With no
  `--package-root`, the compatibility default is `dist/electron-app`.
- `--package-root <path>` requires `--skip-pack`; it lets assertions and smokes
  target a caller-owned output without transferring ownership.
- `pnpm electron:pack` and CI/release builders intentionally keep using
  `dist/electron-app`, because installers and update metadata are consumed by
  later release steps.

When a persistent package is required for focused inspection or CI, use the
explicit multi-step flow:

```bash
pnpm electron:pack
pnpm electron:assert-package
pnpm electron:smoke-toolchain
pnpm electron:smoke:workspace --skip-build --skip-pack
```

An alternate persistent output can be checked with
`pnpm electron:assert-package -- --package-root <path>` and
`pnpm electron:smoke-toolchain -- --package-root <path>`.

On Windows, the standard `electron-builder` step rebuilds native dependencies
such as `node-pty` and therefore requires Visual Studio Build Tools with the
C++ desktop workload. This is a source-build prerequisite only; users running
the produced OpenAlice installer do not need Visual Studio.

The `Desktop Package Smoke` workflow runs native Apple Silicon, Intel macOS,
and Windows package jobs. macOS release builds remain separate rather than
universal so native dependencies are installed, built, signed, and notarized
on their matching architecture. Apple Silicon uses the canonical
`latest-mac.yml` update feed; Intel uses `latest-mac-intel.yml` with the
electron-updater compatibility alias `latest-intel-mac.yml`.

A release-facing change should also verify a clean-machine flow:

1. launch the packaged app with no system Node, Git, Bash, or Pi assumption;
2. add one compatible AI credential;
3. create a Chat Workspace using Pi;
4. run `alice --help`, edit a file, and inspect `git status`;
5. verify paths containing spaces and non-ASCII characters;
6. switch Windows between Auto and Custom, restart the backend, and confirm
   the Workspace terminal and Pi use the same persisted `bash.exe`;
7. move a configured custom `bash.exe` and confirm the invalid setting is
   reported instead of silently falling back to Auto.

## Known Follow-up

PortableGit and dugite's embedded Git are still duplicated on Windows. The
next cleanup is to introduce an OpenAlice-owned Git execution wrapper, migrate
Workspace/template call sites to it, and remove dugite only after macOS and
Windows packaged smokes remain green.

That cleanup must not weaken the first-run contract: install OpenAlice,
configure a credential, open a Workspace, and let Alice work.
