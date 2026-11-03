# Workspace Session and Artifact Provenance

This guide owns product Session identity and provenance for Sessions, reports,
Inbox deliveries, Issues, and trade decisions. Follow-up surfaces must resolve
origin here rather than inferring an author from a Workspace, runtime, or run.

Related guides: [[docs/project-structure.md]] and
[[docs/workspace-issues-and-scheduling.md]].

## Session identity

`resumeId` is OpenAlice's canonical, durable product Session identity;
`@resumeId` is its visible signature. Every live Agent receives
`OPENALICE_RESUME_ID` and `OPENALICE_SIGNATURE`, but server-side request origin
is authoritative for Inbox, Issue, and trade attribution. `alice signature show`
resolves that same origin.

Standalone Markdown may end with `Signed-by: @resumeId`; the UI links that
signature to the exact Session. A separate authorship sidecar is unnecessary.

The identifiers are not interchangeable:

| Identity | Scope | Product exposure |
|---|---|---|
| `workspaceId` | Durable context and capability boundary | Public |
| `resumeId` | One stateful product Session across interactive and headless turns | Public follow-up handle |
| `SessionRecord.id` | Durable launcher roster and process-attachment key | Only attachment surfaces |
| `taskId` / `runId` | One headless execution | Public execution evidence |
| `agent` | Runtime kind, shared by many Sessions | Display/selection metadata |
| `agentSessionId` | Native CLI conversation locator | Backend only |
| PID / live PTY | Ephemeral process incarnation | Not an identity |

A new worker receives a new `resumeId`, even in the same Workspace and runtime.
`ResumeRegistry` binds one `resumeId` immutably to one Workspace and runtime.
It may refresh native mappings and resolve secrets at launch, but never moves
the Session or silently applies later Workspace defaults.

`SessionRecord` is born with the `resumeId` and survives surface and lifecycle
changes. Headless and interactive turns must not duplicate roster rows. Archive
and soft delete change presence, not identity; deleted Sessions reject follow-up.

Optional immutable `metadata.createdBy` records Session birth (`interactive`,
`issue`, `headless`, or `conversation`) and is first-write-wins. Optional mutable
`displayName` lives beside the secret-free `ai` binding in
`.alice/sessions/<resumeId>.json`; nametag edits do not change recency, binding,
or provenance. The global registry hydrates these Workspace-owned fields but
never flushes them into `resume-identities.json`.

## Provenance envelope and index

Every attributable occurrence carries a server-stamped origin:

```ts
interface SessionOrigin {
  kind: 'session'
  workspaceId: string
  resumeId: string
  agent: string
  execution?:
    | { kind: 'headless'; taskId: string }
    | { kind: 'interactive'; sessionRecordId: string }
}
```

Agents cannot claim another origin through tool arguments. Native session ids,
keys, and provider payloads never enter this envelope.

Artifact references are typed: report `{ workspaceId, path, revision? }`,
Inbox `{ inboxEntryId }`, Issue `{ workspaceId, issueId }`, and trade decision
`{ accountId, decisionId }`. Immutable provenance edges join an artifact,
action (`created`, `updated`, `commented`, `sent`, `decided`, or
`reconstructed`), Session/human/external origin, and timestamp.

Mutable artifacts retain occurrence-level edges rather than one mutable author.
Adjacent updates from one origin coalesce within fifteen minutes; another
origin or intervening action starts a new activity. Reverse indexes support
audit feeds but do not redefine ownership.

## Follow-up resolution

One resolver serves CLI and UI follow-ups:

1. A known usable `resumeId` continues that exact Session (`exact`).
2. A known unavailable Session returns `unavailable` with its preserved origin
   and reason. A declared successor is a handoff, not rewritten authorship.
3. Unknown origin in a known Workspace recruits a new Session and labels the
   result `reconstructed`.
4. Unknown Workspace returns unavailable; no agent target is invented.

`reconstructed` never means original author. The first reconstruction is an
artifact occurrence; later questions may continue that reconstruction Session
while retaining the reconstructed mode. Selecting the latest run or editor is
an explicit query, never an ownership fallback. The caller's prompt is unchanged
unless reconstruction guidance was explicitly requested.

`conversation create` starts a new Session; `conversation ask --resume-id`
continues an existing one. Business wrappers such as `inbox ask` and `issue ask`
delegate to this resolver. `taskId` addresses execution reads and waits, not
product identity. Waiting is explicit; a bounded server wait does not cancel
work or create a retry loop.

## Artifact contracts

### Reports and Inbox

A report's durable identity is `{ workspaceId, path }`; content-specific
questions also require an immutable revision. Inbox publication stamps a
`sha256:<hex>` revision from the bytes sent and uses it for both attachment and
provenance. Rendering may remain live; the hash identifies the sent revision.

Inbox is an immutable delivery occurrence. Its origin identifies the Session
that called `inbox_push`, independently of later edits to linked documents.
Legacy entries without a sender use reconstruction. The visible sender is
`@resumeId`, optionally with a runtime label; runtime alone is insufficient.

### Issues

Issue creation/mutation provenance and execution responsibility are separate.
`assignee` alone owns future execution:

- exact `@resumeId`: continue that Session; its runtime and binding win over
  Issue launch fields, and turns serialize per Session;
- `@new-then-resume`: recruit once, atomically replace the token with the exact
  signature, then continue that owner;
- `@new-each-run`: recruit a fresh Session for every fire; files provide shared
  continuity, conversational memory does not.

Agent-created `@me` is resolved server-side and never persisted. An unavailable
exact owner blocks rather than silently recruiting a replacement. Issue
Activity contains attributable changes and structured comments; operational
runs remain a separate ledger. Direct file edits are attributed only when one
Session is unambiguous, otherwise remain unknown.

For a fixed owner, human comments dispatch to that owner and replies link by
`replyTo`. Workspace-owned assignee modes follow their recruitment policy.
Unowned human comments may use creator provenance or explicit reconstruction;
agent-authored comments without an owner remain notes. Connector desk comments
use this same contract and do not create another conversation object.

### Trade decisions

The causal chain is Session decision/request → human or policy approval → UTA
operation → broker fills. A trade decision reference uses the UTA Git commit
hash scoped by account. Staging without a commit is not a durable decision.
Approvals, push/order/fill ids, and broker records remain separate execution
evidence. Alice attributes the decision only from authoritative Session context;
UTA remains the sole trading and execution authority.

## Dispatch communication and journals

`buildDispatchCommunication` constructs one validated Task snapshot separating
caller origin, execution target, optional business subject, and reply ownership
(`caller`, `issue-comment`, `issue-run`, or `none`). The snapshot, not mutable
Issue associations, determines external delivery for the turn. Legacy trigger
and inquiry fields are indexes, never transport addresses. Missing or invalid
communication receives no inferred Connector route.

Comment persistence and transport completion are independent: empty, failed,
interrupted, or comment-write-failed turns still close admitted external
activity. `taskId` identifies the transport turn; `commentId` identifies only
the discussion edge.

`agent-conversations.jsonl` is a private append-only dispatch/completion
projection containing prompts and replies. Logging failure cannot affect
message delivery. `HeadlessTaskRegistry` remains execution truth and structured
logs remain diagnostics; neither journal is a dispatch authority or Agent
notification mechanism. Browser access is bounded and authenticated, with no
arbitrary file reads, replay, resume, edit, or delete capability.

## Load-bearing paths

- `src/workspaces/resume-registry.ts` — product/native identity mapping.
- `src/workspaces/session-registry.ts` — durable Session roster and indexes.
- `src/workspaces/product-session-coordinator.ts` — paired birth and repair.
- `src/workspaces/headless-task-registry.ts` — execution truth and lineage.
- `src/workspaces/service.ts` — dispatch, resume, and Session concurrency.
- `src/workspaces/conversation-control.ts` — provenance resolution and follow-up.
- `src/workspaces/dispatch-communication.ts` — immutable reply-routing snapshot.
- `src/workspaces/agent-conversation-log.ts` — private conversation projection.
- `src/tool/conversation.ts` and `src/webui/routes/inquiries.ts` — Agent/human
  follow-up entry points.
- `src/core/inbox-store.ts` and `src/server/inbox-origin.ts` — Inbox records and
  server-stamped origin.
- `src/workspaces/issues/{declaration,mutate,board}.ts` — Issue contracts and
  projections.
- `src/services/uta-client/` and `services/uta/src/domain/trading/` — decision
  correlation and trading authority, respectively.

Verify focused identity, registry, provenance, conversation, Issue, and Inbox
suites plus owning typechecks. Cross-Session or dispatch changes require a real
headless-to-interactive continuation and exact/reconstructed/unavailable
resolution checks; use [[docs/development-workflow.md]] for delivery scope.
