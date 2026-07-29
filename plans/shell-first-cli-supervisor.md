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

Owner guides:

- [[docs/cli-supervisor.md]]
- [[docs/cli-installer.md]]
- [[docs/local-runtime.md]]
- [[docs/managed-workspace-runtime.md]]
- [[docs/remote-access.md]]
- [[docs/data-locations.md]]
- [[docs/development-workflow.md]]

Research:

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
- bare `openalice` changes to the TUI only after the PTY harness proves terminal
  restoration and the compatibility transition is documented.

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

- Keep lifecycle actions in a presentation-neutral CLI core.
- Keep command/TUI rendering as clients of that core.
- Bundle the initial JavaScript TUI inside the immutable CLI release; do not
  require a global npm install.
- Select the renderer through a bounded spike comparing a maintained bundled
  Node library and a small repository-owned renderer. Measure alternate screen,
  resize, raw-mode restoration, bundle size, idle CPU, flicker, Unicode width,
  and Git Bash behavior before choosing.
- Use an explicit reducer/state machine; render is a pure projection and effects
  call the same services as non-interactive commands.
- Poll low-frequency status initially. Add streaming only when measured UX or
  remote efficiency requires it.

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

### 3. TUI renderer spike and PTY harness

- [x] Build two bounded renderer candidates against the same fake control model.
- [ ] Measure package size, startup, idle CPU, resize, flicker, Unicode,
  no-color, restoration, and Git Bash behavior.
- [x] Select one renderer and remove the rejected spike.
- [x] Build a PTY harness with isolated HOME, deterministic control fixtures,
  real input/resize, `@xterm/headless` parsing, transcripts, and timeouts.
- [x] Test normal exit, Ctrl+C, SIGTERM, renderer failure, and disconnect.

### 4. Supervisor TUI MVP

- [ ] Add explicit `openalice tui`.
- [ ] Implement stopped, starting, running, degraded, incompatible, stopping,
  and update-available states.
- [ ] Add start, open, stop, restart, detach, help, and read-only detail.
- [ ] Add component/instance panels and narrow fallback.
- [ ] Keep the TUI open and reconnect across a self-owned restart.
- [ ] Change bare `openalice` only after source-backed macOS/Linux PTY and real
  browser acceptance.

### 5. Logs, Doctor, and update UX

- [ ] Add top-level logs plus TUI filter/follow/pause/bounded history.
- [ ] Add Doctor summary/detail and copyable remediation.
- [ ] Add update notice, plan, progress, and impact screens.
- [ ] Show active work before stop, restart, takeover, or restart-requiring
  update.
- [ ] Add PTY journeys for failed start, disconnect, logs, incompatible control,
  update refusal, and reconnect.

### 6. Instance model

- [ ] Define a versioned atomic CLI-owned registry mapping names to complete
  homes.
- [ ] Preserve implicit `default` without moving existing data.
- [ ] Add `--instance`, list, TUI selection, and collision checks.
- [ ] Make deletion remove registry ownership only by default.
- [ ] Test concurrent homes, ports, sockets, logs, foreign/stale owners,
  Electron ownership, and remote instances.

### 7. Standalone headless Runtime artifact

- [ ] Inventory server/UI/Guardian outputs, production dependencies, native
  modules, Broker Pack boundary, and managed Pi injection.
- [ ] Produce deterministic platform/architecture archives.
- [ ] Define authenticated manifest, version, compatibility, Node requirement,
  file hashes, and content identity.
- [ ] Install immutable Runtime versions and validate without a checkout.
- [ ] Add providers for bundle, source-development, Docker, Electron, and
  managed remote.
- [ ] Prove clean-host Alice, optional components, Web, Workspace PTY, and Pi.
- [ ] Re-run unsigned Electron package acceptance for shared build changes.

### 8. Installer integration and source-development split

- [ ] Add the Runtime bytes and size to installer plan/consent.
- [ ] Make normal `up` select the bundle independent of cwd.
- [ ] Move checkout preparation/rebuild to explicit development provider.
- [ ] Make managed remote reuse the release artifact and trust chain.
- [ ] Distinguish installer-owned Runtime releases from preserved data and
  sources during uninstall.

### 9. Atomic Runtime update, activation, and rollback

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
| Default command surprises foreground users | Explicit TUI command first; compatibility period |
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
- 2026-07-30: Started increment 3 from merged PR #855. Compared Ink 7.1.1
  with a small repository renderer against one fake control model and real PTY.
  On Node 22.22.1/Darwin arm64, the repository candidate started in 98–118 ms
  versus Ink's 313–314 ms, used 8–10 ms versus 26–27 ms CPU during the
  one-second idle/resize journey, and retained 9.8 KiB of source rather than a
  22,368 KiB Ink/React install closure. Both restored the terminal and handled
  Unicode, resize, and no-color. Kept the row-diff ANSI renderer, removed the
  rejected spike, and added the isolated real-PTY/xterm harness. Git Bash
  acceptance remains pending on the Windows matrix.
- 2026-07-30: Increment 3 local verification passed: TUI renderer/PTY tests
  passed 12 with the Windows-only Git Bash journey skipped locally; the full
  CLI suite passed 138 with that one skip; root TypeScript and Vitest passed
  (3,641 tests, 10 skipped); clean installer, installed-CLI Runtime/Web handoff,
  managed remote SSH, distributed-payload equality, and Electron PTY smoke all
  passed. OrbStack was returned to its prior stopped state.
- 2026-07-30: Published increment 3 as serial PR #857 targeting `dev`; merge
  waits for its real Windows Git Bash PTY journey because that result completes
  the renderer-selection evidence rather than serving as generic trailing CI.
