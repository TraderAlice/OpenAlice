# Herdr Remote Runtime Reference

This is a non-authoritative research note for OpenAlice's remote Runtime work.
It records what Herdr actually does, which parts are worth learning from, and
which parts OpenAlice should not copy. Product contracts belong to
[[docs/remote-access.md]].

## Source Snapshot and License Boundary

The review used the public
[`ogulcancelik/herdr`](https://github.com/ogulcancelik/herdr) repository at
commit
[`a0678a38b9426b011f66e1b88ff7aaa9bf877104`](https://github.com/ogulcancelik/herdr/tree/a0678a38b9426b011f66e1b88ff7aaa9bf877104),
inspected on 2026-07-15. The repository declares AGPL-3.0-or-later with a
commercial-license option. This note links to and paraphrases the public source;
it does not vendor Herdr code or make Herdr an OpenAlice dependency.

Line links below are pinned to that commit so this note remains reproducible
when Herdr's main branch changes.

## Executive Summary

Herdr is not merely a TUI launched inside SSH. Its default architecture is a
persistent terminal Runtime with one or more thin clients:

```text
client terminal
  └── input + resize + client-local integrations
        └── private client protocol
              └── background Herdr server
                    ├── session state and layout
                    ├── PTY processes and VT state
                    ├── agent detection and metadata
                    ├── virtual TUI rendering
                    └── JSON control API and event subscriptions
```

There are two distinct SSH experiences:

1. SSH into the host and run `herdr`. Both server and TUI client are remote;
   the outer terminal transports their byte stream in the traditional tmux
   style.
2. Run `herdr --remote <host>` locally. A local Herdr client reaches a remote
   Herdr server through an SSH stdio bridge. The client renders locally and can
   integrate with the local clipboard and desktop.

The second path improves ownership of local presentation and avoids replaying a
remote terminal application's own drawing decisions. It does not eliminate
network round-trip time: every keystroke still has to reach the remote PTY
before new terminal state can return.

The most transferable lesson is broader than the SSH bridge: the remote host
owns durable Runtime facts and execution, while client presentation is
replaceable. Herdr's own contributor guidance says it is still migrating toward
that boundary and warns against adding shared behavior only to its private TUI
socket. OpenAlice should begin with that neutral boundary instead of first
building a second server-rendered application protocol.

## Process Topologies

### Default local mode

Running `herdr` checks for the session server, starts it as a detached daemon if
needed, waits for its client socket, and attaches a thin client. A
`--no-session` option preserves a single-process compatibility path. The
behavior is documented in
[`src/server/autodetect.rs`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/autodetect.rs#L1-L29).

The headless server owns both a JSON API socket and a private binary client
socket. It restores state, owns PTYs, runs the event loop, renders to an
in-memory terminal buffer, streams frames, routes client input, and remains
alive after clients disconnect. See
[`src/server/headless.rs`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/headless.rs#L1-L15).

### Traditional SSH mode

```text
local terminal emulator
  └── ssh terminal byte stream
        └── remote Herdr client
              └── remote Herdr server
                    └── remote PTYs and agents
```

This is the simplest and most compatible route. Herdr behaves like a persistent
terminal multiplexer. It also means the local machine cannot directly provide
desktop clipboard/image behavior because the Herdr client itself is remote.
Herdr documents the distinction in
[`how-to-work.mdx`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/docs/next/website/src/content/docs/how-to-work.mdx#L34-L45).

### Local client with remote Runtime

```text
local Herdr client
  └── private local Unix socket
        └── local bridge process
              └── ssh -T <host> <remote-client-bridge>
                    └── remote private client socket
                          └── remote Herdr server, PTYs, and agents
```

`herdr --remote` first prepares a compatible remote binary, ensures the remote
server is ready, creates a user-only local bridge socket, and launches the
ordinary client against that socket. The bridge starts a non-interactive SSH
process for each local connection and copies framed protocol bytes through SSH
stdin/stdout. It is not an SSH `-L` tunnel to an HTTP application.

Relevant implementation points:

- remote orchestration:
  [`src/remote/unix.rs#L155-L192`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L155-L192);
- remote stdio-to-socket bridge:
  [`src/remote/unix.rs#L194-L218`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L194-L218);
- private local listener:
  [`src/remote/unix.rs#L1685-L1753`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L1685-L1753);
- SSH stdio forwarding:
  [`src/remote/unix.rs#L1851-L1903`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L1851-L1903).

## Server Ownership

Herdr's server owns four different categories of state:

| Category | Examples | Lifetime |
|---|---|---|
| Durable session model | workspaces, tabs, pane layout, labels, launch metadata | snapshot across server restart |
| Live terminal Runtime | PTY process, parser/VT state, scrollback, current screen | while server and process live |
| Shared agent facts | process identity, agent/session metadata, detection state | server-owned, API-visible direction |
| Client-specific presentation | size, theme, keybindings, render baseline, clipboard side effects | one attached client |

The separation is intentional. Herdr's repository rules distinguish pure
`AppState` from `PaneRuntime`, keep rendering conceptually pure, and make
detectors read terminal snapshots rather than own parsers. See
[`AGENTS.md#L24-L32`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/AGENTS.md#L24-L32).

The headless server still contains substantial application-presentation
responsibility: it performs virtual ratatui rendering and carries presentation
through a private client protocol. That is useful, but it is also architectural
debt Herdr explicitly acknowledges. Its stated direction is a server-owned
Runtime API with the TUI as one client, with shared facts exposed through the
JSON API/event path and TUI-only state kept client-side. See
[`AGENTS.md#L36-L51`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/AGENTS.md#L36-L51).

## Client Protocol

### Handshake and compatibility

The private protocol is length-prefixed and versioned. The inspected snapshot
uses protocol version 16, caps ordinary frames at 2 MiB, and has separate larger
limits for explicit graphics and clipboard payloads. A client starts with
`Hello` containing protocol version, terminal dimensions, render encoding,
keybinding profile, and launch mode. The server answers with `Welcome` or a
compatibility error.

Sources:

- limits and encodings:
  [`src/protocol/wire.rs#L12-L44`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/protocol/wire.rs#L12-L44);
- client messages:
  [`src/protocol/wire.rs#L306-L398`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/protocol/wire.rs#L306-L398);
- server messages:
  [`src/protocol/wire.rs#L597-L667`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/protocol/wire.rs#L597-L667);
- handshake validation:
  [`src/server/client_transport.rs#L420-L574`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/client_transport.rs#L420-L574).

### Two render encodings

`SemanticFrame` sends structured cell/frame data. `TerminalAnsi` sends a
per-client sequence plus already-diffed ANSI bytes that the client can write to
stdout. Remote attach explicitly selects `terminal-ansi`; see
[`src/remote/unix.rs#L1923-L1942`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L1923-L1942).

The choice is pragmatic. Semantic frames leave more presentation work in the
client but serialize a richer cell model. ANSI frames let the server reuse its
terminal diff knowledge and keep the remote client small. Both are still
frames of Herdr's whole terminal UI; neither is a neutral agent/session API.

### Backpressure and slow clients

Control messages and rendered frames do not share the same reliability policy:

- control messages are queued reliably and take priority;
- each client has only one pending render slot;
- if that slot is occupied, the server defers a fresh full render instead of
  accumulating obsolete intermediate frames;
- each client keeps its own render baseline and only commits the baseline after
  a frame is accepted for sending;
- identical semantic or ANSI frames are skipped.

This is the right mental model for interactive remoting: control is ordered;
presentation is latest-state delivery. The queue and priority behavior is in
[`src/server/client_transport.rs#L45-L52`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/client_transport.rs#L45-L52) and
[`src/server/client_transport.rs#L183-L266`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/client_transport.rs#L183-L266).
Per-client frame comparison and ANSI diff state live in
[`src/server/render_stream.rs#L12-L117`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/render_stream.rs#L12-L117).

Herdr also has a retained PTY update fast path that patches an existing frame
when one full-app client is attached and the UI is in a safe terminal-only
state. Otherwise it falls back to a full virtual render. A full render does not
necessarily imply a full network redraw because the per-client encoder can
still emit a diff. The fast path and queue-full behavior are visible in
[`src/server/headless.rs#L3338-L3547`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/headless.rs#L3338-L3547).

### What the latency optimization does and does not solve

An Agent TUI may emit many cursor movements, clears, style changes, and repeated
draws while producing one logical screen update. Herdr's remote server parses
the PTY into terminal state, renders from current state, diffs against each
client's acknowledged baseline, and skips or defers intermediate presentation.
That reduces bandwidth and prevents a slow client from replaying a backlog of
stale TUI bytes.

It cannot make the remote Agent process local. Input still crosses SSH, the
remote process decides what to render, and the resulting state crosses back.
Herdr even preserves the ANSI diff baseline across ordinary keypresses because
resetting it would force full redraws and make remote interaction noticeably
slower; see
[`src/server/headless.rs#L2570-L2594`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/headless.rs#L2570-L2594).

For OpenAlice, this means the existing browser PTY-over-WebSocket path is a
valid first measurement. A structured terminal stream is justified only if
measurements show bandwidth/backlog problems. It should optimize the terminal
plane, not turn the whole Studio into a remotely rendered TUI.

## Multi-Client Ownership

Multiple clients create authority questions that a simple tunnel can hide:

- the most recently interacting full-app client becomes foreground;
- the foreground client's dimensions drive shared PTY sizing;
- client-local effects such as clipboard, window title, and notifications
  should go to the relevant foreground client;
- only one writable direct-attach client owns input and resize for a terminal;
- an explicit takeover can replace that writer;
- multiple observers may receive terminal frames without input or resize
  authority.

The server fields for foreground and attach ownership are in
[`src/server/headless.rs#L250-L280`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/server/headless.rs#L250-L280).
The user-facing controller/observer contract is documented in
[`persistence-remote.mdx#L105-L155`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/docs/next/website/src/content/docs/persistence-remote.mdx#L105-L155).

OpenAlice should not silently let the last WebSocket resize every PTY. The
first managed-remote implementation may remain single-interactive-client, but
its protocol and docs must name writer, resize, observer, and takeover
authority so later Electron and browser clients do not invent conflicting
rules.

## Persistence Is Not One Feature

Herdr usefully distinguishes five survival mechanisms:

| Mechanism | What survives |
|---|---|
| Client detach | original server, PTYs, processes, live terminal state |
| Server restart | serialized layout and launch metadata, not original processes |
| Optional screen history | recent ANSI history, with an explicit secret-retention tradeoff |
| Native Agent resume | conversation continuity through the Agent CLI's own session reference |
| Live handoff | best-effort transfer of live PTYs during a compatible server replacement |

The matrix is documented in
[`session-state.mdx#L8-L35`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/docs/next/website/src/content/docs/session-state.mdx#L8-L35).
Herdr stores layout/session snapshots separately from optional terminal history;
its snapshot model is visible in
[`src/persist/snapshot.rs#L11-L122`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/persist/snapshot.rs#L11-L122),
and writes are committed through a temporary file plus rename in
[`src/persist/io.rs#L44-L75`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/persist/io.rs#L44-L75).

This vocabulary prevents misleading claims. “The server persists” does not
mean “every process survives a server crash,” and “the conversation resumes”
does not mean “the original PTY is alive.” OpenAlice's remote contract should
use the same distinctions.

## Session Isolation and Local Control

Herdr gives each named session its own state directory, API socket, client
socket, panes, and Runtime while sharing global configuration. Session status
is determined by reachability, and stop is a structured `server.stop` request
followed by a bounded wait for both sockets to become unreachable. See
[`src/session.rs#L157-L225`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/session.rs#L157-L225) and
[`src/session.rs#L232-L297`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/session.rs#L232-L297).

The API listener applies user-only socket permissions, refuses a busy socket,
and only removes a socket it still owns. See
[`src/api/server.rs#L74-L137`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/api/server.rs#L74-L137).

The transferable pattern is self-termination through an authenticated local
control endpoint. A CLI should ask the Runtime to stop and verify the endpoint
has gone away; it should not guess a PID and kill it. OpenAlice already has a
stronger Guardian lease/process-tree model, so the local control endpoint must
compose with Guardian ownership rather than replace it.

## Remote Bootstrap and Upgrade

Herdr's remote attach does more than connect:

1. detect remote OS and architecture;
2. search normal `PATH` and common manager-specific locations;
3. verify that a candidate binary reports the expected version;
4. ask before installing or replacing a remote binary;
5. fail without host mutation in non-interactive mode;
6. stream a matching binary to a temporary path, make it executable, and
   atomically move it into `~/.local/bin`;
7. verify the installed version and warn if the directory is absent from PATH;
8. ensure the remote server is compatible and ready before attaching.

The product contract is summarized in
[`persistence-remote.mdx#L38-L95`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/docs/next/website/src/content/docs/persistence-remote.mdx#L38-L95).
The staged transfer is in
[`src/remote/unix.rs#L522-L611`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L522-L611),
and detection/confirmation/verification is in
[`src/remote/unix.rs#L672-L735`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L672-L735).

For connection stability, Herdr can generate a private temporary SSH config
that includes the user's config and adds fallback keepalive and ControlMaster
settings. The directory and bridge socket are user-only. See
[`src/remote/unix.rs#L634-L648`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L634-L648) and
[`src/remote/unix.rs#L1756-L1765`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/remote/unix.rs#L1756-L1765).

OpenAlice should reuse its own installer/update trust chain for remote hosts.
It should not copy Herdr's binary transfer implementation or grow a second
remote-only installer inside `openalice remote`.

## Stable API Versus Private Presentation Protocol

Herdr currently exposes two materially different interfaces:

| Interface | Purpose | Coupling |
|---|---|---|
| Private binary client socket | full TUI attach, raw input, resize, semantic/ANSI render frames, local presentation effects | tightly coupled to Herdr's TUI |
| JSON socket API | version/capabilities, session snapshot, workspace/tab/pane/agent control, event subscription | intended as neutral Runtime control |

The JSON API exposes version and protocol in `ping`, a complete
`session.snapshot`, and event subscriptions. The snapshot contains focused
identifiers plus workspace, tab, pane, layout, and agent records; see
[`src/api/schema/session.rs#L8-L22`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/api/schema/session.rs#L8-L22).
The public API method surface is dispatched independently of the private TUI
client in
[`src/api/server.rs#L307-L425`](https://github.com/ogulcancelik/herdr/blob/a0678a38b9426b011f66e1b88ff7aaa9bf877104/src/api/server.rs#L307-L425).

The snapshot-plus-events shape is the better model for an independent
OpenAlice Studio. On connect or reconnect, a client needs a coherent snapshot,
a sequence/cursor boundary, and ordered events after that boundary. If the
cursor cannot be resumed, the client must resnapshot instead of guessing. PTY
bytes remain a specialized stream keyed by stable Runtime identities.

## What OpenAlice Should Borrow

| Herdr lesson | OpenAlice adaptation |
|---|---|
| Default client/server split | Make Guardian-supervised Runtime a named CLI surface without changing Electron ownership |
| Two distinct SSH modes | Preserve ordinary SSH/manual startup and add a separate managed `remote` orchestration command |
| Remote execution, local presentation | Keep browser/Electron local when useful; keep Workspace files, Agent processes, tools, and credentials on the remote host |
| Versioned handshake | Version local control and future Studio protocols from the first release |
| Reliable control, droppable frames | Never let a slow terminal viewer build an obsolete render backlog |
| Explicit foreground/writer/observer ownership | Specify input and resize authority before supporting concurrent clients |
| Snapshot plus events | Use presentation-neutral Runtime facts for a future independent Studio |
| Structured local stop | Ask Guardian to stop its own tree, then verify shutdown; do not kill guessed PIDs |
| Consentful bootstrap | Probe first, show a plan, default to no mutation, reuse the normal OpenAlice installer |
| Precise persistence vocabulary | Distinguish detach, restart, scrollback, native Agent resume, and live handoff |

## What OpenAlice Should Not Borrow

- Do not replace the existing browser/Electron UI with a server-rendered TUI
  framebuffer protocol. OpenAlice already has a presentation-neutral HTTP/WS
  surface and a complete Electron client.
- Do not make the server depend on a currently attached client. Guardian,
  workspaces, schedules, and Agent processes must remain valid without one.
- Do not let SSH mutate a host merely because a connection succeeded. Install,
  update, start, takeover, and stop are separate consent and authority steps.
- Do not create a second installation path for remote machines. The installed
  CLI and release trust chain must be the same as local bootstrap.
- Do not claim that daemon persistence implies PTY crash recovery or Agent
  conversation recovery.
- Do not expose a private control socket through SSH or HTTP by default.
- Do not adopt Herdr's AGPL implementation. Learn from the public architecture,
  keep source attribution, and implement OpenAlice's contract independently.

## Decision for OpenAlice

The first OpenAlice increment should establish a durable server lifecycle and
then compose SSH around the existing same-origin localhost application:

```text
local browser or Electron client
  └── local loopback endpoint
        └── SSH transport
              └── remote loopback Alice HTTP + PTY WebSocket
                    └── Guardian-owned Runtime and native Agent CLIs
```

This gives users a useful remote product before inventing a new Studio
protocol. In parallel, server status and future shared state must use neutral
Runtime names and versioned schemas so a later independent frontend can consume
`snapshot + events + terminal streams` without inheriting a server-rendered UI
protocol. The authoritative commands, ownership rules, security boundary, and
acceptance stages are specified in [[docs/remote-access.md]].
