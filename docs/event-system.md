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
