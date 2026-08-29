# Event System (Retired)

OpenAlice no longer has an Alice-side event bus, producer/listener topology, or
webhook task-ingest API. Those paths were remnants of the former in-process
AgentWork architecture and were removed rather than rebuilt as a second
scheduler.

Current automation is owned by self-describing Workspace issues:

- [[docs/workspace-issues-and-scheduling.md]] — [Workspace issues and scheduling](workspace-issues-and-scheduling.md)
- [[docs/project-structure.md]] — [Project structure](project-structure.md)

The supported chain is `.alice/issues/<id>.md` plus optional `when` metadata,
followed by a headless Workspace run and Inbox delivery. External controllers
use the Workspace issue and headless APIs described in the owner guide; they do
not post task events.

## What Remains

`src/core/event-log.ts` remains as a domain-neutral append-only JSONL journal
utility. UTA currently uses it for account-health and snapshot records. It does
not validate AgentWork event types, dispatch Alice task listeners, start
Workspace agents, or expose Alice automation routes.

Existing user `data/config/webhook.json` files are harmless orphaned state.
OpenAlice no longer reads, seeds, rotates, or deletes them automatically.
History preserves the removed webhook, Flow UI, topology, and listener-registry
implementation if archaeology is required.

Do not recreate task dispatch on top of the journal. Extend Workspace issues,
headless runs, or Inbox reporting when automation needs a new capability.

## Product Activity Journal

OpenAlice also maintains one append-only product activity journal for facts that
the UI is expected to consume. It answers “what did OpenAlice do for the user?”;
ordinary diagnostic output continues to use structured launcher logs and must
not be copied into this stream.

The journal is deliberately not an event bus:

- a producer records only after its own durable domain write succeeds;
- a journal failure never rolls back or starts domain work;
- Office, Sonner, occupancy, and future unread counters are independent read
  projections over the same ordered facts;
- only Agent lifecycle events participate in Office occupancy.

Product modules install themselves through a registered activity family and a
scoped recorder. The journal core does not import or start News, Inbox, trading,
or another optional product. TraderAlice currently installs Agent, Inbox, and
per-item News facts. NanoAlice can omit product-specific families, and future
Workspace products can register new families without rebuilding the journal or
creating another notification polling path.

For compatibility with the first shipped Agent-only projection, the physical
file remains `state/agent-runtime.jsonl` and the read API remains
`/api/agent-runtime` in this increment. Those names are compatibility details;
their contract is the broader product activity journal. A future physical
rename requires the normal idempotent persisted-state migration.
