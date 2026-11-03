# Local Runtime and CLI Bootstrap

This guide owns the installed browser-local OpenAlice Runtime and explicit
source-development override. Installation, update, rollback, filesystem
ownership, and PATH belong to [[docs/cli-installer.md]]; Electron packaging
to [[docs/managed-workspace-runtime.md]].

## Process architecture

The native CLI is a target-specific Bun executable, not a single-process
application: the CLI/TUI spawns a Guardian process, which owns Alice
(loopback Web UI/API), optional UTA and Connector, and independent Agent
Runtime processes per Session. Existing process ownership, health, restart,
lock, signal, and shutdown semantics are unchanged; Bun only changes the
shipped executable and resource provider. Browser, API, auth, Workspace
WebSocket, and terminal share one verified loopback origin.

On Linux, Guardian's positive PID probe parses `/proc/<pid>/stat` after the
final `)` of the (possibly parenthesis-containing) process name. A `Z`
thread-group leader alone does not prove exit — only `Z` with exactly one
remaining thread does; unreadable procfs cannot establish exit. Shutdown
retains descendant PIDs across wrapper exit and forces live survivors after
the grace period.

## Installed Runtime provider

The executable re-enters its own bytes under private internal roles to start
Guardian, Alice, UTA, and Connector as separate processes. Immutable
resources resolve beside the active release under `share/openalice/` (built
Web UI, defaults/migrations, templates, materialized adapter and Workspace
CLI files). The installed content identity covers the complete payload
manifest — resources, file modes, symlink targets — not the executable
alone. The provider discovers working system Git/Bash (preserving user Git
config); the installed CLI needs no system Node/Bun/npm. An external Agent
Runtime may have its own requirements.

Source development remains `pnpm dev` (relay in front of Vite;
`pnpm dev:no-relay` only to debug the older direct proxy). An explicit
`--app-dir`, AliceProject source setting, or `OPENALICE_APP_HOME` selects a
checkout; normal installed startup never clones source or installs
dependencies.

## Agent Runtime boundary

Pi, OpenCode, Codex, Claude Code, and other native Agent CLIs are external
adapter targets: the CLI release never bundles, installs, upgrades, pins, or
configures them. The Runtime discovers the user's executable and preserves
its native config, credentials, version, and process identity. CLI mode
strips Electron-only managed-Pi variables while leaving user-owned `PI_*`
intact. Electron's packaged managed-Pi behavior is a distribution boundary,
not a CLI fallback.

## PTY and Sessions

Each Agent Session owns an independent child process and PTY; Bun's native
terminal backend implements the same input/resize/lifecycle/flow-control
contract as the `node-pty` backends. Bun 1.4 lacks a read-side pause
primitive, so under output pressure the Bun backend pauses/resumes the PTY
process group at the kernel boundary (graceful shutdown resumes a stopped
group before terminating). The Windows CLI uses Bun ConPTY, advertises no
read-side pause, and detaches an over-watermark WebSocket consumer with
retryable close code 1013 (agent and bounded replay buffer retained).
Windows npm-installed agents use the user's `node.exe` — never the compiled
executable as a JS interpreter — and a system Git-for-Windows installation.

## Broker Packs

UTA stays a separate, optional process. Activated Broker Packs remain
external under `<OPENALICE_HOME>/runtime/broker-packs/`; the compiled UTA
role imports the Pack's ESM entry and lets it resolve its own dependencies
from the Pack's `node_modules`. The Bun artifact does not absorb live broker
SDKs. See [[docs/broker-packs.md]].

## Commands and data

Lifecycle commands belong to
[[docs/cli-supervisor.md]]; version/update/rollback to
[[docs/cli-installer.md]]. Installation never starts a Runtime; update or
rollback changes the next invocation, never hot-reloading a running tree.
`OPENALICE_HOME` is the complete user-state root for one AliceProject
boundary — not the CLI installation root, even though both may default
under `~/.openalice`. Use separate homes for concurrent source worktrees
(`pnpm dev -- --home ~/.openalice-dev/<feature>`). See
[[docs/data-locations.md]] and [[docs/alice-project.md]].

## Acceptance

Native Runtime acceptance must prove: execution outside a checkout without
system Node/npm/Bun on PATH; distinct Guardian/Alice/UTA/Connector and Agent
Session PIDs; persistent `up`/detach/`status`/`down`/restart; multiple
independent PTYs with input, resize, backpressure, and isolated
termination; real Web UI/templates/Workspace helpers/system Git; an external
Agent Runtime through its normal adapter (the optional real-runtime smoke
exercises OpenCode only via `OPENALICE_BUN_REAL_OPENCODE_PATH`); external
Broker Pack loading; and update activation plus rollback with user data
preserved. Every native dev and beta/stable candidate runs this acceptance
itself (WebRelay GUI through a captured browser, two external PTYs, isolated
stop) plus a four-process feasibility receipt proving Connector/UTA failure
recovery without restarting Alice. Routine verification is non-trading with
isolated homes; live-paper broker acceptance is the separate lane in
[[docs/uta-live-testing.md]].
