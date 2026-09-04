# Bun-native CLI Distribution

## Stable 0.91.0 acceptance — 2026-09-05

Maintainer authorized stable publication, including both Windows CLI targets.
AUR activation is deferred while account registration is closed. Promotion
[PR #1349](https://github.com/TraderAlice/OpenAlice/pull/1349) remains unmerged:
local full regression (712 files, 6,360 passes, three expected skips), root
types, unsigned packaged Workspace/Pi acceptance, OrbStack Docker and Guardian
recovery passed. The exact dev channel and both Windows native replay receipts
passed. Hosted Docker passed unchanged on retry, as did Windows desktop/upgrade,
Windows Broker Packs and Apple Silicon desktop/upgrade.

Intel desktop Guardian/PTY smoke timed out twice after successful takeover;
the second run also recorded a spawned Shell but no PTY connection. Do not retry
blindly or waive it. Add smoke-only boundary diagnostics and a single-host manual
rehearsal selector, identify the cause, then resume promotion and the separate
version-only preparation. No stable tag or public 0.91.0 bytes exist yet. Release
and package-manager authority remain owned by [[docs/development-workflow.md]]
and [[docs/cli-package-managers.md]].

Diagnostic [run 33893555127](https://github.com/TraderAlice/OpenAlice/actions/runs/33893555127)
passed native Intel takeover, PTY/CLI, packaged Workspace/Pi, and previous-app
upgrade acceptance. Main returned Workspace HTTP 201 at `16:17:23.386Z`; the
renderer observed response headers at `16:18:24.943Z`, then successfully spawned
and attached the Shell. Total takeover smoke was 88 seconds against a 90-second
budget. Increase only the smoke's bounded overall deadline to 180 seconds;
retain every assertion and phase diagnostic, with no sleep, retry loop or
production transport workaround. The underlying renderer delivery latency is
not explained or claimed fixed; track it in [#1350](https://github.com/TraderAlice/OpenAlice/issues/1350). Local diagnostic regression
passed 712 files / 6,361 tests with three expected skips, root/Desktop types and
real isolated takeover/PTY/socket acceptance.

## Homebrew activation — 2026-09-04

The maintainer created `TraderAlice/homebrew-tap` and authorized completing
the channel. Use the existing stable `v0.90.2` formula and archive bytes, not
new dev builds or an invented version. The tap owns one lightweight hourly/manual
stable sync workflow, using its own `GITHUB_TOKEN`; the main repository's
cross-repository token writer remains disabled. Owner contract:
[[docs/cli-package-managers.md]].

- [x] Verify all four public archive checksums, sidecars, and formula asset digest.
- [x] Exercise native macOS ARM64 Homebrew install and real detached Runtime
  startup with an isolated AliceProject and no Node/Bun/agent commands in PATH.
- [x] Publish the tap, verify its public install and hosted sync receipt.
- [x] Confirm manager-owned update/removal, user-data preservation, and record
  final acceptance links. Existing user PATH and installations remain untouched.

Accepted [tap PR #1](https://github.com/TraderAlice/homebrew-tap/pull/1);
[sync run 33889442153](https://github.com/TraderAlice/homebrew-tap/actions/runs/33889442153)
used `GITHUB_TOKEN` to publish formula commit `43d9f20`. Public
`brew install traderalice/tap/openalice` resolved `0.90.2` on macOS ARM64.
Local verification covered five sync contracts, four public archive hashes and
sidecars, formula digest/byte equality, real isolated Runtime/Web start/stop,
package-manager update/uninstall guidance, and data preservation. No new
Linux/Intel runtime test was purchased for byte-identical release assets.
A second [sync run](https://github.com/TraderAlice/homebrew-tap/actions/runs/33889497212)
verified the unchanged version without archive downloads or an empty commit.

Status: Active — macOS/Linux native CLI is public in v0.90.2 and the separately
dispatched v0.91.0-beta.3 is externally verified; stable remains v0.90.2 while
stable/beta discovery authority is converged on the OpenAlice CDN. Native
Windows x64/ARM64 channel acceptance and AUR activation remain in progress;
Homebrew is public at `0.90.2`. npm/Bun's five public
packages are published at v0.90.2 under maintainer `jiaran258`.

Accepted OIDC increment: replace the temporary npm token with GitHub OIDC trust on
the same five packages. Preserve stable-only publication and accepted artifact
bytes; no Windows activation, new version, or package-manager switch changes.
The non-publishing exchange rehearsal lives in `release.yml` so it verifies
the real trusted workflow identity. Owner contract: [[docs/cli-package-managers.md]].

- [x] Replace token-based preflight/publication wiring and add OIDC contract tests.
- [x] Save all five npm Trusted Publisher connections, allowing direct publish
  from `TraderAlice/OpenAlice` / `release.yml` (2026-09-04).
- [x] Complete local verification: root typecheck; 708 full-suite files,
  6,331 passed and 3 expected skips; 47 focused checks and 82 workflow contracts.
- [x] Integrate [PR #1342](https://github.com/TraderAlice/OpenAlice/pull/1342)
  into `dev` at `f37243b7`.
- [x] Run the real five-package OIDC exchange rehearsal without publishing:
  [run 33871780397](https://github.com/TraderAlice/OpenAlice/actions/runs/33871780397),
  one successful 15-second job; all release/build/publication jobs skipped.
- [x] Revoke `openalice-first-publish` on npm and delete the GitHub `NPM_TOKEN`
  secret after maintainer confirmation on 2026-09-04. Both removals verified.
- [x] Repeat the five-package exchange after removing both credentials:
  [run 33872141409](https://github.com/TraderAlice/OpenAlice/actions/runs/33872141409)
  passed in a single 16-second job without publishing.

The next authorized stable release still owns real new-version upload and
provenance acceptance. The persistent npm channel switch remains unchanged;
normal source promotion must carry the OIDC workflow to `master` before a new
stable release uses it. Windows x64 and ARM64 are the maintainer's accepted next
platform increment, separate from this completed authentication change.

## Current increment: unified Windows channels

Accepted 2026-09-04: the portable-only decision below is superseded. Windows
x64 and ARM64 join the existing stable/beta/dev version authority, not a new
preview version system. Missing personal Windows hardware is an explicitly
recorded interactive acceptance gap, not a reason to postpone distribution.
Use the existing native runners for bounded artifact checks; do not restore
full hosted source suites to dev/beta publication.

Ordered delivery:

- [x] Extend common target/provenance and installer selection to Windows;
  retain readable manifests for already-installed macOS/Linux dev clients.
- [x] Add the shared-channel PowerShell bootstrap and side-by-side activation,
  update, rollback, and data-preserving removal. Never overwrite a mapped EXE.
- [x] Produce canonical Windows artifacts in the ordinary dev/release lanes,
  preserving candidates before acceptance and allowing replay without rebuild.
- [x] Extend npm/Bun materialization and publication inputs to Windows without
  adding Windows branches to Homebrew/AUR. First publication and OIDC enrollment
  are separate external-authority checkpoints, not implied by generated files.
- [ ] Verify local contracts/types/full regression once, existing POSIX
  installation, and bounded native Windows install/update/rollback/start/stop.
- [ ] Integrate to dev, inspect live six-target publication, and record the
  remaining interactive Windows/provider gap before any versioned promotion.

One product version and source commit bind the target set. Platform-specific
installer bytes are checksum-bound snapshots selected by the shared updater.
Windows uses an atomic text activation pointer to immutable release directories
instead of requiring administrator symlink privileges or overwriting a running
executable. Electron remains on its existing desktop updater.

Dev/beta cross-build Windows on Linux, reusing dev's platform-neutral inputs.
Only stable and an explicit native rehearsal allocate Windows runners. Native
acceptance preserves the candidate before running and can replay it without
dependency installation or recompilation.

Current verification: root/CLI typechecks passed; complete local suite ran once
(6,348 passed, six stale package-count/workflow assertions repaired and their
focused suites rerun green, three expected skips). The clean OrbStack installer
and real macOS npm/Bun installation, pending update, restart and removal passed.
Canonical Windows candidates from source `5b172265` are preserved in
[run 33878424385](https://github.com/TraderAlice/OpenAlice/actions/runs/33878424385).
Native replay exposed PortableGit internal hard links, Windows PowerShell 5.1's
null-string conversion in atomic replacement, and a transient staged-EXE rename
lock; these now have bounded handling. ARM64 managed installation, real
Guardian/Alice/Web/Git, mapped-runtime update, bidirectional rollback and external
data-preserving removal passed in
[run 33880423746](https://github.com/TraderAlice/OpenAlice/actions/runs/33880423746).
Its npm package assembly exposed a release inventory larger than the default
1 MiB subprocess buffer; the bounded buffer and a local regression fixture are
fixed. Deferred CLI self-removal and native npm/Bun acceptance are being replayed
against those same candidate bytes, not represented as a new product build.

Delivery update: [PR #1346](https://github.com/TraderAlice/OpenAlice/pull/1346)
integrates this topic into the ordinary dev lane after local acceptance; the
remaining manual Windows rerun is deliberately not a synchronous dev gate.
Both architectures have exercised install/start/update/rollback. The post-exit
helper exposed Bun's Windows detached-child behavior, matching
[Bun #31603](https://github.com/oven-sh/bun/issues/31603); the implementation now
uses an awaited, quoted `cmd /c start` bootstrap instead of a new polling
protocol. Its fresh native recheck is
[33884781763](https://github.com/TraderAlice/OpenAlice/actions/runs/33884781763)
(candidate source `5e800195`), still pending when this delivery note was written.
Windows x64 npm install/native execution/manager removal and Bun install/native
execution/ownership passed. Bun leaves a global entry after removing its package;
[issue #1347](https://github.com/TraderAlice/OpenAlice/issues/1347) records the
upstream boundary, and receipts must expose it rather than claim clean removal.
Post-merge six-target CDN activation and the final native receipt are recorded
on the integration PR; versioned release and Windows npm authority are still
separate maintainer actions.

### Accepted preview groundwork

Accepted 2026-09-04: ship both Windows architectures iteratively, without making
the Windows experiment a prerequisite for existing macOS/Linux channels.
Owner contracts: [[docs/cli-installer.md]], [[docs/local-runtime.md]].

Choose a portable ZIP plus checksum-bound, side-by-side PowerShell installation
first. This gives testers a complete product immediately without prematurely
claiming stable npm availability or adding Windows junction/update recovery to
the first increment. A direct managed updater and npm registration remain later
acceptance steps; custom preview provenance deliberately disables automatic
channel discovery. Agent CLIs remain user-owned.

- [x] Compile both Windows architectures with pinned Bun 1.4.0 locally.
- [x] Assemble complete ZIPs with UI, templates, helpers and checksum-pinned
  PortableGit/Bash; use the existing desktop Git pins, not desktop managed Pi.
- [x] Add explicit PowerShell archive installation into a new directory, with
  checksum/path/host checks, consent, no admin/PATH changes, and no data removal.
- [x] Correct Windows Git environment, npm-agent interpreter resolution and
  ConPTY termination; bound slow WebSocket consumers without POSIX signals.
- [x] Add an independently retryable, manual x64/ARM64 workflow. Preserve each
  archive before its native smoke so failures retain reproduction bytes.
- [x] Complete local regression/type checks and integrate [PR #1344](https://github.com/TraderAlice/OpenAlice/pull/1344)
  into `dev` at `1d1dc21d`: full baseline 6,342 passes, final focused 74 passes,
  root/CLI types, local Windows ZIP builds and complete macOS native smoke.
- [x] Run native Windows installation, Guardian/Alice/Web, Git, ConPTY input,
  resize, independent termination and stop checks for each architecture.
- [ ] Perform interactive external-agent/provider acceptance; record concrete
  failures instead of claiming cross-compilation proves Windows runtime support.
- [ ] Add accepted Windows artifacts to the normal direct-channel manifest and
  npm topology, then first-publish and enroll the two new package identities.

The first preview is not a new beta/stable release. It is commit-addressed
Actions output with a separate native acceptance receipt and no mutable channel
alias. `CLI Installer Smoke` can dispatch only this lane from integrated `dev`
using `windows_preview=true`, without the normal manual installer matrix.

Native rehearsal [33874069985](https://github.com/TraderAlice/OpenAlice/actions/runs/33874069985)
preserved the x64 ZIP and passed ConPTY input/resize/independent termination.
Its installation smoke exposed inherited PowerShell 7 `PSModulePath` preventing
Windows PowerShell 5.1 from discovering `Get-FileHash`; reset only that child
environment, not the host. A separate old classifier assertion also needed to
recognize the manual Windows-only selector. Neither failure is waived.
The next smoke attempt accepts the saved ZIPs with `windows_candidate_run`,
skipping dependency installation and all rebuilds; product changes still need
a newly compiled candidate. Ambiguous/missing archived candidates fail closed.

Accepted native replay: [33875035438](https://github.com/TraderAlice/OpenAlice/actions/runs/33875035438)
passed on both native hosts, reusing product commit `579bd53e` from the first
build. ARM64 took 66 seconds and x64 67 seconds; both skipped Node/pnpm setup,
dependency installation and all builds. The receipts bind these exact archives:

| Architecture | Content identity | Archive SHA-256 |
|---|---|---|
| x64 | `bec6a7546a3e1c4c` | `66f98d667861df4e8bc74a60f2e12665dd1bbbcbbfe76495d0b7764bc25bcf0c` |
| ARM64 | `dc78db8c9192513a` | `8ad8791c605e5105dedfe84c8e5faa56258e706d653914d64275d5a08cd41fc8` |

[x64 preview](https://github.com/TraderAlice/OpenAlice/actions/runs/33874069985/artifacts/9937224452)
and [ARM64 preview](https://github.com/TraderAlice/OpenAlice/actions/runs/33874069985/artifacts/9937338651)
are retained for 30 days as Actions artifacts, not permanent GitHub Release or
npm assets. Real interactive Agent/provider use and manual upgrade/removal are
still explicit follow-up acceptance, not implied by this smoke.

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

The original cutover gate covers macOS and Linux. Windows x64 and ARM64 now
have a separate preview increment above; they do not block the existing matrix.

| Platform | Architectures | Initial gate |
|---|---|---|
| macOS | arm64, x64 | Required |
| Linux glibc | arm64, x64 | Required |
| Windows | x64, arm64 | Independent preview; native acceptance pending |

Linux musl remains deferred. Windows ARM64 is explicitly requested and is not
replaced by an x64 emulation claim.

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
updater; direct stable/beta CLI installs use `openalice update`; and Docker stays
owned by the service deployment. Direct dev changes are compared
by the native CLI or deployment through checksum and content identity, not by
package semver in the browser. Pinned, custom, and invalid provenance fail
closed without an implicit update action.

Package semver remains build/display metadata rather than source-channel
authority. Once a release is accepted, a focused two-manifest PR synchronizes
its root and CLI versions back to `dev`; explicit source launcher identity keeps
that checkout on the dev channel.

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

- [x] Reserve the npm meta and platform package names; keep the resulting
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
- [x] Let an authenticated first stable publication claim the five fixed,
  unreserved npm names, while retaining maintainer checks for existing names
  and integrity-checked idempotent retries after partial publication.
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
  bundled-Agent/public-Web contract; managed SSH remains a separate
  provider-neutral existing-host path.

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
  `0.91.0-beta.1`; keep release preparation isolated from implementation, then
  synchronize only the accepted published version metadata back to `dev`.
- [x] Dispatch one `beta` release for `v0.91.0-beta.1`. Do not produce or queue
  a stable release from the same run.
- [x] Externally verify the beta GitHub Release, updater feeds, CLI manifest,
  installer, native Runtime, and Broker Packs while proving every stable-owned
  mutable surface stayed byte-for-byte unchanged.
- [x] Leave later fixes on `dev`. A `beta.2` checkpoint is optional; stable is
  a separate later decision after beta testing and maintainer acceptance.
- [x] After later `dev` fixes and the beta fast-lane redesign, publish only
  `v0.91.0-beta.2` and independently verify its public surface and
  stable-channel isolation.
- [x] After the remote-readiness increment, publish only
  `v0.91.0-beta.3`, independently verify all accepted assets and
  stable-channel isolation, and record the Settings identity-refresh fix as the
  following `dev` increment.
- [x] Synchronize the root and CLI package baselines to `0.91.0-beta.3` on
  `dev`, while making explicit source launcher identity—not package semver—the
  authority for the `dev` update channel.

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

### 12. Make local acceptance primary for dev and beta

- [x] Fix the confidence boundary: surface-appropriate local tests, browser,
  OrbStack, and unsigned Electron/package smokes are the primary development
  evidence. Hosted CI is a cheap integration/build backstop for routine PRs,
  not a second full test environment.
- [x] Reduce routine integration PRs to one clean Ubuntu workflow-contract,
  root-typecheck, and complete-build lane. Do not allocate the full Vitest
  suite, macOS/Windows matrix, dev-smoke, Docker image, desktop packages, or
  managed-SSH fixture.
- [x] Retain only the cheap checkout HTTP installer on relevant dev PRs. Keep
  the four native dev candidates, packaged-runtime acceptance, atomic alias
  publication, and live raw-dev install on the post-merge `dev` push.
- [x] Reduce exact beta version preparation to the trusted base classifier,
  workflow contracts, root typecheck, and stable aggregate check name. Let the
  manually dispatched Release build and accept the final version-bearing
  artifacts once; the post-merge full `master` run is an asynchronous backstop.
- [x] Keep `master` promotion, stable preparation/release, `master` push,
  nightly, and manual full validation on the complete cross-platform lanes.
- [x] Verify the lightweight lane on its own `dev` PR and record the measured
  before/after wall and runner time. Local workflow contracts, root typecheck,
  full tests, and full build must already be green before opening that PR.

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
pnpm test:system:guardian
pnpm test:system:installer
pnpm test:system:installer:dev
pnpm test:system:remote
pnpm electron:smoke:pty
pnpm electron:smoke:workspace
pnpm exec vitest run \
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
waiting on hosted runners; hosted jobs remain final publication and stable
release gates rather than a duplicate routine-development test harness.
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
10. managed remote can install, start, reuse, and tunnel the native Runtime on
    an ordinary SSH-reachable host without owning its infrastructure provider.
## Progress Log

- 2026-09-04: Maintainer authorized attempting the five unscoped npm names
  with the accepted v0.90.2 tarballs. A seven-day bootstrap token is configured
  in GitHub Actions. Added an explicit `Release / publish-npm` operation for
  current stable assets only, without rebuilding or changing version/CDN state.
  npm 12 installation requires explicit `--allow-scripts=openalice`. An
  isolated local registry serving the original, integrity-verified tarballs
  passed npm 12.0.2 / Node 22.22.2 install, version, detached start, status, and
  stop on macOS arm64 with no Node/Bun in Runtime PATH. All five packages were
  published under `jiaran258` in
  [run 33860369715](https://github.com/TraderAlice/OpenAlice/actions/runs/33860369715)
  (98 seconds, one hosted job). Independent registry reads matched all five
  accepted integrity values; a fresh public-registry npm 12 install passed
  version, detached start, status, and stop with isolated data. Tooling merged
  through [PR #1340](https://github.com/TraderAlice/OpenAlice/pull/1340), with
  root typecheck, 34 focused tests, and 6,319 hermetic tests passing (3 expected
  skips). No beta, CDN, desktop, Homebrew, or AUR publication ran. The persistent
  automatic npm switch remains disabled; OIDC is still follow-up work.

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
- 2026-09-03: Public-channel inspection confirmed the direct Bash installer is
  live, all five intended npm names remain unreserved, the Homebrew Tap does
  not exist, and the repository's `NPM_TOKEN` now returns HTTP 401. The npm
  authority gate now treats 404 names as explicit first-publication targets
  after authenticating the token, while existing names still require matching
  maintainership. Stable npm publication now verifies every tarball against
  the accepted manifest and safely skips an already-published identical
  version, so a partial first publication can be retried without weakening
  package identity. External activation remains blocked on replacing the npm
  token and deliberately enabling the stable npm switch.
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
- 2026-09-01: Published only
  [`v0.91.0-beta.2`](https://github.com/TraderAlice/OpenAlice/releases/tag/v0.91.0-beta.2)
  from `87b5a81aa608c6c687c21d24259ea78054a632ac` in
  [release run 33475817953](https://github.com/TraderAlice/OpenAlice/actions/runs/33475817953).
  The beta fast lane completed in 17:53 wall time and 64:04 aggregate runner
  time across 16 jobs, versus 35:03 and 110:09 across 21 jobs for beta1: 49.0%
  less wall time and 41.8% less runner time. The signed/notarized Intel macOS
  current candidate remained the 14:44 critical path. Independent verification
  accepted all 49 GitHub assets, versioned desktop downloads, four native CLI
  archives and sidecars, shared/versioned installers, updater feeds, Broker
  Packs, and the beta CDN manifest. The default installer and GitHub latest
  release still resolve stable `v0.90.2`; the captured stable manifest, feeds,
  aliases, ETags, and sizes remained unchanged.
- 2026-09-01: Reframed development confidence around local acceptance instead
  of constrained hosted runners. Routine `dev` PRs now retain one clean Ubuntu
  workflow-contract, root-typecheck, and complete-build lane; relevant CLI
  changes additionally retain only the clean checkout HTTP installer. Exact
  beta preparation retains the trusted base classifier plus contracts and
  typecheck, while the Release workflow owns the final candidate build and
  artifact acceptance. Full tests, macOS/Windows, dev-smoke, Docker, desktop,
  Broker Pack, and managed-SSH lanes remain on `master`, stable, nightly, or
  manual authority rather than synchronously blocking routine development.
  Before opening the proving PR, local workflow contracts passed 47/47, the
  root suite passed 5,431 tests with 13 expected skips, root typecheck passed,
  and the complete workspace build passed. The prior remote baseline was a
  15:31 desktop critical path for the preceding product PR and a 5:15
  redundant Ubuntu root-test lane for the version-only beta3 PR. On the
  workflow's own [PR #1298](https://github.com/TraderAlice/OpenAlice/pull/1298),
  central feedback completed in 2:50 wall and 2:37 runner time; the relevant
  clean checkout installer completed in 0:31 wall and 0:25 runner time in
  parallel. All full-test, macOS/Windows, dev-smoke, Bun-feasibility, and
  managed-SSH jobs were explicitly skipped. The combined critical path fell
  81.7% from 15:31 to 2:50 and aggregate hosted allocation fell from roughly 70
  minutes to 3:02 (about 95.7%).
