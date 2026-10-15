# Event System (Retired)

OpenAlice no longer has an Alice-side event bus, producer/listener topology, or
webhook task-ingest API. Those paths were remnants of the former in-process
AgentWork architecture and were removed rather than rebuilt as a second
scheduler.

Automation now belongs to Workspace issues and headless execution:
[[docs/workspace-issues-and-scheduling.md]]. The shared append-only Product
Activity Journal is active and has its own owner guide:
[[docs/product-activity-journal.md]]. Neither it nor the domain-neutral
`src/core/event-log.ts` utility dispatches task events.

Old `data/config/webhook.json` files are orphaned state; OpenAlice no longer
reads or cleans them up automatically. Git history preserves the removed
webhook, Flow UI, topology, and listener implementation.
