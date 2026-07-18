# Managed Workspace Runtime

This guide owns the packaged-desktop runtime contract for Workspace agents.
Read it before changing desktop packaging, agent discovery, Pi launch behavior,
the Windows shell/toolchain, or the `OPENALICE_MANAGED_*` environment keys.

Related guides: [[docs/project-structure.md]],
[[docs/model-semantics-and-runtime-injection.md]], and
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

Plain `pnpm dev` and Docker installs are different deployment shapes. They do
not inherit the packaged desktop's managed-agent promise and may require an
agent CLI in the host environment or image. The curl-installed CLI is a third
shape: it installs the same pinned Pi version under the OpenAlice install root
and injects `OPENALICE_MANAGED_PI_*` when it starts a source-backed Runtime. It
still relies on host Node/npm and does not inherit Electron's managed
Git/Bash/search-tool payload.

### AI credential setup contract

**Settings → AI Provider** is an account-to-runtime setup flow, not a generic
bag of provider fields. The form must make these decisions explicit before a
key can be saved:

1. which provider account issued the API key (subscription logins remain in the
   native Claude Code or Codex CLI);
2. which region or endpoint owns that key;
3. which Workspace Agent runtimes can consume the endpoint's declared API
   protocol;
4. which exact model ID to test and remember as the credential default; and
5. whether that exact key + endpoint + protocol + model combination passes a
   live connection probe.

Provider presets own provider-specific key, region, and model guidance. Runtime
compatibility is derived from the preset's wire map rather than duplicated as
editorial copy. Protocol names and raw endpoints belong behind an advanced
detail unless the user chose **Custom**, where protocol and base URL are
required inputs. The managed credential path is key-bearing; keyless local
servers and subscription auth stay in the native CLI's own configuration.

Google Gemini credentials use the native `google-generative-ai` wire in Pi and
the native Google provider in opencode. Google AI Studio now creates `AQ.`
authorization keys by default; these and legacy `AIza` keys are sent as
`x-goog-api-key`. Do not route the built-in Gemini preset through Google's
OpenAI-compatibility endpoint, whose Bearer authentication does not reliably
accept authorization keys. The credential probe must use the same native wire
as the Workspace runtime and fail with an actionable timeout instead of leaving
the form indefinitely in Testing state.

A stored credential may declare more than one wire for the same key. Pi and
opencode can consume native Google, Anthropic Messages, OpenAI Chat
Completions, or OpenAI Responses; the per-Workspace editor must therefore let
the user choose the protocol explicitly and write the matching Pi `api` or
opencode `@ai-sdk/*` provider. Anthropic-wire credentials also carry their
header mode through those adapters: first-party Anthropic uses `x-api-key`,
while confirmed gateway endpoints can use `Authorization: Bearer` without also
emitting a conflicting API-key header. Old Workspace defaults without an
explicit protocol keep the runtime preference order for backward compatibility.

**Settings → AI Provider → Default Workspace credentials** owns creation-time
defaults only: per-agent credential, optional protocol, and the opencode/Pi
context limit. The context default is 256K so users do not cross common
higher-price tiers implicitly. Changing these settings never rewrites an
existing Workspace; that Workspace's settings modal remains the explicit
override surface.

Credential access and model semantics are separate inputs. Known model ids
resolve reasoning behavior and advertised limits from the offline registry;
the injector caps the selected context policy at the model maximum and leaves
effort to the native runtime. Only unknown/free-typed models expose an advanced
reasoning override, and creation defaults bind that assertion to the exact
model id so it cannot leak across a later model change. Follow
[[docs/model-semantics-and-runtime-injection.md]] for the full contract.

Quick Chat must summarize the launch configuration behind its credential pill:
the effective model ID and every context limit actually declared by the native
project config are visible before Send. For an existing Workspace these values
come from its CLI-native config; selecting a different Pi/opencode credential
previews the model that credential will inject and the global context default.
Claude Code and Codex Workspace overrides show their model but omit context
because those native project files do not declare one. The adjacent adjustment
action opens that Workspace's AI injector for all four runtimes, and falls back
to AI Provider settings before the first Workspace has been created. Saving the
Workspace modal refreshes this summary without requiring a page reload.
Their default remains the CLI's own global login and configuration: Alice never
chooses the first compatible vault credential simply because one exists. Only
an explicit Workspace binding or creation default opts into injection.

Claude Code can place global onboarding and per-project trust screens before an
interactive seeded prompt even after the same Workspace passes a headless
provider probe. Its current CLI exposes authentication status but no supported
status/accept command for these two gates. OpenAlice therefore reads only the
existing completion booleans in Claude's native state and displays an advisory
before launch. It never writes those booleans, substitutes a private config
directory, or treats the advisory as a provider-readiness failure. An unknown
or changed native state shape fails open and leaves Claude in control.

Provider model catalogs are curated suggestions, not allowlists. Keep the
free-text model field so a newly released or project-specific model remains
usable before OpenAlice updates its catalog. Gemini suggestions should contain
general-purpose text/tool models only; image, Live, TTS, embedding, and managed
agent model IDs are different product surfaces and do not belong in Quick Chat.

Keep subscription-backed CLI profiles distinct from API-key credentials.
Claude Code subscription profiles should prefer its native aliases (`default`,
`best`, `opus`, `sonnet`, `haiku`, and `opusplan`) so the CLI and account tier
resolve current availability; Anthropic API credentials should suggest exact
API model IDs. Codex subscription and OpenAI API catalogs may share a model
family only when official documentation confirms both surfaces support it.

Editing must round-trip the stored `lastModel` and any endpoint that no longer
matches a current preset. A catalog refresh must never silently replace either
value merely because the user opened and saved the form.

Credential actions and the default-credential selectors must remain reachable
without horizontal scrolling at the mobile shell breakpoint. In particular,
long slugs, endpoint text, and runtime badges may wrap or truncate, but must not
force Add, Edit, Delete, or selection controls outside the viewport.

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

The Windows package retains dugite's JavaScript execution wrapper but excludes
its embedded Git payload. `LOCAL_GIT_DIRECTORY` routes every dugite call to the
same pinned PortableGit tree that supplies Workspace Bash. macOS continues to
ship dugite's embedded Git because its packaged path does not need a separate
managed Unix shell payload.

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
the Workspace's `.pi/settings.json`. This also backfills existing
Workspaces created before the global preference existed, while preserving all
other Pi-owned project settings. OpenAlice records the prior value so reset can
restore it. The Pi file is a derived compatibility cache; the machine-local
preference remains the source of truth.

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
  path into `.pi/settings.json` during Windows Workspace bootstrap.

The packaged Electron managed npm runtime is not added to `PATH` as a fake
`pi` binary; the Pi adapter owns its explicit launch command. The curl
installer additionally creates `<install-root>/bin/pi` as a direct launcher to
the same immutable managed runtime while the `openalice` launcher still uses
the explicit env contract. User-installed standalone Pi in plain source/dev
continues to use the normal `pi` command path.

Pi project trust follows the runtime boundary:

- before TUI or WebPi startup, the Pi adapter records a genuinely undecided
  OpenAlice-managed Workspace in the trust store used by that Pi process. This
  prevents a fresh Quick Chat from stalling behind a terminal-only trust
  selector that WebPi cannot render;
- an explicit saved allow or deny decision on the Workspace or its nearest
  parent remains authoritative. OpenAlice never flips that decision;
- interactive argv does not receive the version-sensitive `--approve` flag.
  External Pi 0.78.x therefore remains launch-compatible while Pi 0.79+ reads
  its normal `trust.json` state;
- packaged headless sessions pass `--approve` because no user is present and
  OpenAlice controls the pinned managed Pi and Workspace contents;
- plain `pnpm dev` headless sessions do not receive version-specific approval
  flags. The Pi executable on `PATH`, its version, and its upgrade policy
  belong to the contributor. A curl-installed CLI Runtime has an explicit
  managed Pi path and therefore follows the pinned managed approval contract.

Do not add external-Pi version probing or upgrade UX to preserve flags used by
the packaged runtime. Compatibility for the packaged app is maintained by
pinning and upgrading the bundled Pi with the OpenAlice release.

OpenAlice always updates trust in Pi's normal user agent directory (or an
explicit user-provided `PI_CODING_AGENT_DIR`). Provider overrides do not change
that directory: OpenAlice adds a namespaced provider to its `models.json` and
uses the native Workspace `.pi/settings.json` layer to select it. This keeps
Pi's global settings, packages, auth, resources, trust, and sessions visible.
An old Workspace `.pi-agent/` tree is migrated into this native layout before
launch and removed only after its configuration and session data are preserved.

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

Pi's provider definition lives in its normal user `models.json`; the Workspace
stores only provider/model selection and OpenAlice rollback metadata under
`.pi/`. Do not restore a duplicate `.pi/skills/` copy: current Pi discovers the
shared `.agents/skills/` tree from the Workspace working directory.

Provider injection into shared native JSON config is node-owned, not
file-owned. Claude Code's `.claude/settings.local.json` and opencode's
`opencode.json` preserve unknown/user keys and use their adjacent OpenAlice
rollback sidecars for conflict-aware reset. Keep all native provider config and
rollback paths in `_common.mjs`'s local git excludes.

## Packaging Invariants

Keep these true together:

- `vendor/**` remains in the Electron builder file list.
- `asar` remains disabled while packaged scripts and binaries are executed
  from the resource tree.
- `dugite` remains in `pnpm.onlyBuiltDependencies` because macOS packages use
  its embedded Git. The Windows builder excludes `node_modules/dugite/git/**`,
  keeps the JS wrapper, and must route it through managed PortableGit.
- Pi and PortableGit versions, download URLs, and checksums remain pinned in
  `scripts/vendor-managed-runtime.mjs`.
- Managed `fd` and `ripgrep` versions, release URLs, checksums, binaries, and
  license files remain pinned together in `scripts/vendor-managed-runtime.mjs`.
- Pi remains network-capable. The managed search tools prevent its normal
  startup probe from downloading redundant copies into its user agent
  directory; they do not force `PI_OFFLINE` or patch Pi itself.
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

The focused Windows toolchain smoke additionally loads the packaged dugite JS
wrapper with no embedded dugite Git present, then performs a real
`init`/`add`/`commit`/`status` cycle through managed PortableGit.

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

OpenAlice still imports dugite directly at several Workspace and template call
sites. A future OpenAlice-owned Git execution wrapper can centralize timeouts,
errors, and environment policy and eventually replace the dugite dependency.
That refactor is no longer required to keep duplicate Git binaries out of the
Windows package.

That cleanup must not weaken the first-run contract: install OpenAlice,
configure a credential, open a Workspace, and let Alice work.
