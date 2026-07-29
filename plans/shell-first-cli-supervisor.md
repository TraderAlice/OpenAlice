# Shell-first CLI and Supervisor TUI

Status: Active

Related issue: None yet

Delivery mode: Parallel / contribution. Every implementation increment targets
`dev`, remains open for human review, and carries the required parallel labels.
Dependent increments wait for their prerequisite PRs to merge; independent test,
research, and packaging work may continue from fresh `dev` branches.

Owner guides:

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
  trying to reproduce the browser product;
- Guardian owns a persistent local Runtime that survives terminal, TUI, browser,
  and SSH client disconnection;
- non-interactive commands expose the same lifecycle and diagnostics for shell
  scripts, CI, remote hosts, containers, and service managers;
- the installed CLI, headless Runtime, and displayed product version advance as
  one OpenAlice release;
- installation and N-1 to N upgrade are exercised end to end against a running
  Runtime before release.

The user-facing mental model is:

```text
openalice TUI    -> local operations and lifecycle
browser Web UI   -> complete OpenAlice product interaction
Electron         -> complete desktop distribution
Guardian         -> one authoritative Runtime owner beneath every surface
```

## Current Baseline

The repository already has load-bearing pieces that this initiative must reuse:

- `openalice server start` launches a detached source-backed Guardian and waits
  for Guardian control plus Alice HTTP readiness.
- `openalice server status --json` and `server stop` use a private local Guardian
  endpoint rather than guessing or killing a PID.
- Guardian reports its Runtime version, owner, endpoint, component readiness,
  and capabilities through control protocol 1.
- the installer stages content-addressed CLI releases and atomically switches
  launchers;
- the CLI reports the OpenAlice product version, performs bounded update
  discovery, reuses the installer for confirmed updates, and preserves product
  data during uninstall;
- Docker installer acceptance covers clean installation, repeat installation,
  immutable CLI-version switching, PATH integration, and state-preserving
  uninstall;
- Guardian recovery, Electron PTY/package, managed remote, Docker Runtime, and
  live dev-channel smokes already cover adjacent surfaces.

The principal gaps are:

- the default `openalice` path is a foreground source-checkout launcher;
- the persistent lifecycle is hidden behind the `server` subtree;
- there is no Supervisor TUI, top-level log/doctor/open surface, or shell
  completion;
- ordinary installed use still requires a user-owned source checkout and build
  toolchain;
- a CLI update does not install or activate the OpenAlice Runtime that a user
  actually runs;
- installer smoke changes selectors but does not exercise a real old Runtime
  running across an N-1 to N update;
- terminal rendering, resize, detach, reconnect, and terminal-restoration
  behavior have no dedicated CLI TUI acceptance harness.

## Product Decisions

### TUI role

- The TUI is a Supervisor, not a second OpenAlice application UI.
- It owns lifecycle, health, logs, diagnostics, updates, and instance selection.
- It may show bounded summaries such as active Workspace, Session, Agent, and
  headless-task counts, but opens the Web UI for product interaction.
- It never implements chat, trading, broker credentials, Workspace editing, or
  Agent terminal control.
- It remains useful when Guardian is absent, starting, unhealthy, incompatible,
  stopping, or being upgraded.
- Closing the TUI never stops the Runtime. `q`, `Esc` from the root screen, and
  `Ctrl+C` restore the terminal and detach.

### Runtime ownership

- Guardian remains the only process-tree owner and recovery authority.
- CLI and TUI lifecycle actions compose with the Guardian lease and local
  control endpoint; they do not create a second daemon or PID-file kill path.
- Browser closure, TUI exit, terminal closure, and SSH disconnect do not alter
  Runtime lifetime.
- Foreground operation remains explicit for development, Docker, system
  supervision, and diagnostics.
- Stop, restart, takeover, update restart, and instance deletion are distinct
  actions with distinct impact disclosure.

### Vocabulary

- `instance` means one complete OpenAlice home, Guardian owner tree, Runtime
  endpoint, and lifecycle.
- `default` is the ordinary instance and requires no extra configuration.
- The CLI does not call instances `sessions`; Workspace Session already has a
  durable product meaning.
- “Runtime protocol” and content identities are diagnostic implementation
  details. Users see one OpenAlice product version.

### Default and non-interactive commands

The target command contract is:

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

Semantics:

- `openalice` is an alias for `openalice tui` when stdin and stdout are suitable
  terminals.
- a non-TTY `openalice` invocation refuses to invent an interactive flow and
  prints concise guidance to `up`, `status --json`, or `open`;
- `up` starts in the background, waits for real readiness, and does not open a
  browser unless `--open` is present;
- `run` owns the foreground and stops its self-owned Runtime on normal
  interruption;
- `open` starts nothing and only opens a verified healthy instance;
- ordinary `status` is concise and actionable; `--json` is a versioned,
  machine-readable contract;
- `server` remains a compatibility alias during migration;
- existing foreground `start` remains compatible for at least one release,
  warns only in an interactive terminal, and then follows an explicitly
  documented removal or reassignment decision;
- source-backed development moves to an explicit `openalice dev` or
  `openalice run --source <path>` surface before normal installation stops
  depending on a checkout.

### TUI information architecture

The minimum 80 by 24 root screen contains:

1. product version, installation channel, and update notice;
2. instance selector with lifecycle state;
3. selected instance owner, endpoint, home, uptime, and Runtime version;
4. Alice, UTA, and Connector component state;
5. bounded activity counts when the running Runtime exposes them;
6. recent lifecycle events or actionable diagnostic detail;
7. a stable keyboard action bar.

Initial root actions:

| Key | Action | Safety |
|---|---|---|
| `o` / Enter on URL | Open Web UI | No Runtime mutation |
| `l` | Open logs | Read-only |
| `d` | Open Doctor | Read-only until a separate confirmed fix |
| `u` | Review update | Shows plan before mutation |
| `r` | Restart | Shows active-work impact before confirmation |
| `x` | Stop | Explicit confirmation; never bound to `q` |
| `i` | Select/manage instance | Deletion remains a separate confirmed action |
| `?` | Help | Read-only |
| `q` / `Ctrl+C` | Detach TUI | Never stops Runtime |

The TUI must:

- render a useful narrow-layout fallback rather than corrupting screens below
  the preferred size;
- support resize, monochrome/no-color terminals, redirected output refusal,
  Unicode-width differences, and terminal raw-mode restoration;
- pause rendering while an external browser opener or confirmation prompt
  temporarily needs ordinary terminal behavior;
- redact secrets and never expose credential or sealing-key paths in diagnostics;
- retain state and reconnect through expected Guardian restarts;
- display explicit ownership and protocol incompatibility rather than offering
  a blind takeover.

### Technical shape

- Extract lifecycle parsing, status normalization, actions, and formatting from
  command handlers into a presentation-neutral CLI control model.
- Keep the initial TUI in the installed JavaScript CLI so command and TUI
  behavior share one release and one implementation.
- Bundle the TUI and its runtime dependencies into the immutable CLI payload;
  never require a global npm install.
- Select the terminal renderer through a bounded implementation spike. Compare
  a bundled maintained Node TUI library with a small repository-owned renderer
  against alternate-screen, resize, raw-mode restoration, bundle-size, Windows
  Git Bash, and PTY-test evidence. Do not start a Rust rewrite without measured
  performance or portability need.
- Keep TUI state as an explicit reducer/state machine. Rendering is a pure
  projection and effects call the same control services as non-interactive
  commands.
- Poll the low-frequency status contract initially. Add a streaming event
  protocol only when polling cannot meet observed UX or remote efficiency
  requirements.
- Never parse human log text as lifecycle truth.

### Control protocol

The current protocol-1 endpoint supports one JSON-line request per connection
and exact protocol equality. Evolve it without needlessly invalidating running
instances:

- retain a small stable transport envelope where possible;
- report API schema version, supported compatibility range, product version,
  Runtime provider, owner, capabilities, and component state;
- add capabilities before adding methods, so older clients can degrade cleanly;
- distinguish `unsupported_method`, `incompatible_protocol`, unreachable
  Runtime, foreign-machine owner, stale owner, and unhealthy component states;
- make `runtime.status` read-only and safe across launcher surfaces;
- preserve the rule that only a self-owned CLI instance advertises stop;
- add restart only as an orchestrated stop/readiness transaction unless
  Guardian can prove an atomic self-restart contract;
- expose log descriptors or a bounded log method without granting arbitrary
  file reads;
- expose activity summaries only from presentation-neutral Alice/Guardian facts.

### Release and version model

Normal users see one version:

```text
OpenAlice 0.x.y
```

Diagnostics may separately show:

- CLI build/content identity;
- installed Runtime content identity;
- running Runtime product version;
- control transport/API versions and capabilities;
- install source and channel;
- pending restart or pending activation.

The final direct-install release contains:

```text
OpenAlice release manifest
  -> CLI payload
  -> managed Pi payload
  -> platform-specific headless Runtime payload
  -> file hashes and authenticity metadata
  -> supported control compatibility range
```

The source checkout remains a development provider, not the normal stable
provider. Electron may package the same build output through its own signed
distribution, but keeps its existing launcher and update authority.

### Update transaction

The target update sequence is:

1. identify installer provenance and permitted channel;
2. fetch release metadata with a bounded timeout;
3. download every required CLI and platform Runtime artifact before process
   mutation;
4. verify expected product version, platform, architecture, hashes, and release
   authenticity;
5. validate staged launchers and Runtime in an isolated probe;
6. inspect every local instance and its running compatibility/active-work
   impact;
7. publish immutable version directories;
8. atomically switch visible CLI and next-start Runtime pointers;
9. leave compatible running instances alive and report pending activation, or
   obtain explicit consent for an incompatible restart;
10. verify new Guardian ownership, control compatibility, and Alice HTTP
    readiness after restart;
11. atomically restore the prior pointers and restart the prior Runtime when
    activation fails;
12. retain bounded prior versions for rollback and garbage-collect only
    unreferenced, inactive releases.

Package-manager-owned installations do not self-update. Their TUI shows the
correct package-manager command and can re-evaluate the running Runtime after
the external update.

## Non-goals

- A terminal implementation of chat, trading, settings, Workspace management,
  or Agent TUIs.
- Public network listening by Guardian or its local control endpoint.
- Replacing Electron distribution, signing, notarization, or auto-update.
- Silently enabling boot-at-login or installing a system service.
- Live PTY handoff during the first Runtime-bundle release.
- Native Windows PowerShell installation before its existing installer
  authenticity and packaging boundary is ready.
- Deleting application state as part of CLI uninstall or instance removal.

## Delivery Increments

Each increment is a reviewable PR. Checkboxes describe repository truth, not
intent. A dependent increment does not branch from an unmerged contribution.

### 0. Canonical plan

- [x] Audit current CLI lifecycle, Guardian control, installer acceptance,
  release boundaries, Herdr research, and Electron/package verification.
- [x] Record product vocabulary, target command grammar, TUI boundary, update
  transaction, delivery increments, and acceptance matrix.
- [ ] Publish this plan PR to `dev` with `workflow:parallel`,
  `theme:reliability`, `area:app-shell`, and `review:deep`.

### 1. Presentation-neutral lifecycle core

- [ ] Extract normalized instance status and lifecycle operations from current
  `server` command handlers without changing Guardian ownership.
- [ ] Add top-level `up`, `run`, `down`, `status`, and `open`.
- [ ] Define stable JSON envelopes, error codes, exit statuses, and TTY
  behavior.
- [ ] Preserve `server` and `start` compatibility with explicit migration
  tests.
- [ ] Add shell completion generated from the same command schema.
- [ ] Create the durable CLI Supervisor owner guide and route it from
  `docs/README.md` and `AGENTS.md`.
- [ ] Verify source-backed foreground and detached browser flows with isolated
  homes, Guardian recovery, remote composition, and packaged Electron smoke.

### 2. Control compatibility and observability

- [ ] Specify compatible control transport/API version semantics and
  capability negotiation.
- [ ] Extend normalized status with Runtime provider, product version,
  compatibility, pending activation, component detail, and bounded uptime.
- [ ] Add safe log discovery/tail primitives with rotation and redaction.
- [ ] Add read-only Doctor checks for install provenance, Node/runtime
  requirements, filesystem ownership, control reachability, ports, component
  health, update metadata, and source/bundle integrity.
- [ ] Keep `doctor --fix` empty or narrowly allowlisted until each mutation has
  its own plan, consent, and acceptance.
- [ ] Exercise old-client/new-server and new-client/old-server fixtures.

### 3. TUI renderer spike and PTY harness

- [ ] Build two bounded renderer candidates against the same fake control model.
- [ ] Measure packaged size, cold start, idle CPU, resize behavior, full-screen
  flicker, Unicode width, no-color mode, terminal restoration, and Git Bash
  behavior.
- [ ] Select and document one renderer; delete the rejected spike.
- [ ] Build a reusable PTY harness with isolated HOME, deterministic control
  fixtures, ANSI screen parsing through `@xterm/headless`, resize, input,
  timeout, transcript, and screenshot/text artifact support.
- [ ] Test normal exit, `Ctrl+C`, SIGTERM, renderer failure, and control
  disconnection for terminal restoration.

### 4. Supervisor TUI MVP

- [ ] Add explicit `openalice tui`.
- [ ] Implement stopped, starting, running, degraded, incompatible, stopping,
  and update-available root states.
- [ ] Implement start, open Web, stop, restart, detach, help, and read-only
  status actions.
- [ ] Add component and instance detail panels plus narrow-terminal fallback.
- [ ] Make `openalice` enter the TUI only after explicit compatibility and PTY
  acceptance; preserve a documented non-TTY path.
- [ ] Ensure the TUI stays open and reconnects across self-owned restart.
- [ ] Walk the real source-backed Runtime and browser route on macOS and Linux.

### 5. Logs, Doctor, and update UX

- [ ] Add the top-level `logs` command and TUI log view with component filter,
  follow, pause, bounded history, and redaction.
- [ ] Add Doctor summary/detail screens and copyable remediation commands.
- [ ] Add update notice and impact-review screens using the existing
  installer-backed update path.
- [ ] Show active-work impact before stop, restart, takeover, or
  restart-requiring update.
- [ ] Keep all destructive confirmations operable without color or mouse.
- [ ] Add TUI PTY journeys for logs, disconnected Runtime, failed start,
  incompatible control, update refusal, and reconnect.

### 6. Instance model

- [ ] Specify a versioned, atomic, CLI-owned instance registry mapping names to
  complete homes without weakening `OPENALICE_HOME`.
- [ ] Reserve and migrate the implicit `default` instance without moving
  existing user data.
- [ ] Add `--instance`, `instance list`, selection in the TUI, and collision
  checks.
- [ ] Define safe deletion as registry removal only by default; product-data
  deletion remains a separately planned destructive action.
- [ ] Test concurrent homes, ports, sockets, logs, foreign owners, stale owners,
  Electron ownership, and remote instances.

### 7. Standalone headless Runtime artifact

- [ ] Inventory the complete server build, UI assets, Guardian entry point,
  production dependencies, native modules, broker-pack boundary, and managed
  Pi injection.
- [ ] Produce deterministic platform/architecture-specific Runtime archives
  for the supported direct-install matrix.
- [ ] Define a signed or release-authenticated manifest with product version,
  compatibility range, file hashes, Node requirement, and content identity.
- [ ] Install archives into immutable Runtime version directories and validate
  them without a source checkout.
- [ ] Add a Runtime-provider abstraction for bundle, source-development,
  Docker, Electron, and managed-remote ownership.
- [ ] Prove the bundle can start Alice, optional UTA/Connector behavior, Web UI,
  Workspace PTY, and managed Pi from an empty non-root host.
- [ ] Re-run unsigned packaged Electron acceptance to prove shared build changes
  did not alter app-mode behavior.

### 8. Installer integration and source-development split

- [ ] Add the headless Runtime and its exact bytes/download size to the install
  plan and consent transaction.
- [ ] Preserve an explicit CLI-only or development install only if a real user
  case justifies it; do not silently omit the Runtime from the normal path.
- [ ] Make normal `openalice up` select the installed bundle independent of cwd.
- [ ] Move checkout preparation, dependency bootstrap, and rebuild controls to
  the explicit development provider.
- [ ] Update managed remote to reuse the same release artifact and trust chain
  rather than grow a remote-only bundle installer.
- [ ] Extend uninstall plans to distinguish installer-owned Runtime releases
  from preserved product data and user-owned sources.

### 9. Atomic Runtime update, activation, and rollback

- [ ] Extend the release manifest and updater to stage matching CLI, Pi, and
  Runtime assets as one product release.
- [ ] Add running-instance compatibility and active-work impact planning.
- [ ] Keep compatible old Runtime processes alive with an explicit pending
  activation state.
- [ ] Add confirmed graceful restart for incompatible activation.
- [ ] Add readiness-gated rollback of launchers and Runtime pointers.
- [ ] Add bounded previous-release retention and reference-safe garbage
  collection.
- [ ] Expose transaction phase and recovery state in CLI JSON, TUI, logs, and
  Doctor.
- [ ] Test interruption and process death at every durable transaction boundary.

### 10. Release gates and operational hardening

- [ ] Add a real previous stable release to candidate N-1 to N lane.
- [ ] Add post-merge live dev-channel Runtime install/upgrade acceptance.
- [ ] Add release-candidate macOS and Linux architecture coverage for install,
  persistent run, update, rollback, and uninstall.
- [ ] Add a post-publication canary against the real installer, manifest, CDN
  aliases, and stable update discovery.
- [ ] Preserve Electron package, Docker, managed remote, Guardian recovery, and
  source-development lanes.
- [ ] Document systemd/launchd supervision as explicit `run` composition before
  considering an opt-in `service install` command.
- [ ] Move stable architectural truth into owner guides and mark this plan
  complete only after a versioned release passes the full matrix.

## Acceptance Matrix

### Command and ownership

| Scenario | Required result |
|---|---|
| `openalice` in a suitable TTY | Opens Supervisor TUI without starting product interaction |
| `openalice` without TTY | Refuses interactive rendering and prints script-safe guidance |
| `up` from stopped | Returns only after Guardian control and Alice HTTP readiness |
| `up` from running | Idempotently reports the verified existing endpoint |
| TUI detach or shell exit | Runtime remains alive |
| `run` interrupted | Only its self-owned Runtime shuts down cleanly |
| stop Electron-owned Runtime | Refused without replacing Electron ownership |
| takeover | Uses Guardian recovery and explicit impact disclosure |
| foreign-machine owner | Never reclaimed from heartbeat expiry alone |
| `status --json` | Stable schema for absent, starting, running, degraded, incompatible, stopping |

### TUI

| Scenario | Required result |
|---|---|
| 80 by 24 | Complete root controls remain visible |
| narrower terminal | Useful fallback or explicit minimum-size message |
| resize storm | No crash, terminal corruption, or unbounded render backlog |
| `q` / `Ctrl+C` | Alternate screen/raw mode restored; Runtime unaffected |
| renderer exception | Terminal restored and diagnostic emitted |
| Guardian disconnect | TUI stays alive, explains state, and reconnects |
| Guardian restart | Selection and view survive reconnection |
| no color / monochrome | State and confirmations remain understandable |
| logs contain control bytes | Escaped or safely rendered |
| update requires restart | Active-work impact shown before confirmation |

### Installation and update

| Scenario | Required result |
|---|---|
| clean non-root host | Installer yields runnable CLI, TUI, Pi, and headless Runtime |
| repeat same install | No duplicate releases, PATH blocks, registry entries, or data mutation |
| N-1 running -> N compatible | New release stages; old Runtime stays usable until activation |
| N-1 running -> N incompatible | Stop/restart impact requires consent |
| failed download/hash/authenticity | No visible pointer or process mutation |
| failure after pointer switch | Prior CLI/Runtime pointers restored |
| new Runtime not ready | Prior Runtime recovers and data remains intact |
| installer or updater killed | Next invocation diagnoses and resumes or rolls back safely |
| uninstall | Installer-owned bytes removed; homes, Workspaces, sources, credentials, and keys preserved |
| package-manager install | Self-update disabled with correct manager guidance |

### Cross-surface regression

| Surface | Required evidence |
|---|---|
| browser/dev | Real localhost UI, auth, Workspace, and PTY |
| Guardian | Recovery, takeover, stop ordering, and no orphan process tree |
| Electron | Unsigned packaged startup, app transport, managed runtime, PTY, shutdown |
| Docker | Loopback Runtime health and non-trading E2E |
| managed remote | Consent, matching release, disconnect persistence, tunnel health |
| installer | Clean fixture, live dev channel, interactive plan review |
| release | Previous stable upgrade and post-publication CDN canary |

## Verification Commands

Every code increment runs:

```bash
npx tsc --noEmit
pnpm test
```

Add according to the touched increment:

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

The TUI increment adds a dedicated PTY command that:

- owns an isolated HOME and `OPENALICE_HOME`;
- records normalized screen text and raw diagnostic transcripts;
- drives keys and resize through a real PTY;
- parses ANSI state with `@xterm/headless`;
- fails on leaked child processes or an unrestored terminal;
- supports deterministic fake-control and real-Guardian modes.

The Runtime artifact and update increments add:

- clean-host bundle smoke without a repository mount;
- real N-1 release to candidate upgrade;
- transaction fault injection after download, verification, immutable publish,
  pointer switch, stop request, Guardian acquisition, Alice readiness, and
  rollback;
- data hashes before and after every failed or successful update.

Live-paper broker testing is not part of this initiative unless a change
touches broker adapters, order writes, or UTA permissions. All routine Runtime
acceptance remains non-trading and uses isolated state.

## Risks and Kill Switches

| Risk | Mitigation |
|---|---|
| Default command change surprises current foreground users | Keep explicit compatibility period and `run` escape hatch |
| TUI crash leaves terminal broken | Central restoration guard plus real PTY signal/failure tests |
| TUI becomes a second product UI | Enforce Supervisor non-goals and open Web for product actions |
| Control protocol strands old running Runtime | Add capabilities and compatibility fixtures before new methods |
| Update terminates active Agent work | Download first, show impact, keep compatible Runtime, require consent otherwise |
| Runtime bundle drifts from Electron | Share build inventory/manifest and keep packaged smoke |
| Native dependency fails on a host | Platform-specific artifacts, clean-host matrix, explicit Node/native contract |
| Instance registry conflicts with existing home selection | Preserve implicit default and make registry additive/versioned |
| Parallel PR dependency stalls the goal | Work only on independent increments until prerequisite review/merge |
| Release canary mutates real user state | Dedicated ephemeral host/home and no credentials or broker accounts |

Feature-level kill switches:

- explicit `openalice tui` remains available before the default command changes;
- `openalice run --source` preserves source-backed recovery;
- immutable previous releases and pointer rollback preserve a known-good launch;
- update discovery remains disableable and never blocks startup;
- normal local Runtime binding remains loopback-only.

## Completion Criteria

This plan is complete only when:

1. stable installation on a clean supported host requires no source checkout;
2. `openalice` opens a tested Supervisor TUI and detaching leaves the Runtime
   alive;
3. the documented non-interactive lifecycle, status, logs, Doctor, and
   completion surfaces are stable;
4. users see one OpenAlice product version while diagnostics accurately report
   installed and running identities;
5. a real previous stable release can upgrade to the candidate while running,
   with compatibility planning, data preservation, and readiness-gated rollback;
6. installer, TUI PTY, Guardian, browser, Electron package, Docker, managed
   remote, development-channel, and post-publication canary evidence is green;
7. owner guides describe the shipped architecture and this plan records the
   delivered PRs and final release.

## Progress Log

- 2026-07-29: Goal created. Audited the current CLI lifecycle, Guardian control
  protocol, source-backed Runtime boundary, installer smoke, Herdr reference,
  and cross-surface verification requirements. Established the Supervisor TUI
  boundary, target command grammar, headless bundle direction, update
  transaction, ten implementation increments, and acceptance matrix.
