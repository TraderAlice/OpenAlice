# Bun-native CLI Distribution

Status: Active — design accepted, feasibility work not started

Delivery mode: Serial / interactive. This changes a released install and
long-running Runtime entry path. Each accepted increment starts from current
`dev`, lands through one focused PR to `dev`, and updates this plan with the
verification actually completed.

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

Publish a native OpenAlice command for macOS, Linux, and Windows that:

- runs without a system Node.js or Bun installation;
- starts the existing Guardian-owned multi-process Runtime from any directory;
- embeds or ships only OpenAlice-owned code and resources;
- launches user-owned Agent Runtime executables as independent PTY processes;
- supports Bash and native PowerShell installation with the same release and
  update contract;
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

Cutover requires the platforms already served by the CLI plus native Windows:

| Platform | Architectures | Initial gate |
|---|---|---|
| macOS | arm64, x64 | Required |
| Linux glibc | arm64, x64 | Required |
| Windows | x64 | Required |

Linux musl and Windows arm64 are follow-up targets only after there is a
supported-user or deployment requirement. Do not multiply release variants
before the required matrix is proven.

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

- [ ] Pin the Bun build tool version used by CI and local release builds.
- [ ] Compile the TypeScript CLI and Supervisor TUI for the current host with
  no system Node requirement in the output.
- [ ] Compile and boot Alice from an isolated `OPENALICE_HOME` with the real Web
  UI and auth-status route.
- [ ] Re-execute the compiled binary as Guardian, Alice, UTA, and Connector;
  prove separate PIDs, signal propagation, component failure isolation, and
  clean lock release.
- [ ] Launch at least two independent fake or real Agent CLI PTYs; stopping one
  must not stop the other, Alice, or Guardian.
- [ ] Prove the current `node-pty` path under Bun on macOS and Windows. If it
  fails, compare an embedded N-API load with a Bun-native PTY implementation
  behind the existing PTY ownership boundary. Do not add a Node sidecar as the
  default answer.
- [ ] Prove an installed broker pack can still be dynamically loaded from
  `OPENALICE_HOME` without bundling its SDK into UTA Core.
- [ ] Prove embedded UI/default/template reads and one materialized external
  adapter file.
- [ ] Record measured executable size, cold start, idle memory per role, and
  clean-build time against the released headless Runtime.
- [ ] Decide go/no-go from real macOS and Windows evidence. A compile-only
  success is insufficient.

No public installer or durable compatibility layer changes in this increment.
Failed experiments stay out of product code; retain only a minimal reusable
build harness when it improves the next investigation.

### 2. Bun runtime entry and build ownership

- [ ] Add one strict TypeScript build entry that dispatches user commands and
  internal roles before role startup.
- [ ] Convert Guardian, Alice, UTA, and Connector top-level startup into
  explicit boot functions without changing their process boundaries.
- [ ] Replace Guardian's child JavaScript paths with self-executable role
  spawns while preserving environment, readiness, restart, and shutdown
  behavior.
- [ ] Bundle OpenAlice package dependencies and required platform-native
  assets; keep broker packs external.
- [ ] Generate platform archives, `release.json`, SHA-256 metadata, version,
  control compatibility, and content identity from accepted build outputs.
- [ ] Keep source development on `pnpm dev`; it need not imitate the installed
  executable layout.

### 3. Resources and Workspace helper boundary

- [ ] Embed Web UI, defaults, templates, migrations, and immutable adapter
  resources through one resource-root abstraction shared with source and
  Electron modes.
- [ ] Serve the real UI and create every standard Workspace template from a
  compiled executable outside the repository.
- [ ] Replace Node-backed Workspace CLI shims with aliases or small wrappers
  that dispatch into `openalice`.
- [ ] Materialize only files that an external Agent process must open by path;
  verify lifecycle, permissions, content identity, and update replacement.
- [ ] Remove CLI-only `OPENALICE_MANAGED_PI_*` selection and injection without
  changing Electron's bundled-Agent behavior.
- [ ] Verify existing user-installed Agent CLIs retain their native config,
  version, executable path, and credentials.

### 4. Native CLI installers

- [ ] Define one platform-neutral install plan and transaction model shared by
  the Bash and PowerShell presentations.
- [ ] Make both installers manage only OpenAlice release artifacts, helper
  shims, PATH, provenance, lock, activation, retention, and uninstall.
- [ ] Remove Node/npm/Pi/build-tool preflight and managed-Pi consent from the
  CLI install plan.
- [ ] Add the native PowerShell bootstrap for Windows x64 with the same
  checksum, staging, lock, immutable-release, pointer, PATH, and data-preserving
  behavior as Bash.
- [ ] Preserve explicit install consent and separate start consent; neither
  installer silently starts or registers a long-running service.
- [ ] Install from current `dev` artifacts and the matching dev selector before
  promotion.

### 5. Cutover and updates

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

### 6. Remote and server composition

- [ ] Make managed SSH install select a Bun artifact for the remote platform
  and architecture without cloning source or installing Agent Runtimes.
- [ ] Preserve loopback binding, Guardian ownership, tunnel behavior, and
  remote content/provenance comparison.
- [ ] Define an explicit unsupported-host result for targets outside the
  accepted Bun build matrix.
- [ ] Keep Docker on its current server image until a separately justified
  change proves that consuming the Bun artifact improves that distribution.

### 7. Retire the expanded CLI Runtime

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

### 8. Release acceptance

- [ ] Build every required target from the accepted tagged tree.
- [ ] Verify archive checksum and internal release metadata before upload.
- [ ] Run clean non-admin Bash installs on macOS and Linux.
- [ ] Run a clean standard-user PowerShell install on Windows.
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

The Bun-specific acceptance harness must additionally prove:

- the installed command runs with `node`, `npm`, and `bun` absent from PATH;
- every Guardian/Alice/UTA/Connector and Agent Session PID is distinct;
- the Runtime survives the launching shell and Supervisor TUI;
- killing UTA or Connector preserves the documented Alice behavior;
- terminating one Agent Session does not affect another Session;
- UI, templates, Workspace helper commands, PTY resize/input, and broker-pack
  loading work outside a checkout;
- Windows paths, spaces, junction activation, PowerShell execution policy, and
  locked-running-executable updates are exercised on Windows; and
- failed staging, verification, activation, readiness, or interruption leaves
  the prior release runnable and user data unchanged.

Routine acceptance is non-trading and uses isolated homes with no real
credentials or broker accounts. Broker-pack loading uses a fixture package;
live-paper trading is not part of packaging verification.

## Open Feasibility Questions

These may change implementation details but not the fixed product boundaries:

1. Does the current `node-pty` N-API package bundle and run reliably in Bun
   standalone executables on every required target, or should CLI builds use a
   Bun-native PTY backend behind the same Session process abstraction?
2. Can the current `@hono/node-server` paths run unchanged under Bun, or should
   the CLI build use a small runtime-neutral server adapter while Electron and
   source development retain Node?
3. Can installed broker-pack ESM and native SDKs load dynamically from disk in
   the compiled UTA role without broadening the base artifact?
4. Which current filesystem callers work directly against Bun embedded assets,
   and which externally consumed adapter files require materialization?
5. What signing, notarization, and malware-scanning gates are required for the
   standalone macOS and Windows CLI binaries independently of Electron?

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

1. a clean macOS, Linux, or Windows CLI installation needs no preinstalled
   Node, Bun, npm, source checkout, or Agent Runtime to run OpenAlice itself;
2. one primary platform executable starts the existing multi-process Guardian,
   Alice, UTA, and Connector tree and every Agent Session remains an independent
   external process;
3. the CLI release contains no Agent Runtime and never changes one already on
   the user's machine;
4. the real UI, Workspace creation, helper commands, PTY Sessions, optional
   components, and fixture broker pack work outside a checkout;
5. Bash and native PowerShell installers perform verified, atomic,
   data-preserving install, update, rollback, and uninstall transactions;
6. the old CLI has a documented, data-preserving cutover; a clean reinstall is
   acceptable and no old Runtime compatibility path remains in normal startup;
7. Electron remains independently packaged and its required regression smokes
   pass; and
8. the old expanded headless Runtime and managed-Pi CLI distribution paths are
   deleted from current source and the durable owner guides describe the Bun
   architecture.

## Progress Log

- 2026-08-29: Maintainer selected the architecture after comparing Herdr and
  OpenCode. CLI is treated as a primary long-running distribution. The selected
  direction is one Bun-compiled OpenAlice artifact that re-executes into the
  existing multi-process Runtime; Agent Runtime installation and Electron
  packaging are outside its ownership boundary. Plan created; no feasibility
  or implementation checkbox is complete.
