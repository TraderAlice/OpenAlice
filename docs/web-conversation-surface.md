# Web conversation surface

The Web surface presents an existing Workspace Session in the browser through
its runtime's own structured protocol instead of a PTY. It is a presentation of
the same durable Session, not another runtime: the runtime still owns the
transcript, credentials, tools, and approvals; Alice keeps one long-lived child
process per Session record and projects that process's protocol into one
neutral live snapshot.

Read this guide before changing `src/workspaces/web-session-host.ts`,
`src/workspaces/web-session/`, `composeWebCommand`, the `/api/workspaces/:id/sessions/:sid/web/*`
routes, or the browser modules `useWebConversation`, `web-presentation.ts`,
`WebSessionView`, and `ConversationRequestCard`. Rendering rules live in
[[docs/ui-interaction-and-motion.md]]; Manager-specific launch rules live in
[[docs/workspace-manager.md]].

## Ownership

| Layer | Owner | Must not |
|---|---|---|
| Adapter (`src/workspaces/adapters/<agent>.ts`) | Declare `capabilities.web = { wire, permissionPrompts, freshSession }` and compose the structured-mode argv in `composeWebCommand` | Parse protocol output or hold session state |
| Transport (`src/workspaces/web-session/<wire>-transport.ts`) | Speak exactly one wire over the child's stdio, drive `WebSessionState`, surface requests, learn the native session id | Spawn processes, touch the registry, or know which adapter launched it |
| Host (`src/workspaces/web-session-host.ts`) | Spawn/supervise the process, own the snapshot revision, dispatch prompt/abort/respond to the transport, tail stderr | Branch on agent ids or wire names |
| Service/routes | Bind the Session record and `resumeId`, enforce one live process per Session, expose the snapshot | Reach into transport internals |
| Browser | Poll the snapshot, group the neutral messages into turns, answer requests with an option id | Import runtime APIs or branch on the wire beyond copy |

`agy` and `shell` have no structured protocol and stay TUI-only. Do not add a
Web capability to a runtime whose structured mode cannot round-trip tool
approval or cannot reopen an exact recorded conversation.

## Wires

| Wire | Runtimes | Process | Permission prompts | Fresh session |
|---|---|---|---|---|
| `pi-rpc` | `pi`, `omp` | `--mode rpc` JSONL; Pi additionally `--approve`, omp `--auto-approve` | none in RPC mode; launch-time approval | yes (RPC allocates the id) |
| `acp` | `cursor`, `grok`, `opencode` | Agent Client Protocol JSON-RPC over stdio (`cursor-agent acp`, `grok agent --no-leader stdio`, `opencode acp`) | `session/request_permission` with the agent's own options | `session/new`; resume via `session/load` when advertised |
| `claude-stream-json` | `claude` | `-p --input-format stream-json --output-format stream-json --include-partial-messages --permission-prompt-tool stdio` | `control_request` `can_use_tool`; answered with allow/deny | `--session-id <uuid>` chosen by the adapter |
| `codex-app-server` | `codex` | `codex app-server --listen stdio://` with MCP registration, `approvalPolicy: never`, `sandbox: danger-full-access` | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` (answered with a `decision` enum), `item/permissions/requestApproval` (answered with the granted `permissions` profile + `scope`), `item/tool/requestUserInput` | `thread/start`; resume via `thread/resume` |

If ACP does not advertise `loadSession`, opening an existing Session fails with
terminal guidance and preserves its native ID. Never replace its transcript
with `session/new`; only a separate fresh Session may allocate a new ID.

The Web surface never resumes "last": it reopens the exact recorded native id
or starts a fresh conversation the transport reports back, so the Session's
`resumeId` binds to one native transcript exactly as PTY discovery does.

Codex wire enums (`AskForApproval`, `SandboxMode`) are kebab-case and its
server-request response shapes differ per method; verify against
`codex app-server generate-json-schema --out <dir>` from the installed binary
before changing the transport rather than inferring from TypeScript-style
names.

Every transport must leave the snapshot in `idle` (or `failed` when the process
is gone) with `error` set when a prompt is rejected before the turn starts —
for example missing credentials. A snapshot stuck in `working` with no turn in
flight is a transport bug, not a runtime condition.

## Neutral model

`src/workspaces/web-session/model.ts` is the contract the browser mirrors in
`ui/src/components/workspace/api.ts`:

- `WebConversationMessage` borrows Pi's minimal roles — `user`, `assistant`
  (text / thinking / toolCall / data parts), `toolResult`, plus `notice` for
  system remarks and `unknown` for records a transport could not classify.
  Keep unknown records; they are the audit trail for protocol drift.
- `WebPermissionRequest` carries the runtime's own option list. Transports
  translate protocol enums into `{ id, label, tone }`; the browser answers
  with the same `id`. Never synthesize options a runtime did not offer.
- `WebSessionPhase` adds `awaiting-input` to the WebPi phases: the turn is
  still in flight and blocked on the user. Prompting during it is rejected;
  aborting drops the pending requests.
- `streamingMessage` is the cumulative in-flight assistant message and is
  replaced, never appended; transports move it into `messages` when the turn
  ends.

The snapshot is ephemeral. Do not persist it, do not migrate it, and do not
read it back as a transcript.

## Persisted surface value

`SessionRecord.surface` keeps the shipped value `webpi` (migration 0040) for
every runtime that opens in the Web surface. Renaming it would require a
migration for no behavioral gain; free-floating identifiers (routes, host,
components, labels) use "Web". User-facing copy says "Web", never "WebPi".

## Routes

- `POST /web/open` — checks `capabilities.web`, refuses a Session with a
  running headless turn, disposes a PTY on the same record, starts the host.
- `GET /web?revision=` — snapshot or `{ unchanged: true }`.
- `POST /web/prompt`, `POST /web/abort` — turn control.
- `POST /web/respond { requestId, optionId, text? }` — answers one request; the
  transport validates the option id and fails with `web_respond_failed`. For a
  question with `allowText`, send `optionId: ""` and nonblank `text` to answer
  freely. Permission requests reject text answers. Secret questions use a masked
  field. Cancelling a turn clears the entire pending question sequence.

Switching a running Web Session to the TUI stops the Web process first; the
reverse disposes the PTY. Exactly one process may own a Session record.

## Browser

`agentSupportsWeb(agents, agent)` is the only gate for launch affordances.
Runtime identity affects copy (placeholder, stop label, wire tooltip) and
nothing else. The request card is pinned above the composer; see
[[docs/ui-interaction-and-motion.md]] for the interaction rules. Demo mode
mirrors the capability table in `ui/src/demo/fixtures/web-session.ts` and
scripts a permission turn for prompting runtimes; update it with any contract
change.

## Verification

- `npx tsc --noEmit`, `pnpm test`, `cd ui && npx tsc -b`.
- `src/workspaces/web-session-host.spec.ts` drives a fake child over stdio for
  every wire; extend it when a transport learns a new message.
- `src/workspaces/adapters/web-command.spec.ts` pins each runtime's argv.
- `pnpm -F open-alice-ui dev:demo`: open a Claude/Codex/ACP quick chat, answer
  the request card, stop mid-turn, and confirm the notice.
- Live acceptance needs installed runtimes and is not part of routine CI: for
  each runtime, open one Session in Web, send a prompt that needs a tool,
  answer the card, stop mid-turn, then reopen the same Session in the TUI and
  confirm the native transcript is shared. State the gap when this was not run.

Grok agent flags belong after the `agent` subcommand; the pager TUI rejects
top-level `--no-leader` when launching ACP. Verify argv with the installed CLI,
not just a fake process. Startup errors retain the child exit diagnostic rather
than replacing it with transport-disposal errors. Failed opens are rolled back
by their route, so exit callbacks must not race that registry write. During a
live ACP turn, user-message echoes are ignored because prompt() already
appended the message; history replay still consumes user-message chunks.

### Native protocol differences

- OMP emits `agent_end` without Pi's later `agent_settled`; both must settle the
  turn and clear the streaming copy. A retrying agent_end must remain busy.
- Pi/OMP can accept a prompt and later emit an assistant with `stopReason:
  error` and `errorMessage`. Surface that error, including on history load;
  an empty assistant body is not a successful reply.
- Claude stream-json does not replay old messages on --resume. The transport
  loads the exact native session file under CLAUDE_CONFIG_DIR (or the native
  home default), follows the latest main parent chain, and excludes abandoned
  branches and sidechains. It does not create another transcript store.
- OpenCode ACP does not accept --model. Session projection sets its model in
  process-local OPENCODE_CONFIG_CONTENT and leaves Web argv free of that flag.
  Native-session config selectors can confirm the effective model. ACP also
  exposes [session configuration options](https://agentclientprotocol.com/announcements/session-config-options-stabilized).

A default handshake is insufficient acceptance for an adapter: also exercise
an explicit model, a completed turn, errors, and exact-session restoration with
the installed CLI. Keep login/provider/version failures distinct from parser
or lifecycle defects, and never claim every runtime passed from one shared
wire's fake-process fixture.

Managed launch permissions follow [[docs/model-semantics-and-runtime-injection.md]]. Protocol permission handling remains available for native policy requests; normal managed tool execution is approved at launch.

## Background ownership handoff

Issue and Connector desk work can preempt a TUI/Web interactive connection on
the same Session. Native context is retained. The shared resume lease excludes
new interactive starts while the previous child is stopping and the background
turn is running. A deliberate PTY disposal must not trigger browser reconnect.
Web shutdown waits for child termination, including the SIGKILL fallback, before
another writer may start. The UI renders background occupancy without attaching
a terminal to a headless Session.

Quick Start exposes a TUI / GUI selector beside the runtime. GUI is available
only with `web.freshSession`; `quick-chat` accepts `surface: webpi` and starts
the structured host directly with the same Session runtime binding. Omission
keeps the terminal default. The initial prompt is sent once after Web startup.
