# Bun-native CLI Distribution

Status: Active — macOS/Linux implementation in progress; Windows deferred

Delivery mode: Serial / interactive on the dedicated
`codex/usability-improvements` integration branch. This changes a released
install and long-running Runtime entry path. Each increment starts from the
latest accepted integration tip, lands through one focused PR to that branch,
and updates this plan with the verification actually completed. Keep only one
implementation PR active at a time. After end-to-end acceptance, promote the
coherent usability branch to `dev` through one reviewable PR; do not drip
partially usable packaging internals directly into `dev`.

Parent product plan: [[plans/shell-first-cli-supervisor.md]]. This plan
supersedes only that plan's CLI distribution mechanics: managed Pi, the host
Node requirement, the expanded headless Runtime archive, and the pending
installer/update work built around that archive. The parent plan continues to
own Supervisor behavior, Guardian lifecycle semantics, control compatibility,
logs, Doctor, and AliceProject selection.

Owner guides:

- [[docs/cli-installer.md]]
- [[docs/local-runtime.md]]
- [[docs/cli-supervisor.md]]
- [[docs/managed-workspace-runtime.md]]
- [[docs/broker-packs.md]]
- [[docs/development-workflow.md]]

Research references:

- [Bun standalone executables](https://bun.sh/docs/bundler/executables)
- [Bun Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)
- [OpenCode build script](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/script/build.ts)
- [OpenCode publish script](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/script/publish.ts)
- [OpenCode download matrix](https://opencode.ai/zh/download)
- [[docs/reference/install-script/README.md]]

## Motivation

OpenAlice needs to stay alive independently of a desktop window, browser, or
terminal. In sustained use, the Shell Supervisor and detached Guardian Runtime
are a primary product distribution rather than a fallback for Electron.

The released v0.90.1 CLI achieves checkout-independent startup by installing a
TypeScript CLI, pinned managed Pi, host-Node launchers, and a 107 MiB compressed
platform Runtime assembled from three production `node_modules` closures. That
proved the product and lifecycle, but it also made the CLI installer own Node,
Pi, build-tool checks, two visible commands, and a repository-shaped Runtime
tree. Those are distribution decisions rather than intrinsic OpenAlice
requirements.

The new distribution should retain the proven long-running process model while
shrinking the ownership boundary to OpenAlice itself.

## Objective

Publish a native OpenAlice command for macOS and Linux that:

- runs without a system Node.js, Bun, or Git installation;
- starts the existing Guardian-owned multi-process Runtime from any directory;
- embeds or ships only OpenAlice-owned code and resources;
- launches user-owned Agent Runtime executables as independent PTY processes;
- supports direct Bash installation plus npm, Bun, Homebrew, and
  Arch/AUR installation from the same accepted release artifacts;
- keeps installation bytes separate from `OPENALICE_HOME` product data so a
  clean reinstall or bounded cutover never rewrites that data; and
- leaves Electron as a complete, independent packaging and update lane.

## Fixed Product Boundaries

These decisions are not reopened by the feasibility spike.

### OpenAlice owns its Runtime, not Agent installation

The CLI distribution includes:

- the `openalice` command and Supervisor TUI;
- Guardian, Alice, UTA Core, and Connector Service code;
- the compiled Web UI, default assets, Workspace templates, migrations, and
  OpenAlice adapter glue;
- Workspace helper commands such as `alice`, `alice-workspace`, `alice-uta`,
  and `traderhub`;
- release metadata, licenses, checksums, and install provenance.

It does not include or install:

- Pi, Codex, Claude Code, OpenCode, Cursor, or another Agent Runtime;
- Node.js, Bun, or a package manager for an Agent Runtime;
- an Agent Runtime's credentials, login state, configuration, or updates;
- optional broker SDK packs; or
- Electron, Chromium, desktop preload/IPC resources, or desktop updater
  assets.

OpenAlice owns an Agent process only after a Session launches it: process
creation, PTY transport, environment injection, observation, stop, and recovery
remain OpenAlice responsibilities. The executable's installation and version
remain user responsibilities. A missing selected Agent may produce a direct
diagnostic and official installation link; OpenAlice does not perform that
installation.

`@earendil-works/pi-tui` may remain an ordinary bundled code dependency of the
Supervisor. That does not make the Pi CLI part of the distribution.

### Preserve the current OS-process topology

Bun changes artifact delivery, not Runtime isolation:

```text
openalice command or TUI process
  -> detached Guardian process
       -> Alice process
            -> one independent PTY process per Agent Session
       -> optional UTA process
       -> optional Connector process
```

Guardian remains the single process-tree owner. Alice, UTA, and Connector keep
their existing failure, restart, health, port, and shutdown boundaries. Every
Agent Session continues to launch the adapter-selected external executable as
its own OS process. Workers or in-process service composition must not replace
these boundaries.

### Electron remains independent

Electron keeps its own embedded runtime, vendored resources, signing,
notarization, NSIS/DMG layout, updater, packaged PTY checks, and any bundled
Agent policy. Shared source and `OPENALICE_HOME` contracts remain compatible,
but neither distribution consumes the other's final artifact or install
layout.

## Selected Technical Shape

### One primary executable, multiple process roles

Each platform build produces one primary Bun standalone executable. The same
bytes re-execute with an internal role rather than publishing a copy of the Bun
runtime for every component:

```text
openalice <user command>
openalice --internal-role guardian
openalice --internal-role alice
openalice --internal-role uta
openalice --internal-role connector
```

The internal role flag is not a second public command API. Guardian spawns
`process.execPath` with the selected role and the existing resolved launch
environment. Each invocation is a separate OS process with its own Bun runtime,
signals, logs, locks, and exit status.

The build entry must dispatch before importing a role with startup side
effects. Existing top-level `main()` calls move behind explicit exported boot
functions; they do not collapse into a shared in-process lifecycle.

### Release artifact

The default release shape is:

```text
openalice-cli-<version>-<platform>-<arch>.<archive>
  bin/openalice[.exe]
  adapters/pi-session-provider.ts
  release.json
  LICENSE
  THIRD_PARTY_NOTICES.md
```

The executable embeds the built Web UI, default assets, Workspace templates,
Workspace tool client, and other immutable OpenAlice resources when Bun's
virtual filesystem supports their real access patterns. A small sidecar is
allowed when an external process requires a real filesystem path; the current
Pi session-provider extension is the known example. File count is not a design
goal. The ownership boundary is.

Workspace helper commands should dispatch into the same OpenAlice executable.
The installer may create symlinks or small shell/CMD shims that pass the helper
name explicitly. It must not retain a Node-based `openalice-cli.cjs` solely to
preserve the old layout.

### Installed layout

```text
<install-root>/
  releases/
    <version>-<platform>-<content-id>/
      bin/openalice[.exe]
      share/openalice/
        runtime/git/
        ui/dist/
        default/
        src/workspaces/templates/
        src/workspaces/cli/bin/
      adapters/
      release.json
  current -> releases/<active-release>
  bin/
    openalice
    alice
    alice-workspace
    alice-uta
    traderhub
  data/ and other existing preserved OpenAlice state
```

macOS/Linux may use a symlink for `current`; Windows uses a directory junction
or equivalent pointer that can switch without overwriting a running
executable. Visible shims resolve through `current`. A running Guardian remains
on its immutable old executable until an explicit restart; new invocations use
the newly activated release. The existing pending-activation status remains
the user-visible bridge.

Install and uninstall manage only the release directories, pointer, helper
shims, PATH entry, provenance, and installer lock. User data and Agent Runtime
installations are never removal targets.

### Initial build matrix

The current cutover gate covers macOS and Linux. Native Windows is explicitly
deferred; its PowerShell, PTY, path, junction, signing, and locked-executable
work remains a later platform initiative rather than blocking this plan.

| Platform | Architectures | Initial gate |
|---|---|---|
| macOS | arm64, x64 | Required |
| Linux glibc | arm64, x64 | Required |
| Windows | x64 | Deferred |

Linux musl and Windows arm64 are follow-up targets only after there is a
supported-user or deployment requirement. Do not multiply release variants
before the required matrix is proven.

## Installation and Package-manager Topology

The build produces one accepted set of versioned platform artifacts. Every
installation channel consumes those exact bytes and checksums; npm, Homebrew,
and AUR do not rebuild OpenAlice from source or carry independent patches.

```text
Bun compile matrix
  -> signed/checksummed platform archives + release.json
       -> Bash installer (`curl ... | bash`)
       -> PowerShell installer
       -> npm platform packages -> npm meta package
                                -> Bun global install of the same meta package
       -> Homebrew formula
       -> AUR `-bin` package, installable with paru
```

The intended stable user surfaces are:

```bash
curl -fsSL https://openalice.ai/install | bash
# native Windows uses the matching PowerShell entry
npm install -g openalice
bun add -g openalice
brew install traderalice/tap/openalice
paru -S openalice-bin
```

The unscoped npm name is a desired product surface, not yet repository truth;
reserve and verify the final package names before implementation. A scoped
fallback must keep the installed command named `openalice`.

### Direct installers

The Bash and PowerShell installers own immutable release directories, the
`current` pointer, helper shims, install provenance, atomic activation,
rollback, retention, PATH integration, and uninstall. They are the
authoritative channel for `dev`, exact-version testing, and native Windows
installation.

### npm and Bun

npm and Bun consume one registry topology rather than separate packages:

```text
openalice                       # small meta package, exposes `openalice`
  optionalDependencies:
    @traderalice/openalice-darwin-arm64
    @traderalice/openalice-darwin-x64
    @traderalice/openalice-linux-arm64
    @traderalice/openalice-linux-x64
    @traderalice/openalice-windows-x64
```

Each platform package contains the already accepted native release payload.
The meta package selects and validates the installed platform package, then
materializes or links its native command and required sidecars. Running
`openalice` after installation must execute the native Bun-built binary, not a
persistent JavaScript wrapper that requires Node or Bun.

Publish every platform package before publishing the meta package and its
dist-tag. A partial platform publication must not expose a meta version that
cannot install successfully.

### Homebrew and Arch/AUR

The initial Homebrew formula lives in the TraderAlice tap and selects the
accepted macOS/Linux archive and SHA-256 by OS and architecture. Promotion to
Homebrew core is optional later work, not an initial launch dependency.

The AUR package is `openalice-bin`; `paru` is one client for that AUR package,
not an OpenAlice-specific installer. Its `PKGBUILD` downloads the accepted
Linux archive, verifies the release checksum, installs the native command and
sidecars, and declares conflicts/provides without compiling the repository.

### Update and uninstall ownership

The channel that installs the visible command owns its update and uninstall:

| Provenance | Update owner |
|---|---|
| Bash / PowerShell | OpenAlice installer transaction |
| npm | npm |
| Bun | Bun package manager |
| Homebrew | Homebrew |
| AUR / paru | pacman-compatible package manager |

`openalice update` may discover and explain a newer version for every channel,
but it invokes self-update only for direct installs. Package-manager installs
show or execute the correct manager-owned command after explicit consent; they
must never copy over their own managed prefix behind the package manager's
back.

The same binary bytes may arrive through different channels, so provenance is
recorded beside the executable or in package metadata rather than compiled
into a channel-specific binary. npm/Bun postinstall, the Homebrew formula, the
AUR recipe, and direct installers each record their own source.

Long-running processes make manager-owned replacement a real acceptance case.
Test npm, Bun, Brew, and AUR upgrades while a Guardian tree is active. If a
manager or Windows refuses to replace a locked executable, require and explain
`openalice down` before that manager's upgrade; do not solve it by introducing
a second hidden self-update or permanent runtime copy without measured need.

Package-manager channels initially publish stable releases only. Mutable `dev`
and exact-ref testing stay on the direct installers until a real need justifies
additional registry tags or formulas.

## Alternatives Considered

| Shape | Decision | Reason |
|---|---|---|
| Expanded Node CLI plus headless Runtime | Replace | Keeps Node, `node_modules`, managed Pi, build-tool, and repository-layout ownership |
| One Bun executable and one application process | Reject | Breaks Guardian, component, and per-Agent process isolation |
| Separate Bun executable for Guardian, Alice, UTA, and Connector | Reject initially | Repeats the Bun runtime and multiplies release artifacts without improving the process model |
| One Bun executable that re-executes by role | Select | Preserves the current process tree with one primary platform artifact |
| Bun executable plus bundled or installer-managed Agent Runtime | Reject | Makes an adapter target part of the OpenAlice CLI product boundary |
| Make Electron consume the CLI Runtime | Out of scope | Couples independent packaging, lifecycle, and update lanes before the CLI design is proven |

## Ordered Delivery

Checkboxes reflect repository truth, not intent.

### 1. Feasibility gate

- [x] Pin the Bun build tool version used by CI and local release builds.
- [x] Compile the TypeScript CLI and Supervisor TUI for the current host with
  no system Node requirement in the output.
- [x] Compile and boot Alice from an isolated `OPENALICE_HOME` with the real Web
  UI and auth-status route.
- [x] Re-execute the compiled binary as Guardian, Alice, UTA, and Connector;
  prove separate PIDs, signal propagation, component failure isolation, and
  clean lock release.
- [x] Launch at least two independent fake or real Agent CLI PTYs; stopping one
  must not stop the other, Alice, or Guardian.
- [x] Finish the Bun-native PTY gate. Bun 1.4 `Terminal` is accepted on macOS
  arm64, Linux arm64, and Linux x64 behind the existing PTY ownership boundary;
  high-output backpressure stops the whole PTY process group at the producer
  boundary and resumes below the existing low watermark. Do not add a Node
  sidecar as the default answer.
- [ ] Prove an installed broker pack can still be dynamically loaded from
  `OPENALICE_HOME` without bundling its SDK into UTA Core.
- [x] Prove embedded UI/default/template reads and one materialized external
  adapter file.
- [ ] Record measured executable size, cold start, idle memory per role, and
  clean-build time against the released headless Runtime.
- [ ] Decide go/no-go from real macOS and Linux evidence. A compile-only
  success is insufficient.

No public installer or durable compatibility layer changes in this increment.
Failed experiments stay out of product code; retain only a minimal reusable
build harness when it improves the next investigation.

### 2. Bun runtime entry and build ownership

- [x] Add one strict TypeScript build entry that dispatches user commands and
  internal roles before role startup.
- [x] Convert Guardian, Alice, UTA, and Connector top-level startup into
  explicit boot functions without changing their process boundaries.
- [x] Replace Guardian's child JavaScript paths with self-executable role
  spawns while preserving environment, readiness, restart, and shutdown
  behavior.
- [x] Bundle OpenAlice package dependencies and required platform-native
  assets; keep broker packs external.
- [x] Generate platform archives, `release.json`, SHA-256 metadata, version,
  control compatibility, and content identity from accepted build outputs.
- [ ] Keep source development on `pnpm dev`; it need not imitate the installed
  executable layout.

### 3. Resources and Workspace helper boundary

- [x] Ship Web UI, defaults, templates, migrations, and immutable adapter
  resources through one resource-root abstraction shared with source and
  Electron modes.
- [x] Serve the real UI and create every standard Workspace template from a
  compiled executable outside the repository.
- [x] Replace Node-backed Workspace CLI shims with aliases or small wrappers
  that dispatch into `openalice`.
- [x] Materialize only files that an external Agent process must open by path;
  verify lifecycle, permissions, content identity, and update replacement.
- [ ] Remove CLI-only `OPENALICE_MANAGED_PI_*` selection and injection without
  changing Electron's bundled-Agent behavior.
- [ ] Verify existing user-installed Agent CLIs retain their native config,
  version, executable path, and credentials.
- [x] Ship a release-owned Git sidecar and prepend only its `bin` directory to
  Runtime children; prove init, commit, local clone, and GitHub HTTPS with no
  system Git on PATH.

### 4. Native CLI installers

- [ ] Define one platform-neutral install plan and transaction model shared by
  the Bash and PowerShell presentations.
- [ ] Make both installers manage only OpenAlice release artifacts, helper
  shims, PATH, provenance, lock, activation, retention, and uninstall.
- [ ] Remove Node/npm/Pi/build-tool preflight and managed-Pi consent from the
  CLI install plan.
- [ ] Deferred Windows lane: add the native PowerShell bootstrap with the same
  checksum, staging, lock, immutable-release, pointer, PATH, and data-preserving
  behavior as Bash.
- [ ] Preserve explicit install consent and separate start consent; neither
  installer silently starts or registers a long-running service.
- [ ] Install from current `dev` artifacts and the matching dev selector before
  promotion.

### 5. Package-manager publication

- [ ] Reserve the npm meta and platform package names; keep the resulting
  command named `openalice`.
- [ ] Generate npm platform packages from accepted release archives and one
  meta package with platform `optionalDependencies`.
- [ ] Install the meta package through both npm and Bun on every required
  platform; verify that the final command is the native executable and does
  not require the package manager at runtime.
- [ ] Generate the TraderAlice Homebrew formula from accepted archive URLs and
  checksums; test macOS arm64/x64 and supported Linux targets.
- [ ] Generate and publish the `openalice-bin` AUR `PKGBUILD` and `.SRCINFO`
  from the accepted Linux archives; test installation through `paru` in a clean
  Arch fixture.
- [ ] Record channel provenance without rebuilding or modifying the native
  executable bytes.
- [ ] Detect manager-owned installs in update/Doctor output and route update
  and uninstall guidance back to the owning manager.
- [ ] Exercise each manager's upgrade and removal while a Runtime is stopped,
  then exercise its documented behavior while Guardian is active.
- [ ] Publish platform npm packages first, the npm meta package second, and
  Brew/AUR metadata only after the referenced release assets are public and
  verified.

### 6. Cutover and updates

- [ ] Define the Bun-to-Bun update transaction first; do not let the released
  Node layout shape the new Runtime or installed layout.
- [ ] Keep installation bytes separate from `OPENALICE_HOME` product data so
  removing the old CLI and performing a clean Bun install is always a valid
  cutover.
- [ ] Provide one bounded v0.90.1 cutover path when it is straightforward:
  validate the Bun command, replace only installer-owned launchers/releases,
  and preserve product data. A clean reinstall with explicit guidance is an
  acceptable fallback; seamless cross-generation activation is not a design
  requirement.
- [ ] For Bun-to-Bun updates, preserve a running old Guardian until explicit
  restart and report pending activation; do not replace a running executable
  in place.
- [ ] Roll back the active pointer when new-runtime readiness fails.
- [ ] Remove obsolete managed `pi` launchers only after the new OpenAlice
  command is validated; never remove a user-owned `pi` elsewhere on PATH.
- [ ] Keep bounded prior OpenAlice releases for rollback and collect only
  inactive installer-owned releases.
- [ ] Make `openalice update` hand off to the correct Bash or PowerShell
  installer for its installation provenance.
- [ ] Keep package-manager-owned installations manager-owned.

Do not add a permanent dual runtime, compatibility resolver, or old-layout
repair path. Once the Bun release activates, normal startup knows only the Bun
layout. Published old installers and tags remain available as historical
artifacts.

### 7. Remote and server composition

- [ ] Make managed SSH install select a Bun artifact for the remote platform
  and architecture without cloning source or installing Agent Runtimes.
- [ ] Preserve loopback binding, Guardian ownership, tunnel behavior, and
  remote content/provenance comparison.
- [ ] Define an explicit unsupported-host result for targets outside the
  accepted Bun build matrix.
- [ ] Keep Docker on its current server image until a separately justified
  change proves that consuming the Bun artifact improves that distribution.

### 8. Retire the expanded CLI Runtime

- [ ] Delete the CLI release path that builds and publishes
  `openalice-runtime-*.tar.gz` dependency-closure archives.
- [ ] Delete CLI installation and repair of managed Pi, including the public
  `pi` launcher owned by OpenAlice.
- [ ] Delete installed-CLI checks that require host Node, npm, native build
  tools, expanded `node_modules`, or repository-relative service entrypoints.
- [ ] Remove `OPENALICE_MANAGED_RUNTIME_PATH` from the Bun install path while
  retaining explicit source-development and Electron resource providers.
- [ ] Update owner guides in the same increment; do not preserve stale current
  behavior as a compatibility path.
- [ ] Keep release history and old tagged installers available for diagnosis;
  do not rewrite published v0.90.1 assets.

### 9. Release acceptance

- [ ] Build every required target from the accepted tagged tree.
- [ ] Verify archive checksum and internal release metadata before upload.
- [ ] Run clean non-admin Bash installs on macOS and Linux.
- [ ] Deferred Windows lane: run a clean standard-user PowerShell install.
- [ ] Install and run the accepted release through npm, Bun, Homebrew, and
  `paru`, then verify manager-owned update and uninstall guidance.
- [ ] Exercise the documented old-to-new cutover once on a currently supported
  v0.90.1 CLI host; this is evidence for the guidance, not a cross-platform
  compatibility matrix or a release blocker for the Bun architecture.
- [ ] Prove `up`, detach, `status`, `open`, multiple independent Agent PTYs,
  component restart, `down`, update activation, rollback, and uninstall.
- [ ] Run the root TypeScript/tests, UI typecheck, Guardian recovery, CLI PTY,
  installer, managed remote, and relevant Electron regression lanes.
- [ ] Publish `dev` preview artifacts and exercise their network path before a
  human-directed `dev` to `master` promotion.

## Verification Matrix

Every code increment runs:

```bash
npx tsc --noEmit
pnpm test
pnpm -F @traderalice/openalice-cli test
```

Add according to the increment:

```bash
cd ui && npx tsc -b
pnpm test:guardian-recovery
pnpm test:install:docker
pnpm test:install:dev-channel
pnpm test:remote:docker
pnpm electron:smoke:pty
pnpm electron:smoke:packaged --temp-data
```

Use the local OrbStack Docker engine as the default clean Linux harness for
installer, remote, package-manager, repeat-install, upgrade, rollback, and
uninstall checks. Containers must use isolated temporary homes and no host
credentials or broker state. OrbStack validates Linux behavior efficiently,
but it does not replace native macOS acceptance. Windows PowerShell,
filesystem-locking, PATH, and executable-signing checks belong to the deferred
Windows lane.

The Bun-specific acceptance harness must additionally prove:

- the installed command runs with `node`, `npm`, and `bun` absent from PATH;
- every Guardian/Alice/UTA/Connector and Agent Session PID is distinct;
- the Runtime survives the launching shell and Supervisor TUI;
- killing UTA or Connector preserves the documented Alice behavior;
- terminating one Agent Session does not affect another Session;
- UI, templates, Workspace helper commands, PTY resize/input, and broker-pack
  loading work outside a checkout;
- npm, Bun, Homebrew, and AUR installations resolve to the same accepted native
  release content for their platform, report correct provenance, and do not
  self-update across package-manager ownership; and
- failed staging, verification, activation, readiness, or interruption leaves
  the prior release runnable and user data unchanged.

Routine acceptance is non-trading and uses isolated homes with no real
credentials or broker accounts. Broker-pack loading uses a fixture package;
live-paper trading is not part of packaging verification.

## Open Feasibility Questions

These may change implementation details but not the fixed product boundaries:

1. Can the current `@hono/node-server` paths run unchanged under Bun, or should
   the CLI build use a small runtime-neutral server adapter while Electron and
   source development retain Node?
2. Can installed broker-pack ESM and native SDKs load dynamically from disk in
   the compiled UTA role without broadening the base artifact?
3. Which current filesystem callers work directly against Bun embedded assets,
   and which externally consumed adapter files require materialization?
4. What signing, notarization, and malware-scanning gates are required for the
   standalone macOS CLI binary independently of Electron?

## Explicit Non-goals

- Installing, updating, pinning, downgrading, or repairing an Agent Runtime.
- Making a selected Agent Runtime an OpenAlice release dependency.
- Replacing OS processes with workers or an in-process model loop.
- Reworking the Supervisor interaction design, trading behavior, or Workspace
  data model as part of packaging.
- Making Electron depend on the CLI artifact or changing Electron's updater.
- Automatically enabling boot-at-login or a system service during install.
- Keeping the old Node/headless bundle as a permanent fallback after cutover.
- Expanding public network listeners or changing remote authentication.

## Completion Criteria

This plan is complete only when:

1. a clean macOS or Linux CLI installation needs no preinstalled
   Node, Bun, npm, Git, source checkout, or Agent Runtime to run OpenAlice itself;
2. one primary platform executable starts the existing multi-process Guardian,
   Alice, UTA, and Connector tree and every Agent Session remains an independent
   external process;
3. the CLI release contains no Agent Runtime and never changes one already on
   the user's machine;
4. the real UI, Workspace creation, helper commands, PTY Sessions, optional
   components, and fixture broker pack work outside a checkout;
5. the Bash installer performs verified, atomic, data-preserving install,
   update, rollback, and uninstall transactions;
6. npm, Bun, Homebrew, and AUR/paru install the same accepted native release,
   and updates/uninstalls remain owned by the selected manager;
7. the old CLI has a documented, data-preserving cutover; a clean reinstall is
   acceptable and no old Runtime compatibility path remains in normal startup;
8. Electron remains independently packaged and its required regression smokes
   pass; and
9. the old expanded headless Runtime and managed-Pi CLI distribution paths are
   deleted from current source and the durable owner guides describe the Bun
   architecture.

## Progress Log

- 2026-08-29: Maintainer selected the architecture after comparing Herdr and
  OpenCode. CLI is treated as a primary long-running distribution. The selected
  direction is one Bun-compiled OpenAlice artifact that re-executes into the
  existing multi-process Runtime; Agent Runtime installation and Electron
  packaging are outside its ownership boundary. Plan created; no feasibility
  or implementation checkbox is complete.
- 2026-08-29: Added the initial acquisition matrix: direct Bash/PowerShell,
  npm, Bun, Homebrew, and AUR/paru. All channels consume the same accepted
  platform artifacts; the installing channel retains update/uninstall
  ownership, and package-manager variants do not rebuild OpenAlice.
- 2026-08-29: Established `codex/usability-improvements` as the dedicated
  serial integration lane. Focused implementation PRs target that branch one
  at a time, then the accepted initiative is promoted coherently to `dev`.
  OrbStack Docker is the default clean Linux installation harness, with native
  macOS and Windows acceptance retained for platform-specific behavior.
- 2026-08-29: Feasibility increment 1 pinned Bun 1.3.14, added a reusable
  current-host compile/probe harness, and moved CLI version resolution behind a
  build-time constant with the existing package-manifest fallback for source
  execution. The compiled CLI and Supervisor import graph runs `--version` and
  `--help` with an empty `PATH`: macOS arm64 produced 63,891,938 bytes in 70 ms;
  OrbStack Linux arm64 produced 94,087,312 bytes in 232 ms; emulated Linux x64
  produced 94,079,104 bytes in 480 ms. This proves the command shell only;
  Alice/component boot, PTY, resources, and external broker packs remain open.
- 2026-08-29: Feasibility increment 2 made `node-pty` lazy at the Session/probe
  boundary and established `native/node-pty` beside the compiled executable as
  the candidate native sidecar. Alice now boots from a Bun executable with an
  empty `PATH`, isolated `OPENALICE_HOME`, and checkout-backed resources; the
  real UI and `/api/auth/status` both return 200. macOS arm64 measured
  67,937,378 bytes and 1,433 ms to readiness; OrbStack Linux arm64 measured
  98,150,544 bytes and 735 ms; emulated Linux x64 measured 98,093,184 bytes and
  4,047 ms. This does not yet prove PTY loading from the sidecar or embedded
  resources outside a checkout.
- 2026-08-29: Feasibility increment 3 adopted OpenCode's build-condition
  boundary without inheriting its third-party native addon: Node/Electron keeps
  lazy `node-pty`, while Bun 1.4 selects Bun's native `Terminal` API behind one
  OpenAlice-owned PTY contract. Before the pivot, pinned `bun-pty` passed on
  macOS arm64 and Linux x64 but produced no output on Linux arm64, including in
  a direct source-mode probe. The Bun-native compiled probe then passed on
  macOS arm64, Linux x64, and Linux arm64: it started two PTYs with distinct
  PIDs, exercised input/output and resize, stopped one, and proved the other
  remained usable. Alice also booted with an empty `PATH` and no native
  sidecar. Bun's current Terminal API has no output pause/resume equivalent,
  and its 1.4 type contract still describes PTY support as POSIX-only, so
  high-output backpressure and native Windows x64 remain explicit gates.
- 2026-08-29: A real isolated `Bun Grok Live` AliceProject exposed that the
  standalone executable could boot and serve the UI but could not initialize
  its first Chat Workspace: `process.execPath` re-launched Alice instead of
  interpreting `bootstrap.mjs`, then an external dynamic import could not
  resolve `dugite`. The Bun build now re-enters the same executable through an
  internal bootstrap role and supplies the bundled git executor to the plain
  ESM template helper. The compiled build gate materializes a real Chat
  Workspace with an empty `PATH`. After rebuilding, the browser created the
  Workspace, launched installed Grok Build 1.0.13 as an independent Bun-native
  PTY process, received `BUN_PTY_GROK_OK` plus the correct Workspace cwd,
  stopped it without stopping Alice, restarted Alice under the same named
  project identity, resumed the native Grok session, and received
  `REATTACH_OK`.
- 2026-08-29: Feasibility increment 4 added one strict Bun entry that dispatches
  the CLI and private Guardian/Alice/UTA/Connector roles before importing their
  explicit boot functions. Guardian now re-enters the same 72,116,978-byte
  macOS arm64 executable for each service while preserving four distinct PIDs.
  With an empty PATH and isolated home, the real CLI `run` path reached Alice,
  UTA, and Connector readiness; forced Connector failure recovered under a new
  PID, forced UTA failure left Alice ready, the control flag restored UTA under
  a new PID, and SIGTERM released the Guardian lock. The smoke also fixed an
  existing UTA restart deadlock by clearing a signalled child reference.
- 2026-08-29: Release-artifact increment added a target-native archive builder
  with per-file hashes, content identity, SHA-256 sidecar, licenses, immutable
  resources, Bun-native Workspace helper dispatch, and a release-owned Git
  sidecar. On macOS arm64 the expanded release measured 114,485,201 bytes and
  the gzip archive 56,462,626 bytes; Git 2.53.0 occupied 19,168,630 bytes after
  replacing duplicate built-in executables with 150 relative symlinks and
  excluding GCM/LFS. Outside the checkout and with no system Node/Bun/Git on
  PATH, acceptance passed Git init/commit/local clone, live GitHub HTTPS,
  Chat/AutoQuant/Auto Prediction bootstrap, real `alice-workspace` manifest
  plus invocation, default and Pi adapter materialization, content provenance,
  and the real Web UI.
- 2026-08-29: PTY backpressure increment completed the Bun-native PTY gate
  without a Node sidecar or an application-level output spool. Because Bun
  1.4's callback-only `Terminal` has no read-side pause API, the Bun backend
  maps the existing high/low-watermark contract to `SIGSTOP`/`SIGCONT` on the
  PTY's POSIX process group. A compiled high-output probe used a child writer
  behind its parent shell, held output byte-for-byte stable while paused,
  resumed past another 512 KiB, and exited normally when killed from the paused
  state on native macOS arm64, OrbStack Linux arm64, and emulated Linux x64.
  This keeps pressure at the producer/kernel PTY boundary and covers Agent
  Runtime helper processes without an unbounded Bun heap queue. Native Windows
  remains part of the deferred Windows distribution lane.
