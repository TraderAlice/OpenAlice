# Web conversation surface

The Web surface presents an existing Workspace Session through its runtime's
structured protocol instead of a PTY. It is another attachment to the same
product Session, not another runtime or transcript. The native runtime still
owns conversation state, credentials, tools, and approvals.

Read this guide before changing `src/workspaces/web-session-host.ts`,
`src/workspaces/web-session/`, `composeWebCommand`, Web routes, or browser
conversation modules. Rendering policy lives in
[[docs/ui-interaction-and-motion.md]].

## Ownership

| Layer | Owner | Must not |
|---|---|---|
| Adapter | Declare `capabilities.web` and compose structured-mode launch | Parse protocol output or hold Session state |
| Transport | Speak one wire over stdio, drive neutral state, surface requests, learn native id | Spawn processes, touch registries, or branch on launching adapter |
| Host | Spawn/supervise one child, own snapshot revision, dispatch controls, tail stderr | Branch on Agent ids or wire names |
| Service/routes | Bind `SessionRecord`/`resumeId`, enforce one process, expose snapshots | Reach into transport internals |
| Browser | Poll snapshots, group neutral messages, answer requests by option id | Import runtime APIs or branch on wire beyond copy |

Runtimes without a structured protocol remain TUI-only. Do not advertise Web
when tool approval cannot round-trip or an exact recorded conversation cannot
reopen. `agentSupportsWeb(agents, agent)` is the sole launch-affordance gate.

## Wires and exact continuation

Transports own `pi-rpc`, ACP, Claude stream-json, and Codex app-server protocol
details. Adapters compose process commands; the host remains protocol-neutral.
Verify wire enums and request/response schemas against the installed native CLI,
not TypeScript-style naming or another runtime using the same transport.

Web never resumes “last.” It reopens the exact native id recorded for the
Session's `resumeId`, or starts a fresh conversation only for a fresh product
Session. If a transport cannot load an existing transcript, opening fails with
guidance and preserves the native id; it must not silently substitute a new
conversation.

TUI/Web/background ownership is exclusive. Switching surface stops the previous
process and waits for actual exit under the shared resume lease. Deliberate PTY
or Web disposal must not trigger browser reconnect. Background occupancy is
displayed without attaching a second interactive process.

A rejected pre-turn prompt leaves the snapshot `idle`, or `failed` if the child
is gone, with an error. `working` without an in-flight turn is a transport bug.
Transport shutdown and route rollback must not race registry writes or replace
the child's startup diagnostic with disposal errors.

## Neutral snapshot

`src/workspaces/web-session/model.ts` is mirrored by
`ui/src/components/workspace/api.ts`:

- messages use neutral user/assistant/toolResult/notice/unknown roles and parts;
- unknown records remain visible as protocol-drift audit evidence;
- permission/question requests carry the runtime's actual option ids and labels;
- `awaiting-input` means the turn remains in flight and rejects another prompt;
- `streamingMessage` is cumulative replacement, moved into messages at turn end.

The browser answers `{ requestId, optionId, text? }`. Free text is allowed only
when the question declares it; permission requests reject text. Abort clears
all pending requests. Never synthesize options the runtime did not offer.

Snapshots are ephemeral. Do not persist, migrate, or use them as transcript
history. Native transcript loading remains transport-owned; Alice does not add
a second transcript store.

`SessionRecord.surface` retains the shipped value `webpi` for every Web runtime.
Changing it would require a persisted migration without behavioral gain. Routes,
code, and user copy use “Web,” not “WebPi.”

## Routes and browser boundary

- `POST /web/open` validates Web capability and execution ownership. Optional
  credential/model/effort selection follows paused-Session replacement: validate,
  stop, persist secret-free binding, reopen the same native conversation. Busy
  turns reject edits; invalid input retains the old process; failed relaunch
  remains paused for recovery.
- `GET /web?revision=` returns a snapshot or `{ unchanged: true }`.
- `POST /web/prompt` and `/abort` control the turn.
- `POST /web/respond` answers one validated request.

Demo fixtures mirror adapter capabilities and request behavior. Runtime identity
may change copy, not browser lifecycle logic. Managed launch permissions follow
[[docs/model-semantics-and-runtime-injection.md]]; protocol permission handling
remains available for native policy requests.

Assistant file references are parsed outside transports. Workspace reads enforce
realpath containment and bounded content. Missing references stay literal;
code, escaped brackets, incomplete syntax, and user prose are not reinterpreted.
Initial history does not trigger automatic workbench opens, and unmount cancels
resolution. Market references use the shared market data owner rather than
Workspace file access.

Visual text reveal is presentation only: completion, Stop, reduced motion, and
unmount flush/cancel it without changing authoritative snapshots or polling.

## Load-bearing paths

- `src/workspaces/web-session-host.ts` — process and snapshot ownership.
- `src/workspaces/web-session/` — neutral model and one transport per wire.
- `src/workspaces/adapters/` — capability declaration and command composition.
- `src/workspaces/service.ts` and Workspace routes — Session binding, exclusivity,
  open/prompt/abort/respond lifecycle.
- `ui/src/components/workspace/` — API mirror, polling, presentation, requests,
  and reference rendering.
- `ui/src/demo/fixtures/web-session.ts` — demo capability/request projection.

## Verification gates

Extend `web-session-host.spec.ts` for new protocol messages and
`adapters/web-command.spec.ts` for launch changes. Run owning root/UI typechecks
and select protocol/lifecycle suites explicitly; a scenario/owner intersection
can exclude shared wire evidence. Update demo behavior with contract changes.

For a changed runtime, use the installed CLI to exercise explicit model launch,
a completed turn, a tool permission/question, Stop, errors, and exact native
transcript restoration across Web ↔ TUI. A shared fake-process handshake does
not prove every runtime. Use [[docs/development-workflow.md]] for cross-owner
acceptance and report unrun live-runtime gaps.
