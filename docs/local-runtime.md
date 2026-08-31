# Local Runtime and CLI Bootstrap

This guide owns the installed browser-local OpenAlice Runtime and explicit
source-development override. Installation, update, rollback, filesystem
ownership, and PATH belong to [[docs/cli-installer.md]]. Electron remains an
independent distribution under [[docs/managed-workspace-runtime.md]].

## Process architecture

The native CLI is a target-specific Bun executable. It is not a single-process
application:

```text
openalice command or Supervisor TUI
  └── Guardian process
      ├── Alice process + loopback Web UI/API
      ├── optional UTA process
      ├── optional Connector process
      └── independent Agent Runtime processes per Session
```

Guardian, Alice, UTA, Connector, Supervisor, and every Agent Session retain
their existing process ownership, health, restart, lock, signal, and shutdown
semantics. Bun changes the shipped executable and resource provider, not those
boundaries.

The browser, API, authentication, Workspace WebSocket, and terminal share one
verified loopback origin. No public domain, hosted Studio protocol, or SSH
transport is required for local use.

## Installed Runtime provider

The executable re-enters its own bytes under private internal roles to start
Guardian, Alice, UTA, and Connector as separate OS processes. Immutable
resources resolve beside the active release under `share/openalice/`:

- built Web UI;
- defaults and migrations;
- standard Workspace templates;
- materialized adapter and Workspace CLI files external processes open by path;
- release-owned portable Git.

The installed content identity covers the complete payload manifest, including
these resources, file modes, and symlink targets. It is not derived from the
primary executable alone.

The provider prepends only the release-owned Git `bin` directory to Runtime
children. The installed CLI therefore requires no system Node.js, Bun, npm, or
Git and does not modify a user's system Git.

Source development remains ordinary:

```bash
pnpm dev
```

An explicit `--app-dir`, AliceProject source setting, or
`OPENALICE_APP_HOME` can select a checkout for development. Normal installed
startup does not clone source, install dependencies, or reconstruct a
repository-shaped Runtime.

## Agent Runtime boundary

Pi, OpenCode, Codex, Claude Code, and other native Agent CLIs are external
adapter targets. The CLI release does not bundle, install, upgrade, pin,
downgrade, remove, or configure them.

The Runtime discovers the user's executable from the inherited environment,
uses the corresponding adapter, and preserves that tool's native config,
credentials, version, and process identity. CLI mode strips Electron-only
managed-Pi environment variables before Agent Runtime resolution while leaving
user-owned `PI_*` configuration intact. Missing Runtime guidance belongs to
onboarding/startup, not installation.

Electron deliberately keeps its packaged managed-Pi behavior for desktop
open-box use. That difference is a distribution boundary, not a compatibility
fallback in the CLI.

## PTY and Sessions

Each Agent Session owns an independent child process and PTY. Bun's native
terminal backend implements the same input, resize, lifecycle, and bounded
WebSocket flow-control contract as the Electron/source `node-pty` backend.

Bun 1.4 does not expose a read-side pause primitive. Under output pressure the
Bun backend stops and continues the PTY process group at the producer/kernel
boundary, avoiding an unbounded JavaScript spool. Graceful shutdown resumes a
stopped group before terminating it. Electron and source-backed Node execution
continue using `node-pty` pause/resume.

## Broker Packs

UTA remains a separate process and optional for non-trading use. Activated
Broker Packs stay external under:

```text
<OPENALICE_HOME>/runtime/broker-packs/
```

The compiled UTA role imports the Pack's ESM entry and lets it resolve its own
JavaScript and N-API dependencies from the Pack's `node_modules`. The Bun
artifact does not absorb live broker SDKs. See [[docs/broker-packs.md]].

## Commands and lifecycle

Common entry points:

```bash
openalice                 # Supervisor TUI
openalice up              # persistent background Runtime
openalice status
openalice open
openalice down
openalice run             # foreground Runtime
openalice doctor
openalice logs
openalice version --json
openalice update --check
openalice rollback --plan
```

`openalice up` waits for Guardian control and Alice readiness, then returns;
the Runtime survives the launching shell. `openalice run` owns the foreground
Guardian tree and Ctrl+C stops it. The Supervisor TUI detaches without stopping
an already-running Runtime. A healthy matching owner is reused; takeover always
requires the existing explicit Guardian recovery path.

Installation never starts a Runtime. Update or rollback changes the next CLI
invocation and does not hot-reload an already-running process tree. Restart is
an explicit lifecycle decision.

Stable, beta, and dev direct installs perform bounded, channel-keyed update
checks on their own manifests at interactive startup. Network failure is silent
and never blocks use. Pinned and custom installs do not silently cross into a
release channel. Package-manager-owned installs report their manager's stable
update command and are never overwritten by the direct installer.

## Data and concurrent development

`OPENALICE_HOME` is the complete user-state root for one AliceProject boundary:
data, Workspaces, runtime locks, credentials, and optional Broker Packs. It is
not the CLI installation root, even though both defaults may resolve under
`~/.openalice` for ordinary use.

For concurrent source worktrees choose separate complete homes:

```bash
pnpm dev -- --home ~/.openalice-dev/feature-a
pnpm dev -- --home ~/.openalice-dev/feature-b
```

See [[docs/data-locations.md]] and [[docs/alice-project.md]].

## Acceptance

The native Runtime acceptance must prove:

- execution outside a checkout with system Node, npm, Bun, and Git absent;
- distinct Guardian/Alice/UTA/Connector and Agent Session PIDs;
- persistent `up`, detach, `status`, `open`, `down`, and restart behavior;
- multiple independent Agent PTYs with input, resize, backpressure, and
  isolated termination;
- real Web UI, defaults, templates, Workspace helpers, and portable Git;
- an external Agent Runtime-shaped process through its normal adapter without
  changing its config or version; the optional real-runtime smoke exercises
  OpenCode only when `OPENALICE_BUN_REAL_OPENCODE_PATH` explicitly selects its
  installed executable;
- external Broker Pack loading without moving SDKs into UTA Core;
- update activation and local rollback with user data preserved.

Routine verification is non-trading and uses isolated homes. Live-paper broker
acceptance remains a separate explicit lane under [[docs/uta-live-testing.md]].

Every native `dev` and versioned beta/stable candidate runs the artifact
acceptance itself: the compiled CLI opens a captured platform browser command,
launches two external OpenCode-adapter PTYs with distinct PIDs, sends independent
input and resize messages, stops one Session, and proves the other remains
interactive.
The same candidate lane also runs the four-process feasibility receipt, which
forces Connector and UTA failures and proves they recover without restarting
Alice. Installer and package-manager receipts separately cover stopped and
active upgrades, activation on restart, rollback, and data-preserving removal.
