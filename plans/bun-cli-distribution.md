# Bun-native CLI Distribution

Status: Active — macOS/Linux native CLI is public in v0.90.2 and the separately
dispatched v0.91.0-beta.1 is externally verified; stable remains v0.90.2 while
stable/beta discovery authority is converged on the OpenAlice CDN;
the Railway native CLI SSH host passes local empty-Volume, normal replacement,
hard-kill recovery, real retained-Volume transfer, hosted Agent turns, and live
v2 normal-restart/hard-kill reacceptance; the disposable hosted empty-Volume
and forced installer-failure fallback journeys remain open; native PowerShell
and external package-manager activation remain deferred

Delivery mode: Serial / interactive from current `dev`. The accepted native CLI
increments have already reached `dev`; the old `codex/usability-improvements`
tip contains superseded release-flow experiments and must not be promoted as a
whole. New implementation increments use focused branches back to `dev`.
Human-directed source promotion and the focused version-only branch continue to
follow [[docs/development-workflow.md]].

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
- [[docs/remote-access.md]]
- [[docs/docker-deployment.md]]

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
  cli/
    releases/
      <version>-<platform>-<arch>-<content-id>/
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
    provenance/<release-name>.json
    staging/
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
bun add -g --trust openalice
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
    openalice-darwin-arm64
    openalice-darwin-x64
    openalice-linux-arm64
    openalice-linux-x64
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

The Web version surface follows the running topology rather than creating
another updater. Source checkouts use Git; packaged Electron uses its native
updater; direct stable/beta CLI installs use `openalice update`; and Railway or
Docker stays owned by the service deployment. Direct dev changes are compared
by the native CLI or deployment through checksum and content identity, not by
package semver in the browser. Pinned, custom, and invalid provenance fail
closed without an implicit update action.

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
- [x] Prove an installed broker pack can still be dynamically loaded from
  `OPENALICE_HOME` without bundling its SDK into UTA Core.
- [x] Prove embedded UI/default/template reads and one materialized external
  adapter file.
- [x] Record measured executable size, cold start, idle memory per role, and
  clean-build time against the released headless Runtime.
- [x] Decide go/no-go from real macOS and Linux evidence. A compile-only
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
- [x] Keep source development on `pnpm dev`; it need not imitate the installed
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
- [x] Remove CLI-only `OPENALICE_MANAGED_PI_*` selection and injection without
  changing Electron's bundled-Agent behavior.
- [x] Verify existing user-installed Agent CLIs retain their native config,
  version, executable path, and credentials.
- [x] Ship a release-owned Git sidecar and prepend only its `bin` directory to
  Runtime children; prove init, commit, local clone, and GitHub HTTPS with no
  system Git on PATH.

### 4. Native CLI installers

- [x] Define one platform-neutral install plan and transaction model; realize
  it in Bash for the accepted macOS/Linux lane while PowerShell stays deferred.
- [x] Make the Bash installer manage only OpenAlice release artifacts, helper
  shims, PATH, provenance, lock, activation, retention, and uninstall.
- [x] Remove Node/npm/Pi/build-tool preflight and managed-Pi consent from the
  CLI install plan.
- [ ] Deferred Windows lane: add the native PowerShell bootstrap with the same
  checksum, staging, lock, immutable-release, pointer, PATH, and data-preserving
  behavior as Bash.
- [x] Preserve explicit install consent and separate start consent; neither
  installer silently starts or registers a long-running service.
- [x] Install from current `dev` artifacts and the matching dev selector before
  promotion.

### 5. Package-manager publication

- [ ] Reserve the npm meta and platform package names; keep the resulting
  command named `openalice`.
- [x] Generate npm platform packages from accepted release archives and one
  meta package with platform `optionalDependencies`.
- [x] Install the meta package through both npm and Bun on every required
  platform; verify that the final command is the native executable and does
  not require the package manager at runtime.
- [x] Generate the TraderAlice Homebrew formula from accepted archive URLs and
  checksums. The release gate covers native macOS arm64/x64 and Linuxbrew
  arm64/x64 installation.
- [x] Generate the `openalice-bin` AUR `PKGBUILD` and `.SRCINFO` from the
  accepted Linux archives and configure pinned clean Arch x64 and Arch Linux
  ARM build/install gates.
- [ ] Publish the generated formula to the TraderAlice tap and `openalice-bin`
  to AUR, then test the public `brew` and `paru` commands.
- [x] Record channel provenance without rebuilding or modifying the native
  executable bytes.
- [x] Detect manager-owned installs in update/Doctor output and route update
  and uninstall guidance back to the owning manager.
- [x] Exercise each manager's upgrade and removal while a Runtime is stopped,
  then exercise its documented behavior while Guardian is active.
- [x] Record and enforce platform-first/meta-last npm publication after the
  GitHub Release succeeds. Stable publication remains explicitly disabled
  until registry authority and package names are established.
- [x] Preflight every opted-in public channel before expensive release builds:
  prove npm package maintainership, Homebrew Tap push access, and pinned-host
  AUR Git access without logging or weakening the external credentials.
- [x] Expose the authority preflight as a bounded manual, read-only rehearsal
  that cannot publish packages, push metadata, or create a release.
- [ ] Publish Brew/AUR metadata only after the referenced release assets are
  public and verified. The opt-in automation and public-byte receipt are ready;
  external repository creation, credentials, activation, and first public
  command walks still require maintainer authority.

### 6. Cutover and updates

- [x] Define the Bun-to-Bun update transaction first; do not let the released
  Node layout shape the new Runtime or installed layout.
- [x] Keep installation bytes separate from `OPENALICE_HOME` product data so
  removing the old CLI and performing a clean Bun install is always a valid
  cutover.
- [x] Provide one bounded v0.90.1 cutover path when it is straightforward:
  validate the Bun command, replace only installer-owned launchers/releases,
  and preserve product data. A clean reinstall with explicit guidance is an
  acceptable fallback; seamless cross-generation activation is not a design
  requirement.
- [x] For Bun-to-Bun updates, preserve a running old Guardian until explicit
  restart and report pending activation; do not replace a running executable
  in place.
- [x] Roll back the active pointer when new-runtime readiness fails.
- [x] Remove obsolete managed `pi` launchers only after the new OpenAlice
  command is validated; never remove a user-owned `pi` elsewhere on PATH.
- [x] Keep bounded prior OpenAlice releases for rollback and collect only
  inactive installer-owned releases.
- [x] Make `openalice update` hand off to the exact-version Bash installer for
  direct macOS/Linux provenance; PowerShell remains in the deferred lane.
- [x] Keep package-manager-owned installations manager-owned.

Do not add a permanent dual runtime, compatibility resolver, or old-layout
repair path. Once the Bun release activates, normal startup knows only the Bun
layout. Published old installers and tags remain available as historical
artifacts.

### 7. Remote and server composition

- [x] Make managed SSH install select a Bun artifact for the remote platform
  and architecture without cloning source or installing Agent Runtimes.
- [x] Preserve loopback binding, Guardian ownership, tunnel behavior, and
  remote content/provenance comparison.
- [x] Define an explicit unsupported-host result for targets outside the
  accepted Bun build matrix.
- [x] Keep the existing source-built Docker server image on its current
  bundled-Agent/public-Web contract; add the separately justified Railway
  native CLI SSH-host profile instead of reshaping that image.

### 8. Retire the expanded CLI Runtime

- [x] Delete the CLI release path that builds and publishes
  `openalice-runtime-*.tar.gz` dependency-closure archives.
- [x] Delete CLI installation and repair of managed Pi, including the public
  `pi` launcher owned by OpenAlice.
- [x] Delete installed-CLI checks that require host Node, npm, native build
  tools, expanded `node_modules`, or repository-relative service entrypoints.
- [x] Remove `OPENALICE_MANAGED_RUNTIME_PATH` from the Bun install path while
  retaining explicit source-development and Electron resource providers.
- [x] Update owner guides in the same increment; do not preserve stale current
  behavior as a compatibility path.
- [x] Keep release history and old tagged installers available for diagnosis;
  do not rewrite published v0.90.1 assets.

### 9. Release acceptance

- [x] Build every required target from the accepted tagged tree.
- [x] Verify archive checksum and internal release metadata before upload.
- [x] Run clean non-admin Bash installs on macOS and Linux.
- [ ] Deferred Windows lane: run a clean standard-user PowerShell install.
- [x] Install and run the accepted release through npm, Bun, Homebrew, and
  `paru`, then verify manager-owned update and uninstall guidance.
- [x] Exercise the documented old-to-new cutover once on a currently supported
  v0.90.1 CLI host; this is evidence for the guidance, not a cross-platform
  compatibility matrix. Keep the real published v0.90.1 replacement as a
  required Linux x64 `dev` and stable-release acceptance gate.
- [x] Prove `up`, detach, `status`, `open`, multiple independent Agent PTYs,
  component restart, `down`, update activation, rollback, and uninstall.
- [x] Run the root TypeScript/tests, UI typecheck, Guardian recovery, CLI PTY,
  installer, managed remote, and relevant Electron regression lanes.
- [x] Publish `dev` preview artifacts and exercise their network path before a
  human-directed `dev` to `master` promotion.

### 10. Publish the 0.91 beta checkpoint

- [x] Capture the current stable manifest, updater feeds, aliases, and shared
  installer before beta publication.
- [x] Promote the exact accepted `dev` tip, including the GitHub-safe AUR
  metadata asset contract, to `master` through the full promotion gate.
- [x] Use a focused `master` branch and PR to set both product manifests to
  `0.91.0-beta.1`; do not merge that version-only commit back to `dev`.
- [x] Dispatch one `beta` release for `v0.91.0-beta.1`. Do not produce or queue
  a stable release from the same run.
- [x] Externally verify the beta GitHub Release, updater feeds, CLI manifest,
  installer, native Runtime, and Broker Packs while proving every stable-owned
  mutable surface stayed byte-for-byte unchanged.
- [x] Leave later fixes on `dev`. A `beta.2` checkpoint is optional; stable is
  a separate later decision after beta testing and maintainer acceptance.

### 11. Converge channel discovery authority

The release workflow already publishes same-schema stable and beta manifests
to the OpenAlice CDN. Those manifests are the mutable channel pointers;
versioned GitHub Releases remain the immutable artifact and release-notes host.
Runtime discovery must not depend on GitHub's anonymous API quota.

- [x] Select the stable and beta CDN manifests as the single discovery
  authority shared by fresh installation, CLI updates, and Settings checks.
- [x] Make the Bash installer resolve stable from `manifest.json` and beta from
  `beta/manifest.json`, with strict channel/version validation and no GitHub
  Releases API lookup.
- [x] Make `GET /api/version` and its explicit refresh derive the normalized
  channel from installed provenance and expose the update authority. Read the
  matching stable/beta manifest only for source, desktop, or CLI contexts;
  service-managed, dev, pinned, and custom contexts do not create a duplicate
  Web updater, and invalid provenance fails closed.
- [x] Keep the v0.90.1 installer bridge only for an explicit 0.90.1 selector or
  a stable manifest that explicitly advertises 0.90.1; default stable discovery
  no longer uses that bridge now that stable has a native CLI release.
- [x] Remove the unused desktop GitHub API checker, require explicit channel
  identity in the CLI updater, and make the release gate reject a shared
  installer that falls back to legacy stable behavior.
- [x] Update the legacy-cutover fixture and owner guides, then verify fixture
  tests, the public stable install plan, clean Linux installer acceptance, and
  the real Settings route without GitHub API access.

### 12. Railway native CLI SSH host

This is a small deployment profile of the Stage 2 SSH product. It is not a
hosted Studio, public Web server, new installer, or replacement for the
source-built Docker image.

- [x] Add a repo-owned `Dockerfile.railway` and entrypoint that keep the native
  OpenAlice release out of the image, validate or install it on the mounted
  volume, and `exec` foreground `openalice server run` under `tini`.
- [x] Fix the Volume at `/data`, Railway SSH `HOME` at `/data/home`, and native
  install/npm/Bun user roots beneath it. Export those paths and persistent
  `PATH` from the image for Railway SSH, use system-only `PATH` during
  bootstrap, and keep machine launch links rebuildable outside the durable
  authority.
- [x] Allow only `OPENALICE_HOME` to select a Project beneath `/data`; always
  derive `AQ_LAUNCHER_ROOT` from it and reject alternate Volume/user/install/
  package roots or normalized escapes.
- [x] Reuse the shared stable/beta/dev installer. Stable and beta may select an
  in-channel pinned version; dev follows its completed latest manifest and
  rejects a version override. A failed refresh may reuse only a still-valid
  prior release; an empty failed bootstrap stops.
- [x] On ordinary SSH-managed hosts, compare stable, beta, and pinned targets by
  logical release while validating each target's schema 3 platform,
  architecture, checksum, content identity, and embedded Runtime locally. For
  dev, require the invoking CLI to match the latest manifest and bind installer
  handoff to the remote target from that same completed set.
- [x] Keep Railway inspection-only from the laptop: the service entrypoint and
  variables own release selection and lifecycle, while `openalice remote`
  verifies target-local provenance/Runtime consistency, distinguishes a
  configured selector from a verified fallback, and opens only the tunnel.
  Replace persistent command shims with the image-owned wrapper after every
  selection and route SSH `update`, `rollback`, and `uninstall` back to Railway
  configuration so neither a current release nor a published fallback can
  split the persistent pointer from the foreground Runtime.
- [x] Keep Agent Runtime installation, authentication, version, plugins, and
  updates user-owned through Railway SSH and persistent user `PATH` locations.
- [x] Make AliceProject transfer Git-aware: retain tracked and nonignored
  untracked Workspace content, exclude ignored untracked dependencies, native
  install/runtime/session/known-backup state, and reject or classify unsafe
  symlinks. Prove ordinary repositories remain connected after transfer and
  fail closed on linked worktrees, alternate/promisor object state, nested Git
  repositories, and initialized submodules. Transfer only Alice-owned
  credential families through the private stream; Web auth/sessions and native
  Agent login/config remain destination setup.
- [x] Pass Bash syntax plus the focused entrypoint, managed-remote, and
  Project-transfer specs (222 tests).
- [x] Build `Dockerfile.railway`, bootstrap the native CLI and foreground
  Runtime from an empty local Docker Volume, then perform a normal
  stop/recreate replacement against that Volume and retain CLI and Project
  markers. Verify the image has no Agent Runtime.
- [x] Run the content planner locally against the real Default AliceProject,
  using the intended Railway destination metadata but no SSH or mutation:
  10,693 portable files, 5,612 directories, 222,215,071 portable bytes,
  289,328,517 required destination bytes, 21 credential entries, six
  exact-Session scheduled Issues, and no content-policy blockers. Git-ignored
  dependencies plus runtime, backup, session, install, and machine-local state
  remain excluded. Live source ownership/quiescence and remote capability,
  destination, and free-space preflight are not part of this offline evidence.
- [x] Rerun the hard-kill container replacement after the stale-owner PID reuse
  and CLI preflight repairs in the local Docker harness. The current dev Bun
  Runtime reclaimed the stale lock on the same Volume, retained the Project
  marker, matched release content without pending activation, restored the
  fixed SSH Home/PATH, and did not acquire an Agent Runtime. This evidence did
  not exercise Railway replacement containers with isolated PID namespaces.
- [x] Diagnose the first retained-Volume Railway deployment failure. Its old
  beta lock used the legacy hostname-derived machine identity, while the new
  container correctly used the stable Railway service identity; ordinary
  foreign-machine protection therefore left the stale owner blocked.
- [x] Reject the first heartbeat-based handoff repair during review. It allowed
  ordinary Railway SSH to gain cross-container reclaim authority and had a
  stale-inspection/rename race. Cancel its dev artifact before publication;
  keep the last accepted dev manifest unchanged.
- [x] Replace heartbeat authority with a Volume-mount-inode kernel `flock`
  taken before installer or Project mutation. Validate the real mount, its
  canonical relationship to the actual Home/install roots, and the inherited
  locked FD. Pass a startup duplicate only through CLI -> Guardian ->
  Alice/UTA/Connector; those trusted writers validate and retain lifetime copies
  while ordinary child processes, adapters, Agents, and PTYs receive none. Write `railway-flock-v1` owner
  records, keep ordinary SSH observer-only, fail closed at every Runtime hop,
  discover every Volume Project and reject legacy owners before release or
  Project mutation, and recheck complete owner evidence before quarantine.
- [x] Pass the fenced-handoff local gates: focused ownership/CLI/entrypoint and
  capability-isolation specs, root/Guardian/CLI TypeScript, full suite,
  Guardian recovery, Linux installer and SSH-remote Docker smokes, plus a
  Linux shared-Volume drill for suspended holder, hard kill, and simultaneous
  replacements. Rebuild the Railway image and reconfirm that it contains no
  Node, Bun, or Agent Runtime executable.
- [x] Pass the remaining local repository gates: root and CLI TypeScript,
  `git diff --check`, the 222-test focused run, the 5,266-test full suite,
  Linux installer and SSH-remote Docker smokes, Guardian recovery smoke, and a
  rebuilt Railway image with the required tools but no Node, Bun, or Agent
  Runtime.
- [x] Replace recursive mutation-claim cleanup with a UUID generation marker
  shared by publication, release, and stale reaping. Atomically retire only the
  exact marker generation, recheck it before canonical mutation, distinguish
  Railway replacements with a per-start instance id, require the
  `railway-runtime-lock-v2` capability, and let the Volume-fenced preflight
  recover only exact claim-only/published-owner intermediate shapes after a
  blocker-free full scan. Unknown entries, duplicate claim markers/write temps,
  and malformed or symlinked nodes remain fail-closed.
- [ ] On a disposable Railway service and empty `/data` Volume, pass clean
  bootstrap and empty-host install-failure/fail-closed acceptance without using
  or clearing the retained real Volume.
- [x] Deploy the profile non-destructively against the retained real Railway
  `/data` Volume with no public domain, no Dashboard Start Command override,
  Serverless disabled, Restart Policy set to Always, one replica, at least 30
  seconds of draining, fixed SSH `HOME=/data/home` plus persistent user `PATH`,
  an OpenSSH alias from `railway ssh config`, and a successful inspection-only
  `openalice remote` browser/tunnel journey. The v2 deployment automatically
  recovered the exact supported interrupted-lock shape without manual lock
  deletion and retained the selected Project and native install.
- [x] Repeat `openalice project transfer --plan` through the deployed Railway
  candidate so SSH compatibility, destination absence, and free-space
  preflight are proven before apply.
- [x] Apply the reviewed real AliceProject transfer into a new
  `/data/projects/<name>` Home, select that Home for the service, and verify its
  portable Workspace/configuration state after redeploy without copied install
  bytes or machine-local symlinks.
- [x] Install and authenticate one Agent Runtime through Railway SSH, then prove
  a real Workspace turn without treating those Agent bytes as an OpenAlice
  release artifact.
- [x] Restart and redeploy against the same retained Volume, then hard-kill the
  exact foreground Runtime child once. Verify automatic v2 recovery, distinct
  per-start fence identities, persistent install/Home/OpenCode state, Runtime
  readiness, and successful continuation of the same remote Session after both
  replacements without deleting a lock.
- [ ] Force one installer failure with a known-valid prior release on the
  retained Volume and observe the bounded exact-release fallback. Keep the
  empty-Volume install-failure/fail-closed journey isolated to the disposable
  service above.

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
pnpm electron:smoke:workspace
bash -n scripts/railway/*.sh
pnpm exec vitest run scripts/railway-entrypoint.spec.ts \
  packages/cli/src/install.spec.mjs \
  packages/cli/src/lifecycle.spec.mjs \
  packages/cli/src/project-command.spec.ts \
  packages/cli/src/remote.spec.mjs \
  packages/cli/src/server-control.spec.mjs \
  packages/cli/src/update.spec.mjs \
  packages/cli/src/rollback.spec.mjs \
  packages/cli/src/uninstall.spec.mjs \
  packages/cli/src/project-transfer.spec.ts \
  packages/cli/src/project-transfer-ssh.spec.ts \
  packages/cli/src/project-transfer-stream.spec.ts
```

Use the local OrbStack Docker engine as the default clean Linux harness for
installer, remote, package-manager, repeat-install, upgrade, rollback, and
uninstall checks. Containers must use isolated temporary homes and no host
credentials or broker state. OrbStack validates Linux behavior efficiently,
including native Bun release and multiprocess Runtime acceptance on Linux
arm64 and x64, but it does not replace native macOS acceptance. Prefer this
local native-macOS plus OrbStack matrix during serial development instead of
waiting on hosted runners; hosted jobs remain publication and release gates.
Windows PowerShell,
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
2. Which current filesystem callers work directly against Bun embedded assets,
   and which externally consumed adapter files require materialization?
3. What signing, notarization, and malware-scanning gates are required for the
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
   architecture; and
10. the Railway SSH-host profile completes both a disposable empty-Volume
    bootstrap/fail-closed journey and a non-destructive retained-Volume journey
    with fixed persistent SSH Home, AliceProject migration, a user-owned Agent
    turn, same-Volume normal and hard-kill restart/redeploy, and exact-release
    fallback without a public Web route.

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
- 2026-08-29: External Broker Pack acceptance materialized a production-shaped
  active CCXT fixture under an isolated `OPENALICE_HOME`. Its ESM entry imports
  a private SDK from the Pack's own `node_modules`, and that SDK must load and
  expose a real platform N-API `.node` binary before it returns its marker. The
  separately re-executed compiled UTA role created a healthy keyless account
  carrying that marker, then loaded the Pack again after forced UTA failure and
  restart. Native macOS arm64, OrbStack Linux arm64, and emulated Linux x64 all
  passed with an empty `PATH`; UTA Core and the Bun release artifact remain free
  of the fixture SDK and live broker dependencies.
- 2026-08-29: External Agent Runtime ownership increment removed Electron-only
  `OPENALICE_MANAGED_PI_PATH` and `OPENALICE_MANAGED_PI_NODE_PATH` before any
  Bun CLI home-derived environment is calculated, while preserving native Pi
  state, `HOME`, `PATH`, and the source/Electron managed-Pi paths. The release
  gate now discovers a package-external OpenCode executable and starts it via
  the real adapter as an independent Workspace PTY on macOS arm64, OrbStack
  Linux arm64, and emulated Linux x64. An additional native macOS run launched
  installed OpenCode 1.17.13 from `/opt/homebrew/bin/opencode`, received its
  real TUI output, and left its synthetic user-owned native config
  byte-for-byte unchanged. The Linux run also exposed and fixed missing Dugite
  core symlinks and standard `git-upload-pack`, `git-receive-pack`, and
  `git-shell` bin entries in the portable Git layout.
- 2026-08-29: Native Bash installer increment replaced the expanded Node/Pi
  transaction with verified target-native archives under `cli/releases`, a
  dynamic `cli/current` launcher, schema 3 artifact provenance, exact-version
  update handoff, three-release retention, local atomic rollback, and
  data-preserving uninstall. The validated v0.90.1 cutover removes only the old
  installer-owned `cli-versions` tree and Pi/CMD launchers after the new native
  command runs. A real macOS arm64 build installed and reported its provenance,
  updated over a distinct retained build, and rolled back by pointer. OrbStack
  Debian arm64 passed install/update with Node, npm, pnpm, Bun, and Agent
  Runtimes absent. Native Windows PowerShell remains deferred; package-manager
  channels and published dev/release assets remain open.
- 2026-08-29: Managed SSH now installs and runs the matching native Bun release
  without probing or installing Node, build tools, source, or Agent Runtimes in
  its default path. Explicit `--app-dir` remains a separately validated source
  development override, and unsupported targets fail instead of silently
  changing distribution models. The OrbStack Linux arm64 SSH fixture passed
  native install, distinct Guardian/Alice/UTA processes, real auth readiness,
  tunnel disconnect/reconnect, aggregate AliceProject inventory, structured
  stop, interrupted transfer retry, credential resealing, and startup of a
  transferred second Home on the same immutable release.
- 2026-08-30: Replaced the formal expanded-headless release matrix with four
  target-native Bun CLI candidates and made their archives plus SHA-256
  sidecars part of the gated GitHub Release. Every `dev` push now builds the
  same matrix, verifies sidecars and internal target/version/Bun metadata,
  publishes commit-addressed immutable copies, activates fixed preview aliases
  checksum-last, and runs the raw `dev/install` network journey on a non-root
  Debian host with Node, npm, pnpm, Bun, and Agent Runtimes absent. Native
  Doctor now reports its embedded Bun engine instead of Bun's compatibility
  `process.version` as a host Node dependency. The live network gate remains
  pending until this increment reaches `dev` and publishes its first aliases.
- 2026-08-30: Added OpenCode-style platform npm packages plus a small
  `openalice` meta package, generated Homebrew and `openalice-bin` AUR metadata,
  schema 3 package-manager provenance, and manager-owned update/uninstall
  routing. Bun installation deliberately uses `bun add -g --trust openalice`
  because Bun blocks dependency lifecycle scripts by default; the postinstall
  has no download fallback and runs under Bun without host Node. Real macOS
  arm64 npm and pinned Bun 1.4.0 installs passed native `version`, detached
  `up`, Doctor ownership, `down`, uninstall guidance, and manager removal with
  Node/Bun absent from the Runtime `PATH`. PR/release workflows now repeat
  npm/Bun on the native matrix, install the formula on both macOS arches, build
  and install the x64 AUR package in a pinned Arch image, derive publication
  inputs only from all four accepted archives, and publish npm platform
  packages before the stable meta package. OrbStack confirmed the official
  Arch base-devel image currently lacks arm64, so native Arch Linux ARM remains
  an explicit acceptance gap. Public registry name reservation and external
  tap/AUR publication remain activation work rather than hidden fallbacks.
- 2026-08-30: Direct installs now record an atomic pending activation receipt
  with the exact previous immutable release. Matching first readiness confirms
  it; early exit, timeout, or executable failure restores the validated pointer
  without starting the prior Runtime or touching user data. Installer failure
  after pointer activation performs the same exact rollback, and retention
  cannot collect the pending target. Package-manager upgrades remain
  manager-owned: CLI/TUI status compares content identities and reports restart
  activation without modifying npm, Bun, Homebrew, or AUR files.
- 2026-08-30: Recorded a go decision from same-host v0.90.1 expanded Runtime
  and Bun-native measurements. On macOS arm64, archive size fell from 112.5 to
  53.8 MiB, expanded size from 528.5 to 113.8 MiB, four-role readiness improved
  from 1,548 to 1,326 ms, and median idle RSS fell from 539.0 to 440.4 MiB. On
  native OrbStack Linux arm64, archive size fell from 76.9 to 64.4 MiB,
  expanded size from 419.2 to 128.4 MiB, readiness was effectively flat at 935
  versus 959 ms, and idle RSS fell from 525.5 to 391.8 MiB. Rebuilding the
  v0.90.1 headless artifact from its tag with prebuilt server inputs took 66.52
  seconds on that Linux host; the Bun artifact assembly plus archive took 4.83
  seconds, with a 0.93-second standalone compile. Both paths used isolated
  homes, all four real process roles, three RSS samples at 500 ms intervals,
  and no configured accounts. Release and feasibility reports now preserve
  compile, artifact, total, cold-start, and per-role memory evidence. Source
  development remains the unchanged `pnpm dev` path.
- 2026-08-30: Expanded the npm/Bun native package smoke from one install/remove
  pass into two real manager-owned candidates. Each manager now upgrades and
  removes with the Runtime stopped, then replaces a running prior candidate and
  proves the new native command sees the old Guardian content as pending,
  idempotent `up` preserves that result, CLI update/uninstall remain guidance
  only, and `down` plus a fresh `up` activates the new content. Native macOS
  arm64 passed through npm and pinned Bun 1.4.0; the PR matrix repeats the same
  journey on Linux. Homebrew and AUR lifecycle expansion remains separate from
  this npm/Bun increment.
- 2026-08-30: Repaired cross-platform acceptance exposed by the package-manager
  increment. The Bash installer now canonicalizes its release root before
  retention comparisons, so macOS `/var` to `/private/var` resolution cannot
  collect the active rollback release. npm package assembly selects `npm.cmd`
  on Windows, path assertions use native separators, and the direct symlink
  replacement rollback case is explicitly skipped on Windows while native
  Windows activation remains a deferred distribution lane. Type checking, 335
  CLI tests, 5,062 root tests, and the non-root Orb Linux installer smoke pass.
- 2026-08-30: Completed local system-package-manager lifecycle acceptance.
  Homebrew now consumes the archive's actual extracted release root and copies
  `release.json` instead of trying to move one source twice. A shared fixture
  derives a hash-refreshed N-1 archive set from accepted candidates, after
  which a local Git-backed tap and an x64 Arch container perform real stopped
  and active upgrades, restart activation, and removal. Native macOS arm64
  Homebrew and Orb-emulated Linux x64 `makepkg`/`pacman` both passed with an
  empty Runtime `PATH`; the formal release matrix repeats Homebrew on Intel and
  arm64 runners and AUR on native x64. Windows distribution remains deferred.
- 2026-08-30: Rebuilt the current macOS arm64 native candidate and repeated the
  complete npm and Bun stopped/active lifecycle after the shared-fixture
  refactor; both passed. `npx tsc --noEmit`, all 335 CLI tests, all 5,064 root
  tests, and the non-root Orb Linux installer smoke also pass.
- 2026-08-30: Promoted the native CLI increments through `dev` and completed
  preview acceptance. Dev run 33270375503 built darwin-arm64, darwin-x64,
  linux-arm64, and linux-x64 candidates, verified each candidate through the
  full npm and pinned Bun manager lifecycle before upload, validated checksums
  and embedded target/version metadata, activated the four dev aliases, and
  passed the clean raw `dev/install --branch dev` network journey. A separate
  isolated macOS arm64 install from the public dev alias passed `version`,
  `up`, `status`, `down`, and uninstall with Node, Bun, and Agent Runtimes
  absent from the Runtime `PATH`. Stable registry/tap/AUR publication and the
  tagged-release matrix remain release activation work; Windows remains
  deferred.
- 2026-08-30: Closed the Linuxbrew acceptance gap with pinned official
  Homebrew 6.0.15 images for native Linux arm64 and x64 runners. The shared
  system-package lifecycle now accepts Homebrew on macOS or Linux, while a
  release-gating Linuxbrew matrix repeats stopped and active upgrades,
  ownership guidance, restart activation, and removal against the exact
  accepted Linux archives.
- 2026-08-30: Closed native Arch Linux ARM package acceptance. The x64 lane
  remains on the pinned official Arch base-devel image; the arm64 lane uses a
  pinned Arch Linux ARM base-devel image whose audited build consumes
  signature-checked upstream repositories. Both native runner lanes build the
  generated `openalice-bin`, install it through `pacman`, and repeat stopped
  and active upgrade, ownership, restart activation, and removal checks before
  dev aliases or a stable release can publish.
- 2026-08-30: Replayed the published v0.90.1 installer into an isolated macOS
  home, replaced its expanded Node Runtime and managed Pi with the accepted Bun
  candidate, and proved native `version`, detached `up`, `status`, `down`, and
  uninstall with a minimal Runtime `PATH`. The cutover removed only
  installer-owned `cli-versions` and Pi launchers while preserving product data
  and an external user-owned Pi byte-for-byte. Dev and stable publication now
  repeat the same bounded journey on native Linux x64. The historical Pi
  manifests are fetched from the v0.90.1 OpenAlice tag and verified against the
  hashes embedded by that published installer, avoiding dependence on the
  upstream Pi asset URL that has since disappeared.
- 2026-08-30: Consolidated the full Runtime lifecycle evidence into native
  candidate gates. The compiled macOS arm64 artifact captured the exact URL
  passed through `open`, created two external OpenCode-adapter Sessions with
  distinct PIDs, delivered independent binary input after WebSocket resize,
  stopped one Session, and kept the other interactive. The four-process
  feasibility receipt forced Connector and UTA failures, recovered both with
  new PIDs while Alice stayed ready, and released the Guardian lock after
  shutdown. Existing direct and package-manager receipts cover update pending
  state, restart activation, local rollback, uninstall, and data preservation;
  every native dev and stable candidate now repeats the relevant artifact and
  component gates.
- 2026-08-30: Added the external-channel activation chain without silently
  claiming registry ownership. Every stable release now re-downloads all four
  public archives and sidecars, verifies their accepted hashes, compares the
  public formula/AUR/npm metadata byte-for-byte with the preserved inputs, and
  retains a receipt before any registry writer can run. npm/Bun, the
  TraderAlice Tap, and AUR have separate opt-in variables and least-scope
  credentials; Tap/AUR commits are idempotent. Package-name reservation, Tap
  creation, AUR key enrollment, enabling the switches, and the first public
  install journeys remain explicit maintainer actions.
- 2026-08-31: Published `v0.90.2-beta.1` and later `v0.90.2` as independent
  release intents. The stable run built and accepted all native CLI targets,
  Bash installers, npm/Bun/Homebrew/Linuxbrew/AUR mechanics, desktop packages,
  and Broker Packs; external package-manager activation remained intentionally
  disabled. Public GitHub/R2 bytes and a clean native Runtime journey passed
  independent verification. GitHub normalized the hidden `.SRCINFO` asset name,
  leaving the original run red only at its final metadata-name comparison; PR
  #1268 now stages the exact accepted bytes as `openalice-bin.SRCINFO` while AUR
  keeps its repository-local `.SRCINFO` contract.
- 2026-08-31: Maintainer selected `v0.91.0-beta.1` as the next public checkpoint
  and explicitly deferred stable until later testing. Beta and stable are
  separate serial intents: fixes may accumulate on `dev` between them, another
  beta is optional, and unchanged-source stable promotion is the exception
  rather than an automatic second output.
- 2026-08-31: Published only
  [`v0.91.0-beta.1`](https://github.com/TraderAlice/OpenAlice/releases/tag/v0.91.0-beta.1)
  from `009d3f466288bd69cf831e6bddccee501ca99c04` in
  [release run 33329951354](https://github.com/TraderAlice/OpenAlice/actions/runs/33329951354).
  The prerelease contains 49 uploaded assets: four native CLI archives and
  sidecars, 20 Broker Pack archives plus catalogs, signed and notarized macOS
  desktop packages, the intentionally unsigned Windows package, updater
  metadata, and installers. Independent public verification downloaded and
  hashed all CLI and Broker bytes with zero mismatches, then completed a clean
  non-root Debian beta install, Runtime start/status/stop, uninstall, and data
  preservation journey with no host Node, Bun, or Agent Runtime. The captured
  stable manifest, feeds, aliases, and default installer route remained
  unchanged at `v0.90.2`; npm, Homebrew Tap, and AUR publication stayed
  disabled. No stable release was produced or queued.
- 2026-08-31: Converged stable and beta discovery on the existing OpenAlice CDN
  manifests. The Bash bootstrap, native CLI updater, Web Settings route, and
  release acceptance now require explicit matching channel/version metadata;
  GitHub remains the immutable archive and release-notes host rather than the
  anonymous discovery API. The explicit v0.90.1 bridge remains bounded, while
  an unused desktop GitHub checker and the beta-release legacy-default
  tolerance were removed. Local acceptance passed root and UI/Desktop type
  checks, 359 CLI tests, 5,189 root tests, the non-root OrbStack Linux installer
  smoke, a public stable plan resolving v0.90.2 despite a deliberately dead old
  GitHub API seam, and the real Settings card plus forced refresh. A direct
  public beta manifest read resolved v0.91.0-beta.1. No release or channel
  promotion was performed.
- 2026-08-31: Added the focused Railway native CLI SSH-host increment in the
  working tree. The repo-owned image fixes `/data`, persistent Railway SSH
  `HOME=/data/home`, OpenAlice install/npm/Bun user paths, and persistent `PATH`;
  bootstrap first uses system-only `PATH`. Only `OPENALICE_HOME` selects a
  Project and its Workspace root is always derived. Ordinary SSH-managed remote
  treats stable/beta/pinned as logical releases with target-local artifact
  integrity, while dev is bound to both local and remote targets from the latest
  completed manifest. Railway remains platform-owned and inspection-only from
  the laptop. Project transfer is Git-aware and excludes native install,
  runtime, Session, known-backup, and machine-local state. Focused Bash,
  entrypoint, managed-remote, and Project-transfer checks passed 222 tests; the
  full suite passed 5,266 tests. Root and CLI TypeScript, diff checks, Linux
  installer and SSH-remote Docker smokes, Guardian recovery smoke, and the
  Railway image prerequisite/no-runtime check also passed. A local empty-Volume
  build and normal stop/recreate retained CLI and Project markers while
  confirming the image has no Agent Runtime. A later hard-kill exposed
  stale-owner PID reuse and CLI preflight defects; after the owner check adopted
  stable machine and process-start identity, the current dev Bun Runtime passed
  the same-Volume hard-kill/recreate journey with its Project marker and
  persistent login-shell environment intact. The real Default AliceProject
  offline content-planner pass, using destination metadata but no SSH, reduced
  the portable boundary to 10,693 files, 5,612 directories, and 222,215,071
  bytes; it requires 289,328,517 destination bytes and found 21 credential
  entries plus six exact-Session scheduled Issues, with no content-policy
  blockers. Git-ignored dependencies, runtime state, backups, sessions, native
  install trees, and machine-local state stay outside the stream. Live source
  ownership and remote destination preflight remain separate apply gates. A
  real public `v0.91.0-beta.1` run in the final Railway image proved the legacy
  provider-without-content-identity compatibility fallback, and the
  image-owned persistent wrappers blocked direct update, rollback, and
  uninstall without changing the active pointer, release store, or install
  manifest. The disposable hosted empty-Volume drill, Project apply, the
  real Railway fixed-layout candidate deployment, Agent, restart/redeploy, and
  failure journeys remain pending. The inspected Railway service with
  `HOME=/root` is the old deployment, not candidate evidence.
- 2026-09-01: Review of the first same-service handoff repair found two release
  blockers: general Railway SSH inherited reclaim authority, and a heartbeat
  could refresh between stale inspection and lock-directory rename. Dev build
  run 33417079146 was cancelled before publication; the public dev manifest
  stayed on `7a5fad58`. The replacement now locks the real Railway Volume mount
  directory before creating mutable paths or installing. It validates canonical
  actual Home/install containment plus the locked directory FD through Linux
  fdinfo. A read-only Volume-wide retained-lock preflight now rejects legacy
  ownership before release-pointer, shim, or Project mutation. Guardian keeps
  the lifetime copy; Alice, UTA, and Connector retain lifetime duplicates that
  ordinary children, adapters, Agents, and PTYs do not inherit. CLI, Guardian,
  Alice, UTA, and Connector all fail
  closed when the profile declares a missing or invalid fence. Cooperative owners declare `railway-flock-v1`;
  legacy owners and changed owner evidence fail closed. The current macOS
  focused review sets pass with the expected Linux-only skips; root, CLI,
  and Guardian TypeScript, shell/Node syntax, Guardian recovery, and the full
  5,292-test suite pass. A compiled Linux arm64 Bun chain independently proved
  identical Volume/CLI/Guardian lock identity, trusted-writer descriptor adoption,
  blocked contention, and fenced Guardian/Alice owner metadata. Linux installer,
  remote-SSH, and full Docker Runtime smokes pass. PR/dev archive publication,
  live Railway reacceptance, Project apply, and the Agent turn remain pending.
- 2026-09-01: PR #1280 merged the kernel-fence repair to `dev` at
  `a0f17e40`; run 33431851058 published all four native aliases and passed the
  public raw/dev install. The retained Railway Volume then failed before
  release mutation on eight legacy lock directories as designed. After proving
  the old deployment had stopped and no installed writer remained, those exact
  directories and owner records moved reversibly to
  `/data/quarantine/legacy-cutover-a0f17e40-1/`; the new Linux x64 archive
  started with Guardian and Alice holding the Volume inode fence. Its first
  restart exposed a separate immutability defect: the Workspace logger used
  `process.cwd()` and appended to the release-owned
  `share/openalice/logs/workspace-sessions.log`, so reinstall verification
  rejected the changed tree and safely fell back. The current fix routes that
  sink to `<OPENALICE_HOME>/logs/workspace-sessions.log` and opens it lazily so
  a rejected pre-fence Alice process cannot create Project state. A direct
  no-fence Alice regression now requires the whole Project Home to stay absent;
  the real Bun Workspace smoke requires the Project-owned log and rejects any
  before/after release-tree mutation. Root TypeScript, the 5,295-test suite,
  full build, and the local native Bun release smoke pass. A fresh dev archive
  and Railway restart/redeploy acceptance remain required before Project
  transfer.
- 2026-09-01: PR #1281 merged the immutable Workspace-log repair to `dev` at
  `50f3d49f`, and run 33435309446 published the matching native archives. The
  retained no-domain Railway service then installed that dev archive under the
  persistent SSH Home, selected `/data/projects/main-cloud`, and received the
  stopped local Default AliceProject through the production transfer path:
  10,702 files and 222,635,304 bytes, with zero native Sessions copied. OpenCode
  1.18.25 was installed separately under `/data/home`, and Workspace
  `chat-solid-coral-ridge` completed a real headless turn with
  `OPENALICE_REMOTE_OK`. A following service restart exposed two crash-recovery
  defects not covered by the earlier container drill: recursive release could
  strand an empty canonical directory, and reused Railway hostname/PID identity
  could misclassify the prior container. The current v2 repair adds a fresh
  per-start instance id, requires both Railway Runtime capabilities, and uses a
  UUID generation marker for publication/release/reaping. Exact-marker atomic
  retirement prevents an old recoverer from deleting a new claim; the
  Volume-fenced preflight validates every Project before cleaning only known
  claim-only, owner-write-temp, or published-owner intermediates. Claim-only
  status is no longer reported as absent. Focused Runtime/CLI/entrypoint tests
  pass 133 tests with four platform skips; root, Guardian, and CLI TypeScript,
  diff checks, Guardian recovery, and the full 5,319-test suite with 13 skips
  are green. Linux installer, native SSH-remote, and full Docker Runtime smokes
  also pass on OrbStack. At that point a new dev archive, live automatic
  recovery, persisted resume, and restart/hard-kill acceptance remained
  pending; no stable/beta release or channel promotion was performed.
- 2026-09-01: PR #1282 merged the v2 lock repair to `dev` at `5d58b259`;
  workflow run 33448877068 published and accepted all four matching dev
  archives plus the raw `dev/install` path. The retained no-domain Railway
  service deployed candidate `9e423f82-3b24-4a8f-bb1e-efa8be770387` and
  automatically recovered the supported interrupted
  `config-bootstrap.lock` shape without manual deletion. Its Linux x64 Runtime
  retained content identity `36bda5ecaa277a15`, selected
  `/data/projects/main-cloud`, the migrated 10,702-file Default AliceProject,
  and user-owned OpenCode 1.18.25. A normal restart and an exact hard kill of
  the foreground Runtime child each produced a fresh fencing-instance id and
  returned Alice, UTA, and Connector to ready state on the same Volume; the
  fence changed from `a45ff33c` to `5866184a` and then `c3ca8fa8`. OpenCode
  resume `resume-smooth-paper-bridge-ysivle` then completed
  `OPENALICE_REMOTE_RESUME_OK`, `OPENALICE_REMOTE_RESTART_OK`, and
  `OPENALICE_REMOTE_HARD_KILL_OK`; the inspection-only SSH tunnel also loaded
  the migrated real UI without a public domain. That UI exposed a separate
  authority defect: package semver made a service-managed dev Runtime suggest
  a stable source update. The follow-up now derives channel from provenance and
  keeps source, desktop, CLI, service, and non-updating ownership distinct;
  service/dev/pinned/custom contexts do not create a duplicate Web updater.
  The disposable hosted empty-Volume/bootstrap-failure drill and retained
  valid-release forced-refresh fallback remain pending. No stable/beta release,
  tag, or channel promotion was performed.
