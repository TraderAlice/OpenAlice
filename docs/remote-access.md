# Remote Runtime and Access

This guide owns OpenAlice's remote Runtime architecture: server lifecycle,
local and remote client responsibilities, SSH transport, managed remote
bootstrap, control/status contracts, multi-client authority, and the staged
path toward an independent Studio frontend.

Start with [[docs/remote-quickstart.md]] for the user-facing setup and daily
workflow. This owner guide complements [[docs/local-runtime.md]],
[[docs/cli-supervisor.md]], and [[docs/managed-workspace-runtime.md]]. The
Herdr comparison that informed this design is recorded in
[[docs/reference/herdr-remote-architecture.md]]. That reference is research;
this guide is the OpenAlice contract.

## Status

The repository now contains the Bun-native Stage 0 through Stage 2 path, with
source checkout support retained only as an explicit development override:

- `openalice up|run` re-executes the installed native command into the existing
  Guardian/Alice/UTA/Connector process roles without requiring Node, Bun, a
  checkout, or a current working directory;
- `openalice up|run|status|down` provides browserless local lifecycle over the
  same `cli-server` Guardian owner;
- bare `openalice` starts the TUI and local Web relay; its GUI can select a
  registered Machine and a running AliceProject;
- `openalice relay` serves the trusted local Web UI and lets that browser
  inspect registered Machines and switch one active Machine/AliceProject;
- `openalice server run|start|status|stop` provides a browserless
  foreground or detached Runtime lifecycle backed by Guardian's local control
  endpoint;
- `openalice machine list|add|rename|remove|enable|disable` owns Herdr-style
  saved Machine profiles; `--machine <id-or-label> <command>` targets one
  saved profile, while `machine inspect` remains the product-specific bounded
  fleet inventory probe;
- `openalice project transfer` plans and copies one quiescent local
  AliceProject into a new complete home on a registered SSH Machine, preserving
  portable configuration and Workspace repositories while deliberately
  starting with zero resumable Sessions;
- Electron remains a complete local desktop distribution.

The release-owned installer advances one checksum-bound native OpenAlice
release. Agent Runtime executables remain user-owned and are only discovered
from the selected execution context's `PATH`. The clean Docker SSH acceptance
covers native download, install, multi-process startup, AliceProject transfer,
and the tunnel loop on a context with no Node, Bun, or Agent Runtime installed.
Real long-latency Agent TUI measurements remain a separate release observation
rather than a reason to invent a new terminal protocol preemptively.

Browser terminals on a remote source-dev UI keep their WebSocket on the page's
origin, including its forwarded port. Only loopback browser access bypasses the
Vite proxy for the development backend port; a LAN client cannot assume that
the backend's loopback-only listener is exposed alongside the UI.

Settings → General → Where Alice is working presents the active Machine beside the
AliceProject reported by its Runtime. In the normal `openalice` TUI, the Web GUI
and TUI share one relay and one current target; either can change the connection
and both observe the result. `openalice relay` offers the same Web GUI without
the terminal presentation. The relay serves its own local UI bundle, so
remote-served JavaScript never gains SSH authority.
The Switch location dialog opens immediately with the current target visible.
Its machine and AliceProject lists hold their layout while the relay discovers
the fleet; discovery has no fabricated percentage or staged progress because
the relay returns one inventory. The body scrolls independently of the
confirmation controls, and a selected running target is shown alongside the
current target before switching.

Native `server run/start` derives its content identity from the installed
`release.json`, matching the interactive launcher. Readiness confirms pending
activation only when the running identity matches the installed pointer.
Ownership contention exits with code 75 and does not roll back the installed
release; corrupted or non-starting releases retain the existing rollback path.
On Linux, process identity prefers procfs start ticks plus boot time, with the
existing conservative fallback when process metadata cannot be read.

## Product Decision

OpenAlice has four first-class entry surfaces, not one replacement chain:

| Surface | Presentation runs | Runtime runs | Purpose |
|---|---|---|---|
| Electron | local packaged app | local Electron-owned Runtime | complete desktop distribution |
| Local browser | local browser | local Guardian-owned Runtime | low-friction CLI distribution and development |
| SSH browser | local browser | remote Guardian-owned Runtime | same product over an authenticated transport |
| Independent Studio | local or hosted web client | local, remote, or managed Runtime | later presentation-neutral client |

Electron must remain complete. The CLI/server path is an additional
distribution and remote-control surface; it does not replace Electron's
`app://` protocol, preload/IPC, packaged PTY, signing, updater, or managed
runtime behavior.

The first remote product reuses the normal OpenAlice browser application over
an SSH loopback tunnel. This already keeps the expensive and security-sensitive
work on the remote host while rendering HTML locally. A new hosted Studio
protocol is deferred until the local/server boundary is stable.

## Vocabulary

- **Runtime**: the Guardian-owned process tree and user state under one
  `OPENALICE_HOME`. It includes Alice, optional UTA, optional Connector Service,
  workspaces, PTYs, user-owned Agent CLIs, schedules, and file-backed state.
- **Server**: a Runtime deliberately started without owning a browser or
  terminal client. It continues after the command that requested detached
  startup exits.
- **Client**: a presentation or control surface: browser, Electron renderer,
  installed CLI, or future independent Studio.
- **Transport**: how a client reaches a Runtime. The first remote transport is
  OpenSSH; it is not part of Runtime state.
- **Control endpoint**: a user-local, non-network endpoint owned by Guardian for
  status and graceful shutdown. It is distinct from Alice HTTP, MCP/CLI, UTA,
  Connector, and PTY WebSocket endpoints.
- **Presentation protocol**: HTTP/WS for the current browser, Electron IPC for
  the packaged app, and a future versioned snapshot/event protocol for an
  independent Studio.

## Architectural Invariants

1. The machine that owns the files owns the Workspace, native Agent processes,
   tool execution, provider requests, and trading boundary.
2. Guardian remains the final single-writer and process-tree authority for an
   `OPENALICE_HOME`; a new CLI command may not invent a parallel lock.
3. UTA remains optional. Server, remote status, browser Chat, and non-trading
   work must function in lite/read-only mode.
4. Alice binds to `127.0.0.1` for local and SSH-backed server use. Internal
   MCP/CLI, UTA, Connector, control, and PTY ports are never made public to
   enable remote access.
5. SSH authenticates and encrypts transport. It does not silently grant
   install, update, start, takeover, or stop consent.
6. Disconnecting a browser, Electron renderer, CLI, or SSH tunnel does not stop
   a detached Server.
7. top-level `down` and compatibility `server stop` ask the owning Guardian to
   terminate its own tree and verify completion. They do not signal a guessed
   PID or delete a live lock.
8. `--takeover` remains the only command-line authority to replace another
   recorded Guardian owner.
9. On an ordinary SSH-managed host, remote bootstrap reuses the invoking local
   CLI's recorded installer source and logical release identity. Stable, beta,
   and pinned installs may use different target archives for different
   operating systems or architectures; each host verifies its own archive
   checksum and content identity. A source checkout without installed metadata
   selects the exact beta release when its CLI version is a beta; the read-only
   plan blocks contradictory channel/version metadata before any SSH write.
   Dev additionally requires the invoking CLI to
   match the latest completed dev manifest and selects the remote target from
   that same manifest. Bootstrap does not carry a second SSH-only installer,
   upload Runtime bytes through SSH, install Node/build tools, clone a checkout,
   or install an Agent Runtime. Only an explicit `--app-dir` opts into source
   preparation.
10. Shared Runtime facts use presentation-neutral names and versioned schemas.
    Browser layout, Electron chrome, modal state, and other client UI state do
    not become server truth.

The relay owns a single active Machine operation. Its
`/relay/v1/machines/operation` snapshot reports the actual check, install,
restart, and verification stages to the GUI; Electron reads the same relay
state through IPC. A running operation blocks location switching, and its
final failure is retained so the dialog can show the installer error.
When an upgrade restarts the currently selected remote Runtime, the relay
rebuilds and verifies its SSH forward before marking the operation successful.
The upgrade dialog remains visible during that planned outage; an unrelated
backend outage still uses the normal reconnect screen.

## AliceProject Transfer

The first transfer direction is local AliceProject to a registered SSH
Machine. `--plan` inventories without changing either host; apply requires an
explicit confirmation or `--yes`. The source remains registered and unchanged,
and the destination receives a new AliceProject id. Transfer never means
takeover, move, merge, replacement, deletion, Runtime start, or default-project
selection.

```bash
openalice project transfer \
  --from research \
  --to-machine cloud-dev \
  --to-project research-cloud \
  --to-home /home/alice/.openalice-research \
  --session-owner-policy keep-blocked \
  --plan
```

The plan reports portable file/byte totals, required destination free space,
secret-free credential categories, excluded Session/runtime files, and exact-
Session scheduled Issues. Apply re-probes source ownership and remote inventory,
requires a stopped source (or the separate `--stop-source` authority), and
refuses an occupied project key or Home.

The sender uses a versioned, bounded stream over SSH stdin. The receiver checks
normalized paths, entry types, symlink containment, sizes, checksums, available
space, and transaction identity; writes an owner-private sibling staging Home;
then atomically publishes and registers it without changing the remote default.
A matching published receipt makes registration retry idempotent. Cancellation
terminates the SSH receiver and leaves only that transaction's marked staging
path eligible for a safe retry.

Portable configuration, active and departed Workspace repositories, Workspace
ids, and lifecycle records transfer. Absolute Workspace paths are rebased to
the remote Home. For an ordinary self-contained Git Workspace, the planner
keeps portable object/ref/index state, tracked files (including deliberately
tracked ignored files), and nonignored untracked user files; machine-local Git
configuration plus ignored untracked dependencies and build outputs stay
behind. Linked worktrees, alternate/promisor object stores, nested Git
repositories, and initialized submodules block apply instead of being silently
degraded. A non-Git Workspace remains portable subject to the same Session,
symlink, and machine-local exclusions.

Guardian state, Runtime payloads, ports, Web auth and sessions,
headless/native conversation state, resume identities, native Agent login and
configuration, and untracked Session dossiers do not transfer. A deliberately
Git-tracked `.alice/sessions` dossier remains inert repository content and does
not create a resumable remote Session. Top-level `bin/` and `cli/` trees,
installer locks/caches, and Alice-owned backup families are excluded; an
arbitrary backup file deliberately stored inside a user repository still
follows that repository's Git rules. Absolute symlinks, symlinks containing
control characters, and relative symlinks that resolve outside the source
AliceProject Home are reported as machine-local exclusions. Portable relative
symlinks contained by the Home remain part of the transfer.

Only Alice-owned AI, market-data-provider, broker, and Connector credentials
can travel in the private SSH stream. Broker and Connector values are decrypted
in source-process memory and sealed on the receiver with a newly created
destination key; the source sealing key is never copied. With
`--without-credentials`, portable AI and market-data configuration remains
after secret fields are stripped, while broker-account and Connector credential
files are omitted and must be configured again. Web authentication and native
Agent login remain separate destination setup in either mode. Exact-Session
scheduled Issue owners require an explicit `keep-blocked` or `new-then-resume`
policy.

## Layered Topology

```text
presentation plane
  browser | Electron | future Studio
        │
transport plane
  loopback HTTP/WS | Electron IPC | SSH loopback | future capability channel
        │
runtime/control plane
  Guardian lease + local control endpoint + Alice APIs
        │
execution plane
  Workspace files + PTYs + native Agent CLIs + tools + optional UTA
```

The boundary matters when debugging latency. In an SSH-browser session, the
browser is local but the shell/TUI and model loop are remote. Keystrokes cross
the network to the remote PTY; remote screen changes return over the Workspace
WebSocket. HTML layout, menus, lists, and most Studio interaction remain local
browser work.

## Command Contract

The default `openalice` command starts the local TUI and its Web relay. The
relay owns one active Machine/AliceProject target for all browser tabs attached
to that relay. `openalice relay` runs the same Web controller without TUI
presentation. Browsers never open a Runtime HTTP port or an SSH-forwarded
Runtime port directly through supported CLI commands.

```bash
openalice
openalice relay
openalice machine add <user@host> --label <name>
openalice --machine <id-or-label> <command> [options]
openalice --remote <target> --plan|--status|--stop [options]
```

`machine add` validates the profile, probes the host, plans and confirms any
required native CLI/Runtime install or start, checks readiness, and only then
registers the Machine. The relay can select a registered, enabled Machine and
one of its running AliceProjects. It cannot select an arbitrary SSH address.
Settings → General now offers the same Machine preparation from the local GUI:
enter an SSH target and label, run a read-only probe, review the exact planned
actions, then approve apply. Saved Machines can be re-probed for updates against
the local CLI release. Select a running AliceProject when reviewing an update so
the plan targets that project's data home rather than the Machine's default
home. About OpenAlice shows the client and connected backend versions separately
and exposes the same review for the current remote AliceProject. The relay
rechecks the plan immediately before apply and
rejects changed remote facts; a restarted Runtime can briefly disconnect an
active connection. These are local relay controls, never AliceProject API calls.
`--machine` routes CLI commands through a saved profile. `--remote` keeps
read-only planning and explicit status/stop controls; its former one-off
browser attach is retired.

Local Runtime lifecycle commands are browserless:

```bash
openalice run [app-dir]
openalice up [app-dir]
openalice status
openalice down
openalice server run|start|status|stop
```

`run` owns a foreground Guardian and stops its process tree on normal shell
termination. `up` starts a detached owner and returns after control and HTTP
readiness. The `server` presenter remains for managed remote and existing
scripts. Neither these commands nor their status URLs transfer GUI ownership
from the local relay to the Runtime. The old `start`, `open`, and `up --open`
shortcuts are retired.

### Registered Machines and aggregate inventory

`openalice machine` owns the saved, health-checked fleet identity used by the
relay:

```bash
openalice machine list [--json]
openalice machine add alice@example.com --label "Cloud" --yes
openalice machine rename <id-or-label> --label "Cloud production" --yes
openalice machine disable <id-or-label> --yes
openalice machine enable <id-or-label> --yes
openalice machine remove <id-or-label> --yes
openalice --machine <id-or-label> status --json
openalice machine inspect [id-or-label] [--json]
```

Machine profiles live in the machine-wide Supervisor root's owner-private
`machines.json`; they contain an opaque id, display name, OpenSSH target,
enabled state, optional port, and local identity-file path, but never passwords,
private-key bytes, passphrases, host keys, agent material, or remote
credentials. OpenSSH config, agent, ProxyJump, and host-key policy stay
authoritative. Removing or disabling a row changes local metadata only after
the explicit confirmation; remove never deletes remote data.

`machine add` accepts `--ssh-port` and `--identity`. It validates the profile
before remote setup and rechecks the registry before saving. Herdr's named
server sessions have no OpenAlice equivalent: `--remote-session` is rejected,
not silently stored. Select an AliceProject with `--project` or `--home` on the
target command where supported. Persisted keys and JSON output fields are
documented separately in [[docs/data-locations.md]].

Disabled profiles remain visible as offline inventory rows with
`EMACHINEDISABLED`, no projects, and no remote capabilities. Inventory does not
contact them; new TUI connections, starts, and transfers check enablement too.
Disabling a profile does not stop the remote Server or close an existing tunnel.
Explicit `--remote --plan|--status|--stop` remains independent of saved profiles
because it controls a Runtime without selecting a GUI target.

`machine inspect` uses the same typed inventory for local and remote Machines.
Each remote probe invokes `openalice machine inspect local --json` once; that
remote command reads only its Supervisor AliceProject registry and probes those
registered complete homes. Fleet probes force OpenSSH batch mode so a password,
key-passphrase, or host-key prompt cannot seize the Supervisor TUI; those cases
become an `unauthorized` row. Interactive tunnel commands retain normal
OpenSSH prompting. The inventory command does not scan other directories. The bounded
response contains project identity, product, home/port, normalized Runtime
state, safe component health, and advertised capabilities. Runtime owner PIDs,
tokens, logs, command lines, environments, and credentials are omitted.

Reachability is deliberately not Runtime state. A registered remote row is
reported as `online`, `offline`, `unauthorized`, or `incompatible`; an online
Machine may still contain stopped, unhealthy, or differently owned Projects.
One unreachable Machine remains a row in the fleet result instead of failing
the complete refresh. The older `remote-targets.json` port cache is not a
Machine registry and is no longer consulted by the supported GUI path.

The Supervisor Fleet page consumes that contract directly. A running remote
AliceProject with a validated `127.0.0.1` Web endpoint can be opened through
the existing loopback tunnel. The TUI owns an abort controller for every such
tunnel: `q`, `Esc`, `Ctrl+C`, or process termination closes the tunnel while
leaving Guardian and the detached remote Server untouched. `s` may start a
stopped compatible Project, but only after a fresh aggregate inventory and
Machine-registry read prove the selected key is still stopped, available, and
lifecycle-capable. The command then invokes the registered SSH target and
refreshes Fleet state. Stop, restart, takeover, Setup, source, logs, Doctor,
and configuration mutations remain unavailable for remote Fleet selections;
offline or incompatible rows never receive guessed lifecycle actions.

The browser relay is an alternate client presentation: `openalice relay`
opens a stable loopback origin and selects a running local Project when one is
available. If none is running, its connection screen can still discover
Machines and Projects. Settings lists only registered SSH Machines and lets the
user select a running Project. A stopped Project must first be started through
CLI lifecycle controls. Selecting or switching Projects does not start, stop,
update, or take over a Runtime; the separate, explicitly approved Machine
update plan can restart one. One relay has one active target shared by all its tabs. A
switch probes the candidate and verifies its AliceProject identity before
promotion; failure retains the old target. Success closes old WebSockets,
increments a target generation, and reloads all tabs. Switching never stops
the old Runtime.

Electron can host the same relay in its main process. Its default integrated
mode keeps `app://openalice`, the local Guardian-owned AliceProject, and native
IPC. Settings can select a running local or SSH Project for separated mode:
the relay verifies the candidate first, then Electron stops only its own local
children, releases its local Project lock, and loads the relay's loopback UI.
The separated renderer uses backend HTTP/WS and receives no backend-specific
native bridge. Returning to integrated mode reacquires local ownership without
takeover, starts local children, waits for Alice readiness, and only then loads
`app://openalice`. The selection is scoped to this Electron process; a fresh
launch starts in integrated mode. Neither switch stops a selected remote
Runtime.

When `--app-dir` is absent, managed remote requires the verified native Runtime
installed with the matching CLI. No Git checkout, Node, Bun, Python, compiler,
or package-manager mutation is part of that path. A target outside the
published platform/architecture matrix is reported as unsupported instead of
silently changing distribution models. An explicit `--app-dir` is user-owned:
it may be prepared as source, but existing source is never fetched, switched,
reset, or overwritten merely to imitate the native release.

`--yes` may approve the displayed install/update/start plan for automation, but
it never implies `--takeover`. Non-interactive execution without a sufficient
explicit approval fails without remote mutation.

The relay owns Machine identity and publishes its selected target through its
local control API. The browser reads that state from the relay, rather than
remembering an SSH alias in a URL fragment or tab storage. A remote
AliceProject's data home belongs to the backend and cannot be switched by a
browser-only filesystem action.

## Server Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Absent
    Absent --> Starting: server start or run
    Starting --> Running: control and HTTP ready
    Starting --> Failed: timeout or child exit
    Running --> Running: idempotent start or status
    Running --> Stopping: structured stop or owner signal
    Stopping --> Absent: process tree exited and lease released
    Running --> Recovering: owner dies unexpectedly
    Recovering --> Running: Guardian recovery or explicit takeover
    Recovering --> Absent: bounded cleanup completes
```

The readiness barrier includes:

- Guardian owns the canonical runtime lease;
- the local control endpoint responds with a compatible protocol;
- Alice reports healthy on its loopback HTTP endpoint;
- optional components report their own state without making UTA a readiness
  requirement for non-trading use.

The detached parent returns success only after this barrier. On timeout it
prints the isolated log path and current ownership evidence. It must not report
success merely because a child PID was spawned.

The Server appends Guardian and child output beneath the selected
`OPENALICE_HOME` and prints that path on start. Logs must not contain provider,
broker, SSH, pairing, or sealing secrets.

## Guardian Control Contract

### Endpoint

The Unix endpoint is normally
`<OPENALICE_HOME>/state/guardian-control.sock`, mode `0600`. If that path would
exceed the conservative Unix-domain-socket byte limit, both Guardian and the
CLI derive a per-home hashed filename beneath a UID-owned `0700` directory in
the OS temporary root. Native Windows derives an equivalent per-home named
pipe. Every form is deterministic for the canonical home and is removed only
when the closing Guardian still sees the socket identity it created.

The endpoint is never bound to TCP and is never forwarded by `openalice --remote`.
Remote orchestration reaches it only by executing the remote CLI through SSH.

Stale path handling follows reachability and ownership, not existence alone:

1. connect and perform a versioned status request;
2. if reachable, treat it as an owner regardless of a surprising PID file;
3. if unreachable, consult the Guardian lease/recovery state;
4. remove a stale endpoint only while acquiring ownership for a new Guardian;
5. never unlink an endpoint merely because status timed out once.

### Versioned messages

The control protocol is newline-delimited JSON with a small, bounded request
size. Every request and response carries `protocol` and `id`. Initial methods:

- `runtime.status` — read-only readiness, ownership, version, endpoints, and
  component health;
- `runtime.stop` — acknowledge intent, begin the normal Guardian shutdown
  cascade, and close the endpoint only after shutdown begins.

The status result is presentation-neutral and includes at least:

```json
{
  "protocol": 1,
  "runtimeVersion": "<OpenAlice version or dev identity>",
  "state": "running",
  "home": "<canonical OPENALICE_HOME>",
  "owner": {
    "surface": "cli-server",
    "pid": 1234,
    "instanceId": "<Guardian instance id>",
    "startedAt": "<ISO-8601>",
    "launchRoot": "<native release resource root or explicit source root>"
  },
  "endpoints": {
    "web": "http://127.0.0.1:47331"
  },
  "components": {
    "alice": "ready",
    "uta": "disabled",
    "connector": "disabled"
  },
  "capabilities": ["runtime.stop"]
}
```

`owner.surface` is diagnostic metadata. A healthy compatible Guardian whose
Alice component is ready is `running` regardless of whether its launcher calls
itself `cli-server`, `docker`, `electron`, or something else. Mutation is
authorized only by the same canonical home and the matching capability.

Human `server status` output may be friendly, but `--json` preserves this
machine-readable meaning and stable exit classes:

| Class | Meaning |
|---|---|
| `running` | compatible Guardian is ready and Alice reports ready |
| `starting` / `stopping` | compatible owner is in a transitional state |
| `absent` | no reachable control endpoint and no live Guardian owner |
| `owned_elsewhere` | Guardian lease evidence exists, but no compatible controllable endpoint is reachable |
| `incompatible` | endpoint is reachable but protocol/runtime compatibility fails |
| `unhealthy` | compatible owner exists but readiness checks fail |

Status must not return credentials, auth tokens, complete environment
variables, arbitrary command lines, or private internal-port URLs.

### Shutdown and recovery

`runtime.stop` enters the existing Guardian shutdown path:

1. stop accepting new control mutations;
2. send the normal graceful signal to children;
3. wait the existing grace period;
4. escalate through Guardian's process-tree policy when required;
5. wait for children and the recorded owner to exit;
6. release only the lease and control endpoint owned by this instance.

If the control endpoint is unreachable but a lease exists, `server stop` does
not improvise cleanup. Recovery remains the existing explicit Guardian
takeover path with its discover → TERM → grace → tree KILL → owner-exit order.

## SSH Transport Contract

```text
local browser → local Web relay → SSH loopback tunnel → remote Alice HTTP/WS
```

The local relay serves the GUI bundle and proxies HTTP/WebSocket traffic to its
one selected Runtime. It owns the SSH tunnel; the Runtime owns its AliceProject
and never gains authority over the client's Machine registry. Switching first
validates the candidate's health and AliceProject identity, then atomically
changes the relay target. The old Runtime remains running.

SSH binds both ends to `127.0.0.1`, follows ordinary OpenSSH config, agent,
keys, ProxyJump, and host-key verification, and never forwards Guardian's
control endpoint. An unreachable Machine stays in inventory with a diagnostic
state; the relay does not guess a replacement target or start a Runtime. The
user can verify `ssh <target>` independently before diagnosing OpenAlice.

## HTTP and Browser Security

SSH makes the remote HTTP request arrive from loopback, so network origin alone
is not sufficient authorization. The browser contract remains:

- the UI, HTTP API, and PTY WebSocket share the tunnel's local loopback origin;
- Alice accepts loginless local behavior only for no-`Origin` local CLI/server
  callers, a validated loopback browser origin, or the exact packaged
  `app://openalice` origin;
- public web origins cannot inherit localhost trust merely because a tunnel is
  open;
- state-changing requests and WebSocket upgrades keep origin validation;
- `OPENALICE_DISABLE_AUTH=1` is never a remote-access instruction;
- operators exposing a deployment beyond loopback own its HTTPS,
  authentication, and network-access policy.

The local relay additionally rejects non-exact Host and cross-origin mutation
requests, strips browser forwarding headers, and namespaces backend cookies
per Machine/Project. Its control routes accept registered keys rather than raw
SSH destinations or commands. Backend API requests capture the active target
at dispatch; they are never replayed against another target after a switch.
Opaque `oa-surface-*.localhost` hosts are forwarded only to the selected
Runtime's Surface Router; they never enter relay control or local UI routes.

The future independent Studio cannot reuse “it arrived from loopback” as its
identity. It needs an explicit pairing/capability flow with revocation,
least-privilege scopes, origin binding, and a user-visible device/session list.
That is a later protocol, not a shortcut in the SSH phase.

## Terminal and Agent Streaming

### Stage-one behavior

The existing Workspace PTY WebSocket crosses the SSH tunnel unchanged. The
remote PTY and Agent TUI remain authoritative; the local xterm-compatible
surface renders received terminal bytes. Shell, Claude Code, Codex, opencode,
and Pi retain the same terminal semantics. The Web conversation surface remains
an optional structured presentation of a runtime's own protocol, not a
prerequisite or replacement for shell/TUI workflows.

The browser's core health probe publishes a monotonic recovery generation only
when Alice transitions from unavailable back to available. PTY views use that
signal to re-attach the same Session after a recoverable tunnel/backend outage,
including after their bounded exponential retry budget has expired. A stopped
retry loop remains visibly closed with an explicit **Retry** action.
Runtime-identity reads such as the running version/update authority and current
AliceProject also invalidate outage-era requests and refetch on that recovery
generation, so a replacement owner cannot leave Settings describing the old
Runtime after the global overlay disappears.
Authentication failures, another controller's ownership, and a missing Session
remain fatal to that attachment: recovery never implies takeover, Session
recreation, or a new Agent Runtime.

This path should be measured before adding a second terminal protocol. Relevant
tests use controlled network conditions such as 20 ms, 80 ms, and 150 ms RTT,
low-bandwidth links, bursty Agent redraws, resize, reconnect, and long-running
output. Record:

- input-to-first-visible-output latency;
- bytes transferred during representative Agent interactions;
- whether stale output accumulates after a burst;
- reconnect and scrollback behavior;
- CPU and memory on both ends;
- behavior when the tunnel disappears mid-command.

Round-trip latency cannot be removed while the Agent process is remote. The
design goal is to avoid adding avoidable backlog, excessive redraw bandwidth,
or remote presentation work on top of that RTT.

### Structured terminal optimization, if evidence requires it

If raw PTY traffic creates meaningful backlog or bandwidth cost, add a
terminal-specific stream behind stable Workspace/Session/terminal identities:

- server parses terminal bytes into current VT state;
- clients negotiate full snapshot plus incremental updates;
- each frame has a monotonic sequence and explicit dimensions;
- control messages remain reliable and ordered;
- render updates are bounded latest-state data, not an unbounded reliable
  queue;
- a gap or incompatible baseline triggers a fresh snapshot;
- only an acknowledged or queued frame advances the per-client baseline;
- observers cannot send input or resize;
- one controller owns input and resize, with explicit takeover.

This stream optimizes terminals only. Studio navigation, data tables, settings,
Inbox, Workspace metadata, and trading UI continue to use presentation-neutral
application APIs rather than a remote-rendered framebuffer.

## Multi-Client Authority

The first SSH-browser release may support one interactive browser per terminal,
but the contract reserves explicit roles:

| Role | Read output | Send input | Resize PTY | Take ownership |
|---|---:|---:|---:|---:|
| observer | yes | no | no | no |
| controller | yes | yes | yes | no |
| takeover requester | after grant | after grant | after grant | explicit only |

For a given terminal there is at most one controller. A second browser,
Electron client, or future Studio may observe without changing the PTY size.
Control transfer is visible and deliberate; it is not awarded silently to the
last socket that sends a resize.

Client-local effects stay client-local:

- clipboard reads/writes target the controlling local surface;
- notifications name the Session and source client policy;
- window size and focus are not durable Runtime facts;
- reconnect does not imply takeover;
- disconnect releases transient controller ownership after a bounded grace
  period, but does not kill the PTY or Agent.

Shared Runtime facts include Workspace and Session identity, terminal identity,
Agent process/session metadata, execution status, artifacts, and file-backed
state. They must not be named after a particular sidebar, card, tab strip, or
Electron window.

## Persistence Semantics

Remote documentation must distinguish what survived:

| Event | Guardian tree | PTY process | recent terminal state | Agent conversation |
|---|---:|---:|---:|---:|
| browser/tunnel disconnect | survives | survives | live in PTY Runtime | survives because process lives |
| controller transfer | survives | survives | live in PTY Runtime | survives because process lives |
| Alice child restart under Guardian | Guardian survives | depends on current PTY ownership path | implementation-dependent | native Agent process/session dependent |
| full Guardian/server restart | stops and restarts | does not automatically survive | only persisted history, if explicitly supported | only through native Agent resume/provenance |
| machine reboot | stops | stops | only persisted history | only through native Agent resume/provenance |

OpenAlice must not market server detach as crash-proof terminal persistence.
Conversation provenance and native CLI resume remain governed by
[[docs/conversation-provenance.md]]. Persisting terminal scrollback is a
separate privacy decision because screens can contain source, prompts, output,
tokens, or account data.

Live PTY handoff during Runtime upgrade is explicitly deferred. The first
managed remote version may require a visible stop/restart when protocols are
incompatible. It must describe the effect before acting.

## Managed Remote Bootstrap and Compatibility

Managed SSH bootstrap uses a plan/apply split. OpenAlice begins only after the
user has made the target reachable through ordinary OpenSSH.

The read-only plan reports:

- SSH target and resolved remote platform/architecture;
- detected OpenAlice CLI path, version, logical release identity, and whether
  its target-local artifact identity is valid for the remote host;
- control protocol compatibility;
- Server state, Runtime provider, native content identity, and release/source
  root;
- whether the installed native Runtime matches the CLI product version,
  platform, architecture, selector, and checksum-bound provenance;
- for an explicit source override, whether its checkout already has complete
  Runtime artifacts;
- proposed install/update/start actions;
- destination paths and whether PATH changes are required;
- whether a running owner would be affected;
- the final local and remote loopback ports.

Apply rules for an ordinary SSH-managed host:

1. no matching compatible CLI or Runtime: ask before invoking the normal
   installer with the local CLI's recorded logical release selector and
   expected target-local artifact identity; the installer obtains the matching
   platform-native release;
2. native mode never installs source-build dependencies or Agent Runtime
   executables;
3. explicit source mode validates its own prerequisites and remains separate
   from the native installer transaction;
4. compatible CLI, absent Server: start after explicit plan consent;
5. compatible healthy Server: reuse without mutation;
6. incompatible stopped CLI: ask before update;
7. incompatible running Server: stop/restart or update only after a second
   effect-specific confirmation;
8. owner conflict: fail unless the user separately passed `--takeover`;
9. non-interactive mode: require flags that cover every proposed mutation.
10. unsupported native platform/architecture: stop with an explicit result;
    do not fall back to a checkout;
11. explicit `--app-dir`: preserve existing Git state and never manage updates.

Remote SSH commands retry a small allowlist of transport failures (connection
reset/timeout/close, key-verifier service interruption, and SSH identification
exchange failures). Stderr from retryable attempts remains buffered; users see
one neutral retry line, and raw diagnostics appear only after a final failure.
Arbitrary remote command failures are never retried. After
an approved installer or Server-start action loses its SSH transport, managed
remote re-probes the versioned state: it continues only when the intended CLI
or Server is already present and compatible, otherwise it returns the original
failure. Source preparation uses compact phase output and suppresses successful
package/build chatter; a failed phase still includes a bounded diagnostic tail.

For an ordinary SSH-managed host, the local orchestrator compares protocol
ranges and logical release identity; human version strings alone are
insufficient. Stable, beta, and pinned releases may have different macOS and
Linux archive/content identities, but the remote CLI provenance and embedded
Runtime must agree with that remote host's target. For dev, the latest CDN dev
manifest is the completed-set authority: the local CLI must match its own
target, the remote target is selected from the same manifest, and installer
handoff is bound to the remote checksum and content identity. If the manifest
cannot be verified or the local CLI is stale, remote mutation is blocked.

## Future Independent Studio Protocol

The independent frontend is not “serve the current bundle from another domain
and forward cookies.” It is a client of a versioned Runtime protocol.

Its minimum reconnect model is:

1. authenticate through an explicit local pairing or remote capability;
2. negotiate protocol version and capabilities;
3. fetch one coherent Runtime snapshot with a cursor;
4. subscribe to ordered events after that cursor;
5. attach specialized streams, such as terminal output, by stable identity;
6. if the cursor is unavailable or a sequence gap appears, discard derived
   state and resnapshot;
7. issue mutations with request IDs and idempotency where retry is possible.

The snapshot contains presentation-neutral data such as Runtime identity,
Workspace/Session records, terminal and Agent identities, health, and
capabilities. It does not contain browser component trees or Electron window
state.

This protocol can later travel through SSH stdio, a local socket, an
authenticated WebSocket, or a relay. Transport choice does not redefine the
Runtime model.

## Delivery Stages

### Stage 0 — SSH transport (implemented inside the relay)

- the local relay owns the SSH loopback tunnel for its registered remote target;
- browser UI and PTY WebSocket traverse the relay's stable loopback origin;
- Machine registration owns remote preparation and Server readiness.

### Stage 1 — native Server lifecycle (implemented)

- `server run/start/status/stop`;
- Guardian-owned local status/stop endpoint;
- detached start waits for real readiness;
- status distinguishes absent, compatible, unhealthy, and other owner;
- stop is structured and capability-gated;
- Electron behavior remains unchanged.

### Stage 2 — managed Bun-native remote (implemented)

- `machine add` plan/apply orchestration;
- probe and bootstrap the matching native CLI release with explicit consent;
- run the installed release without Node, Bun, source checkout, build tools, or
  bundled Agent Runtime executables;
- retain explicit `--app-dir` source preparation for development only;
- report unsupported release targets instead of silently cloning source;
- start/reuse the remote Server;
- establish the relay's SSH loopback tunnel on target selection;
- leave the Server alive after disconnect;
- remaining release observation: validate ordinary Agent TUI interaction under
  representative network shaping before deciding whether Stage 3 is useful.

### Stage 3 — terminal transport optimization

- build only if Stage 2 measurements justify it;
- add snapshot/diff/sequence/backpressure semantics for terminal state;
- add controller/observer ownership and takeover tests;
- keep the rest of Studio on application-level APIs.

### Stage 4 — independent Studio and broader transports

- add Runtime snapshot/events protocol;
- add pairing/capability security;
- extend the implemented Electron remote selection to hosted Studio if needed;
- consider broader device enrollment only after registered SSH Machine
  selection is operationally understood.

### Stage 5 — native release hardening (in progress)

- the initial content-addressed platform archive, hashed manifest, installer
  integration, and managed-remote selection are implemented;
- add release signature/provenance verification and reproducible-build
  evidence before describing the asset as cryptographically authenticated;
- retain the `server` commands and `--remote` selector, status schema, state root, and
  consent model;
- keep source-backed development as a supported diagnostic path.

## Acceptance Matrix

### Stage 1

| Scenario | Required result |
|---|---|
| fresh isolated home | detached Server reaches control and HTTP readiness |
| second normal start | reports already running; does not signal owner |
| explicit takeover | follows Guardian recovery ordering and obtains one owner |
| status JSON | stable schema and exit class for all lifecycle states |
| graceful stop | Guardian stops children, releases owned lease/socket, exits in bound |
| hung child | TERM precedes process-tree KILL; no orphan survives |
| stale endpoint | recovered only with lease/ownership evidence |
| cross-root or foreign owner | no normal-start kill; explicit takeover only |
| optional UTA absent | Server and browser Chat remain ready |
| Electron running | `server start/stop` do not silently replace or terminate it |
| packaged Electron smoke | local app, PTY, IPC, and shutdown remain healthy |

### Stage 2

| Scenario | Required result |
|---|---|
| ordinary SSH, matching compatible remote CLI/Server | reuses both without mutation |
| ordinary SSH, matching release across different targets | compares the logical stable/beta/pinned release, then validates the remote archive and Runtime against its own platform/architecture provenance |
| ordinary SSH, dev client behind latest manifest | blocks install/start mutation and asks the user to update the local dev CLI first |
| ordinary SSH, protocol-compatible CLI from a different branch/tag/commit | plan names a matching CLI update before connection |
| ordinary SSH, missing remote CLI, interactive | shows plan; default no leaves host unchanged |
| ordinary SSH, missing remote CLI, non-interactive | fails unless explicit approval is present |
| ordinary SSH, incompatible running Server | explains process impact before update/restart |
| matching installed native Runtime | plan selects it without Node, Bun, checkout, build-tool, or Agent-install mutation |
| missing remote CLI and Runtime | ordinary installer obtains matching native platform artifact; default no leaves the host unchanged |
| unsupported native target | reports the unsupported platform/architecture without cloning source |
| explicit source path | remains a deliberate development override and preserves existing Git state |
| tunnel disconnect | local command exits; remote Server and work continue |
| reconnect | same local port is preferred; same Runtime, browser origin, and live terminal are reachable; a busy port falls back visibly |
| ordinary SSH, status and stop | user-facing commands require no raw SSH; status uses one bundled control probe and stop verifies structured shutdown |
| ordinary SSH, transient SSH loss after apply | retry known transport faults; re-probe completed install/start state before deciding failure |
| host-key failure | fails without disabling verification |
| SSH agent/passphrase path | preserves normal OpenSSH interaction |
| browser security | same-origin HTTP/WS works; public Origin remains rejected |
| external Agent TUI matrix | each user-installed Shell/Agent executable retains its own version, config, and process |
| Docker SSH fixture | no-Node host exercises install, start, tunnel, reconnect, transfer, and stop |
| AliceProject containing install bytes or host links | transfer excludes top-level `bin/`, `cli/`, and escaping/absolute symlinks as machine-local content |

### Later protocols

| Scenario | Required result |
|---|---|
| slow observer | cannot accumulate unbounded obsolete terminal frames |
| concurrent clients | exactly one controller owns input/resize |
| dropped sequence | client resnapshots instead of rendering corrupted state |
| reconnect after event gap | Runtime snapshot reestablishes coherent state |
| capability revocation | independent Studio loses access without stopping Runtime |

## Verification Route

When this surface changes:

1. use isolated `OPENALICE_HOME` roots; never exercise recovery against the
   user's normal home;
2. follow [[docs/cli-installer.md]] for distributed CLI payload changes and run
   `pnpm test:system:installer`, plus the manual installer playground before a
   release;
3. run the Guardian recovery case matrix when lifecycle, ownership, signals,
   locks, or the control endpoint changes;
4. start the real localhost route and verify the Workspace terminal and
   loginless loopback Origin contract;
5. exercise OpenSSH transport and managed `--remote` against a disposable SSH/Docker
   host with `pnpm test:system:remote`, including default-no, installed payload
   equality, detach persistence, reconnect, and structured stop;
6. follow [[docs/managed-workspace-runtime.md]] and run the matching Electron
   and package smoke whenever shared Guardian, PTY, startup, or dependency
   behavior changes;
7. run the repository-wide TypeScript and test gates required by `AGENTS.md`.

Record any network-shaping gap explicitly. A localhost smoke does not verify
remote TUI behavior, and an SSH tunnel smoke does not verify Electron package
behavior.

## Non-Goals for the First Implementation

- public TCP binding of Alice or the Guardian control endpoint;
- hosted-domain cookie forwarding;
- cloud relay, NAT traversal, or device fleet management;
- live migration of PTYs across Runtime upgrades;
- persistent terminal screen history by default;
- simultaneous writable control from multiple clients;
- replacing Electron with a browser wrapper;
- replacing Shell or native Agent TUIs with the Web conversation surface;
- scanning arbitrary remote directories or silently cloning OpenAlice; managed
  clone/update is restricted to the displayed destination and explicit plan;
- installing, pinning, downgrading, or repairing Agent Runtime executables on a
  remote host;
- moving broker credentials, account state, or trading writes out of UTA.
