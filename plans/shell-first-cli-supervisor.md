# Shell-first CLI and Supervisor TUI

Status: Active

Delivery mode: Serial / interactive. The user selected serial delivery on
2026-07-30 because the new TUI and its dependent Runtime/update work need each
accepted increment integrated into `dev` before the next increment builds on
it. Each increment gets proportional local verification, a PR to `dev`, and a
merge without waiting on merely pending CI. A known completed failure blocks
the next increment until repaired.

Superseded planning PR: #852 was opened under the earlier parallel direction.
It is not retroactively merged; the first serial implementation PR carries the
updated canonical plan and supersedes it.

Superseded renderer PR: #857 proved the real PTY, Git Bash, terminal cleanup,
and Windows Guardian seams, but its handwritten `.mjs` renderer is not the
product architecture. Its platform and harness fixes are salvaged selectively;
the renderer/session implementation is replaced by the TypeScript `pi-tui`
application shell.

Owner guides:

- [[docs/cli-supervisor.md]]
- [[docs/cli-installer.md]]
- [[docs/local-runtime.md]]
- [[docs/managed-workspace-runtime.md]]
- [[docs/remote-access.md]]
- [[docs/data-locations.md]]
- [[docs/development-workflow.md]]

Research:

- [[docs/reference/pi-herdr-cli-architecture.md]]
- [[docs/reference/herdr-remote-architecture.md]]

Predecessor:

- [[plans/cli-lifecycle-quality.md]]

## Objective

Make Shell-first OpenAlice a complete, first-class product distribution:

- `openalice` opens a local Supervisor TUI that manages OpenAlice rather than
  reproducing the browser product;
- Guardian owns a persistent local Runtime that survives terminal, TUI,
  browser, and SSH disconnection;
- non-interactive commands expose the same lifecycle and diagnostics to shell
  scripts, CI, remote hosts, containers, and service managers;
- the installed CLI, headless Runtime, and displayed product version advance as
  one OpenAlice release;
- installation and N-1 to N upgrade are exercised end to end against a running
  Runtime before release.

The user-facing model is:

```text
openalice TUI    -> local operations and lifecycle
browser Web UI   -> complete OpenAlice product interaction
Electron         -> complete desktop distribution
Guardian         -> one authoritative Runtime owner beneath every surface
```

## Product Decisions

### Supervisor, not a second product UI

- The TUI owns lifecycle, health, logs, diagnostics, updates, and instance
  selection.
- It may show bounded Workspace, Session, Agent, and headless-task counts.
- It opens the Web UI for chat, trading, credentials, Workspace editing, and
  Agent terminal interaction.
- It stays useful while Guardian is absent, starting, unhealthy, incompatible,
  stopping, updating, or reconnecting.
- `q`, root `Esc`, and `Ctrl+C` restore the terminal and detach. They never stop
  the Runtime.

### Runtime ownership

- Guardian remains the only process-tree owner and recovery authority.
- CLI and TUI actions use the Guardian lease and local control endpoint; they
  do not create another daemon or PID-file kill path.
- Stop, restart, takeover, update restart, and instance deletion remain
  separate actions with separate impact disclosure.
- Heartbeat is health evidence, never permission to unlock a possibly live
  writer.
- Foreground operation remains explicit for development, Docker, system
  supervision, and diagnosis.

### Vocabulary and version

- `instance` means one complete home, Guardian tree, Runtime endpoint, and
  lifecycle. `default` is implicit for ordinary users.
- Instances are not called sessions because Workspace Session already has a
  durable product meaning.
- Users see one OpenAlice product version.
- CLI/Runtime content identity, provider, control protocol, and pending
  activation are diagnostic fields rather than additional version brands.

### Target command grammar

```bash
openalice
openalice tui [--instance <name>]
openalice up [--instance <name>] [--open]
openalice run [--instance <name>]
openalice down [--instance <name>]
openalice restart [--instance <name>]
openalice status [--instance <name>] [--json]
openalice open [--instance <name>]
openalice logs [--instance <name>] [--component <name>] [--follow] [--json]
openalice doctor [--instance <name>] [--json] [--fix]
openalice instance list [--json]
openalice instance delete <name>
openalice update [--check] [--yes]
openalice uninstall [--plan] [--yes]
openalice completion <bash|zsh|fish|powershell>
```

- `up` starts in the background, waits for real readiness, and does not open a
  browser unless `--open` is present.
- `run` owns the foreground and stops its self-owned Runtime on interruption.
- `open` starts nothing and opens only a verified healthy endpoint.
- human status is concise; JSON uses a versioned envelope.
- `server` remains a compatibility presenter until remote and old scripts have
  migrated.
- source development moves to explicit `openalice dev` or
  `openalice run --source <path>` before stable installation stops depending on
  a checkout.
- bare `openalice` is the product TUI entry from its first shipped CLI-app
  increment. An unfinished panel is shown as unavailable inside that shell; it
  is not a reason to preserve a second default entry model.
- every explicit subcommand bypasses the TUI and uses the same typed
  application services. Non-interactive commands are the automation API, not
  a separate implementation.
- `openalice run` remains the explicit foreground escape hatch for development,
  containers, service managers, and diagnosis.

### TUI information architecture

The minimum 80 by 24 root screen contains:

1. product version, channel, and update notice;
2. instance selector and lifecycle state;
3. owner, endpoint, home, uptime, provider, and Runtime version;
4. Alice, UTA, and Connector state;
5. bounded activity counts when the Runtime exposes them;
6. recent lifecycle events or actionable diagnostic detail;
7. a stable keyboard action bar.

Initial actions:

| Key | Action | Safety |
|---|---|---|
| `o` / Enter on URL | Open Web UI | No Runtime mutation |
| `l` | Logs | Read-only |
| `d` | Doctor | Read-only until a separate confirmed fix |
| `u` | Review update | Plan before mutation |
| `r` | Restart | Active-work impact confirmation |
| `x` | Stop | Explicit confirmation; never bound to quit |
| `i` | Instances | Deletion remains separately confirmed |
| `?` | Help | Read-only |
| `q` / `Ctrl+C` | Detach | Runtime remains alive |

The TUI must support resize, narrow fallback, monochrome/no-color terminals,
redirected-output refusal, Unicode-width differences, raw-mode restoration,
control disconnect/reconnect, and safe rendering of control bytes. It never
parses human logs as lifecycle truth.

### Technical shape

- Build the CLI application in strict TypeScript and emit immutable ESM
  artifacts for installation. Source readability and refactoring safety take
  priority over maintaining a handwritten `.mjs` implementation.
- Use `@earendil-works/pi-tui` as the terminal substrate. It already supplies
  the TypeScript component model, differential rendering, overlays, Unicode
  width, IME-aware input, terminal lifecycle, and Windows terminal support that
  OpenAlice would otherwise have to reproduce.
- Keep lifecycle, configuration, update planning, and diagnostics in a
  presentation-neutral application core. Command presenters and the TUI are
  two clients of the same services and schemas.
- Follow Pi's startup shape: parse and dispatch explicit commands first,
  resolve the complete launch context, build resources and application state,
  enter the TUI, then perform optional network checks asynchronously.
- Follow Herdr's process shape: detect the selected persistent Runtime, attach
  when compatible, start it when policy allows, and keep the TUI as a
  replaceable client of Guardian-owned facts.
- Use an explicit reducer/state machine; render is a pure projection and effects
  call the same services as non-interactive commands.
- Poll low-frequency status initially. Add streaming only when measured UX or
  remote efficiency requires it.
- Bundle the dependency closure and any required native assets inside each
  immutable CLI release; users never need a separate global TUI dependency.
- Retain the real-PTY/xterm harness as the terminal acceptance boundary. Do not
  retain the repository-owned ANSI renderer as product architecture.

### Launch context and configuration

Configuration resolves exactly once with observable provenance:

```text
defaults
  < installed Runtime provider
  < machine-wide Supervisor config
  < selected instance config
  < environment variables
  < explicit CLI flags
```

- The resolver produces one immutable `ResolvedLaunchContext`. Guardian and
  every child receive the resolved environment and do not independently
  reinterpret configuration.
- Every resolved field retains `value`, `source`, and whether it is locked by
  an explicit override so the TUI and Doctor can explain launch behavior.
- Machine-wide Supervisor configuration and the instance registry live outside
  any selectable `OPENALICE_HOME`; the selector must not store the pointer that
  selects itself.
- `--home` is an explicit one-run instance-home override. `OPENALICE_HOME`
  remains the highest-priority environment override for the complete
  OpenAlice data root.
- OpenAlice-managed Pi receives a per-instance `PI_CODING_AGENT_DIR` and
  session root under the resolved home. This isolates settings, trust,
  resources, and sessions between OpenAlice instances.
- A user-installed Pi launched outside the managed OpenAlice path keeps Pi's
  native global configuration. OpenAlice does not globally rewrite the user's
  own Pi environment.
- Configuration parse errors retain the last known valid running
  configuration, appear in the TUI and Doctor, and are checked without
  mutating state by `openalice config check`.

### Control compatibility

- Preserve a small stable transport envelope when possible.
- Report API schema version, compatibility range, product version, provider,
  owner, capabilities, and components.
- Add capabilities before methods so old clients degrade cleanly.
- Distinguish unsupported method, incompatible protocol, unreachable Runtime,
  foreign-machine owner, stale owner, and unhealthy component states.
- Keep status read-only across launcher surfaces.
- Advertise stop only for a matching self-owned CLI Runtime.
- Expose bounded log descriptors/tail without arbitrary file reads.
- Expose activity summaries only from presentation-neutral Guardian/Alice
  facts.

### Release and update model

The final direct-install release contains:

```text
OpenAlice release manifest
  -> CLI payload
  -> managed Pi payload
  -> platform-specific headless Runtime payload
  -> file hashes and authenticity metadata
  -> supported control compatibility range
```

The update transaction is:

1. identify provenance and permitted channel;
2. fetch metadata with bounded timeout;
3. download every required artifact before process mutation;
4. verify version, platform, architecture, hashes, and authenticity;
5. validate staged launchers and Runtime in isolation;
6. inspect each instance and active-work/compatibility impact;
7. publish immutable version directories;
8. atomically switch CLI and next-start Runtime pointers;
9. leave compatible running instances alive with pending activation, or obtain
   explicit consent for incompatible restart;
10. verify Guardian ownership, control compatibility, and Alice readiness;
11. restore prior pointers and prior Runtime if activation fails;
12. retain bounded prior versions and collect only unreferenced inactive ones.

Package-manager-owned installations show the correct manager command rather
than self-update.

Update discovery and update application are separate states:

- after the TUI is usable, a bounded asynchronous check may advertise a newer
  OpenAlice release and cache release notes; network failure is non-fatal;
- `openalice update --check` and the TUI update panel expose the same result;
- applying an update always uses the OpenAlice release transaction above, not
  Pi's npm update transport or Herdr's single-binary replacement;
- status reports installed CLI version, running Runtime version, protocol
  compatibility, and `restartNeeded`/pending activation independently;
- an update first enumerates every running instance and active-work impact;
  compatible old Runtimes may remain attached to the old immutable release,
  while incompatible activation requires explicit restart consent;
- test-only manifest URLs, fake available versions, and transaction fault
  points are supported through dependency injection into the application core,
  never undocumented production environment switches.

## Non-goals

- Terminal chat, trading, settings, Workspace management, or Agent TUIs.
- Public Guardian/control listening.
- Replacing Electron signing, notarization, packaging, or auto-update.
- Silent boot-at-login or system-service installation.
- Live PTY handoff in the first headless bundle release.
- Native Windows PowerShell installation before its distribution boundary is
  reviewed.
- Application-state deletion during CLI uninstall or ordinary instance removal.

## Serial Delivery Increments

Checkboxes reflect repository truth. Every completed increment records its PR
and verification before the next dependent branch starts from updated `dev`.

### 1. Presentation-neutral lifecycle core

- [x] Extract structured inspect/start/stop/open operations from the human
  `server` presenter.
- [x] Add top-level `up`, `run`, `down`, `status`, and `open`.
- [x] Keep `start` and `server` behavior compatible.
- [x] Add schema-versioned lifecycle JSON envelopes and exit semantics.
- [x] Generate bash, zsh, fish, and PowerShell completion from the root command
  registry.
- [x] Extend the distributed installer payload and clean-install assertions.
- [x] Add the durable Shell CLI Supervisor owner guide and index routes.
- [x] Complete real Guardian/browser, installer, repository, and Electron
  verification.
- [x] Publish the first serial PR to `dev` as #853.

### 2. Control compatibility and observability

- [x] Specify transport/API compatibility and capability negotiation.
- [x] Add provider, product version, pending activation, component detail, and
  bounded uptime to normalized status.
- [x] Add safe rotated log discovery/tail and redaction.
- [x] Add read-only Doctor checks for provenance, Node/runtime requirements,
  ownership, ports, components, update metadata, and source/bundle integrity.
- [x] Exercise old-client/new-server and new-client/old-server fixtures.

### 3. TypeScript CLI application shell and PTY harness

- [x] Prototype a repository-owned renderer and real PTY harness in PR #857;
  use the result as test evidence rather than the final architecture.
- [x] Audit Pi `v0.83.0`, Herdr `v0.7.5`, current OpenAlice CLI/Guardian
  boundaries, configuration precedence, and licenses.
- [x] Select strict TypeScript plus `@earendil-works/pi-tui`; reject both a Rust
  rewrite and a handwritten `.mjs` product renderer.
- [ ] Convert `packages/cli` to TypeScript source with a deterministic build
  output and installer-owned dependency closure.
- [ ] Define one root command parser that dispatches explicit commands before
  interactive startup.
- [ ] Add `ResolvedLaunchContext`, typed application services, and dependency
  injection for filesystem, process, control, browser, terminal, clock, and
  update operations.
- [ ] Port the PTY harness with isolated HOME and `OPENALICE_HOME`,
  deterministic control fixtures, real input/resize, `@xterm/headless`
  parsing, transcripts, and timeouts.
- [ ] Test normal exit, Ctrl+C, SIGTERM, renderer failure, disconnect, resize,
  Unicode, no-color, and Git Bash.
- [x] Salvage the independent Windows Guardian atomic-owner replacement fix
  from #857 and close that superseded PR.

### 4. Supervisor TUI application

- [x] Make bare `openalice` enter the TUI; retain `openalice tui` as an explicit
  alias useful for tests and scripts.
- [x] Render the initial stable application chrome: product and channel header,
  selected home, lifecycle summary, detach action bar, and unavailable-state
  guidance.
- [x] Add navigation, help, update indicator, and selectable detail panels.
- [x] Show unfinished product panels as unavailable within the TUI instead of
  preserving a temporary non-TUI default command.
- [x] Implement stopped, starting, running, degraded, incompatible, stopping,
  and update-available states.
- [x] Add start, open, stop, restart, detach, help, and read-only detail.
- [ ] Add component/instance panels and narrow fallback.
- [x] Keep the TUI open and reconnect across a self-owned restart.
- [x] Complete source-backed macOS/Linux PTY and real browser acceptance before
  merging the bare-command behavior.

Dogfood follow-up on 2026-07-30 installed the CLI and managed Pi into an
isolated root, launched bare `openalice` through a real macOS PTY, started a
detached source Runtime, exercised Logs/Doctor/Help, verified
`/api/auth/status` plus the rendered Ask Alice route in a real browser,
detached the TUI, and reattached to the surviving Guardian. Repeating the
journey from an unrelated directory exposed and fixed the missing-source setup
and disappearing-action-diagnostic paths. The same increment then passed the
clean-container installer, managed SSH install/start/tunnel/reconnect/repair
smoke, and Electron PTY smoke; an interactive installer walk confirmed its
default-no post-install handoff opens the Supervisor without implicitly
starting the Runtime.

### 5. Logs, Doctor, and update UX

- [ ] Add top-level logs plus TUI filter/follow/pause/bounded history.
- [ ] Add Doctor summary/detail and copyable remediation.
- [ ] Add update notice, plan, progress, and impact screens.
- [ ] Show active work before stop, restart, takeover, or restart-requiring
  update.
- [ ] Add PTY journeys for failed start, disconnect, logs, incompatible control,
  update refusal, and reconnect.

### 6. Configuration and instance model

- [x] Define machine-wide Supervisor and selected-instance schemas outside
  `OPENALICE_HOME`.
- [x] Resolve defaults, machine config, instance config, environment, and CLI
  flags once into `ResolvedLaunchContext`, retaining field-level provenance.
- [ ] Add `openalice config check` plus TUI diagnostics; invalid live reload
  retains the last valid configuration.
- [x] Add a selected-instance TUI settings overlay for complete home, Web port,
  and update-check inheritance, with active-Runtime guards and visible
  environment/CLI locks.
- [x] Let parameter-free Setup switch between selected-instance values and
  machine defaults while preserving environment and explicit CLI priority.
- [x] Give OpenAlice-managed Pi an instance-local `PI_CODING_AGENT_DIR` and
  session root without changing a user-installed Pi launched externally.
- [x] Update the managed Workspace runtime owner guide and tests for the new
  managed-Pi isolation boundary.
- [x] Define a versioned atomic CLI-owned registry mapping names to complete
  homes; never store the registry inside a selected home.
- [x] Preserve implicit `default` without moving existing data.
- [x] Add `--instance`, list, TUI selection, and collision checks.
- [ ] Make deletion remove registry ownership only by default.
- [ ] Test concurrent homes, ports, sockets, logs, foreign/stale owners,
  Electron ownership, and remote instances.

The first persisted-configuration increments activate a versioned atomic
`<Supervisor root>/config.json` and let the TUI validate, remember, and
immediately use the selected instance's source checkout, complete home, Web
port, and update policy. Returning a field to inheritance removes only that
instance key. Environment and CLI provenance visibly lock lower-priority
editing, while an active Runtime prevents its home or port from changing
underneath it. Setup now switches in place to machine defaults, persists their
Home, port, and update policy atomically, and immediately re-resolves the
selected instance. Higher-priority instance, environment, and explicit command
layers continue to win. `config check`, last-known-good live reload, and
registry deletion remain unchecked above.

The clean-host follow-up reuses the managed-remote install-source identity for
local startup. A stopped installed Supervisor now confirms `m Managed`, clones
the exact CLI branch/version into an installer-owned collision-safe path,
persists it for the selected instance, and continues through the normal
prepare/build/start flow. This closes the manual `git clone` gap while the
standalone headless artifact below remains the intended way to remove source
toolchains from ordinary installs.

The acceptance walk used a new isolated HOME and install root, installed only
CLI 0.87.0-beta plus managed Pi 0.83.0, then launched from an unrelated empty
directory. `m Managed` displayed the exact `branch dev` plan, cloned under the
install root, installed dependencies, built the Runtime, and reached Alice
ready on an isolated port. `/api/auth/status` and the root page passed, the
0600 Supervisor config retained the managed path, detach/reattach reused the
running Guardian, and TUI stop returned the home to absent.

### 7. Standalone headless Runtime artifact

- [x] Inventory server/UI/Guardian outputs, production dependencies, native
  modules, Broker Pack boundary, and managed Pi injection.
- [ ] Produce deterministic platform/architecture archives.
- [ ] Define authenticated manifest, version, compatibility, Node requirement,
  file hashes, and content identity.
- [x] Install immutable Runtime versions and validate without a checkout.
- [x] Add providers for bundle, source-development, Docker, Electron, and
  managed remote.
- [ ] Prove clean-host Alice, optional components, Web, Workspace PTY, and Pi.
- [x] Re-run unsigned Electron package acceptance for shared build changes.

### 8. Installer integration and source-development split

- [x] Add the Runtime identity/platform to installer plan/consent.
- [x] Make normal `up` select the bundle independent of cwd.
- [ ] Move checkout preparation/rebuild to explicit development provider.
- [x] Make managed remote reuse the release artifact and trust chain.
- [x] Distinguish installer-owned Runtime releases from preserved data and
  sources during uninstall.

The first bundle increment on 2026-07-30 produced a 107 MiB darwin-arm64
archive from three production dependency closures. Content-aware hard-link
deduplication removed 500 MiB from the expanded tree before compression. The
34,613-entry manifest verifies product version, Node floor, platform,
architecture, modes, hashes, symlinks, required Guardian/Alice/UI/UTA/Connector
layout, and content identity. A release matrix now builds darwin/linux on arm64
and x64, installs each archive outside the checkout, boots it, runs Doctor, and
stops it before publication.

The installer places CLI, Pi, and Runtime beneath the same immutable
`cli-versions/<ref>-<content-id>` directory and atomically switches one launcher
that exports both managed providers. Stable versioned installers download
release metadata plus the matching archive, verify both archive SHA-256 and
the internal manifest, and bind CLI and Runtime to one OpenAlice version.
Local development can pass `--runtime-archive` and `--runtime-sha256`.

Dogfood installed the candidate into a fresh temporary root, launched
`openalice up` from `/tmp` with no checkout, reached Alice at loopback, passed
Doctor with zero failures, opened the bare `pi-tui` Supervisor against the
surviving Runtime, detached without stopping it, and stopped it cleanly.
Guardian reported `provider=bundle`, product/runtime `0.87.0-beta`, and content
`d4a8e69b270f3cd1`. The OrbStack Linux arm64 SSH fixture then installed the
matching bundle through the ordinary remote installer, launched and tunneled
without a checkout or build tools, survived disconnect, repaired managed Pi,
reconnected, and stopped through Guardian. Remaining work in this increment is
reproducibility/authenticity hardening. The unsigned packaged-Electron Workspace
acceptance passed its real Electron PTY, Shell, managed Pi response, scheduled
Issue, and cleanup checks. The interactive clean-container installer playground
also passed manual review of consent, plan copy, command/version JSON,
completion, update policy, uninstall preservation, managed Pi, PATH, and
source-tool planning.

### 9. Atomic Runtime update, activation, and rollback

- [x] Separate immutable install provenance from update-channel policy so a
  release-owned exact-tag install remains on stable while explicit
  `--version` installs stay pinned.
- [ ] Stage matching CLI, Pi, and Runtime as one product release.
- [ ] Plan compatibility and active-work impact for running instances.
- [ ] Keep compatible old processes alive with pending activation.
- [ ] Confirm restart for incompatible activation.
- [ ] Add readiness-gated pointer/Runtime rollback.
- [ ] Add bounded retention and reference-safe garbage collection.
- [ ] Expose transaction phase/recovery in JSON, TUI, logs, and Doctor.
- [ ] Inject failure at every durable transaction boundary.

### 10. Release gates and operational hardening

- [ ] Add real previous stable to candidate N-1 to N.
- [ ] Add post-merge live dev Runtime install/upgrade acceptance.
- [ ] Cover supported macOS/Linux architectures.
- [ ] Add post-publication installer/manifest/CDN canary.
- [ ] Preserve Electron, Docker, managed remote, Guardian recovery, and
  source-development lanes.
- [ ] Document explicit systemd/launchd composition before considering an
  opt-in service installer.
- [ ] Move final truth into owner guides and complete this plan only after a
  versioned release passes the full matrix.

## Acceptance Matrix

### Command and ownership

| Scenario | Required result |
|---|---|
| `up` from stopped | Returns after control and Alice readiness |
| `up` from running | Idempotent verified endpoint; no signal |
| shell/TUI detach | Runtime remains alive |
| `run` interrupted | Self-owned Runtime stops cleanly |
| Electron owner | Inspect/open allowed; down refused |
| takeover | Guardian recovery ordering only |
| foreign machine | Never reclaimed from heartbeat |
| JSON status | Stable absent/starting/running/degraded/incompatible/stopping schema |

### TUI

| Scenario | Required result |
|---|---|
| 80 by 24 | Root controls visible |
| narrow/resize storm | Fallback without crash or backlog |
| quit/Ctrl+C | Terminal restored; Runtime unaffected |
| renderer exception | Terminal restored with diagnostic |
| Guardian disconnect/restart | TUI stays alive and reconnects |
| no color | State and confirmations remain understandable |
| log control bytes | Escaped safely |
| restart update | Active-work impact shown first |

### Install and update

| Scenario | Required result |
|---|---|
| clean non-root | Runnable CLI, TUI, Pi, and headless Runtime |
| repeat install | No duplicate releases/PATH/registry/data mutation |
| compatible running N-1 | N stages; old Runtime usable until activation |
| incompatible running N-1 | Restart requires consent |
| failed download/verification | No pointer/process mutation |
| activation failure | Prior pointers and Runtime recover |
| interrupted transaction | Next run diagnoses and resumes or rolls back |
| uninstall | Installer bytes removed; product/user data preserved |
| package manager | Self-update disabled with manager guidance |

## Verification

Every code increment runs:

```bash
npx tsc --noEmit
pnpm test
```

Add as touched:

```bash
pnpm -F @traderalice/openalice-cli test
pnpm test:guardian-recovery
pnpm test:install:docker
pnpm test:install:dev-channel
pnpm test:remote:docker
pnpm docker:smoke
cd ui && npx tsc -b
pnpm electron:smoke:workspace
pnpm electron:smoke:pty
pnpm electron:smoke:packaged --temp-data
```

The TUI harness owns an isolated HOME and `OPENALICE_HOME`, drives a real PTY,
parses ANSI state with `@xterm/headless`, records diagnostics, and fails on
leaked children or terminal restoration failure.

Runtime update acceptance uses real N-1 assets, transaction fault injection,
and data hashes before and after each success/failure. Routine acceptance is
non-trading and uses no real credentials or broker accounts.

## Risks and Kill Switches

| Risk | Mitigation |
|---|---|
| Default command surprises foreground users | Document bare TUI semantics and preserve explicit `run`, commands, and the `tui` alias |
| TUI leaves terminal broken | Central restoration guard plus PTY failure/signal tests |
| TUI becomes a second product | Supervisor boundary and Web handoff |
| Protocol strands old Runtime | Capabilities and cross-version fixtures |
| Update kills active Agents | Download first, impact plan, compatible keep-alive |
| Bundle drifts from Electron | Shared inventory/manifest and package smoke |
| Native dependency fails | Platform artifacts and clean-host matrix |
| Instance conflicts with home | Additive versioned default mapping |

Kill switches preserve explicit `tui`, source-backed `run`, immutable prior
releases/pointer rollback, disableable non-blocking update discovery, and
loopback-only binding.

## Completion Criteria

This plan is complete only when:

1. stable clean-host installation needs no source checkout;
2. bare `openalice` opens a PTY-tested Supervisor TUI and detach leaves Runtime
   alive;
3. lifecycle, status, logs, Doctor, completion, and instances are stable;
4. users see one product version while diagnostics report exact identities;
5. real N-1 upgrades running to candidate with impact planning, preservation,
   and readiness-gated rollback;
6. installer, TUI PTY, Guardian, browser, Electron package, Docker, managed
   remote, dev-channel, and publication canary evidence is green;
7. owner guides record the shipped architecture and final release.

## Progress Log

- 2026-07-29: Audited CLI lifecycle, Guardian control, source-backed Runtime,
  installer smoke, Herdr reference, and cross-surface gates. Drafted the first
  canonical plan in parallel PR #852.
- 2026-07-30: User changed the goal to serial delivery. Started increment 1
  from current `dev`: added a presentation-neutral lifecycle core, canonical
  top-level commands, versioned JSON, shell completion, compatibility presenter,
  distributed payload coverage, and the Shell CLI Supervisor owner guide.
- 2026-07-30: Increment 1 verification passed: CLI unit tests (114), root
  TypeScript and Vitest (3,617 passed, 9 skipped), Guardian runtime and recovery
  smoke, real isolated background `up/status/down`, foreground PTY Ctrl+C,
  clean installer upgrade/uninstall Docker smoke, managed remote SSH smoke, UI
  typecheck, server build, and Electron PTY smoke.
- 2026-07-30: Built the first standalone headless Runtime increment. A clean
  macOS install booted outside any checkout and the OrbStack Linux arm64 SSH
  fixture installed, started, tunneled, repaired, reconnected, and stopped the
  release bundle without creating a managed source checkout.
- 2026-07-30: Published increment 1 as serial PR #853 targeting `dev`.
- 2026-07-30: Completed increment 2 implementation and local verification:
  additive control API/capability negotiation, expanded product/provider/status
  provenance, bounded redacted logs, read-only Doctor, and both cross-version
  directions. CLI tests passed 126; root Vitest passed 3,629 with 9 skipped;
  TypeScript, Guardian recovery, real running status/logs/Doctor, installer
  upgrade/uninstall, managed remote SSH, server build, and Electron PTY smoke
  all passed.
- 2026-07-30: Audited increment 1 PR #853's one failed Windows dev-smoke:
  Guardian recovery lost a heartbeat write to a transient `owner.json` rename
  `EPERM`. The failed-job rerun passed Guardian recovery and the complete dev
  smoke without a runtime-lock change, so no speculative retry was introduced.
- 2026-07-30: Published increment 2 as serial PR #855 targeting `dev`.
- 2026-07-30: Rejected the handwritten `.mjs` renderer direction from PR #857
  after the user selected a complete TUI application shell from day one.
  Audited Pi `v0.83.0` and Herdr `v0.7.5` side by side. Selected strict
  TypeScript plus `@earendil-works/pi-tui`; assigned Pi as the startup,
  settings, and TUI reference, Herdr as the persistent Runtime and command
  semantics reference, and Guardian plus the OpenAlice installer as the final
  ownership and update authority. Recorded the comparison in
  [[docs/reference/pi-herdr-cli-architecture.md]].
- 2026-07-30: Started the replacement implementation from merged PR #868.
  Added the native TypeScript CLI entry and first `pi-tui` Supervisor shell,
  made bare `openalice` enter it, retained `openalice tui` and every explicit
  command, and bumped the managed Pi/TUI release assets together to `0.83.0`.
  CLI tests passed 132 including a real bare-command PTY detach/restoration
  journey, root TypeScript passed, and root Vitest passed 3,637 with 9 skipped.
  A real isolated source install verified the official Pi manifest/lock hashes,
  installed both launchers, ran the installed TUI through a PTY, and restored
  the terminal on detach. Docker installer smoke remained unrun because the
  local Docker/OrbStack socket was absent.
- 2026-07-30: Repaired the managed Pi `0.83.0` desktop-vendoring hashes in
  serial PR #872 after both macOS package jobs exposed the stale `0.80.6`
  digests. The real forced vendor transaction downloaded and verified both Pi
  release assets, completed `npm ci`, and assembled the macOS managed runtime.
  The next package step then exposed a second `0.80.6` expectation in the
  packaged-toolchain smoke; the Supervisor-controls increment replaced that
  hardcoded version with an exact pattern derived from the packaged manifest.
- 2026-07-30: Connected the `pi-tui` application shell to the existing
  lifecycle, logs, Doctor, and update services. Added polled lifecycle and
  update-available states, keyboard navigation, bounded detail panels,
  CLI-owner-only start/open/stop/restart controls, and explicit mutation impact
  confirmation. A real isolated terminal journey started Guardian and Alice,
  observed ready components and Web endpoint, stopped the Runtime through its
  control socket, remained inside the TUI across both transitions, and restored
  the terminal on detach.
- 2026-07-30: Verified the interactive Supervisor increment with 135 CLI
  tests, root TypeScript, UI TypeScript, the 3,642-test root Vitest suite, and
  the CLI package build. An isolated local installer transaction loaded the TUI
  from managed Pi, rendered installed-provenance Doctor results, then
  `uninstall --yes` removed CLI/Pi while preserving a sentinel data directory.
  The Docker installer playground remained unavailable because this host still
  had no reachable Docker/OrbStack daemon; the equivalent local transaction and
  real PTY lifecycle journeys passed.
- 2026-07-30: Audited the full Pi `0.80.3` to `0.83.0` range (371 commits)
  against OpenAlice's actual imports, generated configuration, managed runtime,
  and installer/package paths. None of the three upstream breaking-change
  groups are reachable from OpenAlice. The exact Supervisor `pi-tui` API
  surface and Node floor remain compatible; `0.83.0` is the accepted baseline
  without a compatibility fork. Recorded the break matrix and future extension
  guardrail in [[docs/reference/pi-herdr-cli-architecture.md]].
- 2026-07-30: Added the immutable launch-context foundation for the TUI:
  default/machine/instance/environment/flag precedence, field provenance,
  named complete-home selection, source root, port, update policy, and a
  machine-wide Supervisor root outside selectable data homes. Installed
  managed Pi now receives instance-private agent and session roots, while
  source development, external Pi, and the standalone installed `pi` launcher
  preserve native user state. TUI and lifecycle/observability commands now use
  the same selected home, preventing `openalice up` from creating a different
  managed-Pi environment than a TUI start. Added source and installed-payload
  regression coverage plus a real PTY journey for explicit
  instance/home/port selection. Persisted configuration schemas, registry
  loading, and full root-parser conversion remain in the configuration
  increment.
- 2026-07-30: Added a Pi-style selected-instance settings overlay to the bare
  Supervisor TUI. Humans can set or inherit complete home, Web port, and update
  checks without launch flags; active Runtime mutations are guarded, and
  environment/CLI overrides render their resolved values as locked. Atomic
  persistence now removes explicit fields when they return to inheritance.
  Real PTY journeys cover a saved/reloaded port and a `--port` lock.
- 2026-07-30: The installed-CLI dogfood journey exposed two lifecycle gaps
  masked by isolated unit fixtures. The built Guardian now probes unconfigured
  internal ports, allowing a CLI Runtime on another complete home to coexist
  with the desktop process occupying 47332. Status fallback now observes both
  Guardian and Alice runtime locks, and spawned-start readiness accepts only
  its expected Guardian PID. The same isolated installed CLI then completed
  start, authenticated Web/root probes, stop/restart ownership handoff,
  reconnect, and final stop while the desktop app remained active.
- 2026-07-30: Added `i Instances` as a first-class Supervisor path. The TUI
  now lists the implicit default and registered instances, creates a validated
  named entry with a separate complete home, switches the live view without
  stopping another Runtime, and remembers the selection for the next bare
  start. Environment/CLI-selected instance or Home overrides make the list
  visibly read-only. Named homes cannot be cleared, duplicated, or nested
  under another registered home.
- 2026-07-30: Real multi-instance dogfood created `paper` entirely inside the
  TUI, started it on 47331, switched to the implicit default while it remained
  active, and started a second Runtime that automatically selected 47334 after
  the first instance's Web and internal ports. Both auth-status probes passed;
  switching back found the first live owner, and each Runtime stopped from its
  own TUI view. The journey exposed that explicit lifecycle/observability
  commands still bypassed the stored registry; `up`, `run`, `down`, `status`,
  `open`, `logs`, and `doctor` now resolve TUI-registered named homes before
  dispatch.
- 2026-07-30: A missing registered complete Home now fails explicit
  automation selection but no longer strands a bare interactive launch. The
  Supervisor keeps the unavailable entry, opens on an available fallback,
  explains the recovery, and lets `i Instances` atomically repair the
  remembered default. Unit and real-PTY coverage preserve that distinction.
- 2026-07-30: Refined the parameter-free installed experience around the bare
  TUI. Enter now starts a stopped Runtime and opens its verified browser
  endpoint in one action, while `s` remains the explicit background-only
  start. Setup uses ordinary product vocabulary, identifies the installed
  Runtime by OpenAlice version and content identity, and edits either the
  current instance or inherited machine defaults without weakening
  environment/CLI precedence. Real PTY coverage exercises both persisted
  layers, and an installed bundle dogfood launch reached Alice, opened the Web
  UI, detached, reattached, and stopped cleanly.
- 2026-07-30: Removed the remaining source-only first-start detour. When Enter
  cannot discover a checkout, an installed CLI now derives the managed source
  plan from its own branch/version provenance, asks for consent in the TUI,
  then preserves the original start-and-open intent after preparation. `c`
  remains the manual checkout escape hatch, while a non-installed source-run
  CLI still falls back to the path editor. Stopped bundle views also ignore an
  uninformative `provider=unknown` observation and show the verified installed
  provider from launch context. Manual clean-container review exposed that the
  offline installer fixture did not include Pi's TUI dependency and therefore
  had never executed bare `openalice`; the fixture now supplies a minimal
  adapter and the Docker acceptance itself drives Enter, verifies the
  install-provenance plan, cancels, and detaches.
- 2026-07-30: Hardened the install boundary exposed by that clean-container
  journey. Staged installs and identical-release reuse now resolve
  `@earendil-works/pi-tui` from the exact managed Pi closure instead of treating
  a runnable Pi CLI as proof that the Supervisor renderer exists. Docker
  acceptance deletes only that dependency from an otherwise healthy release,
  verifies that the installer preserves the damaged evidence, replaces the
  release atomically, and confirms the repaired closure before continuing.
- 2026-08-02: Dogfood found that release-owned installers recorded their
  embedded tag as an explicit pin, disabling both startup notices and the TUI
  update action. Install provenance v2 now keeps the immutable tag for exact
  SSH/source reproduction and records update policy separately. Release
  generation embeds `stable`, human `--version` remains pinned, legacy v1
  metadata remains readable, and the release-installer transformation plus
  stable-ref install/check path have dedicated regression coverage.
