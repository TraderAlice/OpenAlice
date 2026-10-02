# Managed Workspace Runtime

This guide owns the packaged-desktop runtime contract for Workspace agents.
Read it before changing desktop packaging, agent discovery, Pi launch behavior,
the Windows shell/toolchain, or the `OPENALICE_MANAGED_*` environment keys.

Related guides: [[docs/project-structure.md]],
[[docs/model-semantics-and-runtime-injection.md]], and
[[docs/development-workflow.md]].

## Update readiness and acceptance

[[docs/update-lifecycle.md]] owns coordinated update semantics. Electron keeps
its native installer and local `userData/update-operations/` receipt; the relay
or desktop control plane persists a composed plan under `update-control/`.
A native handoff is complete only when the exact approved app version starts,
the renderer is ready, and the required integrated Alice service reports that
version. A separated client verifies its local shell; backend readiness belongs
to the selected Runtime. No Workspace Agent or Studio is started for this check.

`electron:smoke:workspace` seeds a durable native handoff, then starts a new
unsigned packaged process and checks real readiness through preload. It also
checks the shared Skills inventory. `scripts/desktop-startup-smoke.mjs` accepts
`--app-path <executable> --connected-home <disposable-running-project>` to prove
packaged separated client/backend identity without taking local project ownership.
It uses the shipped version endpoint so a previous release need not implement the
current update-inventory API; integrated Workspace acceptance checks that inventory. Native
signature/notarization and Windows installer replacement remain release gates.

## Product Contract

A packaged OpenAlice install must be able to open a Workspace on a fresh
supported machine without asking the user to install Node, npm, Git, Bash, or
an agent CLI first.

The default packaged path is:

1. OpenAlice supplies a managed Pi runtime.
2. The user configures an API-key credential in **Settings → AI Provider**.
3. The Workspace records that secret-free credential reference, model, and
   effort preference in `.alice/settings.json`.
4. OpenAlice resolves the secret just in time and projects it into each Pi
   process; Pi starts with the OpenAlice CLIs and shared skills available.

The runtime and the model credential are separate requirements. Bundling Pi
removes the CLI/toolchain prerequisite; it does not bundle a model account or
API key. User-installed Claude Code, Codex, opencode, or Pi remain supported as
additional runtimes and may use their own subscription login or local config.

Source development and the native CLI do not inherit the packaged desktop's
managed-agent promise. They use separately installed Agent CLIs. The direct
installer supplies a native OpenAlice Runtime, not a host Node/npm dependency
or an installer-owned Pi launcher; it clears desktop-managed Pi variables.
Electron's managed Pi/Git/Bash/search-tool payload remains a separate boundary.
See [[docs/cli-installer.md]] for native installation and
[[docs/local-runtime.md]] for source-backed launch.

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

**Settings → AI Provider → Default Workspace credentials** is a deprecated
installation-level creation seed. New Workspaces translate it into secret-free
runtime preferences; changing it never rewrites an existing Workspace. Normal
users choose native auth or a vault credential on the launch surface, and the
accepted choice becomes that Workspace's recent preference.

Credential access and model semantics are separate inputs. Known model ids
resolve reasoning behavior and advertised limits from the offline registry;
the Session binding resolver caps the selected context policy at the model
maximum and leaves effort to the native runtime. Only unknown/free-typed models expose an advanced
reasoning override, and creation defaults bind that assertion to the exact
model id so it cannot leak across a later model change. Follow
[[docs/model-semantics-and-runtime-injection.md]] for the full contract.

Quick Chat summarizes the exact pending binding behind its credential/model
controls. For an existing Workspace these values come from its interactive
recent preference in `.alice/settings.json`; selecting another credential,
model, or effort updates the file only after the fresh Session is accepted for
launch. Native auth is always a valid explicit choice, including for Pi and
opencode when the user has configured them globally. Native project config
export remains available only under the deprecated compatibility section.

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

The desktop uses the Supervisor's shared Machine/AliceProject Default.
An unavailable or unresolved Default opens the startup chooser without
silently selecting another home or acquiring its Guardian lock. The chooser
can explicitly create or start a registered project. Successful attachment is
verified and presented before the shared Default is saved; it is not an
independent Electron Recent setting.

The old Electron data-location preference is migration input only.
`OPENALICE_HOME` remains an explicit invocation override. Follow
[[docs/alice-project.md]] and [[docs/data-locations.md]] for Default selection,
environment precedence, and concurrent-project isolation.

`pnpm electron:smoke:startup` validates unresolved and unavailable Default
startup against the built desktop bundle. Pass `--app-path <packaged executable>`
to exercise the unsigned package. The cases isolate Supervisor, project state,
and Electron profile, verify the client-only boundary without adopting an
unrelated Runtime, then stop the private process group and remove test state.
`pnpm electron:smoke:credential-pi` is **credential + native Pi execution
acceptance** inside an already selected project. It waits for Chat Workspace
preparation, checks an empty vault and missing native login, then drives the real
Settings → AI Provider UI through Add, a rejected key, a successful HTTP Test
against a local deterministic provider, and Save. It reads back the credential,
sets the Workspace's interactive/headless executor binding through
`PUT /api/workspaces/:id/runtime-settings`, requires `ready/launcher-vault`, and
calls `POST /api/workspaces/:id/headless` for a separate native Pi reply. Terminal
readiness failure or exit zero without the expected reply fails acceptance.
The mock also requires observed credential-test and native reply requests.

This is not the retired onboarding wizard or complete cold-start acceptance.
Explicit `OPENALICE_HOME` bypasses the Machine/AliceProject launcher; the startup
smoke above owns that boundary. Executor selection uses a test API, not its UI,
and the native reply does not exercise the browser Chat composer.

`electron:smoke:onboarding` / `--onboarding` remain deprecated aliases that warn
and run the same gate. Use `--credential-pi` for direct runner invocation.
Shared `OPENALICE_ONBOARDING_*` / `VITE_OPENALICE_ONBOARDING_*` fixture variables
and the deterministic model ID retain their existing names for dev compatibility;
they do not expand this gate's scope. The unsigned Linux path does not certify
macOS/Windows packaging, signing or notarization.

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

A minimal Windows GUI `PATH` is also augmented with existing per-user Bun, npm,
pnpm, WinGet-link, and registered native-agent directories before `/agents`
probes and child-process launches. `OPENALICE_EXTRA_AGENT_PATH` remains
available for non-standard installs. Inventory stays a filesystem lookup;
runnability is still the separate credential/model readiness probe.

User-installed npm Agent runtimes are resolved without evaluating task prompts
as command text. Native `.exe`/`.com` binaries run directly; recognizable
npm/pnpm `.cmd` shims are reduced to their JavaScript entrypoint and run on the
current Node executable. Other batch shims may use their same-directory
extensionless POSIX sibling through the resolved Workspace Bash, with the
prompt retained as a separate argv item and `shell: false`. A batch-only shim
has no safe unattended fallback and is rejected with
`unsupported_windows_batch_shim`; only fixed launcher-owned readiness probes
retain the legacy `cmd.exe` compatibility path.

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
builder enables `asar`. JavaScript entrypoints (desktop, Alice, UTA and
Connector) and ordinary dependencies live in `app.asar`; backend children use
Electron's `ELECTRON_RUN_AS_NODE=1` support to load that archive.

`extraResources` copies vendor, Workspace CLI/templates, default assets and UI
assets to the physical `Resources/runtime` directory (`resources/runtime` on
Windows). `OPENALICE_APP_HOME` points there so external shells, bootstrap
scripts and managed tools always receive real filesystem paths. Code paths
remain relative to the archive; do not derive a backend entrypoint from
`OPENALICE_APP_HOME`.

The `afterPack` hook projects the archive's product name/version/module type
into `runtime/package.json`. It cannot be listed as an extraResource from the
root package.json: electron-builder excludes extraResource inputs from ASAR,
which would remove Electron's own application metadata. Packaging commands run
through `pnpm -F @traderalice/desktop` (the configured hook is relative to that
working directory).

Windows installed-version polling reads the authoritative `app.asar/package.json`
when an archive exists, and the loose `app/package.json` for older releases.
Clear the ASAR header cache between polls because NSIS replaces the archive in
place. A partial archive must remain retryable rather than falling back to a
stale loose manifest. Final installer completion and version detection remain
separate checks before the upgrade journey launches the candidate.

`asarUnpack` explicitly retains node-pty and dugite's embedded Git under
`app.asar.unpacked`, with other native dependencies handled by builder's
native-module detection. The package assertion verifies archive contents,
physical native files, runtime resources and matching product versions.
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
- `CliAdapter.lifecycle.prepareWorkspace` is the common, idempotent runtime
  preparation hook. Workspace creation and every real TUI, Web, headless,
  readiness, or probe launch use the same hook instead of inventing
  surface-specific adapter setup.
- `src/workspaces/adapters/pi.ts` launches the npm runtime as
  `[managedPiNodePath, managedPiPath, ...args]`; its lifecycle implementation
  reconciles trust, legacy config, the managed Windows shell, and the native Pi
  automatic theme pair.

The headless runner records `processStarted` only after Node emits `spawn`.
Failures before that event retain a typed `launchErrorCode`, a human-readable
`error`, and a bounded stderr diagnostic. Structured launcher logs record the
Workspace, run, Agent, launch mode, failure code, and OS error code without
including the prompt, complete argv, credentials, or environment values.

The packaged Electron managed npm runtime is not added to `PATH` as a fake
`pi` binary; the Pi adapter owns its explicit launch command. Source development
and the native CLI use the user's standalone Pi on its normal command path.
The current direct installer does not create `<install-root>/bin/pi` and removes
validated legacy managed-Pi launchers during cutover.

### Workspace launch-plan disclosure

**Workspace Settings → Launch** is the read-only explanation surface for the
next fresh interactive Session. It calls the same spawn composer used by the
PTY pool, then shows:

- the adapter-composed argv and the platform-resolved process argv when they
  differ;
- the resolved runtime path and direct/node-shim/bash-shim/cmd-shim mode;
- cwd, transcript discovery, and adapter capabilities; and
- only launcher-controlled environment contributions, grouped by terminal,
  Workspace, toolchain, and adapter ownership.

The Shell utility is always present in this surface alongside the registered
agent runtimes. Its plan uses the same launcher-built base environment and cwd
as coding agents, so the injected `alice*` and `traderhub` CLI path and local
tool transport remain visible. Shell does not receive an AI provider credential
or another runtime's adapter-specific environment.

Reading a launch plan never runs `prepareWorkspace`, writes native runtime
configuration, or starts a process. The response omits inherited host
environment values. Secret-like command arguments and environment values are
redacted before crossing the API boundary; local tool transports are reported
only as configured, and `PATH` is summarized by entry count. Keep this policy
aligned with the structured-log rule above: launch-plan UI access does not
authorize complete argv, prompts, credentials, or environment values in logs.

Pi project trust follows the runtime boundary:

- before TUI or Web startup, the Pi adapter records a genuinely undecided
  OpenAlice-managed Workspace in the trust store used by that Pi process. This
  prevents a fresh Quick Chat from stalling behind a terminal-only trust
  selector that the Web surface cannot render;
- an explicit saved allow or deny decision on the Workspace or its nearest
  parent remains authoritative. OpenAlice never flips that decision;
- interactive argv does not receive the version-sensitive `--approve` flag.
  External Pi 0.78.x therefore remains launch-compatible while Pi 0.79+ reads
  its normal `trust.json` state;
- packaged headless sessions pass `--approve` because no user is present and
  OpenAlice controls the pinned managed Pi and Workspace contents;
- source-development and native-CLI headless sessions do not receive
  version-specific approval flags for an external Pi. Its version and upgrade
  policy belong to the user; the packaged desktop's pinned managed runtime
  remains the managed approval boundary.

Pi terminal appearance follows the same boundary used by Orca:

- when a Workspace has no explicit Pi project theme, runtime preparation writes
  Pi's built-in `light/dark` automatic pair to `.pi/settings.json`;
- a Pi project theme already present in that file is user-owned and remains
  unchanged on later launches;
- OpenAlice supplies the terminal palette and light/dark facts through xterm,
  OSC/DSR queries, and mode 2031. Pi remains responsible for its own TUI theme;
  OpenAlice does not generate or inject palette-specific Pi themes.

Codex and OpenCode use that terminal boundary differently:

- Codex natively probes OSC 10/11 at startup and derives its contrast-sensitive
  TUI colors from the reported foreground and background. It needs no project
  theme injection; OpenAlice's shared visible/headless terminal responders are
  the complete Orca-aligned integration. Codex does not currently consume mode
  2031 palette updates after startup, so relaunch a running Codex TUI after
  switching between light and dark appearances.
- OpenCode can consume the same terminal palette and mode 2031 updates, but its
  native default is the fixed `opencode` theme. When a Workspace has no native
  TUI config or legacy explicit theme, runtime preparation writes
  `{ "theme": "system" }` to the dedicated `tui.json` project layer.
- Existing `tui.json`, `tui.jsonc`, and legacy project theme choices remain
  user-owned. OpenAlice does not generate an OpenCode palette or mix TUI
  settings into the provider-owned `opencode.json` surface.

Do not add external-Pi version probing or upgrade UX to preserve flags used by
the packaged runtime. Compatibility for the packaged app is maintained by
pinning and upgrading the bundled Pi with the OpenAlice release.

Source development and user-installed Pi update trust in Pi's normal user
agent directory (or an explicit user-provided `PI_CODING_AGENT_DIR`). Provider
overrides do not change or write that directory: a generic managed extension
under the Workspace's `.pi/extensions/` registers the local provider, and the
native Workspace `.pi/settings.json` layer selects it. This keeps the user's
global models, settings, packages, auth, resources, trust, and sessions visible.

An explicitly supplied managed-Pi launch environment is a separate boundary.
The common local-Runtime environment builder can project its Pi settings,
trust, resources, and sessions beneath the selected complete home before
Guardian starts. This conditional support does not mean the native installer
bundles Pi: native standalone startup clears desktop-managed Pi variables.
Do not revive the retired `start` command to select a launch environment.

An old Workspace `.pi-agent/` tree is migrated into the applicable native
agent-directory layout before launch and removed only after its configuration
and session data are preserved.

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
`ELECTRON_RUN_AS_NODE=1`. The packaged backend re-enters its archived Alice
entrypoint with `--openalice-internal-bootstrap` and injects the launcher-owned
Git executor before importing the physical template. This shares the existing
Bun bootstrap role and avoids dependency lookup from the external resource
tree. Source/dev Node bootstraps keep their direct script invocation. Their
Git operations go through `_common.mjs` and dugite; on packaged Windows, `LOCAL_GIT_DIRECTORY` points those calls at the
managed PortableGit directory.

Do not add new Bash bootstraps for built-in templates. `bootstrap.sh` remains
a compatibility fallback for third-party templates and only works where a
POSIX shell exists.

A source-backed Harness receives only repository, release/snapshot, and exact commit
values approved by its template catalog. AutoQuant V2 and Auto Prediction verify that tuple,
copies the repository, keeps its upstream ancestry and canonical `origin`,
starts a local research branch at the approved commit, and writes
`.alice/harness-source.json`. Bootstrap does not install Harness dependencies;
the native Coding Agent owns environment setup, later research commits, and
explicit fetch/merge upgrades inside the Workspace. When a pinned source
declares a v1 Studio capability, Alice may launch it with allocator-owned
loopback ports. Electron integrated mode keeps its main UI on `app://` and uses
the restricted streaming Surface Gateway described in
[[docs/harness-web-surfaces.md]]; it does not re-enable the ordinary Alice web
listener. Separated mode instead loads the local relay's HTTP UI and connects
to the selected backend through that relay.

OpenAlice copies Workspace skills into two canonical project paths:

- `.claude/skills/` for Claude Code;
- `.agents/skills/` for Codex, current Pi, and compatible shared-skill readers.

Pi's provider definition and reversible ownership state live in the sensitive
Workspace-local `.pi/openalice-provider.json`. The generic managed
`.pi/extensions/openalice-provider.ts` registers it in-process, while project
settings store provider/model selection and the automatic terminal theme
default. Both managed files are excluded from git. Do not restore a duplicate
`.pi/skills/` copy: current Pi discovers the shared `.agents/skills/` tree from
the Workspace working directory.

The deprecated provider export into shared native JSON config is node-owned,
not file-owned. Claude Code's `.claude/settings.local.json` and opencode's
`opencode.json` preserve unknown/user keys and use their adjacent OpenAlice
rollback sidecars for conflict-aware reset. Keep all native provider config and
rollback paths, plus OpenCode's generated `tui.json`, in `_common.mjs`'s local
git excludes. Alice never reads this export to resolve a fresh managed binding
or readiness probe. A native CLI can still discover a retained project file
through its own config precedence, which is why the compatibility UI is explicit
and warns before writing it.

## Packaging Invariants

### Version and update surface

**Settings → General → About OpenAlice** is the user-facing source for the
running version, normalized channel, and update owner on every distribution
surface. The backend derives that state from installed provenance and the
runtime profile rather than guessing from package semver. A source checkout
uses Git, packaged Electron uses its native updater, a directly installed
  stable or beta CLI uses `openalice update` as its entry point (with that command
  handing package-manager installs back to their manager), and Docker remains
  owned by its service deployment. Pinned and custom installs have no
implicit updater.
Invalid installed provenance fails closed as custom/non-updating instead of
silently falling back to a stable package version.

The passive read uses `GET /api/version`. An explicit **Check for updates**
uses the authenticated `POST /api/version/check` route to bypass the
application cache, but neither route crosses the running surface's authority.
Stable and beta source, desktop, or CLI contexts may read their matching
OpenAlice CDN manifest. Dev identity is the complete native payload identity,
not its reused package version, so the Web surface does not duplicate the
native CLI or deployment selector. Service-managed, dev, pinned, and custom
contexts therefore make no Web manifest request and never render a Git or CLI
update instruction that their owner cannot apply. GitHub remains the immutable
release-asset and release-notes host rather than the runtime discovery API.

Packaged Electron also invokes the existing `electron-updater` check through
the narrow preload bridge. That check starts the native download path when an
eligible release exists; download progress and the ready-to-restart action are
projected into the same Settings card. Electron development and unsigned
directory packages may not have updater metadata, so the native check reports
that it is unsupported without transferring authority to the Web route. The
top-level update banner and downloaded-update prompt remain secondary
notifications over the same backend and updater state.

The update UI must distinguish determinate download progress from the native
installer handoff. Before closing, the old app reports `preparing`,
`stopping-services`, `releasing-runtime`, and `handing-off` stages, releases
the Guardian runtime lock, and emits a native notification that OpenAlice may
remain closed for up to a minute. Do not invent an install percentage: the
platform installer does not expose one to the old Electron process.

Before the handoff, Electron atomically records
`openalice-update-attempt.json` in its machine-local `userData` directory. The
approved target version clears that marker on first launch, using the shared
release-evidence verifier. A different unapproved version archives the marker
as failed rather than claiming a successful update. If the initiating version is
still running after the bounded installer window, the marker is archived as
`.failed` and a native error names the target version and desktop diagnostic
log. This marker is updater evidence, not user-owned OpenAlice state, and does
not belong under `OPENALICE_HOME`.

Alice startup stderr is tee'd to the terminal and the bounded `desktop.log`
under Electron's platform log directory. If Alice exits before the renderer is
ready—or later exits unexpectedly—the desktop shows a native error with the
last diagnostic lines and log path before cascading shutdown. A failed local
backend must never present as an unexplained desktop flash-and-exit.

Keep these true together:

- `vendor/**` and external Workspace assets remain in `extraResources`.
- `asar` stays enabled; `OPENALICE_APP_HOME` is the physical runtime tree.
  Code entrypoints stay in the archive and executable native payloads stay
  unpacked. Never disable Electron RunAsNode while these children use it.
- `dugite` remains in `pnpm.onlyBuiltDependencies` because macOS packages use
  its embedded Git. The Windows builder excludes `node_modules/dugite/git/**`,
  keeps the JS wrapper, and must route it through managed PortableGit. Keep
  that Windows FileSet anchored by the positive `package.json` pattern before
  the Git exclusion. A pure exclusion (string or FileSet) becomes an all-files
  matcher during builder's matching or AppFileWalker stage, admitting unrelated
  source and duplicate resources. The package inspector spec exercises both
  builder normalization and the actual AppFileWalker filter.
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
   the real `alice` shim (with `alice-workspace` retained as a compatibility alias).
2. The shell creates a one-shot scheduled Issue containing metacharacters in
   its visible What. The real `ScheduleScanner` dispatches the packaged managed
   Pi runtime, which performs a deterministic `bash` tool call that invokes
   `alice issue create`. The smoke accepts the run only when it is
   process-backed, structured assistant output is decoded, the one-shot Issue
   auto-completes, and the created side-effect Issue is visible from the
   external `/api/issues` surface.

The focused Windows toolchain smoke additionally loads the packaged dugite JS
wrapper with no embedded dugite Git present, then performs a real
`init`/`add`/`commit`/`status` cycle through managed PortableGit.

The second assertion deliberately uses an observable Workspace side effect,
not a model claiming that a command succeeded. The run emits a versioned JSON
receipt whose individual checks make PATH, injection, CLI transport, runtime
output, tool use, and cleanup failures distinguishable. The Desktop Package
Smoke matrix receipts are preserved as CI artifacts. Release acceptance gates
are defined in [Development Workflow](development-workflow.md#promotion-dev-to-master).

### Local package diagnostics

Use the packaged Workspace acceptance above before treating a source Electron
launch as release evidence. A native CLI archive, a browser session, and a
packaged desktop app exercise different resource layouts; acceptance of one
cannot certify another.

For interactive diagnosis, `pnpm electron:smoke:packaged` defaults to isolated
stores. `--real-data` explicitly opts into the user's existing state; use it
only when the requested investigation needs that state. Onboarding, trading-mode
and Workspace acceptance profiles always require isolation. The current option
contract lives in `scripts/desktop-packaged-smoke.mjs` and
`scripts/desktop-packaged-smoke-plan.mjs`; do not infer defaults from an old
command transcript.

Temporary packaged app launches inherit only host plumbing and explicit runner
flags. OS-home/XDG, Pi, OpenAlice, Supervisor, global, and Electron state stays
beneath the smoke root; ambient provider credentials, endpoints and native config
overrides are excluded. Build/install subprocesses retain their normal environment.
Known Codex, Claude, Cursor and Grok directory overrides also point under that root.
`PI_CODING_AGENT_SESSION_DIR` and OMP profile selectors are cleared so Pi writes
and adapter reads use the same isolated default layout. The sentinel integration
checks the spawned environment, Pi trust writes and session-title lookup against
disposable inherited directories. This does not certify every third-party CLI's
optional external configuration or plugins.

For a resource-layout failure, inspect an unsigned persistent package:

```bash
pnpm electron:build
pnpm vendor:runtime
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm -F @traderalice/desktop exec electron-builder --dir --projectDir ../.. --publish never
pnpm electron:assert-package
```

This diagnostic flow does not publish or prove signing/notarization. `--signed`
is for an explicitly scoped signing investigation under the
[Package signing boundary](development-workflow.md#package-signing-boundary).

When a package job fails, classify the failure before rebuilding: resource
layout, native dependency/Windows command resolution, or signing/publication.
Read the failed job's log and check the actual packaged resource root, child
`OPENALICE_APP_HOME`, executable resolution and owned process cleanup. Inspect
provider configuration only when relevant, without copying credentials or
request bodies into logs or reports. For preserved candidate replay, follow
[Development Workflow](development-workflow.md#promotion-dev-to-master).

### N-1 desktop upgrade acceptance

Fresh-package startup is not upgrade evidence. Every native Desktop Package
Smoke job also downloads the newest published desktop release whose product
version differs from the candidate, runs that real app against an isolated
home, creates a Chat Workspace plus persisted metadata and browser state, then
opens the same home with the unpacked candidate. Acceptance requires:

- the candidate reports its expected version;
- the N-1 Workspace id, display metadata, and renderer sentinel survive;
- the candidate can create a new Workspace after migrations;
- a second candidate launch reads both old and new state; and
- every check is recorded in a versioned JSON receipt.

The runner uses explicit temporary `OPENALICE_HOME`, `AQ_LAUNCHER_ROOT`,
`OPENALICE_GLOBAL_DIR`, and Electron `userData` roots. It never reads normal
desktop data, credentials, or preferences. The previous renderer is driven
through a short-lived loopback DevTools endpoint so the test uses its real API
and bootstrap code without adding a production smoke route.
Between launches the runner requests explicit Electron Quit through the browser
DevTools target. Closing the main renderer only hides the normal desktop and
does not establish shutdown; the runner still requires clean process exit.

Stable release candidates repeat the journey against publication bytes: macOS
expands the final signed architecture-specific ZIP; Windows installs N-1 then
runs the final NSIS installer over the same isolated directory. Channel gates,
receipts and updater-metadata requirements are owned by
[Development Workflow](development-workflow.md#promotion-dev-to-master).

This gate proves N-1 state compatibility and the shipped ZIP/NSIS bytes. macOS
ShipIt replacement and signing/notarization remain native release mechanics.
Do not describe an unpacked-package PR smoke as proof that ShipIt replaced the
application.

Do not replace the actual shims with direct tool-function calls in this smoke:
that would stop covering argv parsing, manifest discovery, managed Node,
Workspace identity headers, and the Electron-only socket transport.

For runtime or packaging changes, run the focused local tests first:

```bash
pnpm vitest run \
  src/core/runtime-profile.spec.ts \
  src/workspaces/agent-detect.spec.ts \
  src/workspaces/spawn-env.spec.ts \
  tests/integration/agent-configuration/ai-config.spec.ts \
  scripts/vendor-managed-runtime.spec.ts \
  scripts/assert-desktop-package.spec.ts \
  scripts/smoke-packaged-toolchain.spec.ts
```

Then exercise the [packaged Workspace acceptance](#workspace-acceptance-contract).

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

Manual rehearsal can select one `host` (`macos-14`, `macos-15-intel`, or
`windows-latest`); the default `all` and promotion PRs retain the full matrix.
For example, dispatch `desktop-package-smoke.yml --ref <branch> -f host=macos-15-intel`
with `gh workflow run` to investigate a native Intel failure without rebuilding
the other hosts. PTY smoke logs fixed renderer and main-process stages around
Workspace creation, response consumption, shell spawn and PTY attachment; these
diagnostics are enabled only by the existing isolated smoke flag and never log
request bodies, headers, credentials or user prompts.
The outer PTY/CLI smoke deadline is 180 seconds, not a fixed delay: it exits
immediately after acceptance and cleanup. Native Intel evidence showed an
otherwise successful 88-second run, including a roughly 62-second main-to-renderer
response delay. Preserve that timing as a separate performance finding rather
than interpreting a larger smoke budget as a runtime performance fix.

The N-1 state journey waits for the actual `app://openalice/` document to finish
loading and mount before exercising APIs or requesting Quit. A DevTools page
target or reachable backend alone does not mean Electron's initial navigation
has completed. Standalone Broker Pack upgrade jobs must also build
`@traderalice/update-lifecycle` and its dependencies before loading the source
verifier; they cannot rely on another job's server build.

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

## Populated desktop preview

For an isolated native frontend preview with shared mock data, use
`pnpm electron:demo`. It preserves app protocol, preload and child IPC without
starting managed agents or trading services. See [[docs/demo-mode.md]] for
commands, data ownership and acceptance limits.

### Smoke-owned process-group completion

On Linux a positive group signal probe includes exited zombies. The smoke helper
uses two complete procfs snapshots with matching nonempty PID/start-time
identities before treating a group as exited: every member must be Z with exactly
one thread. A Z thread-group leader with workers remains live. State is parsed
after comm's final parenthesis, since legal process names can contain `)`.
Restricted, hidden, unreadable, malformed, empty or changing snapshots remain
conservative; live members in the private session also prevent completion.
TERM/KILL order and shutdown budgets are unchanged. This proves execution stopped,
not that the host init reaped PID entries. Real Node helper tests cover graceful
and ignored TERM after wrapper exit; a local pthread diagnostic additionally
checks a Z leader with a live worker. Native Electron/platform acceptance remains
separate from these Node and injected-procfs assertions.

Routine fixes do not require a permanent native smoke entry point. The isolated
store and `--real-data` contract is defined under [Local package diagnostics](#local-package-diagnostics).
Temporary stores do not promise
OS-home or native-agent credential isolation; do not run live native Agents
against a maintainer account as part of ordinary test verification.
