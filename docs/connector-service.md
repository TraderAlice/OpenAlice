# Connector Service

This guide owns external Connector process boundaries, adapter extension,
secrets, delivery guarantees, health, and acceptance. Related contracts live in
[[docs/workspace-issues-and-scheduling.md]] and
[[docs/workspace-lifecycle.md]].

## Product and process boundary

Connector Service projects durable OpenAlice Inbox entries into optional
external private chats. It is not an Agent runtime, model loop, chat history
authority, or source of truth. Telegram, Discord, Slack, and Feishu are adapter
implementations, not hard-coded product categories.

- Local Inbox append completes before any external request.
- Agent pushes enter through the Workspace CLI with server-validated Session
  origin; Connector has no MCP identity dependency.
- Connector failure never changes `inbox_push` success or Inbox read state.
- The service is optional in every trading mode. Guardian may start, stop, or
  restart it without restarting Alice or UTA.
- Each adapter serves one owner account/private chat; group/channel broadcast
  is out of scope.
- Connector never talks directly to UTA or reads Workspace directories. Alice
  validates actions and materializes bounded files across the process boundary.
- External chat renders the visible `@resumeId`; a runtime label may accompany
  but never replace it.

```text
Workspace Agent -> alice inbox push -> durable Inbox append
                -> non-blocking Alice bridge -> loopback Connector
                -> adapter registry -> external owner chat

Owner DM/action -> sealed Connector queue -> Alice claim and validation
                -> Issue comment or Alice-owned artifact/UTA action
                -> directed adapter response
```

Outbound Inbox delivery and inbound phone-desk chat are separate capabilities.
An adapter may support notifications without ingesting owner messages. Generic
control commands and adapter-declared capabilities drive presentation; core
must not branch on platform ids.

## Adapter extension

Adding a connector requires a `ConnectorDefinition`, a `ConnectorAdapter`,
factory registration at service composition, adapter tests, and any packaging
dependencies. Definitions own fields, non-secret options, setup metadata, and
command/capability declarations. Settings consumes them as data.

`start()` validates durable configuration and arms the adapter; `stop()` is
idempotent and releases every SDK resource. Long-lived adapters recover
transient disconnects through their SDK or the shared supervisor. DeliveryManager
may classify retry/fatal failures but never parse platform-specific error text.
Health reflects the external session (`starting`, `awaiting_link`, `healthy`,
`degraded`, `stopped`), not merely process startup.

## Delivery and files

Inbox remains authoritative. Connector `/inbox` views are bounded summaries and
callbacks carry validated ids or page-local indexes, never trusted raw paths.
On-demand file pull uses a TTL-limited request containing request, connector,
entry, and document ids. Alice re-reads the entry, resolves the Workspace, and
uses the existing attachment safety path before directed delivery. Cancel does
not enqueue; file pull does not alter read state.

Alice reads source Workspace files before externalization. Connector never
accepts a model-provided fetch host. Missing, oversized, unsupported, or
path-escaping files remain visible as references and never block the text
notification. One notification or final reply carries at most five unique files
of at most 1 MiB each. Source and delivery byte evidence remain separate;
ambiguous encodings are not guessed. Static HTML is an attachment, never inline
executable chat content.

Final owner replies may contain Workspace-relative `[[path]]` references.
`file-delivery` owns Agent guidance. The parser ignores code, escaped brackets,
and incomplete/unknown syntax; only successfully resolved references leave the
visible text. Files retain bytes and filenames. The generic Workspace file API
enforces realpath containment and rejects directories, absolute paths, escaping
symlinks, and oversized reads. Upload failure is visible and journaled without
blocking remaining files. `market/...` references use Alice's local market
renderer instead of Workspace file access.

Automation `[[no-reply]]` outside code suppresses text and files before file
resolution. Ordinary conversations may discuss the marker literally. Inbound
owner comments are not echoed. Progress never uploads files.

Delivery is best-effort, not exactly-once. Concurrent/repeated message ids share
one bounded in-process attempt; dedup does not survive restart. Local Inbox
records and Issue comments are durable even when external delivery fails.

## Phone desk and execution-owned replies

Alice owns one phone-desk Issue per desk-capable connector. Owner DMs enter a
sealed queue keyed by platform event id. Alice claims only while a live desk
exists and no generation is running; stacked messages become one quoted comment.
Ack follows durable append; failure releases the claim and process loss waits
for lease expiry.

Desk Sessions are transport-owned: attributable and resumable through their
Issue, visible in diagnostics, but excluded from the ordinary Ask Alice roster.
They are not general coworkers. Owner text and automation use trusted source
context; Workspace/Issue projection does not parse delivery markers.

Alice fixes `DispatchDelivery` at dispatch. Connector must not infer recipients
from the target Session or a mutable Issue association. Accepted, progress,
final, and failed events use the headless `taskId` throughout. Terminal transport
activity closes even when the answer is empty, suppressed, failed, interrupted,
or its comment write fails.

Accepted/progress are ephemeral activity; final/failed replies are persistent.
Sealed mid-turn text may be shown, but tool names, payloads, and errors stay off
owner chat. Activity leases expire local typing/drafts without declaring the
Agent failed or sending a final answer. Late progress and duplicate public
finals are rejected within the bounded dedup window.

Alice persists terminal handoff before posting. Connector HTTP 202 means
accepted, not delivered. Lost receipts are uncertain; recovery sends only a
textless close and never replays public output. A Connector crash may lose
accepted unsent output; unknown historical tasks never replay.

Trading review actions cross Alice's validated action bridge. UTA revalidates
the expected pending hash in the same mutation request; replay after the pending
commit changes cannot repeat a write. Connector presentation never grants
trading authority or bypasses lite/read-only and approval policy.

## Configuration and secrets

`data/config/connector-service.json` contains only `{ "enabled": boolean }`.
`data/config/connectors.json` is AES-256-GCM sealed; the machine key remains at
`<OPENALICE_HOME>/sealing.key`, outside portable `data/`.

Settings APIs return definitions, non-secret values, setup links, and secret
presence markers—never token contents. First-time missing secrets save together;
replacement and removal are explicit separate actions. Empty drafts preserve
stored secrets, and generic auto-save omits secret fields. Adapter-scoped writes
merge under the same cross-process lease and reconcile only the affected
adapter. Guardian owns process start/stop and bounded recovery.

`data/state/connector-work-queue.json` is a versioned sealed queue for inbound
text and artifact/UTA actions. External handlers succeed only after atomic queue
commit. Alice uses bounded claim leases with idempotent ack/release; queue
payloads contain no Connector credentials. The I/O journal is diagnostic, not
queue recovery.

Guardian forwards explicit standard proxy variables and the supported app
fallback. Connector owns one shared proxy transport; adapters consume its
context rather than changing global agents or reading environment independently.
Only supported HTTP(S) proxy rules are routed, and proxy URLs/credentials are
never logged.

## Health and evidence

Optional-service health is `disabled`, `healthy`, or `degraded` with stable
reason, timestamp, and latency. Disabled performs no request; healthy requires
2xx plus valid service schema; all other enabled outcomes degrade. Probe failure
never changes Alice or Inbox availability. `starting` and `awaiting_link` are
intentional setup states, not service degradation.

Guardian restarts an unexpectedly exiting configured Connector forever with
capped jittered backoff; manual disable and shutdown cancel recovery. Process
health tests do not prove adapter connectivity or human-visible external
receipt.

The private bounded `data/logs/connector-io.jsonl` journal records normalized
notification text, attachment evidence, per-adapter attempts, and pseudonymized
command evidence. Tokens and raw external user/chat ids are excluded. Replay
consumes only notification ingress events through a fake adapter; recorded
results are evidence, never new inputs.

Live external-account confirmation is opt-in and manual. It requires operator
permission, user-owned credentials, and a linked owner session. Without them it
is skipped, never represented as passed.

## Load-bearing paths

- `packages/connector-protocol/` — shared definitions, schemas, delivery, and
  health client.
- `services/connector/src/core/` — adapter/command registry, DeliveryManager,
  sealed work queue, reply directives, and activity lifecycle.
- `services/connector/src/adapters/` — platform implementations.
- `src/core/connector-config.ts` — sealed config and Guardian control.
- `src/services/connector-client/` — Inbox projection, action bridges, and
  Alice-side health.
- `src/workspaces/issues/telegram-desk-{chat,project}.ts` — desk claim and
  trusted owner-chat projection.
- `src/workspaces/binary-file.ts` and `src/server/workspace-files.ts` — generic
  bounded file access without Connector types.
- `src/webui/routes/connectors.ts` and `ui/src/pages/ConnectorsPage.tsx` —
  definition-driven Settings surface.

## Verification gates

Connector changes require protocol/service typechecks, adapter registry tests,
fixture replay and journal privacy/rotation tests, isolated process health and
accepted-delivery smoke, and proof that Inbox append succeeds with Connector
absent. Settings changes require browser verification without exposed secrets;
Guardian changes require isolated-home enable/restart/disable recovery and
packaged resource assertions.

Run `pnpm test:contract:connector-replay` for offline replay and
`pnpm test:system:connector` after building for the real process lane. Real
third-party delivery remains a separate opt-in acceptance gate. Apply the
cumulative scope rules in [[docs/development-workflow.md]].
